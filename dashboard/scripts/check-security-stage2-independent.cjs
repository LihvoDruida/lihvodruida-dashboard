#!/usr/bin/env node
"use strict";
// Independent behavioral tests: fresh fakes for persistence and HTTP, no
// reliance on the repository's pre-existing check-* assertions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
let passed = 0;
const test = async (name, callback) => {
  await callback();
  console.log(`PASS ${name}`);
  passed++;
};
function load(relative, mocks = {}) {
  const src = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(src, {
    fileName: relative,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const mockRequire = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === "server-only") return {};
    if (id.startsWith("node:")) return require(id);
    if (id.startsWith("@/lib/") || id.startsWith("@mistblossom/")) return {};
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function("require", "module", "exports", js.outputText)(mockRequire, module, module.exports);
  return module.exports;
}
function fakeDb() {
  const collections = new Map();
  let queue = Promise.resolve();
  let failed = false;
  function col(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }
  const document = (collection, id) => ({
    id, collection,
    async get() {
      if (failed) throw new Error("db_unavailable");
      const payload = col(collection).get(id);
      return { exists: payload !== undefined, data: () => payload, id };
    },
    async set(data) { if (failed) throw new Error("db_unavailable"); col(collection).set(id, data); },
    async delete() { if (failed) throw new Error("db_unavailable"); col(collection).delete(id); },
  });
  const db = {
    collection(name) { return {
      doc(id) { return document(name, id); },
      where(key, operator, value) { assert.equal(operator, "<="); return {
        limit(size) { return {
          async get() { const docs = [...col(name)].filter(([, data]) => data[key] <= value).slice(0, size)
            .map(([id]) => ({ id, ref: document(name, id) })); return { docs }; },
        }; },
      }; },
    }; },
    async runTransaction(fn) {
      // Serialized fake transactions model the one-writer conflict rule.
      let release;
      const next = new Promise((resolve) => { release = resolve; });
      const previous = queue;
      queue = next;
      await previous;
      try {
        if (failed) throw new Error("db_unavailable");
        const changes = [];
        const tx = {
          get: (ref) => ref.get(),
          set: (ref, data) => changes.push([ref, data]),
        };
        const value = await fn(tx);
        changes.forEach(([ref, data]) => col(ref.collection).set(ref.id, data));
        return value;
      } finally { release(); }
    },
  };
  return { db, col, setFailed(value) { failed = value; } };
}
(async () => {
  const storage = fakeDb();
  const deps = { "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => storage.db } };
  const dedupe = load("src/lib/discordInteractionDedupe.ts", deps);
  const revocation = load("src/lib/sessionRevocation.ts", deps);
  const id = "1449767282195562569";
  await test("signed interaction gets one shared claim", async () => {
    assert.equal(await dedupe.claimVerifiedDiscordInteraction(id), true);
    assert.equal(await dedupe.claimVerifiedDiscordInteraction(id), false);
  });
  await test("process-restart model shares persistent replay claims", async () => {
    const second = load("src/lib/discordInteractionDedupe.ts", deps);
    assert.equal(await second.claimVerifiedDiscordInteraction(id), false);
  });
  await test("concurrent requests cannot both claim same interaction", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => dedupe.claimVerifiedDiscordInteraction("1556667778889990001")));
    assert.equal(results.filter(Boolean).length, 1);
  });
  await test("invalid snowflakes and DB outage fail closed", async () => {
    assert.equal(await dedupe.claimVerifiedDiscordInteraction("unsafe"), false);
    storage.setFailed(true);
    await assert.rejects(dedupe.claimVerifiedDiscordInteraction("1556667778889990002"), /db_unavailable/);
    storage.setFailed(false);
  });
  await test("dashboard HTTP handler rejects a forwarded duplicate before mutation", async () => {
    class Reply {
      static json(body, options = {}) { return { status: options.status || 200, body }; }
    }
    const route = load("src/app/api/discord/interactions/route.ts", {
      "next/server": { NextResponse: Reply },
      "@/lib/security": {
        assertRequestBodySize: () => null,
        verifyInternalBearerToken: async () => ({ ok: true }),
        noStoreHeaders: () => ({}),
        logDashboardEvent() {},
        safeErrorMessage: (error) => String(error),
      },
      "@/lib/discordAdmin": { verifyDiscordInteractionSignature: async () => true },
      "@/lib/discordInteractionOutbox": { beginInteractionOutbox: async () => ({ claimed: false, result: null }) },
    });
    const interactionId = "1888999000111222333";
    assert.equal(await dedupe.claimVerifiedDiscordInteraction(interactionId), true);
    const request = { headers: new Headers({
      "authorization": "Bearer test", "x-mistblossom-source": "bot", "x-interaction-id": interactionId,
    }), text: async () => JSON.stringify({ id: interactionId, type: 3, data: { custom_id: "mbv:raid" } }) };
    const reply = await route.POST(request);
    assert.equal(reply.status, 202);
    assert.equal(reply.body.pending, true);
  });
  await test("dashboard handler fails closed when replay store is unavailable", async () => {
    class Reply {
      constructor(text, options) { this.body = text; this.status = options.status; }
      static json(body, options) { return { status: options.status || 200, body }; }
    }
    const route = load("src/app/api/discord/interactions/route.ts", {
      "next/server": { NextResponse: Reply },
      "@/lib/security": {
        assertRequestBodySize: () => null, verifyInternalBearerToken: async () => ({ ok: true }),
        noStoreHeaders: () => ({}), logDashboardEvent() {}, safeErrorMessage: (error) => String(error),
      },
      "@/lib/discordAdmin": { verifyDiscordInteractionSignature: async () => true },
      "@/lib/discordInteractionOutbox": {
        beginInteractionOutbox: async () => { throw new Error("db down"); },
      },
    });
    const interactionId = "1888999000111222334";
    const request = { headers: new Headers({
      authorization: "Bearer test", "x-mistblossom-source": "bot", "x-interaction-id": interactionId,
    }), text: async () => JSON.stringify({ id: interactionId, type: 3 }) };
    assert.equal((await route.POST(request)).status, 503);
  });
  await test("revocation records a digest rather than bearer token", async () => {
    const token = "fake.session.signature.value";
    await revocation.revokeSessionToken(token, 3600);
    assert.equal(await revocation.isSessionTokenRevoked(token), true);
    assert.equal(await revocation.isSessionTokenRevoked("other"), false);
    const docs = storage.col("authRevokedSessions");
    assert.equal(docs.size, 1);
    assert.equal([...docs.keys()][0], require("node:crypto").createHash("sha256").update(token).digest("hex"));
    assert.ok(!JSON.stringify([...docs]).includes(token));
  });
  await test("security TTL retention removes only expired entries", async () => {
    storage.col("discordInteractionClaims").set("legacy", { expiresAt: "2000-01-01T00:00:00.000Z" });
    storage.col("authRevokedSessions").set("expired", { expiresAt: "2000-01-01T00:00:00.000Z" });
    assert.equal(await dedupe.pruneDiscordInteractionClaims(), 1);
    assert.equal(await revocation.pruneRevokedSessions(), 1);
    assert.equal(storage.col("authRevokedSessions").size, 1);
  });
  const staticRules = load("src/lib/staticRules.ts", {
    ...deps, "@/lib/staticRulesDefault": { DEFAULT_STATIC_RULES_MARKDOWN: "test rules" },
  });
  await test("shared invitation quotas are persistent across instances", async () => {
    const invite = "b".repeat(64);
    for (let index = 0; index < 16; index++) assert.equal(await staticRules.claimStaticChallengeQuota(invite, "192.0.2.12"), true);
    assert.equal(await staticRules.claimStaticChallengeQuota(invite, "192.0.2.12"), false);
    const second = load("src/lib/staticRules.ts", deps);
    assert.equal(await second.claimStaticChallengeQuota(invite, "192.0.2.12"), false);
    assert.equal(await second.claimStaticChallengeQuota(invite, "192.0.2.13"), true);
  });
  await test("shared invitation aggregate quota caps distributed IP floods", async () => {
    const invite = "c".repeat(64);
    for (let index = 0; index < 300; index++) {
      assert.equal(await staticRules.claimStaticChallengeQuota(invite, `198.51.100.${index}`), true);
    }
    assert.equal(await staticRules.claimStaticChallengeQuota(invite, "203.0.113.77"), false);
  });
  await test("challenge quotas reset after 15 minutes and allow cleanup", async () => {
    const invite = "d".repeat(64);
    for (let index = 0; index < 16; index++) {
      assert.equal(await staticRules.claimStaticChallengeQuota(invite, "192.0.2.18", 10_000), true);
    }
    assert.equal(await staticRules.claimStaticChallengeQuota(invite, "192.0.2.18", 10_000), false);
    assert.equal(await staticRules.claimStaticChallengeQuota(invite, "192.0.2.18", 10_000 + 900_001), true);
    // Timestamp in ancient epoch: all quota windows are expired by now.
    assert.ok(await staticRules.pruneStaticChallengeQuotas() >= 2);
  });
  await test("a valid cookie is rejected after server-side logout", async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, SESSION_SECRET: process.env.SESSION_SECRET };
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "stage2-independent-tests-" + "x".repeat(56);
    const jar = new Map();
    const auth = load("src/lib/auth.ts", {
      ...deps,
      "next/headers": { cookies: async () => ({ get: (key) => jar.get(key), set: (key, value) => jar.set(key, { value }) }) },
      "@/lib/sessionRevocation": revocation,
      "@/lib/profileIds": { createStableProfileId: async () => "id" + "a".repeat(20) },
      "@/lib/authCookieNames": { BNET_OAUTH_STATE_COOKIE: "__Host-bnet", LEGACY_BNET_OAUTH_STATE_COOKIE: "bnet" },
    });
    try {
      const token = await auth.createSessionToken({ provider: "discord", id, name: "Test", role: "member", profileId: "id" + "a".repeat(20) });
      jar.set(auth.SESSION_COOKIE, { value: token });
      assert.equal((await auth.getStoredSession())?.id, id);
      await auth.clearSession();
      jar.set(auth.SESSION_COOKIE, { value: token }); // stolen cookie replay
      assert.equal(await auth.getStoredSession(), null);
      const next = await auth.createSessionToken({ provider: "discord", id, name: "Test", role: "member", profileId: "id" + "a".repeat(20) });
      assert.notEqual(token, next, "new sessions require unique random jti");
      jar.set(auth.SESSION_COOKIE, { value: next });
      assert.equal((await auth.getStoredSession())?.id, id);
      storage.setFailed(true);
      assert.equal(await auth.getStoredSession(), null, "DB failure must never allow a cookie");
      storage.setFailed(false);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  await test("logout never acknowledges success if revocation fails", async () => {
    class Reply {
      constructor(status) { this.status = status; this.headers = new Headers(); this.cookies = { set() {} }; }
      static json(body, options) { const obj = new Reply(options.status); obj.body = body; return obj; }
      static redirect(_url, status) { return new Reply(status); }
    }
    const route = load("src/app/api/auth/logout/route.ts", {
      "next/server": { NextResponse: Reply },
      "@/lib/session": {
        clearSession: async () => { throw new Error("storage_failed"); },
        SESSION_COOKIE: "session", LEGACY_SESSION_COOKIE: "legacy",
        OAUTH_STATE_COOKIE: "state", LEGACY_OAUTH_STATE_COOKIE: "old-state",
      },
      "@/lib/authCookieNames": { BNET_OAUTH_STATE_COOKIE: "bn", LEGACY_BNET_OAUTH_STATE_COOKIE: "old-bn" },
      "@/lib/security": { logDashboardEvent() {}, noStoreHeaders: () => ({}) },
      "@/lib/apiRoute": { appBaseUrl: () => "https://example.com" },
    });
    const result = await route.POST({ headers: new Headers({ accept: "application/json", "x-dashboard-action": "logout" }) });
    assert.equal(result.status, 503);
    assert.equal(result.body.signedOut, false);
  });
  console.log(`Independent stage 2 security scenarios: ${passed}/${passed} PASS`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
