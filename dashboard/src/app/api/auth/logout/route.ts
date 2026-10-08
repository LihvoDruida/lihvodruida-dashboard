import { NextRequest, NextResponse } from "next/server";
import {
  clearSession,
  LEGACY_OAUTH_STATE_COOKIE,
  LEGACY_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
} from "@/lib/session";
import { BNET_OAUTH_STATE_COOKIE, LEGACY_BNET_OAUTH_STATE_COOKIE } from "@/lib/authCookieNames";
import { logDashboardEvent, noStoreHeaders, applyNoStoreHeaders } from "@/lib/security";
import { appBaseUrl } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOGIN_NEXT_COOKIE = "__Host-mistblossom_next";

function expireAuthCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(LEGACY_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(LEGACY_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(LOGIN_NEXT_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(BNET_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(LEGACY_BNET_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function logoutRedirect(target: string) {
  const response = NextResponse.redirect(target, 303);
  applyNoStoreHeaders(response);
  response.headers.set("Clear-Site-Data", '"cache"');
  response.headers.set("X-Dashboard-Session", "cleared");
  expireAuthCookies(response);
  return response;
}

export async function POST(request: NextRequest) {
  // The global proxy enforces trusted origins on unsafe methods. Avoid a
  // second, differently configured origin check behind Cloudflare here.
  logDashboardEvent("info", "auth.logout.post", request);
  await clearSession();
  // AJAX receives an unambiguous, non-redirecting acknowledgement. A 303
  // followed by fetch used to be treated as proof of logout, even when the
  // redirect ultimately served a login/error page or a stale cached response.
  if (
    request.headers.get("x-dashboard-action") === "logout" &&
    request.headers.get("accept")?.includes("application/json")
  ) {
    const response = NextResponse.json({ ok: true, signedOut: true, redirect: "/login?loggedOut=1" }, {
      status: 200,
      headers: noStoreHeaders(),
    });
    response.headers.set("Clear-Site-Data", '"cache"');
    response.headers.set("X-Dashboard-Session", "cleared");
    expireAuthCookies(response);
    return response;
  }
  return logoutRedirect(new URL("/login?loggedOut=1", appBaseUrl(request)).toString());
}

export async function GET(request: NextRequest) {
  // Never mutate the session on GET: a cross-site link or prefetch could log
  // someone out without their consent. Fallback uses a native POST instead.
  logDashboardEvent("warn", "auth.logout.get_blocked", request);
  return NextResponse.json(
    { error: "Logout requires POST." },
    { status: 405, headers: noStoreHeaders({ Allow: "POST" }) },
  );
}
