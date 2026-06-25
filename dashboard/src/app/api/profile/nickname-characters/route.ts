import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setProfileNicknameCharacters } from "@/lib/profiles";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, rateLimitResponse, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";
import { normalizeCharacterKey } from "@/lib/wowCharacters";
import { profileActionReturnTo, redirectToProfileAction } from "@/lib/profileActionRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToSettings(request: NextRequest, profileId: string, status: string, returnTo?: string) {
  return redirectToProfileAction(request, profileId, "characterStatus", status, returnTo, `/profile/${profileId}/settings`);
}

function cleanKeys(values: FormDataEntryValue[]) {
  return Array.from(new Set(values.map((value) => normalizeCharacterKey(value)).filter(Boolean))).slice(0, 2);
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session?.profileId) return NextResponse.redirect(new URL("/login", request.url), 303);

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-nickname-characters:${session.profileId}:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}/settings`);
  const selectedKeys = cleanKeys(form.getAll("nicknameCharacterKeys"));

  try {
    const savedKeys = await setProfileNicknameCharacters(session.profileId, selectedKeys);
    logDashboardEvent("info", "profile.nickname_characters.saved", request, { profileId: session.profileId, savedKeys });
    return redirectToSettings(request, session.profileId, "profile_nickname_characters_saved", returnTo);
  } catch (error) {
    logDashboardEvent("warn", "profile.nickname_characters.failed", request, { profileId: session.profileId, message: safeErrorMessage(error) });
    return redirectToSettings(request, session.profileId, "profile_nickname_characters_failed", returnTo);
  }
}
