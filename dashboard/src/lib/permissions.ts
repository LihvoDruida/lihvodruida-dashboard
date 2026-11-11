import type { DashboardRole, DashboardSession } from "@/lib/auth";

import { DASHBOARD_PERMISSION_KEYS, type DashboardPermissionKey } from "@/lib/accessGroupSchema";

export type DashboardCapability = {
  key: string;
  title: string;
  description: string;
  enabled: boolean;
};

export const DASHBOARD_ROLE_ORDER: Record<DashboardRole, number> = {
  member: 10,
  mentor: 20,
  moderator: 50,
  admin: 100,
};

export function dashboardRoleRank(role: DashboardRole | null | undefined) {
  return role ? DASHBOARD_ROLE_ORDER[role] || 0 : 0;
}

function permitted(session: DashboardSession | null | undefined, permission: DashboardPermissionKey, fallbackRoles: DashboardRole[] = []) {
  if (!session) return false;
  if (session.isServerOwner) return true;
  if (session.groupId || session.permissions?.length) return Boolean(session.permissions?.includes(permission));
  return fallbackRoles.includes(session.role);
}

export function isDashboardStaff(session: DashboardSession | null | undefined) {
  return permitted(session, "applications.manage", ["admin", "moderator"]);
}

export function isDashboardAdmin(session: DashboardSession | null | undefined) {
  return Boolean(session && (session.isServerOwner || (session.role === "admin" && (session.groupId ? session.permissions?.includes("groups.manage") : true))));
}

export function canViewRaidDirectory(session: DashboardSession | null | undefined) {
  return permitted(session, "raids.view", ["admin", "moderator", "mentor", "member"]);
}

export function canViewGuildRoster(session: DashboardSession | null | undefined) {
  return permitted(session, "guild.roster.view", ["admin", "moderator", "mentor", "member"]);
}

export function canViewRaidRoster(session: DashboardSession | null | undefined) {
  return permitted(session, "raids.roster.view", ["admin", "moderator"]);
}

export function canViewProfileAccessDetails(session: DashboardSession | null | undefined) {
  return permitted(session, "profiles.access.view", ["admin", "moderator"]);
}

export function canViewAllProfiles(session: DashboardSession | null | undefined) {
  return permitted(session, "profiles.view", ["admin", "moderator"]);
}

export function canViewProfilesInOwnGroupOrBelow(session: DashboardSession | null | undefined) {
  return permitted(session, "profiles.group.view", ["admin", "moderator", "mentor", "member"]);
}

export function canViewProfiles(session: DashboardSession | null | undefined) {
  return canViewAllProfiles(session) || canViewProfilesInOwnGroupOrBelow(session);
}

export function canManageGroups(session: DashboardSession | null | undefined) {
  return Boolean(session && (session.isServerOwner || (session.role === "admin" && permitted(session, "groups.manage", ["admin"]))));
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
  return permitted(session, "applications.view", ["admin", "moderator", "mentor"]);
}

export function canManageApplications(session: DashboardSession | null | undefined) {
  return permitted(session, "applications.manage", ["admin", "moderator"]);
}

export function canViewApplicationBattleTag(session: DashboardSession | null | undefined) {
  if (!session) return false;
  if (session.role !== "admin" && session.role !== "moderator") return false;
  return permitted(session, "applications.sensitive.view", ["admin", "moderator"]);
}

export function canManageGeneralEmbeds(session: DashboardSession | null | undefined) {
  return permitted(session, "discord.embeds.manage", ["admin", "moderator"]);
}

export function canManageRulesEmbeds(session: DashboardSession | null | undefined) {
  return permitted(session, "discord.rules.manage", ["admin"]);
}

export function canManageDiscordMembers(session: DashboardSession | null | undefined) {
  return permitted(session, "discord.members.manage", ["admin"]);
}

export function canViewAdminLogs(session: DashboardSession | null | undefined) {
  return permitted(session, "admin.logs.view", ["admin"]);
}

export function canManageRaids(session: DashboardSession | null | undefined) {
  return permitted(session, "raids.manage", ["admin", "moderator"]);
}

export function canViewRulesStats(session: DashboardSession | null | undefined) {
  return permitted(session, "rules.stats.view", ["admin", "moderator"]);
}

export function canManageSiteContent(session: DashboardSession | null | undefined) {
  return permitted(session, "content.manage", ["admin"]);
}

export { DASHBOARD_PERMISSION_KEYS };
