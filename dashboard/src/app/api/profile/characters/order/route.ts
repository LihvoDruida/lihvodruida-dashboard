import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/apiRoute";
import { getSession } from "@/lib/auth";
import { setProfileCharacterOrder } from "@/lib/profiles";
import { MAX_CHARACTER_ORDER } from "@/lib/profileCharacterOrder";
import { invalidatePublicOwnerSnapshot } from "@/lib/publicSiteOwner";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, rateLimitResponse, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";
import { profileActionReturnTo, redirectToProfileAction } from "@/lib/profileActionRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Saves the display order of the signed-in user's own characters (panel profile and public site). */
export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 16_384);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session?.profileId) return NextResponse.redirect(new URL("/login", appBaseUrl(request)), 303);

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-character-order:${session.profileId}:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const fallback = `/profile/${session.profileId}/settings`;
  const returnTo = profileActionReturnTo(form, session.profileId, fallback);
  const keys = form.getAll("order").slice(0, MAX_CHARACTER_ORDER + 1).map((value) => String(value));

  try {
    const saved = await setProfileCharacterOrder(session.profileId, keys);
    invalidatePublicOwnerSnapshot();
    logDashboardEvent("info", "profile.character.order_set", request, { profileId: session.profileId, count: saved.length });
    return redirectToProfileAction(request, session.profileId, "characterStatus", "character_order_saved", returnTo, fallback);
  } catch (error) {
    logDashboardEvent("warn", "profile.character.order_failed", request, { profileId: session.profileId, message: safeErrorMessage(error) });
    return redirectToProfileAction(request, session.profileId, "characterStatus", "character_order_failed", returnTo, fallback);
  }
}
