import type { DashboardRole, DashboardSession } from "@/types/auth";

import { DASHBOARD_PERMISSION_KEYS, type DashboardPermissionKey } from "@/lib/accessGroupSchema";

export const DASHBOARD_ROLE_ORDER: Record<DashboardRole, number> = {
  member: 10,
  mentor: 20,
  moderator: 50,
  admin: 100,
};

export function dashboardRoleRank(role: DashboardRole | null | undefined) {
  return role ? DASHBOARD_ROLE_ORDER[role] || 0 : 0;
}

export function hasDashboardPermission(session: DashboardSession | null | undefined, permission: DashboardPermissionKey) {
  if (!session) return false;
  if (session.isServerOwner) return true;
  return Boolean(session.permissions?.includes("dashboard.view") && session.permissions.includes(permission));
}

const permitted = hasDashboardPermission;

/**
 * System and policy settings (login and geo policy, logging, Discord management, rules,
 * Static roles, runtime settings) are reserved for the live-verified Discord server owner.
 * Group permissions, impersonation ("view as group") and the emergency token never qualify.
 */
export function canManageSettings(session: DashboardSession | null | undefined) {
  return Boolean(session?.isServerOwner && session.provider === "discord" && !session.impersonatedBy);
}

export function isDashboardStaff(session: DashboardSession | null | undefined) {
  return permitted(session, "applications.manage");
}

export function isDashboardAdmin(session: DashboardSession | null | undefined) {
  return canManageGroups(session);
}

export function canViewRaidDirectory(session: DashboardSession | null | undefined) {
  return permitted(session, "raids.view");
}

export function canViewGuildRoster(session: DashboardSession | null | undefined) {
  return permitted(session, "guild.roster.view");
}

export function canViewRaidRoster(session: DashboardSession | null | undefined) {
  return permitted(session, "raids.roster.view");
}

export function canViewProfileAccessDetails(session: DashboardSession | null | undefined) {
  return permitted(session, "profiles.access.view");
}

export function canViewAllProfiles(session: DashboardSession | null | undefined) {
  return permitted(session, "profiles.view");
}

export function canViewProfilesInOwnGroupOrBelow(session: DashboardSession | null | undefined) {
  return permitted(session, "profiles.group.view");
}

export function canViewProfiles(session: DashboardSession | null | undefined) {
  return canViewAllProfiles(session) || canViewProfilesInOwnGroupOrBelow(session);
}

export function canViewAccessGroups(session: DashboardSession | null | undefined) {
  return permitted(session, "groups.view") || canManageGroups(session);
}

export function canManageGroups(session: DashboardSession | null | undefined) {
  return Boolean(session && (session.isServerOwner || (session.role === "admin" && permitted(session, "groups.manage"))));
}

export function hierarchyTitle(role: DashboardRole) {
  if (role === "admin") return "Гільдмайстер";
  if (role === "moderator") return "Офіцер";
  if (role === "mentor") return "Наставник новачків";
  return "Учасник гільдії";
}

export function guildStatusLabel(role: DashboardRole) {
  if (role === "admin") return "Гільдмайстер";
  if (role === "moderator") return "Офіцер";
  if (role === "mentor") return "Наставник";
  return "Учасник";
}

export function dashboardRoleLabel(role: DashboardRole) {
  if (role === "admin") return "Адмін";
  if (role === "moderator") return "Модератор";
  if (role === "mentor") return "Наставник";
  return "Учасник";
}

export function siteStatusLabel(role: DashboardRole) {
  if (role === "admin") return "Повний доступ";
  if (role === "moderator") return "Офіцерський доступ";
  if (role === "mentor") return "Наставник новачків";
  return "Особистий профіль";
}

export function canViewApplications(session: DashboardSession | null | undefined) {
  return permitted(session, "applications.view");
}

export function canManageApplications(session: DashboardSession | null | undefined) {
  return permitted(session, "applications.manage");
}

export function canViewApplicationBattleTag(session: DashboardSession | null | undefined) {
  if (!session) return false;
  if (session.role !== "admin" && session.role !== "moderator") return false;
  return permitted(session, "applications.sensitive.view");
}

export function canManageGeneralEmbeds(session: DashboardSession | null | undefined) {
  return permitted(session, "discord.embeds.manage");
}

export function canManageRulesEmbeds(session: DashboardSession | null | undefined) {
  return permitted(session, "discord.rules.manage");
}

export function canManageDiscordMembers(session: DashboardSession | null | undefined) {
  return permitted(session, "discord.members.manage");
}

export function canViewAdminLogs(session: DashboardSession | null | undefined) {
  return permitted(session, "admin.logs.view");
}

export function canManageRaids(session: DashboardSession | null | undefined) {
  return permitted(session, "raids.manage");
}

export function canViewRulesStats(session: DashboardSession | null | undefined) {
  return permitted(session, "rules.stats.view");
}

export function canManageSiteContent(session: DashboardSession | null | undefined) {
  return permitted(session, "content.manage");
}

export { DASHBOARD_PERMISSION_KEYS };
