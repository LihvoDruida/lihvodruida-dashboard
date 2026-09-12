import { NextRequest, NextResponse } from "next/server";
import { handleDiscordRecruitmentAdviceMessage, type DiscordMessage } from "@/lib/discordRecruitmentAdvisor";
import {
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyInternalBearerToken,
} from "@/lib/security";
import { cleanSnowflake } from "@/lib/values";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
function normalizeGatewayMessage(payload: any): DiscordMessage | null {
  const raw = payload?.message && typeof payload.message === "object" ? payload.message : payload;
  const id = cleanSnowflake(raw?.id);
  const channelId = cleanSnowflake(raw?.channel_id);
  if (!id || !channelId) return null;

  return {
    id,
    channel_id: channelId,
    guild_id: cleanSnowflake(raw?.guild_id),
    content: typeof raw?.content === "string" ? raw.content : "",
    timestamp: typeof raw?.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    author: raw?.author && typeof raw.author === "object"
      ? {
          id: cleanSnowflake(raw.author.id),
          username: typeof raw.author.username === "string" ? raw.author.username : undefined,
          global_name: typeof raw.author.global_name === "string" ? raw.author.global_name : null,
          bot: Boolean(raw.author.bot),
        }
      : undefined,
    webhook_id: raw?.webhook_id ? cleanSnowflake(raw.webhook_id) : undefined,
    type: Number.isFinite(Number(raw?.type)) ? Number(raw.type) : 0,
    source: typeof raw?.source === "string" ? raw.source : typeof payload?.source === "string" ? payload.source : "dashboard-message-endpoint",
    receivedAt: typeof raw?.receivedAt === "string" ? raw.receivedAt : typeof payload?.receivedAt === "string" ? payload.receivedAt : new Date().toISOString(),
  };
}

export async function POST(request: NextRequest) {
  const token = await verifyInternalBearerToken(request, [
    "DISCORD_RECRUITMENT_ADVICE_SECRET",
    "CRON_SECRET",
    "INTERNAL_API_TOKEN",
  ], { minLength: 24 });

  if (!token.ok) {
    logDashboardEvent("warn", "discord.recruitment_advice.message.forbidden", request, { reason: token.reason, envName: token.envName || null, statusCode: 401 });
    return unauthorizedResponse();
  }

  try {
    const payload = await request.json();
    const message = normalizeGatewayMessage(payload);
    if (!message) {
      return NextResponse.json({ ok: false, error: "Invalid Discord gateway message payload" }, { status: 400, headers: noStoreHeaders() });
    }

    const url = new URL(request.url);
    const result = await handleDiscordRecruitmentAdviceMessage(message, {
      dryRun: url.searchParams.get("dryRun") === "1" || url.searchParams.get("preview") === "1" || payload?.dryRun === true,
      force: url.searchParams.get("force") === "1" || payload?.force === true,
      channelId: message.channel_id,
    });

    logDashboardEvent(result.ok ? "info" : "warn", "discord.recruitment_advice.message", request, {
      ok: result.ok,
      enabled: result.enabled,
      dryRun: result.dryRun,
      matched: result.matched,
      replied: result.replied,
      skipped: result.skipped,
      channelId: result.channelId,
      messageId: result.messageId,
      authorId: result.authorId,
      skipReason: result.skipReason || null,
      score: result.score,
      replyMessageId: result.replyMessageId || null,
      error: result.error || null,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "discord.recruitment_advice.message.failed", request, { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: noStoreHeaders() });
  }
}
