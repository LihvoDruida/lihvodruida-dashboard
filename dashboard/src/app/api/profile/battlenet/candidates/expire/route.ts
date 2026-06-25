import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clearProfileBattleNetCandidates } from "@/lib/profiles";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, noStoreHeaders, rateLimitResponse, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 8 * 1024);
  if (tooLarge) return tooLarge;

  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const session = await getSession();
  if (!session?.profileId) {
    return NextResponse.json({ ok: false, error: "session_required" }, { status: 401, headers: noStoreHeaders() });
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-bnet-candidates-expire:${session.profileId}:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  let expectedExpiresAt: string | null = null;
  try {
    const body = await request.json().catch(() => null) as { expiresAt?: unknown } | null;
    expectedExpiresAt = typeof body?.expiresAt === "string" ? body.expiresAt : null;
    const cleared = await clearProfileBattleNetCandidates(session.profileId, expectedExpiresAt);
    logDashboardEvent("info", "profile.battlenet.candidates_expired", request, { profileId: session.profileId, cleared, expectedExpiresAt });
    return NextResponse.json({ ok: true, cleared }, { headers: noStoreHeaders() });
  } catch (error) {
    logDashboardEvent("warn", "profile.battlenet.candidates_expire_failed", request, { profileId: session.profileId, expectedExpiresAt, message: safeErrorMessage(error) });
    return NextResponse.json({ ok: false, error: "cleanup_failed" }, { status: 500, headers: noStoreHeaders() });
  }
}
