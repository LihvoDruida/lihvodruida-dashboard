import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { removeDiscordMemberRoles } from "@/lib/discordMemberManagement";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "roles-remove", 24 * 1024);
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const roleIds = form.getAll("roleIds");
    const result = await removeDiscordMemberRoles({
      userId: form.get("userId"),
      roleIds,
      reason: `Mistblossom manual role remove by ${guard.session.name || guard.session.id}`,
    });

    await auditDiscordAdmin("discord.member.roles.manual_remove", guard.session, {
      status: "success",
      summary: `${result.displayName}: знято ролей ${result.removedRoleIds.length}; уже не було ${result.alreadyMissingRoleIds.length}.`,
      userId: result.userId,
      roleIds: result.roleIds,
      removedRoleIds: result.removedRoleIds,
      alreadyMissingRoleIds: result.alreadyMissingRoleIds,
      changed: result.changed,
      verified: result.verified,
    });

    return adminDiscordResponse(request, {
      ok: true,
      tone: result.changed ? "success" : "info",
      title: result.changed ? "Discord-ролі знято" : "Цих ролей уже не було",
      message: `${result.displayName}: знято ${result.removedRoleIds.length}, без змін ${result.alreadyMissingRoleIds.length}.`,
      data: { result, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.roles_remove_failed", error, "Discord-ролі не знято.", guard.session);
  }
}
