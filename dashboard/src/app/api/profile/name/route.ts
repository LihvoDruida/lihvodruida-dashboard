import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setProfilePreferredName } from "@/lib/profiles";
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
  const limit = checkRateLimit(`profile-name:${session.profileId}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}/settings`);
  const preferredName = String(form.get("preferredName") || "").trim();

  try {
    const savedName = await setProfilePreferredName(session.profileId, preferredName);
    logDashboardEvent("info", "profile.name.saved", request, { profileId: session.profileId, preferredName: savedName });
    return redirectToProfile(request, session.profileId, "profile_name_saved", returnTo);
  } catch (error) {
    const message = safeErrorMessage(error);
    const lowered = message.toLowerCase();
    const status = lowered.includes("символ") || lowered.includes("ім") ? "profile_name_invalid" : "profile_name_failed";
    logDashboardEvent("warn", "profile.name.failed", request, { profileId: session.profileId, message, status });
    return redirectToProfile(request, session.profileId, status, returnTo);
  }
}
