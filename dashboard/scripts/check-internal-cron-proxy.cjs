#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripTypeScriptTypes } = require("node:module");
// Execute actual production modules. Only Next's HTTP adapter and external side
// effects are replaced. Node 24+ strips types without installing dependencies.
function load(file, modules, env, names) {
  const js = stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { mode: "strip" })
    .replace(/import\s+(\w+)\s+from\s*["']([^"']+)["'];?/g, (_, binding, name) => `const ${binding} = require(${JSON.stringify(name)});`)
    .replace(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g,
      (_, bindings, name) => `const {${bindings}} = require(${JSON.stringify(name)});`)
    .replace(/export\s+(?=(?:async\s+)?function|const|let|class)/g, "");
  return new Function("require", "process", "console", `${js}\nreturn {${names}};`)(
    (name) => { if(name==='@/lib/httpBody')return {ApiResponseError:Error}; assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name]; },
    { env }, { log() {}, warn() {}, error() {} },
  );
}
class NextResponse extends Response {
  static next() { const r = new NextResponse(null); r.passed = true; return r; }
  static json(data, init = {}) { return new NextResponse(JSON.stringify(data), init); }
  static redirect(url, status = 307) { return new NextResponse(null, { status, headers: { location: String(url) } }); }
}
const env = { NODE_ENV: "production", DASHBOARD_URL: "https://guild.lihvodruida.pp.ua",
  DASHBOARD_ALLOWED_HOSTS: "guild.lihvodruida.pp.ua", SECURITY_REQUIRE_CLOUDFLARE: "strict",
  SECURITY_STRICT_ORIGIN_CHECKS: "true", INTERNAL_API_TOKEN: "isolated-cron-test-" + "a".repeat(40) };
const privacy = load("src/lib/logPrivacy.ts", {}, {}, "redactLogText,isSensitiveLogKey");
const security = load("src/lib/security.ts", {
  "@/lib/httpBody":{ApiResponseError:Error},
  "@/lib/logPrivacy": privacy,
  "next/server": { NextResponse }, "@/lib/oauth": { getDashboardUrl: () => env.DASHBOARD_URL },
  "@/lib/values": { envFlag: (name) => env[name] === "true" },
}, env, "getRequestHost,isAllowedHost,isLocalHost,getCanonicalDashboardOrigin,noStoreHeaders,forbiddenResponse,unauthorizedResponse,verifyTrustedOrigin,verifyInternalBearerToken,assertRequestBodySize,safeErrorMessage");
const events = [];
const { proxy } = load("src/proxy.ts", { "@/lib/siteBridgeAuth": {hasSiteBridgeToken:()=>false}, "next/server": { NextResponse },
  "@/lib/security": { ...security, logDashboardEvent: (...args) => events.push(args) } }, env, "proxy");
const endpoint = "/api/dashboard/discord/profile-nicknames/automation";
let calls = 0, queueFails = false;
const { POST, GET } = load(`src/app${endpoint}/route.ts`, { "next/server": { NextResponse }, "@/lib/security": security,
  "@/lib/automationTaskRuns": { observeAutomationRun: async (_id, operation) => operation() },
  "../../../../../../../package.json": { version: "3.8.85" }, "@/lib/profileNicknameSync": { processProfileNicknameSyncQueue: async () => {
    calls++; if (queueFails) throw Error("storage unavailable"); return { processed: 0 };
  } } }, env, "POST,GET");
function request(p = endpoint, { host = "dashboard:3000", token = env.INTERNAL_API_TOKEN, headers = {} } = {}) {
  const r = new Request(`http://${host}${p}`, { method: "POST",
    headers: { host, ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers } });
  r.nextUrl = new URL(r.url); r.cookies = { get: () => undefined }; return r;
}
async function through(r) { const response = proxy(r); return response.passed ? POST(r) : response; }

// Exercise the real proxy, bearer check, Ed25519 verifier and modal route together.
// A fake HTTP server returning type 9 cannot detect a missing proxy allowlist entry.
const nodeCrypto = require("node:crypto");
const keyPair = nodeCrypto.generateKeyPairSync("ed25519");
env.DISCORD_GUILD_ID = "333333333333333333";
env.DISCORD_PUBLIC_KEY = keyPair.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
const discordAdmin = load("src/lib/discordAdmin.ts", {
  "node:crypto": nodeCrypto, "@/lib/discordRest": {}, "@/lib/concurrency": {},
  "@/lib/rulesOnboarding": {}, "@/lib/security": security,
  "@/lib/values": load("src/lib/values.ts", {}, env, "cleanSnowflake"),
  "@/lib/discordAvatar": {}, "@/lib/discordRulesStats": {},
}, env, "verifyDiscordInteractionSignature,getDiscordGuildId");
const modalEndpoint = "/api/internal/discord/raid-modal";
let modalCalls = 0;
const modalRoute = load(`src/app${modalEndpoint}/route.ts`, {
  "next/server": { NextResponse }, "@/lib/security": security, "@/lib/discordAdmin": discordAdmin,
  "@/lib/raids": { prepareRaidSignupModal: async () => {
    modalCalls++;
    return { type: 9, data: { custom_id: "fixture", title: "Fixture", components: [] } };
  } },
}, env, "POST");
function modalRequest({ token = env.INTERNAL_API_TOKEN, host = "dashboard:3000", source = "bot",
  flags = 64, guild = env.DISCORD_GUILD_ID, tampered = false } = {}) {
  const body = JSON.stringify({ type: 3, guild_id: guild, message: { flags },
    member: { user: { id: "111111111111111111" } },
    data: { custom_id: `mbv1:raid-modal:${"a".repeat(32)}:0:manual:0` } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = nodeCrypto.sign(null, Buffer.from(timestamp + body), keyPair.privateKey).toString("hex");
  const r = new Request(`http://${host}${modalEndpoint}`, { method: "POST", body: tampered ? body + " " : body,
    headers: { host, ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "x-mistblossom-source": source, "x-signature-ed25519": signature, "x-signature-timestamp": timestamp } });
  r.nextUrl = new URL(r.url); r.cookies = { get: () => undefined }; return r;
}
async function throughModal(r) { const result = proxy(r); return result.passed ? modalRoute.POST(r) : result; }
(async () => {
  let total = 0;
  async function check(name, fn) { await fn(); total++; console.log("PASS", name); }
  const cron = fs.readFileSync(path.resolve(__dirname, "../../deploy/cron/run-cron.sh"), "utf8");
  const paths = [...new Set([...cron.matchAll(/call "(\/api\/[^\"]+)"/g)].map((m) => m[1]))];
  assert.ok(paths.length >= 9, "Discover all production cron endpoints");
  for (const p of paths) await check(`production cron POST ${p}`, () => assert.equal(proxy(request(p)).passed, true));
  await check("valid cron executes queue without session or Cloudflare and emits no rejection", async () => {
    const r = await through(request()); assert.equal(r.status, 200); assert.equal(calls, 1);
    assert.match(r.headers.get("cache-control"), /no-store/); assert.equal(events.length, 0);
  });
  await check("exact cron GET probe authenticates and never drains the queue", async () => {
    const before = calls;
    const response = await GET(request()); assert.equal(response.status, 200); assert.equal(calls, before);
    const body = await response.json(); assert.equal(body.mode, "read-only"); assert.equal(body.dashboardVersion, "3.8.85");
    assert.equal((await GET(request(endpoint, { token: "forged" }))).status, 401); assert.equal(calls, before);
  });
  await check("missing bearer is blocked at Host gate", async () => {
    assert.equal((await through(request(endpoint, { token: null }))).status, 421); assert.equal(calls, 1);
  });
  for (const token of ["short", "b".repeat(64)]) await check(`invalid bearer length=${token.length} rejected before queue`, async () => {
    assert.equal((await through(request(endpoint, { token }))).status, 401); assert.equal(calls, 1);
  });
  await check("missing configured token fails closed", async () => {
    const saved = env.INTERNAL_API_TOKEN; delete env.INTERNAL_API_TOKEN;
    try { assert.equal((await through(request(endpoint, { token: saved }))).status, 401); assert.equal(calls, 1); }
    finally { env.INTERNAL_API_TOKEN = saved; }
  });
  await check("worker header alias verifies the secret", async () => {
    assert.equal((await through(request(endpoint, { token: null, headers: { "x-worker-stats-token": env.INTERNAL_API_TOKEN } }))).status, 200);
    assert.equal(calls, 2);
    assert.equal((await through(request(endpoint, { token: null, headers: { "x-worker-stats-token": "forged" } }))).status, 401);
    assert.equal(calls, 2);
  });
  await check("unrelated admin API is not exempt", () => assert.equal(proxy(request("/api/dashboard/discord/profile-nicknames/settings")).status, 421));
  await check("unknown Host is not exempt even with valid bearer", () => assert.equal(proxy(request(endpoint, { host: "attacker.invalid" })).status, 421));
  await check("public Host still requires Cloudflare", () => assert.equal(proxy(request(endpoint, { host: "guild.lihvodruida.pp.ua" })).status, 403));
  await check("trusted public ingress still requires authentication", async () => {
    assert.equal((await through(request(endpoint, { host: "guild.lihvodruida.pp.ua", token: null,
      headers: { "x-mistblossom-trusted-proxy": "cloudflare", origin: env.DASHBOARD_URL } }))).status, 401);
    assert.equal(calls, 2);
  });
  await check("queue storage failure returns retryable 503", async () => {
    queueFails = true; assert.equal((await through(request())).status, 503); assert.equal(calls, 3);
  });
  await check("signed modal request passes production service Host without session or Cloudflare", async () => {
    const r = await throughModal(modalRequest()); assert.equal(r.status, 200); assert.equal((await r.json()).type, 9);
    assert.match(r.headers.get("cache-control"), /no-store/); assert.equal(modalCalls, 1);
  });
  for (const [name, options, status] of [
    ["missing bearer", { token: null }, 421], ["forged bearer", { token: "x".repeat(64) }, 401],
    ["wrong source", { source: "browser" }, 401], ["tampered signed body", { tampered: true }, 401],
    ["public message", { flags: 0 }, 400], ["foreign guild", { guild: "222222222222222222" }, 400],
    ["unknown service Host", { host: "attacker.invalid" }, 421],
  ]) await check(`modal rejects ${name} before reading a draft`, async () => {
    assert.equal((await throughModal(modalRequest(options))).status, status); assert.equal(modalCalls, 1);
  });
  console.log(`[check-internal-cron-proxy] OK — ${total}/${total}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
