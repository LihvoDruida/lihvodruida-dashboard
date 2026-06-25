import { NextRequest, NextResponse } from "next/server";
import { handleRaidPollDiscordVote } from "@/lib/raidPolls";
import {
  assertRequestBodySize,
  checkRateLimit,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  verifyInternalBearerToken,
} from "@/lib/security";
import {
  cleanIdempotencyKey,
  idempotencyHeader,
  runIdempotentAction,
} from "@/lib/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTERNAL_POLL_ACTION_TOKENS = [
  "DISCORD_RULES_STATS_TOKEN",
  "WORKER_STATS_TOKEN",
  "INTERNAL_PROFILE_LOOKUP_TOKEN",
];

function cleanKind(value: unknown): "days" | "time" | "schedule" | "schedule_page" | "character" | "character_prompt" | "role" | "submit" {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === "time") return "time";
  if (kind === "schedule") return "schedule";
  if (kind === "schedule_page") return "schedule_page";
  if (kind === "character") return "character";
  if (kind === "character_prompt") return "character_prompt";
  if (kind === "role") return "role";
  if (kind === "submit") return "submit";
  return "days";
}

function cleanValues(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 25) : [];
}

function cleanScheduleGroup(value: unknown) {
  const group = String(value || "").trim().toLowerCase();
  if (group === "a" || group === "b" || group === "c") return group;
  if (/^(mon|tue|wed|thu|fri|sat|sun)$/.test(group)) return group;
  if (/^page_?\d{1,2}$/.test(group)) return group.replace(/^page_?(\d+)$/, "page_$1");
  return "";
}

function cleanSnowflake(value: unknown) {
  const id = String(value || "").trim();
  return /^\d{16,25}$/.test(id) ? id : "";
}

export async function POST(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const tooLarge = assertRequestBodySize(request, 16 * 1024);
  if (tooLarge) return tooLarge;

  const auth = await verifyInternalBearerToken(request, INTERNAL_POLL_ACTION_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "raid_polls.discord_vote.forbidden", request, { reason: auth.reason });
    return NextResponse.json({ ok: false, content: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  const { pollId } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    const userId = cleanSnowflake(body?.userId || body?.user_id);
    if (!userId) return NextResponse.json({ ok: false, content: "Invalid Discord user id" }, { status: 400, headers: noStoreHeaders() });

    const kind = cleanKind(body?.kind);
    const limit = checkRateLimit(`raid-poll-discord-action:${pollId}:${userId}:${kind}`, kind === "submit" ? 80 : 220, 10 * 60 * 1000);
    if (!limit.ok) {
      return NextResponse.json(
        { ok: false, content: "⏳ Забагато дій саме від тебе. Зачекай кілька секунд і повтори." },
        { status: 429, headers: noStoreHeaders({ "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) }) },
      );
    }

    const idempotencyKey = cleanIdempotencyKey(request.headers.get("x-idempotency-key"));
    const { value: result, status: idempotencyStatus } = await runIdempotentAction({
      namespace: "raid-poll-discord-action",
      key: idempotencyKey,
      ttlMs: 90_000,
      pendingValue: {
        ok: false,
        content: "⏳ Цей Discord-запит уже обробляється. Зачекай секунду й не натискай повторно.",
      },
      action: () => handleRaidPollDiscordVote({
        pollId,
        kind,
        group: cleanScheduleGroup(body?.group),
        values: cleanValues(body?.values),
        userId,
        userName: String(body?.userName || body?.user_name || "Discord user").trim().slice(0, 120) || "Discord user",
        guildId: cleanSnowflake(body?.guildId || body?.guild_id),
        guildName: String(body?.guildName || body?.guild_name || "Discord server").trim().slice(0, 120) || "Discord server",
        messageRef: {
          channelId: cleanSnowflake(body?.channelId || body?.channel_id),
          messageId: cleanSnowflake(body?.messageId || body?.message_id),
        },
      }),
    });

    const idempotency = idempotencyHeader(idempotencyStatus);
    return NextResponse.json(result, { headers: noStoreHeaders(idempotency ? { "X-Mistblossom-Idempotency": idempotency } : undefined) });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raid_polls.discord_vote.failed", request, { pollId, message });
    return NextResponse.json({ ok: false, content: message }, { status: 500, headers: noStoreHeaders() });
  }
}
