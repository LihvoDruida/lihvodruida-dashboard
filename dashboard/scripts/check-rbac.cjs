"use strict";
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const load = require("./lib/load-server-ts.cjs");
const schema = load("src/lib/accessGroupSchema.ts").exports;
const permissions = load("src/lib/permissions.ts", { "@/lib/accessGroupSchema": schema }).exports;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
const owner = { provider: "discord", id: "12345678901234567", role: "admin", isServerOwner: true };
const member = { provider: "discord", id: "12345678901234568", role: "member", discordRoleIds: ["22345678901234567"] };
function subject({ groups = [], policy = {}, failure = false } = {}) {
  return load("src/lib/auth/authorization.ts", {
    react: { cache: fn => fn },
    "@/lib/accessGroupSchema": schema,
    "@/lib/accessGroups": {
      listAccessGroupsForManagement: async () => { if (failure) throw Error("offline"); return groups; },
      applyAccessGroupToSession: (session, group, isServerOwner) => ({ ...session, role: group.role, groupId: group.id, permissions: group.permissions, isServerOwner }),
    },
    "@/lib/authAccessPolicy": { getAuthAccessPolicy: async options => { assert.equal(options.strict, true); return { allowServerOwner: true, allowEmergencyTokenLogin: false, roleGroupMappings: [{ roleId: member.discordRoleIds[0], groupId: "custom" }], ...policy }; } },
    "@/lib/runtimeResilience": { withTimeout: promise => promise },
    "@/lib/security": { logDashboardEvent() {} },
  }).exports;
}
(async () => {
  await test("role names never substitute explicit permissions", () => {
    for (const role of ["admin", "moderator", "mentor", "member"]) {
      const session = { ...member, role };
      for (const key of schema.DASHBOARD_PERMISSION_KEYS) assert.equal(permissions.hasDashboardPermission(session, key), false);
    }
  });
  await test("missing base permission denies every delegated right", () => {
    assert.equal(permissions.canManageGroups({ ...owner, isServerOwner: false, permissions: ["groups.manage"] }), false);
  });
  await test("read-only group viewer cannot edit groups", async () => {
    const session = { ...member, permissions: ["dashboard.view", "groups.view"] };
    assert.equal(permissions.canViewAccessGroups(session), true);
    assert.equal(permissions.canManageGroups(session), false);
    const next = require("next/server");
    let current = { ...session, groupId: "reader" };
    let reads = 0;
    const route = load("src/app/api/dashboard/access-groups/route.ts", {
      "next/server": next,
      "@/lib/auth": { getSession: async () => current },
      "@/lib/permissions": permissions,
      "@/lib/accessGroups": {
        canManageGroups: permissions.canManageGroups,
        listAccessGroupsForManagement: async () => { reads++; return [{ id: "reader", permissions: session.permissions }]; },
        applyAccessGroupToSession: actor => actor,
      },
      "@/lib/security": { noStoreHeaders: () => ({ "Cache-Control": "no-store" }), verifyTrustedOrigin: () => true, assertRequestBodySize: () => null },
    }).exports;
    assert.equal((await route.GET()).status, 200);
    const readCount = reads;
    assert.equal((await route.POST(new next.NextRequest("http://localhost:3000/api/dashboard/access-groups", { method: "POST" }))).status, 403);
    assert.equal(reads, readCount, "write must be rejected before catalog/mutation work");
    current = null;
    assert.equal((await route.GET()).status, 401);
  });
  const group = { id: "custom", role: "moderator", rank: 50, permissions: ["dashboard.view", "applications.view"] };
  await test("DB permissions replace elevated cookie claims", async () => {
    const result = await subject({ groups: [group] }).refreshSessionAuthorization({ ...member, role: "admin", groupId: "1", permissions: [...schema.DASHBOARD_PERMISSION_KEYS] });
    assert.deepEqual(result.permissions, group.permissions);
    assert.equal(result.role, "moderator");
  });
  await test("removed mapping and deleted group revoke access", async () => {
    assert.equal(await subject({ groups: [group], policy: { roleGroupMappings: [] } }).refreshSessionAuthorization(member), null);
    assert.equal(await subject().refreshSessionAuthorization(member), null);
  });
  await test("empty permissions never restore defaults", async () => {
    assert.equal(await subject({ groups: [{ ...group, permissions: [] }] }).refreshSessionAuthorization(member), null);
  });
  await test("storage outage denies members and owners", async () => {
    const service = subject({ failure: true });
    assert.equal(await service.refreshSessionAuthorization(member), null);
    assert.equal(await service.refreshSessionAuthorization(owner), null);
  });
  await test("owner exception disabled by policy grants no implicit access", async () => {
    assert.equal(await subject({ policy: { allowServerOwner: false } }).refreshSessionAuthorization(owner), null);
  });
  await test("legacy GitHub and disabled emergency sessions are denied", async () => {
    assert.equal(await subject().refreshSessionAuthorization({ ...owner, provider: "github" }), null);
    assert.equal(await subject().refreshSessionAuthorization({ ...owner, provider: "token" }), null);
  });
  await test("group preview uses current target rights and cannot recover owner rights", async () => {
    const result = await subject({ groups: [group] }).refreshSessionAuthorization({ ...owner, groupId: "custom", impersonatedBy: owner.id });
    assert.equal(result.isServerOwner, false);
    assert.deepEqual(result.permissions, group.permissions);
  });
  const token = load("src/lib/auth/sessionSignature.ts", {}, {
    crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa,
    process: { env: { SESSION_SECRET: "test-session-secret-".repeat(4) } },
  }).exports;
  const now = Math.floor(Date.now() / 1000);
  async function signed(patch = {}) {
    const payload = token.base64UrlEncode(JSON.stringify({ ...member, aud: "mistblossom-dashboard", iat: now, exp: now + 3600, ...patch }));
    return payload + "." + await token.sign(payload);
  }
  await test("valid signed envelope passes", async () => assert.equal((await token.verifySessionEnvelope(await signed())).id, member.id));
  await test("tampered, expired, future, malformed and oversized cookies fail", async () => {
    const valid = await signed();
    for (const value of [valid + "x", "x.y", "x".repeat(9000), await signed({ exp: now - 1 }), await signed({ iat: now + 120 }), await signed({ exp: now + 31 * 86400 }), await signed({ provider: "github" }), await signed({ aud: "other" })]) {
      assert.equal(await token.verifySessionEnvelope(value), null);
    }
  });
  const next = require("next/server");
  const proxy = load("src/proxy.ts", {
    "next/server": next,
    "@/lib/auth/sessionSignature": token,
    "@/lib/siteBridgeAuth": { hasSiteBridgeToken: () => false },
    "@/lib/security": {
      forbiddenResponse: () => next.NextResponse.json({ error: "forbidden" }, { status: 403 }),
      getCanonicalDashboardOrigin: () => "http://localhost:3000",
      getRequestHost: request => request.nextUrl.host,
      isAllowedHost: () => true, isLocalHost: () => true,
      logDashboardEvent() {}, noStoreHeaders: () => ({ "Cache-Control": "no-store" }),
      verifyTrustedOrigin: () => true,
    },
  }, { crypto: webcrypto, btoa, process: { env: { NODE_ENV: "development" } } }).exports.proxy;
  const request = (path, cookie) => new next.NextRequest("http://localhost:3000" + path, {
    headers: cookie ? { cookie: "mistblossom_dashboard_session=" + cookie } : {},
  });
  await test("Proxy rejects forged cookies on protected API routes", async () => {
    assert.equal((await proxy(request("/api/dashboard/server-status", "forged.cookie"))).status, 401);
    assert.equal((await proxy(request("/api/dashboard/server-status", await signed()))).headers.get("x-middleware-next"), "1");
  });
  await test("reserved raid and poll routes require a signed session", async () => {
    for (const path of ["/raids/new", "/raids/bench-priority", "/polls/new", "/dashboard/groups"]) {
      const response = await proxy(request(path));
      assert.equal(response.status, 303);
      assert.match(response.headers.get("location"), /\/login\?/);
    }
  });
  await test("public raid, poll and guild reads stay public", async () => {
    for (const path of ["/raids", "/raids/public-raid", "/polls", "/polls/public-poll", "/guild"]) {
      assert.equal((await proxy(request(path))).headers.get("x-middleware-next"), "1");
    }
  });
  console.log(`[check-rbac] ${passed}/${passed} passed`);
})().catch(error => { console.error(error); process.exit(1); });
