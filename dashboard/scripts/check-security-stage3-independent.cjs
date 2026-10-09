#!/usr/bin/env node
"use strict";
// Independent behavioral tests. Import the actual TS implementation using
// the global TypeScript compiler; no pre-existing project test helpers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let ts;
try { ts = require("typescript"); } catch { ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript"); }
const root = path.resolve(__dirname, "..");
const originalSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "independent-stage3-key-" + "k".repeat(48);
function load(relative, mocks = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: relative,
  }).outputText;
  const exports = {};
  const requireMock = (id) => id === "server-only" ? {} : Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith("node:") ? require(id) : id.startsWith("@/lib/") ? {} : (() => { throw new Error(`unexpected import ${id}`); })();
  new Function("require", "exports", js)(requireMock, exports);
  return exports;
}
function store() {
  const rows = new Map();
  let writes = Promise.resolve();
  let unavailable = false;
  const ref = (id) => ({ id, async delete() { rows.delete(id); } });
  const db = {
    collection() { return {
      doc(id) { return ref(id); },
      where(key, op, compare) { return {
        limit(max) { return {
          async get() {
            const matches = [...rows].filter(([, d]) => op === "==" ? d[key] === compare : op === "<=" ? d[key] <= compare : false).slice(0, max);
            return { docs: matches.map(([id]) => ({ id, ref: ref(id) })) };
          },
        }; },
      }; },
    }; },
    async runTransaction(callback) {
      const old = writes;
      let finish;
      writes = new Promise((resolve) => finish = resolve);
      await old;
      try {
        if (unavailable) throw new Error("db unavailable");
        const updates = [];
        const tx = {
          get: async (r) => ({ data: () => rows.get(r.id) }),
          set: (r, data) => updates.push([r.id, data]),
        };
        const result = await callback(tx);
        for (const [id, data] of updates) rows.set(id, data);
        return result;
      } finally { finish(); }
    },
  };
  return { db, rows, setUnavailable: (v) => { unavailable = v; } };
}
(async () => {
  let passed = 0;
  async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
  const storage = store();
  const outbox = load("src/lib/discordInteractionOutbox.ts", { "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => storage.db } });
  const id = "1977770001112223334";
  const token = "super-sensitive-discord-interaction-token";
  const base = Date.now();
  await test("atomic claim: only one request executes among concurrent duplicates", async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => outbox.beginInteractionOutbox(id, token, base)));
    assert.equal(results.filter((r) => r.claimed).length, 1);
  });
  await test("webhook token is AES-256-GCM ciphertext at rest", async () => {
    const doc = storage.rows.get(id);
    assert.ok(doc.tokenCipher);
    assert.ok(!JSON.stringify(doc).includes(token));
    assert.equal(doc.deliveryState, "processing");
  });
  await test("claimed processing state has no response and cannot rerun", async () => {
    assert.deepEqual((await outbox.beginInteractionOutbox(id, token)).result, null);
  });
  const answer = { type: 4, data: { content: "✅ Записано", components: [] } };
  await test("finished action stores the exact callback before response delivery", async () => {
    await outbox.finishInteractionOutbox(id, answer, base + 100);
    assert.deepEqual(storage.rows.get(id).result, answer);
    assert.equal(storage.rows.get(id).deliveryState, "ready");
    assert.deepEqual((await outbox.beginInteractionOutbox(id, token)).result, answer);
  });
  await test("worker lease reveals token only in authenticated worker result", async () => {
    const jobs = await outbox.leaseInteractionDeliveries(10, base + 200);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].interactionToken, token);
    assert.deepEqual(jobs[0].result, answer);
    assert.equal(storage.rows.get(id).deliveryState, "leased");
    assert.notEqual(storage.rows.get(id).tokenCipher, token);
  });
  const firstLease = storage.rows.get(id).leaseId;
  await test("concurrent workers never acquire the same job", async () => {
    const jobs = await Promise.all(Array.from({ length: 4 }, () => outbox.leaseInteractionDeliveries(10, base + 250)));
    assert.equal(jobs.flat().length, 0);
  });
  await test("wrong settlement lease cannot mark delivery successful", async () => {
    assert.equal(await outbox.settleInteractionDelivery(id, "f".repeat(8) + "-1111-1111-1111-111111111111", true, false, base + 350), false);
    assert.equal(storage.rows.get(id).deliveryState, "leased");
  });
  await test("temporary network failure schedules retry with backoff", async () => {
    assert.equal(await outbox.settleInteractionDelivery(id, firstLease, false, false, base + 400), true);
    assert.equal(storage.rows.get(id).deliveryState, "ready");
    assert.equal((await outbox.leaseInteractionDeliveries(10, base + 401)).length, 0);
  });
  await test("worker reclaims retry after delay and marks delivered", async () => {
    const jobs = await outbox.leaseInteractionDeliveries(10, base + 4000);
    assert.equal(jobs.length, 1);
    assert.equal(await outbox.settleInteractionDelivery(id, jobs[0].leaseId, true, false, base + 4300), true);
    assert.equal(storage.rows.get(id).deliveryState, "delivered");
    assert.equal(storage.rows.get(id).tokenCipher, "");
    assert.equal((await outbox.leaseInteractionDeliveries(10, base + 4500)).length, 0);
  });
  await test("expired lease can be reclaimed by another worker", async () => {
    const second = "1977770001112223335";
    await outbox.beginInteractionOutbox(second, token, base);
    await outbox.finishInteractionOutbox(second, answer, base + 100);
    const jobs = await outbox.leaseInteractionDeliveries(10, base + 200);
    assert.equal(jobs.length, 1);
    const reacquired = await outbox.leaseInteractionDeliveries(10, base + 31_000);
    assert.equal(reacquired.length, 1);
    assert.notEqual(reacquired[0].leaseId, jobs[0].leaseId);
    assert.equal(await outbox.settleInteractionDelivery(second, jobs[0].leaseId, true, false, base + 31_100), false);
    assert.equal(await outbox.settleInteractionDelivery(second, reacquired[0].leaseId, true, false, base + 31_100), true);
  });
  await test("permanent Discord token rejection never retries", async () => {
    const third = "1977770001112223336";
    await outbox.beginInteractionOutbox(third, token, base);
    await outbox.finishInteractionOutbox(third, answer, base + 100);
    const jobs = await outbox.leaseInteractionDeliveries(10, base + 200);
    assert.equal(await outbox.settleInteractionDelivery(third, jobs[0].leaseId, false, true, base + 500), true);
    assert.equal(storage.rows.get(third).deliveryState, "failed");
    assert.equal(storage.rows.get(third).tokenCipher, "");
  });
  await test("expired Discord tokens are not leased beyond 14 minutes", async () => {
    const fourth = "1977770001112223337";
    await outbox.beginInteractionOutbox(fourth, token, base);
    await outbox.finishInteractionOutbox(fourth, answer, base + 100);
    assert.equal((await outbox.leaseInteractionDeliveries(10, base + 14 * 60 * 1000 + 100)).length, 0);
    assert.equal(storage.rows.get(fourth).deliveryState, "failed");
  });
  await test("maintenance scrubs expired webhook token without erasing replay claim", async () => {
    const agedId = "1977770001112223340";
    const agedAt = Date.now() - 15 * 60 * 1000;
    await outbox.beginInteractionOutbox(agedId, token, agedAt);
    await outbox.finishInteractionOutbox(agedId, answer, agedAt + 100);
    await outbox.pruneInteractionOutbox();
    assert.equal(storage.rows.get(agedId).deliveryState, "failed");
    assert.equal(storage.rows.get(agedId).tokenCipher, "");
    assert.equal((await outbox.beginInteractionOutbox(agedId, token)).claimed, false);
  });
  await test("failed storage prevents new claim and delivery", async () => {
    storage.setUnavailable(true);
    await assert.rejects(outbox.beginInteractionOutbox("1977770001112223338", token), /db unavailable/);
    storage.setUnavailable(false);
  });
  await test("ciphertext cannot be decrypted after wrong key rotation", async () => {
    const fifth = "1977770001112223339";
    await outbox.beginInteractionOutbox(fifth, token, base);
    await outbox.finishInteractionOutbox(fifth, answer, base + 100);
    process.env.SESSION_SECRET = "different-secret-value-" + "y".repeat(48);
    await assert.rejects(outbox.leaseInteractionDeliveries(10, base + 300));
    process.env.SESSION_SECRET = "independent-stage3-key-" + "k".repeat(48);
  });
  await test("claims survive process restart while keeping replay protection", async () => {
    const restarted = load("src/lib/discordInteractionOutbox.ts", { "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => storage.db } });
    assert.equal((await restarted.beginInteractionOutbox(id, token)).claimed, false);
  });
  await test("outbox HTTP API rejects unauthenticated read and write", async () => {
    class Reply {
      static json(body, opts = {}) { return { status: opts.status || 200, body }; }
    }
    const route = load("src/app/api/internal/discord/interaction-deliveries/route.ts", {
      "next/server": { NextResponse: Reply },
      "@/lib/security": { verifyInternalBearerToken: async () => ({ ok: false }), noStoreHeaders: () => ({}) },
      "@/lib/discordInteractionOutbox": outbox,
    });
    const request = { headers: new Headers({ "x-mistblossom-source": "bot" }), text: async () => JSON.stringify({ id, leaseId: firstLease, success: true }) };
    assert.equal((await route.GET(request)).status, 401);
    assert.equal((await route.POST(request)).status, 401);
  });
  await test("outbox HTTP API accepts only internal bot identity", async () => {
    class Reply {
      static json(body, opts = {}) { return { status: opts.status || 200, body }; }
    }
    const route = load("src/app/api/internal/discord/interaction-deliveries/route.ts", {
      "next/server": { NextResponse: Reply },
      "@/lib/security": { verifyInternalBearerToken: async () => ({ ok: true }), noStoreHeaders: () => ({}) },
      "@/lib/discordInteractionOutbox": { leaseInteractionDeliveries: async () => [], settleInteractionDelivery: async () => true },
    });
    assert.equal((await route.GET({ headers: new Headers({ "x-mistblossom-source": "web" }) })).status, 401);
    const allowed = { headers: new Headers({ "x-mistblossom-source": "bot" }) };
    assert.equal((await route.GET(allowed)).status, 200);
    assert.deepEqual((await route.GET(allowed)).body.jobs, []);
  });
  await test("outbox HTTP rejects oversized and malformed settlements", async () => {
    class Reply {
      static json(body, opts = {}) { return { status: opts.status || 200, body }; }
    }
    const route = load("src/app/api/internal/discord/interaction-deliveries/route.ts", {
      "next/server": { NextResponse: Reply },
      "@/lib/security": { verifyInternalBearerToken: async () => ({ ok: true }), noStoreHeaders: () => ({}) },
      "@/lib/discordInteractionOutbox": { leaseInteractionDeliveries: async () => [], settleInteractionDelivery: async () => true },
    });
    const request = { headers: new Headers({ "x-mistblossom-source": "bot" }), text: async () => JSON.stringify({ id, leaseId: firstLease, success: "sure" }) };
    assert.equal((await route.POST(request)).status, 400);
    assert.equal((await route.POST({ ...request, headers: new Headers({ "x-mistblossom-source": "bot", "content-length": "2200" }) })).status, 413);
  });
  await test("signed Discord HTTP route persists callback before returning to bot", async () => {
    class Reply {
      constructor(body, status = 200) { this.body = body; this.status = status; }
      static json(body, options = {}) { return new Reply(body, options.status || 200); }
      clone() { return { json: async () => this.body }; }
    }
    const empty = () => null;
    const route = load("src/app/api/discord/interactions/route.ts", {
      "next/server": { NextResponse: Reply },
      "@/lib/discordAdmin": { verifyDiscordInteractionSignature: async () => true, getDiscordGuildId: () => "1999990001112223334", decodeRulesCustomId: empty },
      "@/lib/security": { assertRequestBodySize: () => null, verifyInternalBearerToken: async () => ({ ok: true }), noStoreHeaders: () => ({}), logDashboardEvent() {}, safeErrorMessage: (err) => String(err) },
      "@/lib/discordInteractionOutbox": outbox,
      "@/lib/raids": { decodeRaidSignupSubmitCustomId: empty, decodeRaidRoleSelectCustomId: empty, decodeRaidCharacterSelectCustomId: empty, decodeRaidManualSpecCustomId: empty, decodeRaidAttendanceCustomId: empty, decodeRaidManualClassCustomId: empty },
      "@/lib/rosterFormation": { decodeRosterCustomId: empty },
      "@mistblossom/discord-contract": { decodeNicknameFixCustomId: empty, decodeRaidPollCustomId: empty, decodeAutoroleCustomId: empty, decodeApplicationCustomId: empty },
    });
    const incomingId = "1977770001112223391";
    const body = JSON.stringify({ id: incomingId, token: "discord-token-for-route", type: 3, guild_id: "1999990001112223334", data: { custom_id: "unknown-action" } });
    const request = { headers: new Headers({ authorization: "Bearer test", "x-mistblossom-source": "bot", "x-interaction-id": incomingId }), text: async () => body };
    const result = await route.POST(request);
    assert.equal(result.status, 200);
    assert.match(result.body.data.content, /не належить/);
    assert.deepEqual(storage.rows.get(incomingId).result, result.body);
    assert.equal(storage.rows.get(incomingId).deliveryState, "ready");
    const replay = await route.POST(request);
    assert.deepEqual(replay.body, result.body);
    assert.equal(storage.rows.get(incomingId).attempts, 0);
  });
  console.log(`Independent outbox scenarios: ${passed}/${passed} PASS`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret;
});
