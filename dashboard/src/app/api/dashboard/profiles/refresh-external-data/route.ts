import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { isDashboardAdmin } from "@/lib/permissions";
import { refreshAllProfilesExternalData } from "@/lib/profiles";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  rateLimitResponse,
  safeErrorMessage,
  unauthorizedResponse,
  verifyInternalBearerToken,
  verifyTrustedOrigin,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

function integerParam(value: string | null, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

async function runRefresh(request: NextRequest, reason: "manual" | "cron") {
  const url = new URL(request.url);
  const settings = await getDashboardApiSettings();
  const limit = integerParam(url.searchParams.get("limit"), settings.profileExternalRefreshBatchLimit, 1, 500);
  const minSpacingSeconds = integerParam(url.searchParams.get("minSpacingSeconds"), settings.profileExternalRefreshMinSeconds, 0, 86_400);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";

  const result = await refreshAllProfilesExternalData({
    limit,
    minSpacingSeconds,
    force,
    reason,
  });

  return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders() });
}

export async function GET(request: NextRequest) {
  const token = await verifyInternalBearerToken(request, ["PROFILE_REFRESH_SECRET", "CRON_SECRET", "INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!token.ok) return unauthorizedResponse();

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profiles-external-refresh:cron:${ip}`, 6, 60 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  try {
    const response = await runRefresh(request, "cron");
    logDashboardEvent("info", "profiles.external_refresh.cron", request, await response.clone().json().catch(() => null));
    return response;
  } catch (error) {
    logDashboardEvent("warn", "profiles.external_refresh.cron_failed", request, { message: safeErrorMessage(error) });
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500, headers: noStoreHeaders() });
  }
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 2048);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!isDashboardAdmin(session)) return unauthorizedResponse();

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profiles-external-refresh:manual:${session?.profileId || session?.id || ip}`, 4, 15 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  try {
    const response = await runRefresh(request, "manual");
    logDashboardEvent("info", "profiles.external_refresh.manual", request, {
      profileId: session?.profileId || null,
      ...(await response.clone().json().catch(() => null)),
    });
    return response;
  } catch (error) {
    logDashboardEvent("warn", "profiles.external_refresh.manual_failed", request, {
      profileId: session?.profileId || null,
      message: safeErrorMessage(error),
    });
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500, headers: noStoreHeaders() });
  }
}
