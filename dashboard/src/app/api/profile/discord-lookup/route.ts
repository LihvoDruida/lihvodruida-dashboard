import { NextRequest, NextResponse } from "next/server";
import { getProfileByDiscordUserId, getMainCharacter, getProfilePublicName } from "@/lib/profiles";
import { hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  verifyInternalBearerToken,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTERNAL_LOOKUP_TOKENS = ["INTERNAL_PROFILE_LOOKUP_TOKEN"];

export async function GET(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 4 * 1024);
  if (tooLarge) return tooLarge;

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-discord-lookup:${ip}`, 120, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ found: false, error: "Rate limited", reason: "rate-limited" }, { status: 429, headers: noStoreHeaders({ "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) }) });
  }

  const auth = await verifyInternalBearerToken(request, INTERNAL_LOOKUP_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "profile.discord_lookup.forbidden", request, { reason: auth.reason });
    return NextResponse.json({ found: false, error: "Forbidden", reason: "forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  if (!hasFirebaseProfileConfig()) {
    return NextResponse.json({ found: false, error: "Збереження профілів тимчасово недоступне.", reason: "profile-storage-unavailable" }, { status: 503, headers: noStoreHeaders() });
  }

  const url = new URL(request.url);
  const discordId = String(url.searchParams.get("discord_id") || "").trim();
  if (!/^\d{16,25}$/.test(discordId)) {
    return NextResponse.json({ found: false, error: "Invalid Discord user id.", reason: "invalid-discord-id" }, { status: 400, headers: noStoreHeaders() });
  }

  try {
    const profile = await getProfileByDiscordUserId(discordId);

    logDashboardEvent("info", "profile.discord_lookup", request, { found: Boolean(profile), discordId: discordId ? `[discord:${discordId.slice(-6)}]` : null });

    if (!profile) {
      return NextResponse.json({ found: false, reason: "profile-not-found" }, { status: 404, headers: noStoreHeaders() });
    }

    const mainCharacter = getMainCharacter(profile);
    return NextResponse.json({
      found: true,
      profileId: profile.profileId,
      displayName: getProfilePublicName(profile),
      discordName: profile.displayName,
      mainCharacter,
      hasMainCharacter: Boolean(mainCharacter?.name && (mainCharacter.realmName || mainCharacter.realmSlug)),
      characterCount: Array.isArray(profile.characters) ? profile.characters.length : 0,
    }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error, "Profile lookup failed.");
    logDashboardEvent("error", "profile.discord_lookup.failed", request, { discordId: `[discord:${discordId.slice(-6)}]`, message });
    return NextResponse.json({ found: false, error: message, reason: "lookup-exception" }, { status: 500, headers: noStoreHeaders() });
  }
}
