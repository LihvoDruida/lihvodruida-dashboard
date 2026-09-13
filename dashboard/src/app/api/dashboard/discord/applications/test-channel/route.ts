import { NextRequest } from "next/server";

import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { notifyDiscordApplicationChannelTest } from "@/lib/discord";
import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "applications-test-channel");
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const moderator = (await resolveAuthorIdentity(guard.session)).primaryName;
    const result = await notifyDiscordApplicationChannelTest({ moderator, channelId: form.get("applicationsChannelId") as string | null });
    if (!result.ok) {
      throw new Error(result.reason || "Не вдалося надіслати тестове повідомлення у канал заявок.");
    }

    await auditDiscordAdmin("discord.applications_channel.test", guard.session, {
      status: "success",
      summary: "Тестове повідомлення в канал заявок надіслано.",
      channelId: result.channel_id,
      messageId: result.message_id,
    });

    return adminDiscordResponse(request, {
      ok: true,
      title: "Канал заявок працює",
      message: "Тестове повідомлення успішно надіслано в Discord.",
      data: { result },
    });
  } catch (error) {
    return discordAdminError(request, "admin.discord.applications_channel_test_failed", error, "Тест каналу заявок не виконано.", guard.session);
  }
}
