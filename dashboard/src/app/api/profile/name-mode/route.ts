import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setProfilePublicNameMode } from "@/lib/profiles";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, rateLimitResponse, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";
import { profileActionReturnTo, redirectToProfileAction } from "@/lib/profileActionRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToProfile(request: NextRequest, profileId: string, status: string, returnTo?: string) {
  return redirectToProfileAction(request, profileId, "characterStatus", status, returnTo, `/profile/${profileId}/settings`);
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session?.profileId) return NextResponse.redirect(new URL("/login", request.url), 303);

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-name-mode:${session.profileId}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}/settings`);
  const publicNameMode = String(form.get("publicNameMode") || "name").trim();

  try {
    const savedMode = await setProfilePublicNameMode(session.profileId, publicNameMode);
    logDashboardEvent("info", "profile.name_mode.saved", request, { profileId: session.profileId, publicNameMode: savedMode });
    return redirectToProfile(request, session.profileId, "profile_name_mode_saved", returnTo);
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("warn", "profile.name_mode.failed", request, { profileId: session.profileId, message });
    return redirectToProfile(request, session.profileId, "profile_name_failed", returnTo);
  }
}
