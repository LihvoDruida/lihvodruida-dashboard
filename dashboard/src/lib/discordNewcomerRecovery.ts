import "server-only";

import { mapConcurrent } from "@/lib/concurrency";
import {
  addGuildMemberRoles,
  fetchDiscordGuildMembers,
  fetchDiscordGuildSnapshot,
  fetchDiscordRoleControlSnapshotCachedForUi,
  getDiscordGuildId,
  type DiscordGuildMemberModerationItem,
} from "@/lib/discordAdmin";
import { ensureAuthAccessRequiredRole } from "@/lib/authAccessPolicy";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { logDashboardEvent, safeErrorMessage } from "@/lib/security";

export type RolelessRecoveryPreview = {
  roleId: string | null;
  roleName: string | null;
  totalMembers: number;
  rolelessCount: number;
  members: Array<{ userId: string; displayName: string; joinedAt: string | null }>;
  manageable: boolean;
  warning: string | null;
};

export async function inspectRolelessDiscordMembers(): Promise<RolelessRecoveryPreview> {
  const [settings, members, guild, control] = await Promise.all([
    getDiscordWelcomeCardSettings({ bypassCache: true }),
    fetchDiscordGuildMembers(0),
    fetchDiscordGuildSnapshot().catch(() => null),
    fetchDiscordRoleControlSnapshotCachedForUi(30_000),
  ]);
  const roleId = String(settings.defaultRoleId || "").trim() || null;
  const manageableRole = roleId ? control.manageableRoles.find((role) => role.id === roleId) || null : null;
  const candidates = members
    .filter((member) => member.userId !== guild?.ownerId)
    .filter((member) => member.roleIds.length === 0)
    .sort((a, b) => (Date.parse(b.joinedAt || "") || 0) - (Date.parse(a.joinedAt || "") || 0));

  return {
    roleId,
    roleName: manageableRole?.name || null,
    totalMembers: members.length,
    rolelessCount: candidates.length,
    members: candidates.slice(0, 100).map((member) => ({
      userId: member.userId,
      displayName: member.displayName,
      joinedAt: member.joinedAt || null,
    })),
    manageable: Boolean(roleId && manageableRole),
    warning: !roleId
      ? "У Welcome-системі не вибрана стартова роль."
      : manageableRole
        ? null
        : "Вибрана стартова роль недоступна боту. Перевір Manage Roles та ієрархію ролей.",
  };
}

export async function repairRolelessDiscordMembers() {
  const preview = await inspectRolelessDiscordMembers();
  if (!preview.roleId) throw new Error("У Welcome-системі не вибрана стартова роль.");
  if (!preview.manageable) throw new Error(preview.warning || "Стартова роль недоступна боту.");
  const guildId = String(getDiscordGuildId() || "").trim();
  if (!guildId) throw new Error("DISCORD_GUILD_ID не налаштований.");

  await ensureAuthAccessRequiredRole(preview.roleId).catch(() => null);
  const membersById = new Map(preview.members.map((member) => [member.userId, member]));
  // Preview is capped for UI, but apply must repair the complete current set.
  const allMembers = await fetchDiscordGuildMembers(0);
  const guild = await fetchDiscordGuildSnapshot().catch(() => null);
  const targets = allMembers
    .filter((member) => member.userId !== guild?.ownerId)
    .filter((member) => member.roleIds.length === 0);

  const mapped = await mapConcurrent(
    targets,
    async (member: DiscordGuildMemberModerationItem) => {
      try {
        await addGuildMemberRoles({
          guildId,
          userId: member.userId,
          roleIds: [preview.roleId!],
          reason: "Mistblossom owner roleless newcomer recovery",
          concurrency: 1,
          maxConcurrency: 1,
        });
        return { ok: true as const, userId: member.userId, displayName: member.displayName };
      } catch (error) {
        return {
          ok: false as const,
          userId: member.userId,
          displayName: member.displayName,
          error: safeErrorMessage(error, "Role recovery failed"),
        };
      }
    },
    { profile: "external-api", concurrency: 3, min: 1, max: 4, failFast: false },
  );

  const items = mapped.results.filter(Boolean) as Array<{ ok: boolean; userId: string; displayName: string; error?: string }>;
  const assigned = items.filter((item) => item.ok).length;
  const failed = items.filter((item) => !item.ok);
  logDashboardEvent(failed.length ? "warn" : "info", "discord.newcomer_onboarding.roleless_repair", undefined, {
    roleId: preview.roleId,
    targeted: targets.length,
    assigned,
    failed: failed.length,
    failures: failed.slice(0, 25),
  }, { category: "action" });

  void membersById;
  return { roleId: preview.roleId, targeted: targets.length, assigned, failed: failed.length, failures: failed.slice(0, 25) };
}
