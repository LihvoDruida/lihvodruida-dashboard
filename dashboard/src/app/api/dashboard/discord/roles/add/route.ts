import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { addDiscordMemberRoles } from "@/lib/discordMemberManagement";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "roles-add", 24 * 1024);
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const roleIds = form.getAll("roleIds");
    const result = await addDiscordMemberRoles({
      userId: form.get("userId"),
      roleIds,
      reason: `Mistblossom manual role add by ${guard.session.name || guard.session.id}`,
    });

    await auditDiscordAdmin("discord.member.roles.manual_add", guard.session, {
      status: "success",
      summary: `${result.displayName}: додано ролей ${result.addedRoleIds.length}; уже були ${result.alreadyHadRoleIds.length}.`,
      userId: result.userId,
      roleIds: result.roleIds,
      addedRoleIds: result.addedRoleIds,
      alreadyHadRoleIds: result.alreadyHadRoleIds,
      changed: result.changed,
      verified: result.verified,
    });

    return adminDiscordResponse(request, {
      ok: true,
      tone: result.changed ? "success" : "info",
      title: result.changed ? "Discord-ролі додано" : "Ролі вже були в учасника",
      message: `${result.displayName}: додано ${result.addedRoleIds.length}, без змін ${result.alreadyHadRoleIds.length}.`,
      data: { result, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.roles_add_failed", error, "Discord-ролі не додано.", guard.session);
  }
}
