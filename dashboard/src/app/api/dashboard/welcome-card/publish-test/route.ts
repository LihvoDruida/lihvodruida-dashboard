import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { sendDiscordChannelMessageWithAttachment } from "@/lib/discordAdmin";
import { renderDiscordWelcomeCard } from "@/lib/discordWelcomeCard";
import { getDiscordWelcomeCardSettings, renderDiscordWelcomeMessageTemplate } from "@/lib/discordWelcomeCardSettings";
import { cleanWelcomeTestUserId, normalizeDiscordWelcomeCardTestInput, resolveDiscordWelcomeCardTestMember } from "@/lib/discordWelcomeCardTesting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "welcome-card-publish-test", 16 * 1024);
  if ("error" in guard) return guard.error;
  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, {
      ok: false,
      tone: "error",
      title: "Немає доступу",
      message: "Тестову welcome-картку може публікувати лише власник Discord-сервера.",
      status: 403,
    });
  }

  try {
    const form = await request.formData();
    const settings = await getDiscordWelcomeCardSettings({ bypassCache: true });
    const channelId = cleanSnowflake(form.get("channelId")) || settings.channelId;
    if (!channelId) throw new Error("Вибери канал для тестової публікації.");

    const testInput = normalizeDiscordWelcomeCardTestInput({
      testUserId: form.get("testUserId"),
      testDisplayName: form.get("testDisplayName"),
      testUsername: form.get("testUsername"),
      testGreeting: form.get("testGreeting"),
      testNumber: form.get("testNumber"),
      testNickname: form.get("testNickname"),
    });
    const resolved = await resolveDiscordWelcomeCardTestMember(testInput);
    const rendered = await renderDiscordWelcomeCard(resolved.member, settings, {
      greetingOverride: testInput.greeting || settings.greetings[0] || "Ishnu-alah!",
      numberOverride: testInput.number,
    });

    const mentionUserId = resolved.liveMember ? cleanWelcomeTestUserId(testInput.userId) : "";
    const testMessageTemplate = String(form.get("testMessageTemplate") || settings.messageTemplate || "").slice(0, 600);
    const content = renderDiscordWelcomeMessageTemplate(testMessageTemplate, {
      mention: mentionUserId ? `<@${mentionUserId}>` : "@тестовий-учасник",
      username: resolved.member.username || testInput.username,
      displayName: resolved.member.displayName,
      greeting: rendered.greeting,
      label: rendered.label,
    });

    const sent = await sendDiscordChannelMessageWithAttachment({
      channelId,
      content: `🧪 **Тест welcome-системи**\n${content}`,
      fileName: rendered.fileName,
      fileBuffer: rendered.buffer,
      contentType: rendered.contentType,
      auditReason: `Mistblossom welcome-card test by ${guard.session.name || guard.session.id}`,
      allowedUserMentions: mentionUserId ? [mentionUserId] : [],
    });

    await auditDiscordAdmin("discord.welcome_card.test_publish", guard.session, {
      status: "success",
      channelId,
      messageId: sent.messageId,
      testUserId: testInput.userId || null,
      usedLiveMember: resolved.liveMember,
      summary: `Тестову welcome-картку опубліковано в канал ${channelId}.`,
    });

    return adminDiscordResponse(request, {
      ok: true,
      tone: "success",
      title: "Тестову картку опубліковано",
      message: `Discord прийняв тестову картку в каналі ${channelId}.${resolved.lookupError ? ` Реальний профіль не підтягнуто: ${resolved.lookupError}` : ""}`,
      data: { refresh: false, channelId, messageId: sent.messageId },
    });
  } catch (error) {
    return discordAdminError(
      request,
      "admin.discord.welcome_card_test_publish_failed",
      error,
      "Тестову welcome-картку не опубліковано.",
      guard.session,
    );
  }
}
