import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  LEGACY_OAUTH_STATE_COOKIE,
  LEGACY_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createOAuthStateToken,
} from "@/lib/auth";
import { buildDiscordOAuthUrl } from "@/lib/oauth";
import {
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
} from "@/lib/security";
import { checkGeoAccess, geoAccessDeniedResponse } from "@/lib/geoAccessPolicy";
import { safeDashboardReturnPath } from "@/lib/dashboardRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOGIN_NEXT_COOKIE = "__Host-mistblossom_next";
const OAUTH_NONCE_COOKIE_MAX_AGE = 60 * 10;
const MAX_PARALLEL_OAUTH_FLOWS = 8;

function isEnabled(value: string | null) {
  return /^(1|true|yes|force|switch)$/i.test(String(value || "").trim());
}

function normalizeOAuthNonces(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(-MAX_PARALLEL_OAUTH_FLOWS);
}

function parseRememberedOAuthNonces(value?: string | null): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { nonces?: unknown }).nonces)
        ? (parsed as { nonces: unknown[] }).nonces
        : [];
    return normalizeOAuthNonces(list);
  } catch {
    // Compatibility with the old single-state cookie. It stores the full state
    // token, so keep it as a candidate instead of deleting it aggressively.
    return [raw];
  }
}

function serializeRememberedOAuthNonces(nonces: string[]) {
  return JSON.stringify({ v: 1, nonces: normalizeOAuthNonces(nonces) });
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
      new URL("/login?error=rate_limit", request.url),
      303,
    );
    for (const [key, value] of Object.entries(noStoreHeaders()))
      response.headers.set(key, value);
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
  for (const [key, value] of Object.entries(noStoreHeaders()))
    response.headers.set(key, value);

  response.cookies.set(
    OAUTH_STATE_COOKIE,
    serializeRememberedOAuthNonces(nonces),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_NONCE_COOKIE_MAX_AGE,
    },
  );
  expireCookie(response, LEGACY_OAUTH_STATE_COOKIE, false);
  expireCookie(response, LOGIN_NEXT_COOKIE, true);

  if (forceFreshLogin) {
    clearLocalSessionOnResponse(response);
  }

  return response;
}
