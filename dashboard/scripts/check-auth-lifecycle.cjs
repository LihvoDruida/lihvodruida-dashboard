#!/usr/bin/env node
"use strict";

// Behavioral regression tests without hitting Discord, production cookies or a
// real database. TypeScript is already present in build:ci's dependencies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
let count = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    count++;
    console.log(`✓ ${name}`);
  });
}
function loadTs(relative, mocks = {}) {
  const js = ts.transpileModule(source(relative), {
    fileName: relative,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  const errors = (js.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `Failed to transpile ${relative}`);
  const loadedModule = { exports: {} };
  const requireMock = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === "server-only" || name === "next/headers") return {};
    if (name.startsWith("@/lib/")) return {};
    throw new Error(`Unexpected import ${name} in ${relative}`);
  };
  new Function("module", "exports", "require", js.outputText)(loadedModule, loadedModule.exports, requireMock);
  return loadedModule.exports;
}

(async () => {
  const redirects = loadTs("src/lib/dashboardRedirects.ts");
  await check("return paths allow internal management and reject external URLs", () => {
    for (const allowed of ["/", "/discord/static", "/admin", "/dashboard", "/profile/id" + "a".repeat(16), "/raids/abc?tab=members"]) {
      assert.equal(redirects.safeDashboardReturnPath(allowed, { scope: "discord-auth", fallback: "" }), allowed);
    }
    for (const blocked of ["https://evil.example", "//evil.example", "/api/auth/logout", "/login", "/\\evil.example"]) {
      assert.equal(redirects.safeDashboardReturnPath(blocked, { scope: "discord-auth", fallback: "" }), "");
    }
  });

  const auth = loadTs("src/lib/auth.ts", {
    "@/lib/dashboardRedirects": redirects,
    "@/lib/authCookieNames": loadTs("src/lib/authCookieNames.ts"),
  });
  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "auth-lifecycle-test-secret-" + "z".repeat(48);
  try {
    await check("signed OAuth state retains the management return path", async () => {
      const { token, nonce } = await auth.createOAuthStateToken("/discord/static?tab=members");
      const parsed = await auth.parseOAuthStateToken(token);
      assert.equal(parsed?.nonce, nonce);
      assert.equal(parsed?.nextPath, "/discord/static?tab=members");
      const [payload, signature] = token.split(".");
      const tampered = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
      assert.equal(await auth.parseOAuthStateToken(tampered), null);
    });
    await check("signed OAuth state cannot carry an external redirect", async () => {
      const { token } = await auth.createOAuthStateToken("//evil.example");
      assert.equal((await auth.parseOAuthStateToken(token))?.nextPath, "");
    });
  } finally {
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
  }

  const cookies = [];
  let cleared = 0;
  class MockResponse {
    constructor(status, location) {
      this.status = status;
      this.location = location;
      this.headers = new Headers();
      this.cookies = { set(name, value, options) { cookies.push({ name, value, options }); } };
      this.body = null;
    }
    static json(body, options = {}) {
      const response = new MockResponse(options.status || 200);
      response.body = body;
      Object.entries(options.headers || {}).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }
    static redirect(url, status) { return new MockResponse(status, String(url)); }
  }
  const logout = loadTs("src/app/api/auth/logout/route.ts", {
    "next/server": { NextResponse: MockResponse },
    "@/lib/session": {
      clearSession: async () => { cleared++; },
      SESSION_COOKIE: "__Host-mistblossom_dashboard_session",
      LEGACY_SESSION_COOKIE: "mistblossom_dashboard_session",
      OAUTH_STATE_COOKIE: "__Host-mistblossom_oauth_state",
      LEGACY_OAUTH_STATE_COOKIE: "mistblossom_oauth_state",
    },
    "@/lib/authCookieNames": loadTs("src/lib/authCookieNames.ts"),
    "@/lib/security": {
      logDashboardEvent() {},
      noStoreHeaders: (extra = {}) => ({ "Cache-Control": "no-store", ...extra }),
      applyNoStoreHeaders: (response) => response,
    },
    "@/lib/apiRoute": { appBaseUrl: () => "https://guild.lihvodruida.pp.ua" },
  });
  const request = (method, headers = {}, query = "") => ({
    method,
    url: `https://guild.lihvodruida.pp.ua/api/auth/logout${query}`,
    nextUrl: new URL(`https://guild.lihvodruida.pp.ua/api/auth/logout${query}`),
    headers: new Headers(headers),
  });
  await check("AJAX POST logs out with a verifiable JSON acknowledgement", async () => {
    cookies.length = 0;
    const response = await logout.POST(request("POST", { accept: "application/json", "x-dashboard-action": "logout" }));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, signedOut: true, redirect: "/login?loggedOut=1" });
    assert.equal(response.headers.get("x-dashboard-session"), "cleared");
    assert.equal(response.headers.get("Clear-Site-Data"), '"cache"');
    for (const name of [
      "__Host-mistblossom_dashboard_session", "mistblossom_dashboard_session",
      "__Host-mistblossom_oauth_state", "mistblossom_oauth_state",
      "__Host-mistblossom_bnet_state", "mistblossom_bnet_state",
      "__Host-mistblossom_next",
    ]) assert.ok(cookies.some((c) => c.name === name && c.options.maxAge === 0), `missing expired cookie ${name}`);
  });
  await check("native POST logout redirects to public login URL", async () => {
    const response = await logout.POST(request("POST", { accept: "text/html" }));
    assert.equal(response.status, 303);
    assert.equal(response.location, "https://guild.lihvodruida.pp.ua/login?loggedOut=1");
  });
  await check("GET fallback cannot end a user's session", async () => {
    const before = cleared;
    const response = await logout.GET(request("GET", {}, "?fallback=1"));
    assert.equal(response.status, 405);
    assert.equal(cleared, before);
  });

  const oauthCookies = new Map();
  const start = loadTs("src/app/api/auth/discord/start/route.ts", {
    "next/server": { NextResponse: MockResponse },
    "next/headers": { cookies: async () => ({ get: (key) => ({ value: oauthCookies.get(key) || "" }) }) },
    "@/lib/auth": {
      ...auth,
      secureAuthCookiesEnabled: () => true,
    },
    "@/lib/oauth": {
      buildDiscordOAuthUrl: (state) => `https://discord.com/oauth2/authorize?state=${encodeURIComponent(state)}`,
    },
    "@/lib/oauthNonces": loadTs("src/lib/oauthNonces.ts"),
    "@/lib/dashboardRedirects": redirects,
    "@/lib/security": {
      logDashboardEvent() {},
      checkRateLimit: () => ({ ok: true }),
      getClientIp: () => "127.0.0.1",
      applyNoStoreHeaders: (response) => response,
    },
    "@/lib/geoAccessPolicy": { checkGeoAccess: async () => ({ blocked: false }) },
    "@/lib/apiRoute": { appBaseUrl: () => "https://guild.lihvodruida.pp.ua" },
  });
  process.env.SESSION_SECRET = "auth-lifecycle-test-secret-" + "z".repeat(48);
  try {
    await check("Discord OAuth start stores secure SameSite nonce with ten-minute expiration", async () => {
      cookies.length = 0;
      const response = await start.GET(request("GET", {}, "?next=%2Fdiscord%2Fstatic"));
      assert.equal(response.status, 303);
      const created = cookies.find((c) => c.name === "__Host-mistblossom_oauth_state" && c.options.maxAge === 600);
      assert.ok(created);
      assert.equal(created.options.secure, true);
      assert.equal(created.options.httpOnly, true);
      assert.equal(created.options.sameSite, "lax");
      oauthCookies.set(created.name, created.value);
      const parsed = await auth.parseOAuthStateToken(new URL(response.location).searchParams.get("state"));
      assert.equal(parsed?.nextPath, "/discord/static");
    });
    await check("parallel OAuth starts retain both one-time nonces", async () => {
      cookies.length = 0;
      await start.GET(request("GET", {}, "?next=%2Fadmin"));
      const created = cookies.find((c) => c.name === "__Host-mistblossom_oauth_state" && c.options.maxAge === 600);
      assert.ok(created);
      const nonceList = JSON.parse(created.value).nonces;
      assert.equal(nonceList.length, 2);
      assert.notEqual(nonceList[0], nonceList[1]);
    });
    await check("explicit account switch expires current session before OAuth", async () => {
      cookies.length = 0;
      await start.GET(request("GET", {}, "?force=1"));
      assert.ok(cookies.some((c) => c.name === "__Host-mistblossom_dashboard_session" && c.options.maxAge === 0));
    });
  } finally {
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
  }

  const session = source("src/app/api/auth/session/route.ts");
  const login = source("src/app/login/page.tsx");
  const guard = source("src/components/ClientAuthGuard.tsx");
  const logoutClient = source("src/components/LogoutButton.tsx");
  const authSource = source("src/lib/auth.ts");
  const staticRules = source("src/lib/staticRules.ts");
  await check("session checks and login use access-aware getSession", () => {
    assert.match(session, /await getSession\(\{ live: true \}\)/);
    assert.match(login, /await getSession\(\{ live: true \}\)/);
    assert.doesNotMatch(session, /getStoredSession\(/);
  });
  await check("all protected site areas receive client session checks", () => {
    for (const name of ["dashboard", "polls", "roster", "admin", "discord", "guild"]) assert.ok(guard.includes(name), `missing ${name}`);
  });
  await check("client does not trust 303 or use logout-by-GET fallback", () => {
    assert.match(logoutClient, /X-Dashboard-Session/);
    assert.match(logoutClient, /data\?\.signedOut !== true/);
    assert.match(logoutClient, /formRef\.current\.submit\(\)/);
    assert.doesNotMatch(logoutClient, /logout\?fallback=1/);
  });
  await check("server clears pending Battle.net OAuth and Static audit has typed timestamp", () => {
    assert.match(authSource, /store\.set\(BNET_OAUTH_STATE_COOKIE, "", secureCookieOptions\)/);
    assert.match(staticRules, /const data = doc\.data\(\) \?\? \{\};/);
    assert.match(staticRules, /createdAt: String\(data\.createdAt \|\| ""\)/);
    assert.doesNotMatch(staticRules, /doc\.data\(\)\.createdAt/);
  });
  console.log(`[check-auth-lifecycle] OK — ${count} lifecycle regression checks`);
})().catch((error) => {
  console.error("[check-auth-lifecycle] FAIL:", error);
  process.exitCode = 1;
});
