import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { removeProfileCharacter } from "@/lib/profiles";
import { characterRemoveStatusFromError } from "@/lib/profileCharacterStatus";
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
  const limit = checkRateLimit(`profile-character-remove:${session.profileId}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}`);
  const characterKey = normalizeCharacterKey(form.get("characterKey"));

  try {
    await removeProfileCharacter(session.profileId, characterKey);
    logDashboardEvent("info", "profile.character.removed", request, { profileId: session.profileId, characterKey });
    return redirectToProfile(request, session.profileId, "character_removed", returnTo);
  } catch (error) {
    const status = characterRemoveStatusFromError(error);
    logDashboardEvent("warn", "profile.character.remove_failed", request, { profileId: session.profileId, characterKey, status, message: safeErrorMessage(error) });
    return redirectToProfile(request, session.profileId, status, returnTo);
  }
}
