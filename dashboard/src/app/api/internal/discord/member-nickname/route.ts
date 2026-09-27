import { NextRequest, NextResponse } from "next/server";

import { getDiscordGuildId } from "@/lib/discordAdmin";
import { processObservedNicknameMember } from "@/lib/discordNicknameWarnings";
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
    return NextResponse.json({ ok: false, error: "invalid_source" }, { status: 403, headers: noStoreHeaders() });
  }

  let payload: any;
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
  const source = String(payload?.source || "").trim();
  const eventId = String(payload?.eventId || "").trim().slice(0, 120) || null;
  const observedNickname = payload?.nickname === null || payload?.nickname === undefined
    ? null
    : String(payload.nickname).normalize("NFC").slice(0, 64);

  if (source !== "discord_gateway") {
    return NextResponse.json({ ok: false, error: "invalid_payload_source" }, { status: 403, headers: noStoreHeaders() });
  }
  if (!guildId || !userId) {
    return NextResponse.json({ ok: false, error: "invalid_member_payload" }, { status: 400, headers: noStoreHeaders() });
  }
  if (!configuredGuildId || guildId !== configuredGuildId) {
    logDashboardEvent("warn", "discord.nickname_warning.gateway_wrong_guild", request, {
      guildId,
      configuredGuildId: configuredGuildId || null,
      userId,
      eventId,
    }, { category: "security" });
    return NextResponse.json({ ok: false, error: "wrong_guild" }, { status: 403, headers: noStoreHeaders() });
  }

  try {
    const result = await processObservedNicknameMember({
      userId,
      observedNickname,
      source: "automatic",
    });
    logDashboardEvent(
      "skipped" in result && result.skipped ? "debug" : result.status === "invalid" ? "info" : "debug",
      "discord.nickname_warning.gateway_checked",
      request,
      { eventId, userId, observedNickname, result },
      { category: "action" },
    );
    return NextResponse.json({ ok: true, eventId, userId, result }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error, "Не вдалося перевірити зміну Discord-ніку.");
    logDashboardEvent("error", "discord.nickname_warning.gateway_failed", request, {
      eventId,
      userId,
      observedNickname,
      message,
    }, { category: "action" });
    return NextResponse.json({ ok: false, error: message }, { status: 503, headers: noStoreHeaders() });
  }
}
