import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { profileGenderLabel, setProfileGrammaticalGender } from "@/lib/profiles";
import { syncRaidSignupGenderForProfile } from "@/lib/raids";
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
  const limit = checkRateLimit(`profile-gender:${session.profileId}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}/settings`);
  const grammaticalGender = String(form.get("grammaticalGender") || "unspecified").trim().toLowerCase();

  try {
    const savedGender = await setProfileGrammaticalGender(session.profileId, grammaticalGender);
    const syncResult = await syncRaidSignupGenderForProfile({
      profileId: session.profileId,
      provider: session.provider,
      providerUserId: session.id,
      grammaticalGender: savedGender,
    }).catch((syncError) => {
      logDashboardEvent("warn", "profile.gender.raid_sync_failed", request, { profileId: session.profileId, message: safeErrorMessage(syncError) });
      return null;
    });
    logDashboardEvent("info", "profile.gender.saved", request, { profileId: session.profileId, grammaticalGender: savedGender, label: profileGenderLabel(savedGender), syncResult });
    return redirectToProfile(request, session.profileId, "profile_gender_saved", returnTo);
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("warn", "profile.gender.failed", request, { profileId: session.profileId, message });
    return redirectToProfile(request, session.profileId, "profile_gender_failed", returnTo);
  }
}
