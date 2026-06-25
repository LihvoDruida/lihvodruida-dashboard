export {
  assertAdmin,
  assertCanModerate,
  canModerate,
  resolveDashboardRole,
} from "./auth";

export type {
  DashboardRole,
  DashboardSession,
  SessionUser,
} from "./auth";

export {
  canViewApplications,
  canManageApplications,
  canViewApplicationSensitiveFields,
  canViewApplicationBattleTag,
  canManageGeneralEmbeds,
  canManageRulesEmbeds,
  canManageRaids,
  canManageSiteContent,
  canViewRulesStats,
  canViewRaidDirectory,
  canViewGuildRoster,
  canViewRaidRoster,
  canViewProfileAccessDetails,
  isDashboardStaff,
  isDashboardAdmin,
  dashboardRoleRank,
  canViewProfiles,
  canManageGroups,
  canAccessDashboardRole,
  dashboardCapabilities,
  dashboardRoleLabel,
  guildStatusLabel,
  hierarchyTitle,
  matchingDiscordRoleIds,
  matchingDiscordRoleLabels,
  siteStatusDescription,
  siteStatusLabel,
} from "./permissions";

export type { DashboardCapability } from "./permissions";

export {
  listAccessGroups,
  ensureDefaultAccessGroups,
  getAccessGroup,
  upsertAccessGroup,
  deleteAccessGroup,
  recordAdminAudit,
  canEditTargetGroup,
} from "./accessGroups";

export {
  DASHBOARD_PERMISSION_KEYS,
  PERMISSION_META,
  DEFAULT_ADMIN_GROUP_ID,
  DEFAULT_MODERATOR_GROUP_ID,
  DEFAULT_MENTOR_GROUP_ID,
  DEFAULT_MEMBER_GROUP_ID,
} from "./accessGroupSchema";

export type { AccessGroup, DashboardPermissionKey } from "./accessGroupSchema";
