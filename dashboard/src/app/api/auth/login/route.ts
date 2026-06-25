import { NextRequest, NextResponse } from "next/server";
import { setSession, verifyToken } from "@/lib/auth";
import { getAuthAccessPolicy } from "@/lib/authAccessPolicy";
import { checkGeoAccess, geoAccessDeniedResponse } from "@/lib/geoAccessPolicy";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  verifyTrustedOrigin,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectTo(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  for (const [key, value] of Object.entries(noStoreHeaders())) response.headers.set(key, value);
  return response;
}

export async function POST(request: NextRequest) {
  const geoDecision = await checkGeoAccess(request, "auth");
  if (geoDecision.blocked) return geoAccessDeniedResponse(request, geoDecision);

  if (!verifyTrustedOrigin(request)) {
    return forbiddenResponse("Недовірене джерело входу.");
  }

  logDashboardEvent("info", "auth.token_login.attempt", request);

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const ip = getClientIp(request);
  const limit = checkRateLimit(`token-login:${ip}`, 5, 10 * 60 * 1000);
  if (!limit.ok) {
    logDashboardEvent("warn", "auth.token_login.rate_limited", request, { resetAt: limit.resetAt });
    return redirectTo(request, "/login?error=rate_limit");
  }

  const authPolicy = await getAuthAccessPolicy();
  if (authPolicy.enabled && !authPolicy.allowEmergencyTokenLogin) {
    logDashboardEvent("warn", "auth.token_login.disabled_by_policy", request);
    return redirectTo(request, "/login?error=token_disabled");
  }

  const form = await request.formData();
  const token = String(form.get("token") || "");
  const session = await verifyToken(token);

  if (!session) {
    logDashboardEvent("warn", "auth.token_login.invalid_token", request);
    return redirectTo(request, "/login?error=token");
  }

  logDashboardEvent("info", "auth.token_login.success", request, { userId: session.id, role: session.role });
  await setSession(session);
  return redirectTo(request, "/");
}
