import type { DashboardSession } from "@/lib/auth";
import { getGuildBranding } from "@/lib/branding";
import {
  canViewApplications,
  canManageGeneralEmbeds,
  canManageRaids,
  canManageSiteContent,
  canViewProfiles,
  canViewGuildRoster,
  canViewRaidDirectory,
  canManageGroups,
  canManageDiscordMembers,
  hierarchyTitle,
  siteStatusLabel,
} from "@/lib/permissions";
import LogoutButton from "@/components/LogoutButton";
import DashboardNavIcon, { type DashboardNavSection } from "@/components/DashboardNavIcon";
import SiteNavBehaviour from "@/components/SiteNavBehaviour";
import { getProfileById, getProfilePublicName } from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";

/**
 * Навігація дашборду — та сама структура, що в _includes/sidebar.html
 * на lihvodruida.github.io: плаваюча пігулка .site-nav, дропдаун
 * .nav-account, бургер .nav-burger і повноекранна .nav-sheet.
 *
 * Єдина відмінність від сайту — розділів більше шести, тому в рейку
 * потрапляють головні, а решта живе в дропдауні (як «Заявки» на сайті).
 * На мобільному .nav-sheet показує геть усе.
 */

/** Скільки розділів вміщується в рейку, поки вона не почне тіснити акаунт */
const RAIL_LIMIT = 6;

type NavEntry = {
  href: string;
  section: DashboardNavSection;
  label: string;
  railLabel: string;
};

const CHEVRON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export default async function DashboardIdentity({
  user,
  activeSection = "home",
}: {
  user: DashboardSession | null;
  activeSection?: DashboardNavSection;
}) {
  const [guild, nicknamePolicy] = await Promise.all([
    getGuildBranding(),
    getGuildNicknamePolicy().catch(() => ({ template: "{name} [{main}, {alt}, {alt}]" })),
  ]);
  const profile = user?.profileId ? await getProfileById(user.profileId).catch(() => null) : null;
  const displayName = profile
    ? getProfilePublicName(profile, nicknamePolicy.template)
    : user?.name || user?.login || "Користувач";
  const avatar = profile?.avatarUrl || user?.avatar_url || user?.avatar || null;

  const canUseApplications = canViewApplications(user);
  const canUseDiscord = canManageGeneralEmbeds(user);
  const canUseRaids = canViewRaidDirectory(user);
  const canCreateRaids = canManageRaids(user);
  const canUseProfiles = canViewProfiles(user);
  const canUseGuildRoster = canViewGuildRoster(user);
  const canUseContent = canManageSiteContent(user);
  const canUseAdmin = canManageGroups(user) || canManageDiscordMembers(user);
  const profileHref = user?.profileId ? `/profile/${user.profileId}` : "/profile";

  const navItems: NavEntry[] = user
    ? (
        [
          { href: "/", section: "home", label: "Головна", railLabel: "Головна" },
          canUseApplications
            ? { href: "/applications", section: "applications", label: "Заявки", railLabel: "Заявки" }
            : null,
          canUseRaids
            ? {
                href: "/raids",
                section: "raids",
                label: canCreateRaids ? "Рейди" : "Мої рейди",
                railLabel: "Рейди",
              }
            : null,
          canUseRaids
            ? { href: "/polls", section: "polls", label: "Рейд-пули", railLabel: "Пули" }
            : null,
          canCreateRaids
            ? { href: "/roster", section: "roster", label: "Формування складу", railLabel: "Склад" }
            : null,
          canUseGuildRoster
            ? { href: "/guild", section: "guild", label: "Склад гільдії", railLabel: "Гільдія" }
            : null,
          canUseDiscord
            ? { href: "/discord", section: "discord", label: "Discord", railLabel: "Discord" }
            : null,
          canUseProfiles
            ? { href: "/profiles", section: "profiles", label: "Профілі", railLabel: "Профілі" }
            : null,
          canUseContent
            ? { href: "/content", section: "content", label: "Новини / гайди", railLabel: "Новини" }
            : null,
          canUseAdmin
            ? { href: "/dashboard", section: "admin", label: "Керування", railLabel: "Керування" }
            : null,
        ] as Array<NavEntry | null>
      ).filter((item): item is NavEntry => Boolean(item))
    : [];

  const railItems = navItems.slice(0, RAIL_LIMIT);
  const overflowItems = navItems.slice(RAIL_LIMIT);

  const roleTitle = user ? user.groupName || hierarchyTitle(user.role) : "";
  const statusTitle = user ? (user.isServerOwner ? "Власник сервера" : siteStatusLabel(user.role)) : "";
  const accountSub =
    roleTitle && statusTitle && roleTitle !== statusTitle ? `${roleTitle} · ${statusTitle}` : roleTitle || statusTitle;

  const current = (section: DashboardNavSection) => (activeSection === section ? "page" : undefined);

  return (
    <>
      <SiteNavBehaviour />

      {/* <aside> має display: contents — він потрібен лише як носій
          класу .is-scrolled, точно як .sidebar на сайті. */}
      <aside className="sidebar">
        <header className="site-nav" aria-label="Головна навігація">
          <div className="site-nav__shell">
            <a href="/" className="site-nav__brand" aria-label={`${guild.name} — на головну`}>
              <img
                className="site-nav__brand-mark"
                src={guild.iconUrl}
                alt=""
                width={26}
                height={26}
                loading="eager"
                referrerPolicy="no-referrer"
              />
              <span className="site-nav__brand-text">{guild.name}</span>
            </a>

            {user ? (
              <>
                <span className="site-nav__rule" aria-hidden="true" />

                <nav className="site-nav__links" aria-label="Основна навігація">
                  {railItems.map((item) => (
                    <a key={item.href} className="nav-item" href={item.href} aria-current={current(item.section)}>
                      <DashboardNavIcon section={item.section} />
                      <span>{item.railLabel}</span>
                    </a>
                  ))}
                </nav>

                <span className="site-nav__rule" aria-hidden="true" />

                <div className="nav-account">
                  <button
                    className="nav-account__btn"
                    type="button"
                    aria-expanded="false"
                    aria-controls="nav-account-menu"
                  >
                    {avatar ? (
                      <img
                        className="nav-account__avatar"
                        src={avatar}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="nav-account__avatar nav-account__avatar--fallback" aria-hidden="true">
                        {(displayName || "A").charAt(0)}
                      </span>
                    )}
                    <span className="nav-account__meta">
                      <span className="nav-account__name">{displayName}</span>
                      {accountSub ? <span className="nav-account__sub">{accountSub}</span> : null}
                    </span>
                    <span className="nav-account__chev">{CHEVRON}</span>
                  </button>

                  <nav className="nav-account__menu" id="nav-account-menu" aria-label="Профіль і розділи">
                    <p className="nav-account__group">Профіль</p>
                    <a href={profileHref} aria-current={current("profile")}>
                      <DashboardNavIcon section="profile" />
                      <span>Мій профіль</span>
                    </a>

                    {overflowItems.length ? (
                      <>
                        <p className="nav-account__group">Розділи</p>
                        {overflowItems.map((item) => (
                          <a key={item.href} href={item.href} aria-current={current(item.section)}>
                            <DashboardNavIcon section={item.section} />
                            <span>{item.label}</span>
                          </a>
                        ))}
                      </>
                    ) : null}

                    <p className="nav-account__group">Сесія</p>
                    <LogoutButton className="nav-account__logout" errorClassName="nav-account__logout-error" />
                  </nav>
                </div>

                <button
                  className="nav-burger"
                  type="button"
                  aria-label="Відкрити меню"
                  aria-expanded="false"
                  aria-controls="nav-sheet"
                >
                  <span className="nav-burger__bars" aria-hidden="true" />
                </button>
              </>
            ) : (
              <div className="nav-account">
                <a className="btn primary nav-account__login" href="/login">
                  Увійти
                </a>
              </div>
            )}
          </div>
        </header>
      </aside>

      {user ? (
        <div className="nav-sheet" id="nav-sheet" aria-hidden="true">
          <nav className="nav-sheet__inner" aria-label="Мобільна навігація">
            <p className="nav-sheet__group">Навігація</p>
            {navItems.map((item) => (
              <a
                key={item.href}
                className="nav-sheet__link"
                href={item.href}
                aria-current={current(item.section)}
              >
                <DashboardNavIcon section={item.section} />
                <span>{item.label}</span>
              </a>
            ))}

            <p className="nav-sheet__group">Профіль</p>
            <a className="nav-sheet__link" href={profileHref} aria-current={current("profile")}>
              <DashboardNavIcon section="profile" />
              <span>Мій профіль</span>
            </a>

            <p className="nav-sheet__group">Сесія</p>
            <LogoutButton className="nav-sheet__logout" errorClassName="nav-sheet__logout-error" />
          </nav>
        </div>
      ) : null}
    </>
  );
}
