import { after, NextRequest, NextResponse } from "next/server";
import { handleRaidDiscordAction, syncRaidDiscordSignupUpdate, type RaidCharacterRole, type RaidSignupStatus } from "@/lib/raids";
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

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_RAID_ACTION_TOKENS = [
  "DISCORD_RULES_STATS_TOKEN",
  "WORKER_STATS_TOKEN",
  "INTERNAL_PROFILE_LOOKUP_TOKEN",
];

function cleanAction(value: unknown): RaidSignupStatus {
  const action = String(value || "").trim().toLowerCase();
  if (action === "late") return "late";
  if (["tentative", "maybe", "50/50", "5050", "half"].includes(action)) return "tentative";
  if (action === "skipped" || action === "skip") return "skipped";
  return "going";
}

function cleanSignupRole(value: unknown): RaidCharacterRole | null {
  const role = String(value || "").trim().toLowerCase();
  if (role === "tank") return "tank";
  if (role === "healer" || role === "heal") return "healer";
  if (role === "dps" || role === "dd") return "dps";
  return null;
}

function cleanDiscordId(value: unknown) {
  const id = String(value || "").trim();
  return /^\d{16,25}$/.test(id) ? id : "";
}

function cleanDiscordMessageId(value: unknown) {
  const id = String(value || "").trim();
  return /^\d{16,25}$/.test(id) ? id : "";
}

export async function POST(request: NextRequest, context: { params: Promise<{ raidId: string }> }) {
  const tooLarge = assertRequestBodySize(request, 16 * 1024);
  if (tooLarge) return tooLarge;

  const auth = await verifyInternalBearerToken(request, INTERNAL_RAID_ACTION_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "raids.discord_action.forbidden", request, { reason: auth.reason });
    return NextResponse.json({ ok: false, content: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  const { raidId } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    const userId = cleanDiscordId(body?.userId || body?.user_id);
    const channelId = cleanDiscordMessageId(body?.channelId || body?.channel_id);
    const messageId = cleanDiscordMessageId(body?.messageId || body?.message_id);
    const action = cleanAction(body?.action);
    const commit = Boolean(body?.commit);

    if (!userId) {
      return NextResponse.json({ ok: false, content: "Invalid Discord user id" }, { status: 400, headers: noStoreHeaders() });
    }

    // Вибір персонажа/ролі лише оновлює приватний Discord-пульт і не має ловити cooldown.
    // Rate-limit залишаємо тільки на реальний запис/пропуск, щоб різні користувачі та швидкі select-дії не блокували одне одного.
    if (commit || action === "skipped") {
      const limit = checkRateLimit(`raid-discord-action:${raidId}:${userId}:commit`, 120, 5 * 60 * 1000);
      if (!limit.ok) {
        logDashboardEvent("warn", "raids.discord_action.rate_limited", request, { raidId, userId, resetAt: limit.resetAt });
        return NextResponse.json(
          { ok: false, content: "⏳ Забагато підтверджень саме від тебе. Зачекай кілька секунд і повтори." },
          {
            status: 429,
            headers: noStoreHeaders({
              "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
            }),
          },
        );
      }
    }

    const idempotencyKey = cleanIdempotencyKey(request.headers.get("x-idempotency-key"));
    const { value: result, status: idempotencyStatus } = await runIdempotentAction({
      namespace: "raid-discord-action",
      key: idempotencyKey,
      ttlMs: 90_000,
      pendingValue: {
        ok: false,
        content: "⏳ Цей Discord-запит уже обробляється. Зачекай секунду й не натискай повторно.",
      },
      action: async () => {
        const actionResult = await handleRaidDiscordAction({
          raidId,
          action,
          userId,
          userName: String(body?.userName || body?.user_name || "Discord user").trim().slice(0, 120) || "Discord user",
          characterKey: String(body?.characterKey || body?.character_key || "").trim().slice(0, 120) || null,
          signupRole: cleanSignupRole(body?.signupRole || body?.signup_role || body?.role),
          commit,
          messageRef: {
            channelId,
            messageId,
          },
          syncDiscord: false,
        });
        if (actionResult.ok && "raid" in actionResult && actionResult.raid) {
          const raidToSync = actionResult.raid;
          const messageRef = { channelId, messageId };
          after(async () => {
            await syncRaidDiscordSignupUpdate(raidToSync, messageRef);
          });
        }
        return actionResult;
      },
    });
    const idempotency = idempotencyHeader(idempotencyStatus);
    return NextResponse.json(result, { headers: noStoreHeaders(idempotency ? { "X-Mistblossom-Idempotency": idempotency } : undefined) });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raids.discord_action.failed", request, { raidId, message });
    return NextResponse.json({ ok: false, content: message }, { status: 500, headers: noStoreHeaders() });
  }
}
