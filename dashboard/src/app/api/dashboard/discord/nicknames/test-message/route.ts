import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { sendNicknameWarningTestToOwner } from "@/lib/discordNicknameWarnings";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "nickname-test-message", 8 * 1024);
  if ("error" in guard) return guard.error;
  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, {
      ok: false,
      tone: "error",
      title: "Немає доступу",
      message: "Тестове повідомлення про нік може надсилати лише власник Discord-сервера.",
      status: 403,
    });
  }

  try {
    const result = await sendNicknameWarningTestToOwner();
    await auditDiscordAdmin("discord.nickname_warning.test_message", guard.session, {
      status: "success",
      ownerId: result.ownerId,
      channelId: result.channelId,
      messageId: result.messageId,
      summary: "Тестове повідомлення про виправлення ніку надіслано власнику сервера в DM.",
    });
    return adminDiscordResponse(request, {
      ok: true,
      tone: "success",
      title: "Тестове повідомлення надіслано",
      message: "Перевір приватні повідомлення Discord власника сервера. Scheduler state і cooldown не змінювалися.",
      data: { refresh: false },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.nickname_test_message_failed", error, "Не вдалося надіслати тестове повідомлення власнику сервера.", guard.session);
  }
}
