import "server-only";

import {
  addGuildMemberRoles,
  fetchDiscordRoleControlSnapshotCachedForUi,
  getDiscordGuildId,
} from "@/lib/discordAdmin";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { logDashboardEvent, safeErrorMessage } from "@/lib/security";

function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function recentJoin(joinedAt: unknown) {
  const parsed = Date.parse(String(joinedAt || ""));
  if (!Number.isFinite(parsed)) return false;
  const maxHours = Math.max(1, Math.min(24 * 30, Number(process.env.DISCORD_NEWCOMER_SELF_HEAL_MAX_AGE_HOURS || 168)));
  return Date.now() - parsed >= -5 * 60_000 && Date.now() - parsed <= maxHours * 60 * 60_000;
}

export type NewcomerBootstrapRoleResult = {
  attempted: boolean;
  assigned: boolean;
  roleId: string | null;
  reason: string;
};

/**
 * Last-resort access bootstrap used by auth and priority onboarding.
 * It only touches a fresh member that has zero explicit Discord roles, so it
 * cannot silently undo a moderator's role configuration on established users.
 */
export async function ensureDiscordNewcomerBootstrapRole(params: {
  userId: unknown;
  roleIds?: string[] | null;
  joinedAt?: string | null;
  source: "auth_callback" | "live_session" | "gateway_recovery" | "manual";
}): Promise<NewcomerBootstrapRoleResult> {
  const userId = cleanSnowflake(params.userId);
  const currentRoles = Array.from(new Set((params.roleIds || []).map(cleanSnowflake).filter(Boolean)));
  if (!userId) return { attempted: false, assigned: false, roleId: null, reason: "invalid_user" };
  if (currentRoles.length > 0) return { attempted: false, assigned: false, roleId: null, reason: "already_has_roles" };
  if (!recentJoin(params.joinedAt)) return { attempted: false, assigned: false, roleId: null, reason: "not_recent_join" };

  const settings = await getDiscordWelcomeCardSettings();
  const roleId = cleanSnowflake(settings.defaultRoleId);
  const guildId = cleanSnowflake(getDiscordGuildId());
  if (!roleId) return { attempted: false, assigned: false, roleId: null, reason: "default_role_not_configured" };
  if (!guildId) return { attempted: false, assigned: false, roleId, reason: "guild_not_configured" };

  const control = await fetchDiscordRoleControlSnapshotCachedForUi(60_000);
  if (!control.manageableRoles.some((role) => role.id === roleId)) {
    logDashboardEvent("warn", "discord.newcomer_bootstrap.role_unmanageable", undefined, {
      userId,
      roleId,
      source: params.source,
      error: control.error || null,
    }, { category: "action" });
    return { attempted: true, assigned: false, roleId, reason: "role_unmanageable" };
  }

  try {
    await addGuildMemberRoles({
      guildId,
      userId,
      roleIds: [roleId],
      reason: `Mistblossom newcomer bootstrap (${params.source})`,
      concurrency: 1,
      maxConcurrency: 1,
    });
    logDashboardEvent("info", "discord.newcomer_bootstrap.role_assigned", undefined, {
      userId,
      roleId,
      source: params.source,
    }, { category: "action" });
    return { attempted: true, assigned: true, roleId, reason: "assigned" };
  } catch (error) {
    const message = safeErrorMessage(error, "Newcomer bootstrap role failed");
    logDashboardEvent("warn", "discord.newcomer_bootstrap.role_failed", undefined, {
      userId,
      roleId,
      source: params.source,
      message,
    }, { category: "action" });
    return { attempted: true, assigned: false, roleId, reason: message };
  }
}
