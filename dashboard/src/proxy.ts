import { NextRequest, NextResponse } from "next/server";
import {
  forbiddenResponse,
  getCanonicalDashboardOrigin,
  getRequestHost,
  isAllowedHost,
  isLocalHost,
  logDashboardEvent,
  noStoreHeaders,
  verifyTrustedOrigin,
} from "@/lib/security";

const isDevelopment = process.env.NODE_ENV !== "production";

const SESSION_COOKIE_NAMES = [
  "__Host-mistblossom_dashboard_session",
  "mistblossom_dashboard_session",
];

function hasDashboardSessionCookie(request: NextRequest) {
  return SESSION_COOKIE_NAMES.some((name) =>
    Boolean(request.cookies.get(name)?.value),
  );
}

function isProtectedPagePath(pathname: string) {
  if (pathname === "/") return true;
  // /polls і /roster раніше були відсутні: сторінки покладалися лише на
  // серверний getSession(), тож неавторизований користувач бачив спалах layout
  // замість чистого редиректу на /login.
  return /^\/(?:dashboard|admin|guild|profile|profiles|raids|polls|roster|discord|content)(?:\/|$)/.test(
    pathname,
  );
}

function isPublicApiPath(pathname: string) {
  return (
    // Liveness для healthcheck контейнера і upstream-перевірки Nginx.
    // Має бути публічним: kubelet/docker/systemd не мають сесії.
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/client-errors" ||
    pathname === "/api/background/settings" ||
    pathname === "/api/calendar/raids.ics" ||
    pathname === "/api/discord/interactions" ||
    pathname === "/api/rules/accept/complete"
  );
}

function isInternalBearerApiPath(pathname: string) {
  return (
    pathname === "/api/profile/discord-lookup" ||
    pathname === "/api/dashboard/profiles/refresh-external-data" ||
    pathname === "/api/dashboard/profiles/orphan-cleanup" ||
    pathname === "/api/dashboard/profiles/orphan-cleanup/apply" ||
    pathname === "/api/raids/lifecycle" ||
    pathname === "/api/polls/close-due" ||
    // Обидва ендпоїнти рекрутингового радника викликає Cloudflare Worker
    // із внутрішнім bearer-токеном. Без цих рядків middleware відхиляє
    // їх як «Потрібен вхід» ще до verifyInternalBearerToken у обробнику.
    pathname === "/api/discord/recruitment-advice" ||
    pathname === "/api/discord/recruitment-advice/message" ||
    /^\/api\/raids\/[^/]+\/discord-action$/.test(pathname) ||
    /^\/api\/polls\/[^/]+\/vote$/.test(pathname) ||
    pathname === "/api/roster/discord-action"
  );
}

function hasPotentialInternalBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  return (
    /^Bearer\s+\S+/i.test(authorization) ||
    Boolean(request.headers.get("x-worker-stats-token"))
  );
}

function isProtectedApiPath(pathname: string) {
  return pathname.startsWith("/api/") && !isPublicApiPath(pathname);
}

function loginRedirectFor(request: NextRequest) {
  const target = request.nextUrl.clone();
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  target.pathname = "/login";
  target.search = "";
  if (nextPath && nextPath !== "/") target.searchParams.set("next", nextPath);
  target.searchParams.set("reauth", "1");
  return target;
}

function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function contentSecurityPolicy(nonce: string) {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    isDevelopment ? "'unsafe-eval'" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const styleSrc = ["'self'", `'nonce-${nonce}'`, "'unsafe-inline'"].join(" ");
  const upgrade = isDevelopment ? "" : "upgrade-insecure-requests";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `script-src ${scriptSrc}`,
    `script-src-elem ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net https://render.worldofwarcraft.com https://cdnassets.raider.io https://raider.io",
    "font-src 'self' data:",
    "connect-src 'self' https://discord.com https://discordapp.com https://cdn.discordapp.com https://media.discordapp.net https://api.github.com https://raider.io https://*.raider.io https://render.worldofwarcraft.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' https:",
    "object-src 'none'",
    upgrade,
  ]
    .filter(Boolean)
    .join("; ");
}

type CloudflareProxyMode = "off" | "warn" | "strict";

function getCloudflareProxyMode(host: string): CloudflareProxyMode {
  if (isDevelopment || isLocalHost(host)) return "off";

  const raw = String(process.env.SECURITY_REQUIRE_CLOUDFLARE || "")
    .trim()
    .toLowerCase();

  // Backward compatibility: older deployments used SECURITY_REQUIRE_CLOUDFLARE=true
  // as a hard gate. In practice reverse-proxy/Cloudflare/domain transitions can temporarily
  // strip CF headers from legitimate custom-domain requests and lock admins out.
  // Use SECURITY_REQUIRE_CLOUDFLARE=strict only after the DNS/proxy chain is verified.
  if (["strict", "enforce", "block"].includes(raw)) return "strict";
  if (["1", "true", "yes", "on", "warn", "log"].includes(raw)) return "warn";
  return "off";
}

function hasCloudflareSignal(request: NextRequest) {
  return Boolean(
    request.headers.get("cf-ray") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("cf-visitor"),
  );
}

export function proxy(request: NextRequest) {
  const host = getRequestHost(request);

  if (!isAllowedHost(host)) {
    const isSafeRedirect = request.method === "GET" || request.method === "HEAD";
    logDashboardEvent(isSafeRedirect ? "debug" : "warn", "proxy.host_rejected", request, {
      blockedHost: host,
      redirected: isSafeRedirect,
    });

    if (isSafeRedirect) {
      const target = new URL(
        request.nextUrl.pathname + request.nextUrl.search,
        getCanonicalDashboardOrigin(),
      );
      return NextResponse.redirect(target, 308);
    }

    return new NextResponse("Blocked host", {
      status: 421,
      headers: noStoreHeaders(),
    });
  }

  const cloudflareProxyMode = getCloudflareProxyMode(host);
  if (cloudflareProxyMode !== "off" && !hasCloudflareSignal(request)) {
    logDashboardEvent("warn", "proxy.cloudflare_signal_missing", request, {
      mode: cloudflareProxyMode,
      action: cloudflareProxyMode === "strict" ? "blocked" : "allowed",
    });

    if (cloudflareProxyMode === "strict") {
      return forbiddenResponse("Запит має проходити через Cloudflare.");
    }
  }

  const isDiscordInteractionEndpoint =
    request.nextUrl.pathname === "/api/discord/interactions";
  const hasInternalBearerAuth =
    isInternalBearerApiPath(request.nextUrl.pathname) &&
    hasPotentialInternalBearerToken(request);

  if (
    !isDiscordInteractionEndpoint &&
    !hasInternalBearerAuth &&
    !verifyTrustedOrigin(request)
  ) {
    return forbiddenResponse("Недовірене джерело запиту.");
  }

  if (
    (request.method === "GET" || request.method === "HEAD") &&
    isProtectedPagePath(request.nextUrl.pathname) &&
    !hasDashboardSessionCookie(request)
  ) {
    const response = NextResponse.redirect(loginRedirectFor(request), 303);
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.cookies.set(
      "dashboard_toast",
      JSON.stringify({
        tone: "warning",
        title: "Потрібен вхід",
        message: "Сторінка доступна тільки після авторизації.",
        ttl: 5200,
      }),
      { path: "/", maxAge: 45, sameSite: "lax" },
    );
    return response;
  }

  if (
    isProtectedApiPath(request.nextUrl.pathname) &&
    !hasInternalBearerAuth &&
    !hasDashboardSessionCookie(request)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        toast: {
          tone: "warning",
          title: "Потрібен вхід",
          message: "Сесія завершилась. Увійди ще раз і повтори дію.",
        },
      },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  if (
    request.method === "POST" &&
    request.nextUrl.pathname === "/dashboard/discord"
  ) {
    const wantsJson =
      String(request.headers.get("x-dashboard-action") || "").toLowerCase() ===
        "live" ||
      String(request.headers.get("accept") || "")
        .toLowerCase()
        .includes("application/json");
    logDashboardEvent(
      "warn",
      "proxy.admin_discord_stale_server_action_redirect",
      request,
      { wantsJson },
    );

    if (wantsJson) {
      return NextResponse.json(
        {
          ok: false,
          refresh: true,
          toast: {
            tone: "error",
            title: "Discord-дія не дійшла до API",
            message:
              "Форма відправилась на /dashboard/discord замість /api/dashboard/discord/*. Онови сторінку після деплою й повтори дію.",
            ttl: 8200,
          },
        },
        { status: 409, headers: noStoreHeaders() },
      );
    }

    const target = request.nextUrl.clone();
    target.pathname = "/dashboard/discord";
    target.search = "";
    const response = NextResponse.redirect(target, 303);
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate",
    );
    response.cookies.set(
      "dashboard_toast",
      JSON.stringify({
        tone: "warning",
        title: "Сторінку Discord-керування оновлено",
        message:
          "Форма була з попередньої версії деплою. Відкрий сторінку ще раз і повтори дію — тепер дії йдуть через API, а не Server Action.",
        ttl: 8200,
      }),
      { path: "/", maxAge: 45, sameSite: "lax" },
    );
    return response;
  }

  const staleRaidActionMatch =
    request.nextUrl.pathname.match(/^\/raids\/([^/]+)$/);
  if (
    request.method === "POST" &&
    staleRaidActionMatch &&
    request.nextUrl.searchParams.has("nxtPraidId")
  ) {
    const target = request.nextUrl.clone();
    target.pathname = `/api/raids/${encodeURIComponent(staleRaidActionMatch[1])}/attendance`;
    target.search = "";
    logDashboardEvent(
      "warn",
      "proxy.raid_stale_server_action_rewrite",
      request,
      { raidId: staleRaidActionMatch[1] },
    );
    return NextResponse.rewrite(target, { headers: noStoreHeaders() });
  }

  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Nonce", nonce);
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set(
    "Vary",
    "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Url",
  );

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
