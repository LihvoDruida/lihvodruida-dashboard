import DashboardIdentity from "@/components/DashboardIdentity";
import ListViewMemory from "@/components/ListViewMemory";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { listEntryId } from "@/lib/listViewState";
import ProfileAvatar from "@/components/ProfileAvatar";
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
  type DashboardProfile,
} from "@/lib/profiles";
import { listDashboardProfilePage, profileDirectoryFilters } from "@/lib/profileDirectory";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { fetchDiscordGuildMembersCachedForUi } from "@/lib/discordAdmin";

export const metadata = buildPageMetadata({
  title: "Профілі учасників",
  description:
    "Список профілів Mistblossom Vanguard з персонажами, ролями, мейнами та доступними діями за правами користувача.",
  path: "/profiles",
  keywords: ["профілі учасників", "персонажі WoW", "Battle.net"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function buildProfilesHref({ query, link, role, sort, cursor }: ReturnType<typeof profileDirectoryFilters> & { cursor?: string | null }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (link !== "all") params.set("link", link);
  if (role !== "all") params.set("role", role);
  if (sort !== "activity") params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
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

function roleLabel(role: DashboardProfile["role"]) {
  if (role === "admin") return "Адмін";
  if (role === "moderator") return "Офіцер";
  if (role === "mentor") return "Наставник";
  return "Учасник";
}

function ProfileRow({ profile, avatarUrl }: { profile: DashboardProfile; avatarUrl?: string | null }) {
  const displayName = getProfilePublicName(profile);
  const guildStatus = profile.groupName || guildStatusLabel(profile.role);
  const href = `/profile/${profile.profileId}`;
  const activityDate = profile.lastLoginAt || profile.updatedAt;
  const main = mainCharacterLabel(profile);
  const identity = profile.login ? `@${profile.login}` : `Discord · ${profile.providerUserId}`;

  return (
    <a
      className="profile-directory-row"
      id={listEntryId("profiles", profile.profileId)}
      data-list-entry="profiles"
      href={href}
      role="row"
      aria-label={`Відкрити профіль: ${displayName}`}
    >
      <div className="profile-directory-user" role="cell" data-label="Користувач">
        <ProfileAvatar
          className="profile-directory-avatar"
          fallbackClassName="profile-directory-avatar--fallback"
          src={avatarUrl || profile.avatarUrl || null}
          width={40}
          height={40}
        />
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
  const filters = profileDirectoryFilters({ query: params.q, link: params.link, role: params.role, sort: params.sort });
  const { query, link: linkFilter, role: roleFilter, sort } = filters;
  const result = await listDashboardProfilePage({ viewer: user, ...filters, cursor: params.cursor });
  const { profiles, total, characterCount, linkedCount: linkedBattleNetCount } = result;
  const hasDiscordProfiles = profiles.some((profile) =>
    profile.provider === "discord" && /^\d{16,25}$/.test(profile.providerUserId)
  );
  const liveDiscordAvatars = new Map<string, string>();
  if (hasDiscordProfiles) {
    const members = await fetchDiscordGuildMembersCachedForUi().catch(() => []);
    for (const member of members) {
      if (member.avatarUrl) liveDiscordAvatars.set(member.userId, member.avatarUrl);
    }
  }
  const canManageCleanup = canManageDiscordMembers(user);
  const hasFilters = Boolean(query || linkFilter !== "all" || roleFilter !== "all" || sort !== "activity");
  const paginationState = filters;

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
              <img src="/mistblossom-icon.png" alt="" loading="lazy" decoding="async" />
              <div>
                <strong>Mistblossom Vanguard</strong>
                <span>{user.groupName || guildStatusLabel(user.role)}</span>
              </div>
            </div>
            <div className="profile-directory-hero-metrics">
              <div><span>Знайдено</span><strong>{formatNumber(total)}</strong></div>
              <div><span>Персонажі</span><strong>{formatNumber(characterCount)}</strong></div>
              <div><span>Battle.net</span><strong>{formatNumber(linkedBattleNetCount)}</strong></div>
            </div>
          </div>
        </header>

        {result.unavailable || result.cursorReset ? (
          <div className="notice" role="status">
            {result.unavailable ? "Каталог тимчасово недоступний: сховище не налаштоване." : "Список або умови доступу змінилися. Показано першу доступну сторінку."}
          </div>
        ) : null}

        <section className="profile-directory-panel panel" aria-label="Список профілів">
          <div className="profile-directory-toolbar">
            <div className="profile-directory-toolbar-copy">
              <span className="eyebrow">Ростер профілів</span>
              <h2>{hasFilters ? "Результати" : "Усі доступні профілі"}</h2>
              <p>
                {total
                  ? `Показано ${result.start}–${result.end} із ${total}`
                  : result.unavailable ? "Каталог тимчасово недоступний." : "Немає профілів, які відповідають поточним умовам."}
              </p>
            </div>

            <form className="profile-directory-search" action="/profiles" method="get" data-list-filter="profiles">
              <label className="profile-directory-search-field" htmlFor="profile-directory-search">
                <span>Пошук</span>
                <input
                  id="profile-directory-search"
                  name="q"
                  type="search"
                  maxLength={120}
                  autoComplete="off"
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
                  <option value="name">За іменем профілю</option>
                  <option value="characters">За персонажами</option>
                </select>
              </label>

              <div className="profile-directory-search-actions">
                <button className="btn primary" type="submit">Застосувати</button>
                {hasFilters ? <a className="btn subtle" data-list-reset-position href="/profiles?view=all">Скинути</a> : null}
              </div>
            </form>
          </div>

          <ListViewMemory key={listNavigationScope(user)} kind="profiles" scope={listNavigationScope(user)} currentUrl={buildProfilesHref({ ...filters, cursor: result.cursorReset || result.unavailable ? null : params.cursor })} restorePosition={!result.cursorReset && !result.unavailable} />

          <div className="profile-directory-context" aria-label="Поточний стан списку">
            <div><span>Профілі</span><strong>{formatNumber(total)}</strong></div>
            <div><span>На сторінці</span><strong>{formatNumber(profiles.length)}</strong></div>
            <div><span>Позиція</span><strong>{result.start}–{result.end}</strong></div>
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
                  profiles.map((profile) => <ProfileRow key={profile.profileId} profile={profile} avatarUrl={liveDiscordAvatars.get(profile.providerUserId)} />)
                ) : (
                  <div className="profile-directory-empty" role="row">
                    <span className="profile-directory-empty-icon" aria-hidden="true">⌕</span>
                    <strong>{result.unavailable ? "Каталог недоступний" : hasFilters ? "Нічого не знайдено" : "Профілі ще не доступні"}</strong>
                    <p>
                      {result.unavailable ? "Спробуй відкрити каталог пізніше." : hasFilters
                        ? "Зміни пошук або фільтри. Можна шукати за Discord-ніком, персонажем чи реалмом."
                        : "Профіль зʼявиться після входу учасника через Discord."}
                    </p>
                    {hasFilters ? <a className="btn subtle" data-list-reset-position href="/profiles?view=all">Очистити фільтри</a> : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          <footer className="profile-directory-footer">
            <div>
              <strong>{total ? `${result.start}–${result.end}` : "0"}</strong>
              <span> із {total} профілів</span>
            </div>
            <nav className="dashboard-table-pagination" aria-label="Навігація сторінками профілів">
              {result.previousCursor ? (
                <a className="btn subtle" rel="prev" href={buildProfilesHref({ ...paginationState, cursor: result.previousCursor })}>
                  ← Назад
                </a>
              ) : <span className="btn subtle is-disabled" aria-disabled="true">← Назад</span>}
              <span className="profile-directory-page-indicator">{result.start}–{result.end} із {formatNumber(total)}</span>
              {result.nextCursor ? (
                <a className="btn subtle" rel="next" href={buildProfilesHref({ ...paginationState, cursor: result.nextCursor })}>
                  Далі →
                </a>
              ) : <span className="btn subtle is-disabled" aria-disabled="true">Далі →</span>}
            </nav>
          </footer>
        </section>
      </section>
    </main>
  );
}
