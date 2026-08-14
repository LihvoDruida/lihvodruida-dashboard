import { NextRequest, NextResponse } from "next/server";
import { scanDiscordRecruitmentAdvice } from "@/lib/discordRecruitmentAdvisor";
import {
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyInternalBearerToken,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

function integerParam(value: string | null, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

export async function GET(request: NextRequest) {
  const token = await verifyInternalBearerToken(request, [
    "DISCORD_RECRUITMENT_ADVICE_SECRET",
    "CRON_SECRET",
    "INTERNAL_API_TOKEN",
    "WORKER_STATS_TOKEN",
  ], { minLength: 24 });

  if (!token.ok) {
    logDashboardEvent("warn", "discord.recruitment_advice.forbidden", request, { reason: token.reason, envName: token.envName || null });
    return unauthorizedResponse();
  }

  try {
    const url = new URL(request.url);
    const result = await scanDiscordRecruitmentAdvice({
      dryRun: url.searchParams.get("dryRun") === "1" || url.searchParams.get("preview") === "1",
      force: url.searchParams.get("force") === "1",
      limit: integerParam(url.searchParams.get("limit"), 4, 1, 20),
    });
    logDashboardEvent(result.ok ? "info" : "warn", "discord.recruitment_advice.scan", request, {
      ok: result.ok,
      enabled: result.enabled,
      dryRun: result.dryRun,
      channels: result.channels.length,
      scanned: result.scanned,
      matched: result.matched,
      replied: result.replied,
      skipped: result.skipped,
      errors: result.errors.slice(0, 3),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "discord.recruitment_advice.failed", request, { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: noStoreHeaders() });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
