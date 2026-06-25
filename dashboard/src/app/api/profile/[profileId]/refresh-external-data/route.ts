import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { canViewProfile, getProfileById, refreshProfileExternalData } from "@/lib/profiles";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  rateLimitResponse,
  safeErrorMessage,
  verifyTrustedOrigin,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

function cleanProfileId(value: unknown) {
  return String(value || "").trim().slice(0, 160);
}

function requestedSpacingSeconds(value: unknown, fallbackSeconds: number) {
  const minSeconds = Math.max(10 * 60, Math.floor(fallbackSeconds));
  const number = Number(value);
  if (!Number.isFinite(number)) return minSeconds;
  return Math.max(minSeconds, Math.min(Math.floor(number), 24 * 60 * 60));
}

function publicProfilePayload(profile: Awaited<ReturnType<typeof getProfileById>>) {
  if (!profile) return null;
  return {
    updatedAt: profile.updatedAt || null,
    battlenet: profile.battlenet || null,
    characters: profile.characters,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 2048);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "session_required" }, { status: 401, headers: noStoreHeaders() });
  }

  const { profileId: rawProfileId } = await params;
  const profileId = cleanProfileId(rawProfileId);
  if (!profileId) {
    return NextResponse.json({ ok: false, error: "profile_id_required" }, { status: 400, headers: noStoreHeaders() });
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-external-refresh:${session.profileId || session.id}:${profileId}:${ip}`, 18, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  try {
    const profile = await getProfileById(profileId);
    if (!profile || !canViewProfile(session, profileId, profile)) {
      return NextResponse.json({ ok: false, error: "profile_not_found" }, { status: 404, headers: noStoreHeaders() });
    }

    const settings = await getDashboardApiSettings();
    const body = await request.json().catch(() => null) as { minSpacingSeconds?: unknown } | null;
    const minSpacingSeconds = requestedSpacingSeconds(body?.minSpacingSeconds, settings.profileViewRefreshMinSeconds);
    const result = await refreshProfileExternalData(profile, {
      reason: "profile_view",
      minSpacingSeconds,
      maxCharacters: profile.characters.length,
      force: false,
    });

    const responseProfile = result.profile || profile;
    const throttled = result.refreshed === 0 && result.failed === 0 && result.skipped > 0;

    logDashboardEvent("info", "profile.external_refresh.background", request, {
      profileId,
      viewerProfileId: session.profileId || null,
      refreshed: result.refreshed,
      failed: result.failed,
      skipped: result.skipped,
      locked: result.locked,
      throttled,
    });

    return NextResponse.json({
      ok: true,
      profileId,
      refreshed: result.refreshed,
      failed: result.failed,
      skipped: result.skipped,
      locked: result.locked,
      throttled,
      checkedAt: new Date().toISOString(),
      profile: publicProfilePayload(responseProfile),
    }, { headers: noStoreHeaders() });
  } catch (error) {
    logDashboardEvent("warn", "profile.external_refresh.background_failed", request, {
      profileId,
      viewerProfileId: session.profileId || null,
      message: safeErrorMessage(error),
    });
    return NextResponse.json({ ok: false, error: "refresh_failed" }, { status: 500, headers: noStoreHeaders() });
  }
}
