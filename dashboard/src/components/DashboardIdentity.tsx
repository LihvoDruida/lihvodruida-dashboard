import type { CSSProperties } from "react";
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
import MobileNavSafeAreaSync from "@/components/MobileNavSafeAreaSync";
import DashboardDesktopNav from "@/components/DashboardDesktopNav";
import { getProfileById, getProfilePublicName } from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";

export default async function DashboardIdentity({
  user,
  activeSection = "home",
}: {
  user: DashboardSession | null;
  activeSection?: "home" | "admin" | "applications" | "content" | "discord" | "guild" | "profile" | "profiles" | "raids" | "roster" | "rules";
}) {
  const [guild, nicknamePolicy] = await Promise.all([
    getGuildBranding(),
    getGuildNicknamePolicy().catch(() => ({ template: "{name} [{main}, {alt}, {alt}]" })),
  ]);
  const profile = user?.profileId ? await getProfileById(user.profileId).catch(() => null) : null;
  const displayName = profile ? getProfilePublicName(profile, nicknamePolicy.template) : (user?.name || user?.login || "Користувач");
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
  const navItems = user
    ? [
        { href: "/", section: "home" as const, label: "Головна", desktopLabel: "Головна" },
        canUseApplications
          ? { href: "/applications", section: "applications" as const, label: "Заявки", desktopLabel: "Заявки" }
          : null,
        canUseRaids
          ? { href: "/raids", section: "raids" as const, label: "Рейди", desktopLabel: canCreateRaids ? "Рейди" : "Мої рейди" }
          : null,
        canCreateRaids
          ? { href: "/roster", section: "roster" as const, label: "Склад", desktopLabel: "Формування складу" }
          : null,
        canUseGuildRoster
          ? { href: "/guild", section: "guild" as const, label: "Гільдія", desktopLabel: "Склад гільдії" }
          : null,
        canUseDiscord
          ? { href: "/discord", section: "discord" as const, label: "Discord", desktopLabel: "Discord" }
          : null,
        canUseProfiles
          ? { href: "/profiles", section: "profiles" as const, label: "Профілі", desktopLabel: "Профілі" }
          : null,
        canUseContent
          ? { href: "/content", section: "content" as const, label: "Новини", desktopLabel: "Новини / гайди" }
          : null,
        canUseAdmin
          ? { href: "/dashboard", section: "admin" as const, label: "Адмін", desktopLabel: "Керування" }
          : null,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const hasMobileNav = navItems.length > 0;

  return (
    <>
      <header className="dashboard-topbar">
        <div className="dashboard-brand">
          <img className="guild-mark" src={guild.iconUrl} alt="" width={44} height={44} loading="eager" referrerPolicy="no-referrer" />
          <div>
            <strong>{guild.name}</strong>
            <span>{user?.role === "member" ? "Особиста панель" : user?.role === "mentor" ? "Панель наставника" : "Панель гільдії"}</span>
          </div>
        </div>

        {user ? (
          <>
            <DashboardDesktopNav
              items={navItems}
              activeSection={activeSection}
            />

            <div className="dashboard-user">
              <a
                className={`dashboard-user__profile-link${activeSection === "profile" ? " is-active" : ""}`}
                href={profileHref}
                aria-label={`Відкрити профіль ${displayName || user.name || user.login || "користувача"}`}
                aria-current={activeSection === "profile" ? "page" : undefined}
              >
                <div className="dashboard-user__avatar-wrap">
                  {avatar ? <img className="discord-avatar" src={avatar} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" /> : <span className="discord-avatar-fallback">{(displayName || user.name || user.login || "A").charAt(0)}</span>}
                  <span className="dashboard-user__status" aria-hidden="true" />
                </div>
                <div>
                  <strong>{displayName}</strong>
                  {(() => {
                    const primaryTitle = user.groupName || hierarchyTitle(user.role);
                    const secondaryTitle = user.isServerOwner ? "Власник сервера" : siteStatusLabel(user.role);
                    const subtitle =
                      primaryTitle && secondaryTitle && primaryTitle !== secondaryTitle
                        ? `${primaryTitle} • ${secondaryTitle}`
                        : primaryTitle || secondaryTitle;
                    return <span>{subtitle}</span>;
                  })()}
                </div>
              </a>
              <LogoutButton />
            </div>
          </>
        ) : null}
      </header>

      {user && hasMobileNav ? (
        <>
          <MobileNavSafeAreaSync />
          <div
            className="dashboard-mobile-nav-shell"
            data-items={navItems.length}
          >
            <nav
              className="dashboard-mobile-nav"
              aria-label="Швидка навігація"
              data-items={navItems.length}
              style={{ "--dashboard-mobile-nav-items": navItems.length } as CSSProperties}
            >
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={activeSection === item.section ? "is-active" : undefined}
                  aria-current={activeSection === item.section ? "page" : undefined}
                >
                  <strong>{item.label}</strong>
                </a>
              ))}
            </nav>
          </div>
        </>
      ) : null}
    </>
  );
}
