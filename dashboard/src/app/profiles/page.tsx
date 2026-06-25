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
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function parsePage(value?: string) {
  const page = Number(value || "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildProfilesHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/profiles?${suffix}` : "/profiles";
}

function mainCharacterLabel(profile: DashboardProfile) {
  const main = getMainCharacter(profile);
  if (!main) return { title: "Мейн не вибрано", subtitle: "—" };
  const title = `${main.name}${main.realmName ? ` • ${main.realmName}` : ""}`;
  const subtitle = [main.className, main.activeSpecName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" / ");
  return { title, subtitle: subtitle || "—" };
}

function battleNetStatus(profile: DashboardProfile) {
  if (!profile.battlenet?.linked) return "Ні";
  const synced = profile.battlenet.lastSyncAt || profile.battlenet.lastConnectedAt;
  return synced ? formatDate(synced) : "Так";
}

function ProfileRow({ profile }: { profile: DashboardProfile }) {
  const displayName = getProfilePublicName(profile);
  const guildStatus = profile.groupName || guildStatusLabel(profile.role);
  const href = `/profile/${profile.profileId}`;
  const activityDate = profile.lastLoginAt || profile.updatedAt;
  const main = mainCharacterLabel(profile);

  return (
    <a
      className="dashboard-table-row dashboard-list-row dashboard-table-row--clickable profile-table-row"
      href={href}
      role="row"
      aria-label={`Відкрити профіль: ${displayName}`}
    >
      <div className="dashboard-table-primary" role="cell">
        <strong>{displayName}</strong>
        <small>{profile.login || profile.providerUserId}</small>
      </div>
      <div role="cell">
        <strong>{guildStatus}</strong>
        <small>{profile.role}</small>
      </div>
      <div role="cell">
        <strong>{main.title}</strong>
        <small>{main.subtitle}</small>
      </div>
      <div role="cell" className="dashboard-table-score">
        <strong>{formatNumber(profile.characters.length)}</strong>
        <small>персонажів</small>
      </div>
      <div role="cell">
        <span
          className={`dashboard-table-pill ${profile.battlenet?.linked ? "dashboard-table-pill--ok" : "dashboard-table-pill--muted"}`}
        >
          {profile.battlenet?.linked ? "Так" : "Ні"}
        </span>
        <small>{battleNetStatus(profile)}</small>
      </div>
      <div role="cell">{formatDate(activityDate)}</div>
      <div role="cell">
        <span className="dashboard-table-link">Відкрити</span>
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
  const requestedPage = parsePage(params.page);
  const allProfiles = await listDashboardProfiles({
    viewer: user,
    query,
    limit: 500,
  });
  const pageCount = Math.max(1, Math.ceil(allProfiles.length / PROFILE_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const pageStart = (page - 1) * PROFILE_PAGE_SIZE;
  const profiles = allProfiles.slice(pageStart, pageStart + PROFILE_PAGE_SIZE);
  const canRunManualCleanup = canManageDiscordMembers(user);
  const linkedBattleNetCount = allProfiles.filter(
    (profile) => profile.battlenet?.linked,
  ).length;
  const characterCount = allProfiles.reduce(
    (sum, profile) => sum + profile.characters.length,
    0,
  );

  return (
    <main className="container">
      <section
        className="dashboard-shell content-shell profile-directory-shell"
        aria-label="Профілі учасників Mistblossom Vanguard"
      >
        <DashboardIdentity user={user} activeSection="profiles" />

        <section
          className="dashboard-table-card dashboard-list-panel dashboard-table-card--profiles panel"
          aria-label="Компактний список профілів"
        >
          <div className="dashboard-table-titlebar dashboard-list-head">
            <div>
              <span className="eyebrow">Користувачі</span>
              <h1>Профілі учасників</h1>
            </div>
            <div className="dashboard-table-controls" aria-label="Пошук і ручні дії з профілями">
              <form className="dashboard-table-search-form" action="/profiles" method="get">
                <label className="dashboard-table-search" htmlFor="profile-directory-search">
                  <span className="sr-only">Пошук користувача</span>
                  <input
                    id="profile-directory-search"
                    name="q"
                    placeholder="Пошук користувача"
                    defaultValue={query}
                  />
                </label>
                <button className="dashboard-table-filter is-active" type="submit">
                  Знайти
                </button>
                {query ? (
                  <a className="dashboard-table-filter dashboard-table-filter--muted" href="/profiles">
                    Скинути
                  </a>
                ) : null}
              </form>

              {canRunManualCleanup ? (
                <form
                  className="dashboard-table-action-form"
                  action="/api/dashboard/discord/profiles/cleanup"
                  method="post"
                  data-dashboard-action-form="true"
                  data-dashboard-live-submit="true"
                >
                  <input type="hidden" name="mode" value="apply" />
                  <input type="hidden" name="limit" value="0" />
                  <button
                    className="dashboard-table-filter dashboard-table-filter--danger"
                    type="submit"
                    data-confirm-message="Запустити ручне глобальне очищення акаунтів? Перед видаленням система оновить склад гільдії в базі, перевірить Discord membership, прибере записи акаунтів з рейдів і видалить тільки тих, кого немає ні в roster, ні в Discord."
                  >
                    Очищення
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="dashboard-table-stats" aria-label="Показники профілів">
            <div>
              <span>Профілів</span>
              <strong>{formatNumber(allProfiles.length)}</strong>
            </div>
            <div>
              <span>Показано</span>
              <strong>{formatNumber(profiles.length)}</strong>
            </div>
            <div>
              <span>Персонажів</span>
              <strong>{formatNumber(characterCount)}</strong>
            </div>
            <div>
              <span>Battle.net</span>
              <strong>{formatNumber(linkedBattleNetCount)}</strong>
            </div>
            <div>
              <span>Доступ</span>
              <strong>{user.groupName || guildStatusLabel(user.role)}</strong>
            </div>
            <div>
              <span>На сторінці</span>
              <strong>{PROFILE_PAGE_SIZE}</strong>
            </div>
          </div>

          <div className="dashboard-table-scroll">
            <div className="dashboard-table dashboard-list dashboard-table--profiles" role="table" aria-label="Список доступних профілів">
              <div className="dashboard-table-head" role="row">
                <span role="columnheader">Користувач</span>
                <span role="columnheader">Група / роль</span>
                <span role="columnheader">Мейн</span>
                <span role="columnheader">Персонажі</span>
                <span role="columnheader">Battle.net</span>
                <span role="columnheader">Активність</span>
                <span role="columnheader">Дія</span>
              </div>
              {profiles.length ? (
                profiles.map((profile) => (
                  <ProfileRow key={profile.profileId} profile={profile} />
                ))
              ) : (
                <div className="dashboard-table-empty" role="row">
                  <strong>{query ? "За цим пошуком профілів немає" : "Профілі ще не доступні"}</strong>
                  <span>
                    {query
                      ? "Перевір Discord-нік, імʼя персонажа або реалм."
                      : "Профіль зʼявиться після входу учасника через Discord."}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="dashboard-table-footer">
            <small>
              Сторінка {page} / {pageCount} • {PROFILE_PAGE_SIZE} профілів на сторінку
            </small>
            <div className="dashboard-table-pagination" aria-label="Навігація сторінками профілів">
              <a
                className={`btn subtle${page <= 1 ? " is-disabled" : ""}`}
                aria-disabled={page <= 1}
                href={page <= 1 ? buildProfilesHref(query, 1) : buildProfilesHref(query, page - 1)}
              >
                Назад
              </a>
              <a
                className={`btn subtle${page >= pageCount ? " is-disabled" : ""}`}
                aria-disabled={page >= pageCount}
                href={page >= pageCount ? buildProfilesHref(query, pageCount) : buildProfilesHref(query, page + 1)}
              >
                Далі
              </a>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
