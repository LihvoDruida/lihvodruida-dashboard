import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageGeneralEmbeds, canManageRulesEmbeds } from "@/lib/permissions";
import {
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
} from "@/lib/security";
import {
  fetchDiscordEditableMessage,
  parseDiscordMessageRef,
} from "@/lib/discordAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders() });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  const url = new URL(request.url);
  const mode = String(url.searchParams.get("mode") || "general").trim() === "rules" ? "rules" : "general";

  if (!session || !canManageGeneralEmbeds(session)) {
    return jsonResponse({ error: "Ця дія доступна тільки гільдмайстеру або офіцеру." }, 403);
  }

  if (mode === "rules" && !canManageRulesEmbeds(session)) {
    return jsonResponse({ error: "Редагування правил доступне тільки гільдмайстеру." }, 403);
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`discord-message-load:${session.id}:${ip}`, 60, 10 * 60 * 1000);
  if (!limit.ok) {
    return jsonResponse({ error: "Забагато запитів до Discord. Спробуй трохи пізніше." }, 429);
  }

  try {
    const rawLink = String(url.searchParams.get("message") || url.searchParams.get("url") || url.searchParams.get("link") || "").trim();
    const ref = parseDiscordMessageRef(rawLink);

    if (!ref) {
      logDashboardEvent("warn", "discord.embed.message_load_invalid_link", request, { actorId: session.id, mode });
      return jsonResponse({ error: "Посилання на Discord-повідомлення невалідне." }, 400);
    }

    logDashboardEvent("info", "discord.embed.message_load_started", request, {
      actorId: session.id,
      actorRole: session.role,
      mode,
      channelId: ref.channelId,
      messageId: ref.messageId,
    });

    const message = await fetchDiscordEditableMessage(ref);

    if (message.isRules && !canManageRulesEmbeds(session)) {
      logDashboardEvent("warn", "discord.embed.message_load_forbidden_rules", request, {
        actorId: session.id,
        actorRole: session.role,
        channelId: message.channelId,
        messageId: message.id,
      });
      return jsonResponse({ error: "Це повідомлення правил. Офіцер не може відкривати або редагувати правила." }, 403);
    }

    const warning = mode === "rules" && !message.isRules
      ? "Це повідомлення не схоже на повідомлення правил із кнопками цієї панелі. Контент завантажено, але ролі можуть бути порожніми."
      : "";

    logDashboardEvent("info", "discord.embed.message_loaded", request, {
      actorId: session.id,
      actorRole: session.role,
      mode,
      channelId: message.channelId,
      messageId: message.id,
      isRules: message.isRules,
      roleCount: message.roleIds.length,
      hasContent: Boolean(message.content),
      hasEmbed: Boolean(message.embed),
    });

    return jsonResponse({
      ok: true,
      warning,
      message: {
        id: message.id,
        channelId: message.channelId,
        url: message.url,
        content: message.content,
        embed: message.embed || {},
        embedJson: message.embedJson,
        title: message.title,
        roleIds: message.roleIds,
        isRules: message.isRules,
        rulesType: message.rulesType,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
      },
    });
  } catch (error) {
    logDashboardEvent("error", "discord.embed.message_load_failed", request, { actorId: session.id, message: safeErrorMessage(error) });
    return jsonResponse({ error: "Не вдалося завантажити Discord-повідомлення. Спробуй ще раз пізніше." }, 500);
  }
}
