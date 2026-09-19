import { NextRequest, NextResponse } from "next/server";

import { getDiscordGuildId } from "@/lib/discordAdmin";
import { runDiscordNewcomerOnboarding } from "@/lib/discordNewcomerOnboarding";
import {
  assertRequestBodySize,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyInternalBearerToken,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;


function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

export async function POST(request: NextRequest) {
  const oversized = assertRequestBodySize(request, 16 * 1024);
  if (oversized) return oversized;

  const auth = await verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!auth.ok) return unauthorizedResponse("Forbidden");
  if (String(request.headers.get("x-mistblossom-source") || "").trim() !== "bot-gateway") {
    logDashboardEvent("warn", "discord.newcomer_onboarding.gateway_source_rejected", request, {
      source: String(request.headers.get("x-mistblossom-source") || "").slice(0, 40),
    }, { category: "security" });
    return NextResponse.json({ ok: false, error: "invalid_source" }, { status: 403, headers: noStoreHeaders() });
  }

  let payload: any = null;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413, headers: noStoreHeaders() });
    }
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400, headers: noStoreHeaders() });
  }

  const guildId = cleanSnowflake(payload?.guildId);
  const userId = cleanSnowflake(payload?.userId);
  const configuredGuildId = cleanSnowflake(getDiscordGuildId());
  const joinedAt = String(payload?.joinedAt || "").trim() || null;
  const eventId = String(payload?.eventId || "").trim().slice(0, 120) || null;
  const bodySource = String(payload?.source || "").trim();

  if (bodySource !== "discord_gateway") {
    return NextResponse.json({ ok: false, error: "invalid_payload_source" }, { status: 403, headers: noStoreHeaders() });
  }
  if (joinedAt) {
    const joinedAtMs = Date.parse(joinedAt);
    if (!Number.isFinite(joinedAtMs) || joinedAtMs > Date.now() + 5 * 60_000) {
      return NextResponse.json({ ok: false, error: "invalid_joined_at" }, { status: 400, headers: noStoreHeaders() });
    }
  }

  if (!guildId || !userId) {
    return NextResponse.json({ ok: false, error: "invalid_member_join_payload" }, { status: 400, headers: noStoreHeaders() });
  }
  if (!configuredGuildId || guildId !== configuredGuildId) {
    logDashboardEvent("warn", "discord.newcomer_onboarding.gateway_wrong_guild", request, {
      guildId,
      configuredGuildId: configuredGuildId || null,
      userId,
      eventId,
    }, { category: "security" });
    return NextResponse.json({ ok: false, error: "wrong_guild" }, { status: 403, headers: noStoreHeaders() });
  }

  try {
    const result = await runDiscordNewcomerOnboarding({
      priorityUserIds: [userId],
      source: "gateway",
    });

    if (result.skippedReason === "distributed_lease") {
      return NextResponse.json({
        ok: true,
        retry: true,
        reason: "onboarding_busy",
        eventId,
        userId,
      }, { status: 202, headers: noStoreHeaders() });
    }

    const criticalRetry = result.defaultRoleFailed > 0 || result.persistenceFailed > 0;
    logDashboardEvent(
      result.failed || result.defaultRoleFailed || result.channelFailed || result.persistenceFailed ? "warn" : "info",
      "discord.newcomer_onboarding.gateway_completed",
      request,
      {
        eventId,
        userId,
        joinedAt,
        criticalRetry,
        ...result,
      },
      { category: "action" },
    );

    return NextResponse.json({
      ok: true,
      retry: criticalRetry,
      reason: criticalRetry ? "critical_onboarding_retry" : null,
      eventId,
      userId,
      result,
    }, { status: criticalRetry ? 202 : 200, headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error, "Priority newcomer onboarding failed");
    logDashboardEvent("error", "discord.newcomer_onboarding.gateway_failed", request, {
      eventId,
      userId,
      joinedAt,
      message,
    }, { category: "action" });
    return NextResponse.json({ ok: false, retry: true, error: message }, { status: 503, headers: noStoreHeaders() });
  }
}
