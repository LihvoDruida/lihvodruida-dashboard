import DashboardIdentity from "@/components/DashboardIdentity";
import { getSession } from "@/lib/auth";
import {
  canManageDiscordMembers,
  canViewProfiles,
  guildStatusLabel,
} from "@/lib/permissions";
import {
  getMainCharacter,
  getOwnProfilePath,
  getProfilePublicName,
  listDashboardProfiles,
  type DashboardProfile,
} from "@/lib/profiles";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Профілі учасників",
  description:
    "Список профілів Mistblossom Vanguard з персонажами, ролями, мейнами та доступними діями за правами користувача.",
  path: "/profiles",
  keywords: ["профілі учасників", "персонажі WoW", "Battle.net"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROFILE_PAGE_SIZE = 20;
const VALID_LINK_FILTERS = new Set(["all", "linked", "unlinked"]);
const VALID_ROLE_FILTERS = new Set(["all", "admin", "moderator", "mentor", "member"]);
const VALID_SORTS = new Set(["activity", "name", "characters"]);

type LinkFilter = "all" | "linked" | "unlinked";
type RoleFilter = "all" | "admin" | "moderator" | "mentor" | "member";
type ProfileSort = "activity" | "name" | "characters";

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value?: string | null) {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Kyiv",
  }).format(date);
}

function formatNumber(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value);
}

function parsePage(value?: string) {
  const page = Number(value || "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function parseLinkFilter(value?: string): LinkFilter {
  return VALID_LINK_FILTERS.has(String(value || "")) ? (value as LinkFilter) : "all";
}

function parseRoleFilter(value?: string): RoleFilter {
  return VALID_ROLE_FILTERS.has(String(value || "")) ? (value as RoleFilter) : "all";
}

function parseSort(value?: string): ProfileSort {
  return VALID_SORTS.has(String(value || "")) ? (value as ProfileSort) : "activity";
}

function buildProfilesHref({
  query,
  link,
  role,
  sort,
  page,
}: {
  query: string;
  link: LinkFilter;
  role: RoleFilter;
  sort: ProfileSort;
  page: number;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (link !== "all") params.set("link", link);
  if (role !== "all") params.set("role", role);
  if (sort !== "activity") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/profiles?${suffix}` : "/profiles";
}

function mainCharacterLabel(profile: DashboardProfile) {
  const main = getMainCharacter(profile);
  if (!main) return { title: "Мейн не вибрано", subtitle: "Персонаж не призначений" };
  const title = `${main.name}${main.realmName ? ` • ${main.realmName}` : ""}`;
  const subtitle = [main.className, main.activeSpecName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" / ");
  return { title, subtitle: subtitle || "Клас / спеціалізація не визначені" };
}

function battleNetStatus(profile: DashboardProfile) {
  if (!profile.battlenet?.linked) return "Не підключено";
  const synced = profile.battlenet.lastSyncAt || profile.battlenet.lastConnectedAt;
  return synced ? `Синхр. ${formatDate(synced)}` : "Підключено";
}

function profileActivityTime(profile: DashboardProfile) {
  return parseDate(profile.lastLoginAt || profile.updatedAt)?.getTime() || 0;
}

function roleLabel(role: DashboardProfile["role"]) {
  if (role === "admin") return "Адмін";
  if (role === "moderator") return "Офіцер";
  if (role === "mentor") return "Наставник";
  return "Учасник";
}

function ProfileRow({ profile }: { profile: DashboardProfile }) {
  const displayName = getProfilePublicName(profile);
  const guildStatus = profile.groupName || guildStatusLabel(profile.role);
  const href = `/profile/${profile.profileId}`;
  const activityDate = profile.lastLoginAt || profile.updatedAt;
  const main = mainCharacterLabel(profile);
  const identity = profile.login ? `@${profile.login}` : `Discord · ${profile.providerUserId}`;

  return (
    <a
      className="profile-directory-row"
      href={href}
      role="row"
      aria-label={`Відкрити профіль: ${displayName}`}
    >
      <div className="profile-directory-user" role="cell" data-label="Користувач">
        {profile.avatarUrl ? (
          <img className="profile-directory-avatar" src={profile.avatarUrl} alt="" loading="lazy" />
        ) : (
          <span className="profile-directory-avatar profile-directory-avatar--fallback" aria-hidden="true">
            {Array.from(displayName.trim())[0]?.toUpperCase() || "?"}
          </span>
        )}
        <span className="profile-directory-user-copy">
          <strong>{displayName}</strong>
          <small title={profile.providerUserId}>{identity}</small>
        </span>
      </div>

      <div className="profile-directory-membership" role="cell" data-label="Група / роль">
        <strong>{guildStatus}</strong>
        <small>{roleLabel(profile.role)}</small>
      </div>

      <div className="profile-directory-main" role="cell" data-label="Мейн">
        <strong>{main.title}</strong>
        <small>{main.subtitle}</small>
      </div>

      <div className="profile-directory-character-count" role="cell" data-label="Персонажі">
        <strong>{formatNumber(profile.characters.length)}</strong>
        <small>збережено</small>
      </div>

      <div className="profile-directory-bnet" role="cell" data-label="Battle.net">
        <span
          className={`dashboard-table-pill ${profile.battlenet?.linked ? "dashboard-table-pill--ok" : "dashboard-table-pill--muted"}`}
        >
          {profile.battlenet?.linked ? "Підключено" : "Немає"}
        </span>
        <small>{battleNetStatus(profile)}</small>
      </div>

      <div className="profile-directory-activity" role="cell" data-label="Активність">
        <strong>{formatDate(activityDate)}</strong>
        <small>{profile.lastLoginAt ? "Останній вхід" : "Оновлення профілю"}</small>
      </div>

      <div className="profile-directory-open" role="cell" data-label="Дія">
        <span>Відкрити</span>
        <span aria-hidden="true">→</span>
      </div>
    </a>
  );
}

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canViewProfiles(user)) redirect(await getOwnProfilePath(user));

  const params = await searchParams;
  const query = String(params.q || "").trim();
  const linkFilter = parseLinkFilter(params.link);
  const roleFilter = parseRoleFilter(params.role);
  const sort = parseSort(params.sort);
  const requestedPage = parsePage(params.page);

  const matchedProfiles = await listDashboardProfiles({
    viewer: user,
    query,
    limit: 500,
  });

  const filteredProfiles = matchedProfiles.filter((profile) => {
    if (linkFilter === "linked" && !profile.battlenet?.linked) return false;
    if (linkFilter === "unlinked" && profile.battlenet?.linked) return false;
    if (roleFilter !== "all" && profile.role !== roleFilter) return false;
    return true;
  });

  filteredProfiles.sort((a, b) => {
    if (sort === "name") {
      return getProfilePublicName(a).localeCompare(getProfilePublicName(b), "uk", { sensitivity: "base" });
    }
    if (sort === "characters") {
      return b.characters.length - a.characters.length || profileActivityTime(b) - profileActivityTime(a);
    }
    return profileActivityTime(b) - profileActivityTime(a);
  });

  const pageCount = Math.max(1, Math.ceil(filteredProfiles.length / PROFILE_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const pageStart = (page - 1) * PROFILE_PAGE_SIZE;
  const profiles = filteredProfiles.slice(pageStart, pageStart + PROFILE_PAGE_SIZE);
  const pageEnd = Math.min(pageStart + profiles.length, filteredProfiles.length);
  const canManageCleanup = canManageDiscordMembers(user);
  const linkedBattleNetCount = filteredProfiles.filter((profile) => profile.battlenet?.linked).length;
  const characterCount = filteredProfiles.reduce((sum, profile) => sum + profile.characters.length, 0);
  const hasFilters = Boolean(query || linkFilter !== "all" || roleFilter !== "all" || sort !== "activity");

  const paginationState = { query, link: linkFilter, role: roleFilter, sort };

  return (
    <main className="container app-page profile-directory-page profile-directory-page--modern">
      <section
        className="dashboard-shell content-shell profile-directory-shell app-page-stack"
        aria-label="Профілі учасників Mistblossom Vanguard"
      >
        <DashboardIdentity user={user} activeSection="profiles" />

        <header className="hero panel dashboard-hero profile-directory-hero-modern app-page-hero profile-directory-hero-ref directory-hero">
          <div className="hero-copy dashboard-hero__copy profile-directory-hero-modern__copy">
            <div className="eyebrow">Mistblossom Vanguard • Профілі</div>
            <h1>Профілі учасників</h1>
            <p className="lead">
              Мейни, персонажі, Battle.net і активність — в одному списку. Пошук і фільтри працюють разом,
              а кожен рядок веде прямо до повного профілю.
            </p>
          </div>

          <div className="profile-directory-hero-overview" aria-label="Огляд профілів">
            <div className="profile-directory-hero-brand">
              <img src="/mistblossom-icon.png" alt="" loading="lazy" />
              <div>
                <strong>Mistblossom Vanguard</strong>
                <span>{user.groupName || guildStatusLabel(user.role)}</span>
              </div>
            </div>
            <div className="profile-directory-hero-metrics">
              <div><span>Знайдено</span><strong>{formatNumber(filteredProfiles.length)}</strong></div>
              <div><span>Персонажі</span><strong>{formatNumber(characterCount)}</strong></div>
              <div><span>Battle.net</span><strong>{formatNumber(linkedBattleNetCount)}</strong></div>
            </div>
          </div>
        </header>

        <section className="profile-directory-panel panel" aria-label="Список профілів">
          <div className="profile-directory-toolbar">
            <div className="profile-directory-toolbar-copy">
              <span className="eyebrow">Ростер профілів</span>
              <h2>{hasFilters ? "Результати" : "Усі доступні профілі"}</h2>
              <p>
                {filteredProfiles.length
                  ? `Показано ${pageStart + 1}–${pageEnd} із ${filteredProfiles.length}`
                  : "Немає профілів, які відповідають поточним умовам."}
              </p>
            </div>

            <form className="profile-directory-search" action="/profiles" method="get">
              <label className="profile-directory-search-field" htmlFor="profile-directory-search">
                <span>Пошук</span>
                <input
                  id="profile-directory-search"
                  name="q"
                  placeholder="Нік, персонаж або реалм"
                  defaultValue={query}
                />
              </label>

              <label className="profile-directory-filter-field">
                <span>Battle.net</span>
                <select name="link" defaultValue={linkFilter}>
                  <option value="all">Усі</option>
                  <option value="linked">Підключено</option>
                  <option value="unlinked">Не підключено</option>
                </select>
              </label>

              <label className="profile-directory-filter-field">
                <span>Роль</span>
                <select name="role" defaultValue={roleFilter}>
                  <option value="all">Усі ролі</option>
                  <option value="admin">Адмін</option>
                  <option value="moderator">Офіцер</option>
                  <option value="mentor">Наставник</option>
                  <option value="member">Учасник</option>
                </select>
              </label>

              <label className="profile-directory-filter-field">
                <span>Сортування</span>
                <select name="sort" defaultValue={sort}>
                  <option value="activity">За активністю</option>
                  <option value="name">За іменем</option>
                  <option value="characters">За персонажами</option>
                </select>
              </label>

              <div className="profile-directory-search-actions">
                <button className="btn primary" type="submit">Застосувати</button>
                {hasFilters ? <a className="btn subtle" href="/profiles">Скинути</a> : null}
              </div>
            </form>
          </div>

          <div className="profile-directory-context" aria-label="Поточний стан списку">
            <div><span>Профілі</span><strong>{formatNumber(filteredProfiles.length)}</strong></div>
            <div><span>На сторінці</span><strong>{formatNumber(profiles.length)}</strong></div>
            <div><span>Сторінка</span><strong>{page} / {pageCount}</strong></div>
            {canManageCleanup ? (
              <a className="profile-directory-maintenance-link" href="/dashboard/discord#discord-profiles">
                <span>Обслуговування профілів</span>
                <strong>Імпорт та очищення →</strong>
              </a>
            ) : null}
          </div>

          <div className="profile-directory-table-wrap">
            <div className="profile-directory-table" role="table" aria-label="Список доступних профілів">
              <div className="profile-directory-head" role="row">
                <span role="columnheader">Користувач</span>
                <span role="columnheader">Група / роль</span>
                <span role="columnheader">Мейн</span>
                <span role="columnheader">Персонажі</span>
                <span role="columnheader">Battle.net</span>
                <span role="columnheader">Активність</span>
                <span role="columnheader" aria-label="Дія" />
              </div>

              <div className="profile-directory-rows">
                {profiles.length ? (
                  profiles.map((profile) => <ProfileRow key={profile.profileId} profile={profile} />)
                ) : (
                  <div className="profile-directory-empty" role="row">
                    <span className="profile-directory-empty-icon" aria-hidden="true">⌕</span>
                    <strong>{hasFilters ? "Нічого не знайдено" : "Профілі ще не доступні"}</strong>
                    <p>
                      {hasFilters
                        ? "Зміни пошук або фільтри. Можна шукати за Discord-ніком, персонажем чи реалмом."
                        : "Профіль зʼявиться після входу учасника через Discord."}
                    </p>
                    {hasFilters ? <a className="btn subtle" href="/profiles">Очистити фільтри</a> : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          <footer className="profile-directory-footer">
            <div>
              <strong>{filteredProfiles.length ? `${pageStart + 1}–${pageEnd}` : "0"}</strong>
              <span> із {filteredProfiles.length} профілів</span>
            </div>
            <nav className="dashboard-table-pagination" aria-label="Навігація сторінками профілів">
              <a
                className={`btn subtle${page <= 1 ? " is-disabled" : ""}`}
                aria-disabled={page <= 1}
                href={buildProfilesHref({ ...paginationState, page: page <= 1 ? 1 : page - 1 })}
              >
                ← Назад
              </a>
              <span className="profile-directory-page-indicator">{page} / {pageCount}</span>
              <a
                className={`btn subtle${page >= pageCount ? " is-disabled" : ""}`}
                aria-disabled={page >= pageCount}
                href={buildProfilesHref({ ...paginationState, page: page >= pageCount ? pageCount : page + 1 })}
              >
                Далі →
              </a>
            </nav>
          </footer>
        </section>
      </section>
    </main>
  );
}
