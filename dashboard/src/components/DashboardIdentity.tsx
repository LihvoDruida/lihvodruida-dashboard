import Link from "next/link";
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
import DashboardDesktopNav from "@/components/DashboardDesktopNav";
import DashboardNavIcon, { type DashboardNavSection } from "@/components/DashboardNavIcon";
import SiteNavBehaviour from "@/components/SiteNavBehaviour";
import GuildStatusBanner, { type GuildStatusRaid } from "@/components/GuildStatusBanner";
import { loadStoredGuildRosterData } from "@/lib/guildRoster";
import { primaryCurrentRaidProgress, currentSeasonRaidSlugs } from "@/lib/characterRaidProgress";
import ProfileAvatar from "@/components/ProfileAvatar";
import { getProfileById, getProfilePublicName } from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";

type NavEntry = {
  href: string;
  section: DashboardNavSection;
  label: string;
  desktopLabel: string;
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
  activeSection = "profile",
}: {
  user: DashboardSession | null;
  activeSection?: DashboardNavSection;
}) {
  const [guild, nicknamePolicy] = await Promise.all([
    getGuildBranding(),
    getGuildNicknamePolicy().catch(() => ({ template: "{name} [{main}, {alt}, {alt}]" })),
  ]);

  // Cached guild progress only: never trigger Raider.IO/Battle.net refresh from
  // the global navigation. Missing current season data must not show old raids.
  const roster = user && canViewGuildRoster(user)
    ? await loadStoredGuildRosterData().catch(() => null)
    : null;
  const seasonSnapshot = roster?.stats.raidSeasonSnapshot || null;
  const currentSlugs = currentSeasonRaidSlugs(seasonSnapshot);
  const primaryRaid = currentSlugs.length
    ? primaryCurrentRaidProgress(roster?.stats.raidProgression || [], seasonSnapshot)
    : null;
  const rosterUpdatedMs = Date.parse(roster?.stats.updatedAt || "");
  // An old cache must not be presented as *current* guild progress. Raider.IO
  // exposes tier aggregates as fallback; verify their season before displaying.
  const rosterIsFresh = !Number.isFinite(rosterUpdatedMs) || Date.now() - rosterUpdatedMs < 72 * 60 * 60_000;
  const progressMatchesSeason = Boolean(primaryRaid && currentSlugs.includes(primaryRaid.slug));
  const bannerRaid: GuildStatusRaid = primaryRaid && progressMatchesSeason && rosterIsFresh ? {
    name: primaryRaid.name,
    totalBosses: primaryRaid.totalBosses,
    normalKills: primaryRaid.normalKills,
    heroicKills: primaryRaid.heroicKills,
    mythicKills: primaryRaid.mythicKills,
    updatedAt: roster?.stats.updatedAt || null,
  } : null;

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
          canUseRaids
            ? {
                href: "/raids",
                section: "raids",
                label: canCreateRaids ? "Рейди" : "Мої рейди",
                desktopLabel: canCreateRaids ? "Рейди" : "Мої рейди",
              }
            : null,
          canUseGuildRoster
            ? { href: "/guild", section: "guild", label: "Склад гільдії", desktopLabel: "Гільдія" }
            : null,
          canUseApplications
            ? { href: "/applications", section: "applications", label: "Заявки", desktopLabel: "Заявки" }
            : null,
          { href: "/discord/static", section: "static", label: "Статик", desktopLabel: "Статик" },
          canUseDiscord
            ? { href: "/discord", section: "discord", label: "Discord", desktopLabel: "Discord" }
            : null,
          canUseProfiles
            ? { href: "/profiles", section: "profiles", label: "Профілі", desktopLabel: "Профілі" }
            : null,
          canUseContent
            ? { href: "/content", section: "content", label: "Новини / гайди", desktopLabel: "Контент" }
            : null,
          canUseAdmin
            ? { href: "/dashboard", section: "admin", label: "Керування", desktopLabel: "Керування" }
            : null,
        ] as Array<NavEntry | null>
      ).filter((item): item is NavEntry => Boolean(item))
    : [];

  const roleTitle = user ? user.groupName || hierarchyTitle(user.role) : "";
  const statusTitle = user ? (user.isServerOwner ? "Власник сервера" : siteStatusLabel(user.role)) : "";
  const accountSub =
    roleTitle && statusTitle && roleTitle !== statusTitle ? `${roleTitle} · ${statusTitle}` : roleTitle || statusTitle;
  const current = (section: DashboardNavSection) => (activeSection === section ? "page" : undefined);

  return (
    <>
      <SiteNavBehaviour />

      {user ? (
        <GuildStatusBanner guildName={guild.name} raid={bannerRaid} raidHref={canViewGuildRoster(user) ? "/guild" : "/raids"} />
      ) : null}

      {user ? (
        <header className="dashboard-topbar" aria-label="Навігація панелі Mistblossom Vanguard">
          <Link prefetch={false} href={profileHref} className="dashboard-brand" aria-label={`${guild.name} — мій профіль`}>
            <span className="dashboard-brand__mark">
              <img src={guild.iconUrl} alt="" width={34} height={34} loading="eager" referrerPolicy="no-referrer" />
            </span>
            <span className="dashboard-brand__copy">
              <strong>{guild.name}</strong>
              <small>Guild workspace</small>
            </span>
          </Link>

          <DashboardDesktopNav items={navItems} activeSection={activeSection} />

          <div className="dashboard-user nav-account">
            <button
              className="dashboard-user__button nav-account__btn"
              type="button"
              aria-expanded="false"
              aria-controls="dashboard-user-menu"
            >
              <ProfileAvatar
                className="dashboard-user__avatar"
                fallbackClassName="dashboard-user__avatar--fallback"
                src={avatar}
                width={36}
                height={36}
              />
              <span className="dashboard-user__meta">
                <strong>{displayName}</strong>
                {accountSub ? <small>{accountSub}</small> : null}
              </span>
              <span className="dashboard-user__chevron nav-account__chev">{CHEVRON}</span>
            </button>

            <nav className="dashboard-user__menu nav-account__menu" id="dashboard-user-menu" aria-label="Профіль і сесія">
              <p className="dashboard-user__menu-label">Акаунт</p>
              <Link prefetch={false} href={profileHref} aria-current={current("profile")}>
                <DashboardNavIcon section="profile" />
                <span>Мій профіль</span>
              </Link>
              <p className="dashboard-user__menu-label">Сесія</p>
              <LogoutButton className="dashboard-user__logout" errorClassName="dashboard-user__logout-error" />
            </nav>
          </div>
        </header>
      ) : null}

      {/* Мобільна шапка лишається окремою: desktop-перебудова не робить
          телефонну версію залежною від ширини робочої панелі. */}
      <aside className="sidebar dashboard-mobile-nav">
        <header className="site-nav" aria-label="Мобільна навігація">
          <div className="site-nav__shell">
            <Link prefetch={false} href={profileHref} className="site-nav__brand" aria-label={`${guild.name} — мій профіль`}>
              <img
                className="site-nav__brand-mark"
                src={guild.iconUrl}
                alt=""
                width={28}
                height={28}
                loading="eager"
                referrerPolicy="no-referrer"
              />
              <span className="site-nav__brand-text">{guild.name}</span>
            </Link>

            {user ? (
              <button
                className="nav-burger"
                type="button"
                aria-label="Відкрити меню"
                aria-expanded="false"
                aria-controls="nav-sheet"
              >
                <span className="nav-burger__bars" aria-hidden="true" />
              </button>
            ) : (
              <Link prefetch={false} className="btn primary nav-account__login" href="/login">Увійти</Link>
            )}
          </div>
        </header>
      </aside>

      {user ? (
        <div className="nav-sheet" id="nav-sheet" aria-hidden="true">
          <nav className="nav-sheet__inner" aria-label="Мобільна навігація">
            <div className="nav-sheet__brand">
              <img src={guild.iconUrl} alt="" width={42} height={42} referrerPolicy="no-referrer" />
              <div>
                <strong>{guild.name}</strong>
                <span>{displayName}</span>
              </div>
            </div>

            <p className="nav-sheet__group">Навігація</p>
            {navItems.map((item) => (
              <Link prefetch={false} key={item.href} className="nav-sheet__link" href={item.href} aria-current={current(item.section)}>
                <DashboardNavIcon section={item.section} />
                <span>{item.label}</span>
              </Link>
            ))}

            <p className="nav-sheet__group">Профіль</p>
            <Link prefetch={false} className="nav-sheet__link" href={profileHref} aria-current={current("profile")}>
              <DashboardNavIcon section="profile" />
              <span>Мій профіль</span>
            </Link>

            <p className="nav-sheet__group">Сесія</p>
            <LogoutButton className="nav-sheet__logout" errorClassName="nav-sheet__logout-error" />
          </nav>
        </div>
      ) : null}
    </>
  );
}
