import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addProfileCharacter, getProfileBattleNetCandidates, removeProfileBattleNetCandidates } from "@/lib/profiles";
import { characterAddStatusFromError } from "@/lib/profileCharacterStatus";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, rateLimitResponse, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";
import { normalizeCharacterKey } from "@/lib/wowCharacters";
import { profileActionReturnTo, redirectToProfileAction } from "@/lib/profileActionRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToProfile(request: NextRequest, profileId: string, status: string, returnTo?: string) {
  return redirectToProfileAction(request, profileId, "characterStatus", status, returnTo, `/profile/${profileId}`);
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session?.profileId) return NextResponse.redirect(new URL("/login", request.url), 303);

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-character-add:${session.profileId}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}`);
  const characterKey = normalizeCharacterKey(form.get("characterKey"));
  if (!characterKey) {
    logDashboardEvent("warn", "profile.character.add_invalid_request", request, { profileId: session.profileId });
    return redirectToProfile(request, session.profileId, "character_add_invalid", returnTo);
  }

  const storedCandidates = await getProfileBattleNetCandidates(session.profileId).catch(() => []);
  const candidate = storedCandidates.find((item) => normalizeCharacterKey(item.key) === characterKey);

  if (!candidate) {
    logDashboardEvent("warn", "profile.character.add_missing_reauth", request, { profileId: session.profileId, characterKey });
    return redirectToProfile(request, session.profileId, "character_reauth_required", returnTo);
  }

  try {
    const result = await addProfileCharacter(session.profileId, candidate);
    if (!result.added) {
      logDashboardEvent("warn", "profile.character.add_skipped", request, { profileId: session.profileId, characterKey, reason: result.reason });
      return redirectToProfile(request, session.profileId, "character_add_duplicate", returnTo);
    }

    logDashboardEvent("info", "profile.character.added", request, { profileId: session.profileId, characterKey });
    const response = redirectToProfile(request, session.profileId, "character_added", returnTo);
    await removeProfileBattleNetCandidates(session.profileId, [characterKey]).catch((cleanupError) => {
      logDashboardEvent("warn", "profile.character.candidate_cleanup_failed", request, { profileId: session.profileId, characterKey, message: safeErrorMessage(cleanupError) });
    });
    return response;
  } catch (error) {
    const status = characterAddStatusFromError(error);
    logDashboardEvent("warn", "profile.character.add_failed", request, { profileId: session.profileId, characterKey, status, message: safeErrorMessage(error) });
    return redirectToProfile(request, session.profileId, status, returnTo);
  }
}
