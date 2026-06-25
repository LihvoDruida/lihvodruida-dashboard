import type { DashboardRole, DashboardSession } from "@/lib/auth";
import type { DiscordRoleOption } from "@/lib/discordAdmin";
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

export function canAccessDashboardRole(viewer: DashboardSession | null | undefined, targetRole: DashboardRole | null | undefined) {
  if (!viewer || !targetRole) return false;
  return (viewer.groupRank || dashboardRoleRank(viewer.role)) >= dashboardRoleRank(targetRole);
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

export function siteStatusDescription(role: DashboardRole) {
  if (role === "admin") return "Повний доступ до профілів, заявок, рейдів, Discord-розділів і матеріалів сайту.";
  if (role === "moderator") return "Офіцерський доступ до заявок, профілів, рейдів і Discord-повідомлень без адмінських розділів.";
  if (role === "mentor") return "Особистий профіль і перегляд заявок без Discord/BattleTag та без керування статусами.";
  return "Особистий профіль, персонажі, рейди, запис і правила без адмінських блоків.";
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

export function canViewApplicationSensitiveFields(session: DashboardSession | null | undefined) {
  return canViewApplicationBattleTag(session);
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

export function dashboardCapabilities(role: DashboardRole, permissions?: string[]): DashboardCapability[] {
  const permissionSet = new Set(permissions?.length ? permissions : []);
  const enabled = (key: DashboardPermissionKey, fallback: boolean) => permissions?.length ? permissionSet.has(key) : fallback;
  const isAdmin = role === "admin";
  const canModerate = role === "admin" || role === "moderator";
  const canReviewApplications = canModerate || role === "mentor";

  return [
    { key: "profile", title: "Особистий профіль", description: "Особисті дані, персонажі Battle.net, роль для рейдів і серверне Discord-ім’я.", enabled: true },
    { key: "raid-signup", title: "Рейди та запис", description: "Перегляд опублікованих рейдів, правила і власний запис на участь.", enabled: enabled("raids.view", true) },
    { key: "guild-roster", title: "Склад гільдії", description: "Перегляд персонажів гільдії, Raider.IO, item level, ролей, класів і фільтрів.", enabled: enabled("guild.roster.view", true) },
    { key: "profiles", title: enabled("profiles.view", canModerate) ? "Профілі: повний доступ" : "Профілі: своя група і нижче", description: enabled("profiles.view", canModerate) ? "Перегляд усіх профілів учасників." : "Перегляд власного профілю, своєї групи та груп нижче за рангом.", enabled: enabled("profiles.view", canModerate) || enabled("profiles.group.view", true) },
    { key: "applications", title: "Заявки до гільдії", description: role === "mentor" ? "Перегляд заявок і даних персонажа без Discord/BattleTag та без права приймати рішення." : "Перегляд заявок, даних персонажа та рішення по кандидатах.", enabled: enabled("applications.view", canReviewApplications) },
    { key: "general-embeds", title: "Звичайні Discord-повідомлення", description: "Створення і редагування звичайних Discord-повідомлень, а також згадування вибраних ролей.", enabled: enabled("discord.embeds.manage", canModerate) },
    { key: "raids", title: "Рейди", description: "Створення рейдових оголошень, Discord-кнопки запису та автоматична побудова складу.", enabled: enabled("raids.manage", canModerate) },
    { key: "rules-embeds", title: "Discord правила", description: isAdmin ? "Керування повідомленнями правил, кнопками прийняття, ролями та статистикою." : "Перегляд статистики правил без права змінювати самі повідомлення.", enabled: enabled("discord.rules.manage", isAdmin) },
    { key: "discord-members", title: "Discord учасники", description: "Видача й зняття ролей, серверні ніки та перевірка шаблону ніку.", enabled: enabled("discord.members.manage", isAdmin) },
    { key: "admin-logs", title: "Журнал дій", description: "Останні адміністративні дії, результати Discord API та помилки.", enabled: enabled("admin.logs.view", isAdmin) },
    { key: "site-content", title: "Новини та гайди сайту", description: "Створення, редагування та видалення матеріалів сайту.", enabled: enabled("content.manage", isAdmin) },
    { key: "groups", title: "Групи та права", description: "Керування групами доступу, Discord role ID та дозволами.", enabled: enabled("groups.manage", isAdmin) },
  ];
}

export function splitConfiguredRoleIds(value?: string) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function configuredRoleIdsForDashboardRole(_role: DashboardRole) {
  return [] as string[];
}

export function matchingDiscordRoleIds(session: DashboardSession | null | undefined) {
  if (!session) return [] as string[];
  return Array.from(new Set((session.discordRoleIds || []).map((roleId) => String(roleId || "").trim()).filter(Boolean)));
}

export function matchingDiscordRoleLabels(session: DashboardSession | null | undefined, roles: DiscordRoleOption[] = []) {
  if (!session) return [] as string[];
  if (session.provider === "token") return ["Резервний ключ адміністратора"];
  if (session.isServerOwner) return ["Власник Discord-сервера"];
  const roleMap = new Map<string, string>(roles.map((role) => [role.id, role.name]));
  return matchingDiscordRoleIds(session).map((roleId) => roleMap.get(roleId) || `Discord роль ${roleId.slice(-6)}`);
}

export { DASHBOARD_PERMISSION_KEYS };
