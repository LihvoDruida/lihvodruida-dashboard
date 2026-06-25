import { NextRequest, NextResponse } from "next/server";
import {
  clearSession,
  LEGACY_OAUTH_STATE_COOKIE,
  LEGACY_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
} from "@/lib/session";
import { logDashboardEvent, noStoreHeaders } from "@/lib/security";

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
}

function logoutRedirect(target: string) {
  const response = NextResponse.redirect(target, 303);
  for (const [key, value] of Object.entries(noStoreHeaders()))
    response.headers.set(key, value);
  response.headers.set("Clear-Site-Data", '"cache"');
  response.headers.set("X-Dashboard-Session", "cleared");
  expireAuthCookies(response);
  return response;
}

export async function POST(request: NextRequest) {
  // Logout is intentionally tolerant: the worst CSRF outcome is ending the current
  // session, and strict origin checks were breaking legitimate Vercel/Cloudflare
  // same-origin button submits.
  logDashboardEvent("info", "auth.logout.post", request);
  await clearSession();
  return logoutRedirect(new URL("/login", request.url).toString());
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("fallback") === "1") {
    logDashboardEvent("warn", "auth.logout.get_fallback", request);
    await clearSession();
    return logoutRedirect(
      new URL("/login?loggedOut=1", request.url).toString(),
    );
  }

  logDashboardEvent("warn", "auth.logout.get_blocked", request);
  return NextResponse.json(
    { error: "Logout requires POST." },
    { status: 405, headers: noStoreHeaders({ Allow: "POST" }) },
  );
}
