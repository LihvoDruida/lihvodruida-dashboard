import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setProfileRaidRolePreference } from "@/lib/profiles";
import { normalizeWowRole } from "@/lib/wowRoles";
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
  const limit = checkRateLimit(`profile-raid-role:${session.profileId}:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}/settings`);
  const rawRole = String(form.get("raidRole") || "auto").trim().toLowerCase();
  const isAuto = rawRole === "auto" || rawRole === "default" || rawRole === "main";
  const role = isAuto ? null : normalizeWowRole(rawRole);

  if (!isAuto && !role) {
    logDashboardEvent("warn", "profile.raid_role.invalid", request, { profileId: session.profileId, rawRole });
    return redirectToProfile(request, session.profileId, "raid_role_invalid", returnTo);
  }

  try {
    await setProfileRaidRolePreference(session.profileId, role);
    logDashboardEvent("info", "profile.raid_role.saved", request, { profileId: session.profileId, role: role || "auto" });
    return redirectToProfile(request, session.profileId, role ? "raid_role_set" : "raid_role_auto", returnTo);
  } catch (error) {
    const message = safeErrorMessage(error);
    const lowered = message.toLowerCase();
    const status = lowered.includes("мейна") || lowered.includes("main") ? "raid_role_main_missing" : "raid_role_failed";
    logDashboardEvent("warn", "profile.raid_role.failed", request, { profileId: session.profileId, role: role || "auto", status, message });
    return redirectToProfile(request, session.profileId, status, returnTo);
  }
}
