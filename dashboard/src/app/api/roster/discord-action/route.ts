import { NextRequest, NextResponse } from "next/server";
import {
  handleRosterFormationDiscordAction,
  type RosterDiscordKind,
} from "@/lib/rosterFormation";
import {
  assertRequestBodySize,
  checkRateLimit,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  verifyInternalBearerToken,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Discord-інтеракції обробляє окремий сервіс бота (контейнер `bot`):
 * він перевіряє підпис Discord, робить швидкий ACK і ПРОКСУЄ дію сюди. Уся логіка
 * складу живе в панелі (rosterFormation.ts), тому воркеру не треба знати Firestore —
 * він лише пересилає {rosterId, kind, classKey, values, userId, userName} і показує
 * повернутий content + components. Так само вже влаштовані рейд-пули й рейд-оголошення.
 */

const INTERNAL_ROSTER_ACTION_TOKENS = [
  "INTERNAL_PROFILE_LOOKUP_TOKEN",
];

function cleanKind(value: unknown): RosterDiscordKind | null {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === "pick" || kind === "class" || kind === "spec" || kind === "leave") return kind;
  return null;
}

function cleanValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 16 * 1024);
  if (tooLarge) return tooLarge;

  const auth = await verifyInternalBearerToken(request, INTERNAL_ROSTER_ACTION_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "roster.discord_action.forbidden", request, { reason: auth.reason, statusCode: 403 });
    return NextResponse.json({ ok: false, content: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rosterId = String(body?.rosterId || "").trim();
    const kind = cleanKind(body?.kind);
    const classKey = body?.classKey ? String(body.classKey).trim() : undefined;
    const values = cleanValues(body?.values);
    const userId = String(body?.userId || body?.user_id || "").trim();
    const userName = String(body?.userName || body?.user_name || "").trim();
    const channelId = String(body?.channelId || body?.channel_id || "").trim();
    const messageId = String(body?.messageId || body?.message_id || "").trim();

    if (!rosterId || !kind) {
      return NextResponse.json(
        { ok: false, content: "Некоректний запит складу." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    // Захист від флуду тим самим користувачем; select-и (pick/class/spec) щедріші.
    const limit = checkRateLimit(`roster-discord-action:${rosterId}:${userId}`, 120, 5 * 60 * 1000);
    if (!limit.ok) {
      return NextResponse.json(
        { ok: false, content: "⏳ Забагато дій підряд. Зачекай кілька секунд і спробуй ще раз." },
        {
          status: 429,
          headers: noStoreHeaders({
            "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
          }),
        },
      );
    }

    const result = await handleRosterFormationDiscordAction({
      rosterId,
      kind,
      classKey,
      values,
      userId,
      userName,
      messageRef: { channelId, messageId },
    });

    logDashboardEvent(result.ok ? "info" : "warn", "roster.discord_action.done", request, {
      rosterId,
      kind,
      userId,
      ok: result.ok,
    });

    return NextResponse.json(
      { ok: result.ok, content: result.content, components: result.components || [] },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    logDashboardEvent("error", "roster.discord_action.failed", request, { message: safeErrorMessage(error) });
    return NextResponse.json(
      { ok: false, content: "❌ Не вдалося оновити склад. Спробуй ще раз пізніше або звернись до офіцера." },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
