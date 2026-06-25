import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { updateDiscordMemberNickname } from "@/lib/discordMemberManagement";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "nickname");
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const result = await updateDiscordMemberNickname({
      userId: form.get("userId"),
      nickname: form.get("nickname"),
      reason: `Mistblossom manual nickname update by ${guard.session.name || guard.session.id}`,
    });
    await auditDiscordAdmin("discord.member.nickname.update", guard.session, {
      ...result,
      status: "success",
      summary: `${result.displayName}: нік змінено з ${result.beforeNickname || "—"} на ${result.afterNickname || result.nickname}.`,
      changed: 1,
      changedItems: [{ userId: result.userId, name: result.displayName, beforeNickname: result.beforeNickname, afterNickname: result.afterNickname }],
      changedItemsTotal: 1,
      changedNames: [result.displayName],
    });
    return adminDiscordResponse(request, {
      ok: true,
      title: "Нік змінено в Discord",
      message: `${result.displayName}: ${result.beforeNickname || "—"} → ${result.afterNickname || result.nickname}.`,
      data: { ...result, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.nickname_failed", error, "Discord не змінив серверний нік.", guard.session);
  }
}
