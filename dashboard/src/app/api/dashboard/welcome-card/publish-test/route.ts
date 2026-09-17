import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { fetchDiscordTextChannels, sendDiscordChannelMessageWithAttachment } from "@/lib/discordAdmin";
import { formatDiscordMemberJoinNumber, resolveDiscordMemberJoinNumber } from "@/lib/discordMemberJoinNumber";
import { createDiscordWelcomeArtifact } from "@/lib/discordWelcomeArtifact";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { cleanWelcomeTestUserId, normalizeDiscordWelcomeCardTestInput, resolveDiscordWelcomeCardTestMember } from "@/lib/discordWelcomeCardTesting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}


/**
 * A synthetic test member (no real Discord ID) previews the next free member
 * number. Resolved without a user ID so it never forces a member-list refresh;
 * A live member returns "" so the artifact resolves its real join-order number.
 */
async function synthesizedTestMemberNumber(liveMember: boolean) {
  if (liveMember) return "";
  return formatDiscordMemberJoinNumber(await resolveDiscordMemberJoinNumber({ userId: "", joinedAt: new Date().toISOString() }));
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
    const settings = await getDiscordWelcomeCardSettings();
    const channelId = cleanSnowflake(form.get("channelId")) || settings.channelId;
    if (!channelId) throw new Error("Вибери канал для тестової публікації.");

    const channels = await fetchDiscordTextChannels();
    if (!channels.channels.some((channel) => channel.id === channelId)) {
      throw new Error("Вибраний канал не знайдений серед доступних текстових каналів цього Discord-сервера.");
    }

    const testInput = normalizeDiscordWelcomeCardTestInput({
      testUserId: form.get("testUserId"),
      testDisplayName: form.get("testDisplayName"),
      testUsername: form.get("testUsername"),
      testGreeting: form.get("testGreeting"),
      testNumber: form.get("testNumber"),
      testNickname: form.get("testNickname"),
    });
    const resolved = await resolveDiscordWelcomeCardTestMember(testInput);
    const mentionUserId = resolved.liveMember ? cleanWelcomeTestUserId(testInput.userId) : "";
    const messageTemplateOverride = String(form.get("testMessageTemplate") || settings.messageTemplate || "").slice(0, 600);
    const artifact = await createDiscordWelcomeArtifact(resolved.member, settings, {
      greetingOverride: testInput.greeting || settings.greetings[0] || "Ishnu-alah!",
      numberOverride: testInput.number || await synthesizedTestMemberNumber(resolved.liveMember),
      messageTemplateOverride,
      mentionOverride: mentionUserId ? `<@${mentionUserId}>` : "@тестовий-учасник",
    });

    const sent = await sendDiscordChannelMessageWithAttachment({
      channelId,
      content: `🧪 **Тест welcome-системи**\n${artifact.content}`,
      fileName: artifact.fileName,
      fileBuffer: artifact.buffer,
      contentType: artifact.contentType,
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
