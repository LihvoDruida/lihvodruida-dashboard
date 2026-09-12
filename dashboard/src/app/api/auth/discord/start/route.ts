import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  LEGACY_OAUTH_STATE_COOKIE,
  LEGACY_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createOAuthStateToken,
  useSecureAuthCookies,
} from "@/lib/auth";
import { buildDiscordOAuthUrl } from "@/lib/oauth";
import {
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  applyNoStoreHeaders,
} from "@/lib/security";
import { checkGeoAccess, geoAccessDeniedResponse } from "@/lib/geoAccessPolicy";
import { safeDashboardReturnPath } from "@/lib/dashboardRedirects";
import { appBaseUrl } from "@/lib/apiRoute";
import { MAX_PARALLEL_OAUTH_FLOWS, parseRememberedOAuthNonces, serializeRememberedOAuthNonces } from "@/lib/oauthNonces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOGIN_NEXT_COOKIE = "__Host-mistblossom_next";
const OAUTH_NONCE_COOKIE_MAX_AGE = 60 * 10;

function isEnabled(value: string | null) {
  return /^(1|true|yes|force|switch)$/i.test(String(value || "").trim());
}

function expireCookie(response: NextResponse, name: string, secure: boolean) {
  response.cookies.set(name, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function clearLocalSessionOnResponse(response: NextResponse) {
  expireCookie(response, SESSION_COOKIE, true);
  expireCookie(response, LEGACY_SESSION_COOKIE, false);
}

export async function GET(request: NextRequest) {
  logDashboardEvent("info", "auth.discord.start", request);

  const geoDecision = await checkGeoAccess(request, "auth");
  if (geoDecision.blocked) return geoAccessDeniedResponse(request, geoDecision);

  const ip = getClientIp(request);
  const limit = checkRateLimit(`discord-oauth-start:${ip}`, 30, 10 * 60 * 1000);

  if (!limit.ok) {
    logDashboardEvent("warn", "auth.discord.start.rate_limited", request, {
      resetAt: limit.resetAt,
    });
    const response = NextResponse.redirect(
      new URL("/login?error=rate_limit", appBaseUrl(request)),
      303,
    );
    applyNoStoreHeaders(response);
    return response;
  }

  const url = new URL(request.url);
  const nextPath = safeDashboardReturnPath(url.searchParams.get("next"), {
    scope: "discord-auth",
    fallback: "",
  });
  const forceFreshLogin =
    isEnabled(url.searchParams.get("force")) ||
    isEnabled(url.searchParams.get("switch")) ||
    isEnabled(url.searchParams.get("reauth"));
  const state = await createOAuthStateToken(nextPath);
  const store = await cookies();
  const remembered = parseRememberedOAuthNonces(
    store.get(OAUTH_STATE_COOKIE)?.value ||
      store.get(LEGACY_OAUTH_STATE_COOKIE)?.value,
  );
  const nonces = [...remembered, state.nonce].slice(-MAX_PARALLEL_OAUTH_FLOWS);

  const response = NextResponse.redirect(
    buildDiscordOAuthUrl(state.token),
    303,
  );
  applyNoStoreHeaders(response);

  const secureAuthCookies = useSecureAuthCookies();
  const oauthCookieName = secureAuthCookies ? OAUTH_STATE_COOKIE : LEGACY_OAUTH_STATE_COOKIE;
  response.cookies.set(
    oauthCookieName,
    serializeRememberedOAuthNonces(nonces),
    {
      httpOnly: true,
      secure: secureAuthCookies,
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_NONCE_COOKIE_MAX_AGE,
    },
  );
  expireCookie(response, secureAuthCookies ? LEGACY_OAUTH_STATE_COOKIE : OAUTH_STATE_COOKIE, secureAuthCookies ? false : true);
  expireCookie(response, LOGIN_NEXT_COOKIE, true);

  if (forceFreshLogin) {
    clearLocalSessionOnResponse(response);
  }

  return response;
}
