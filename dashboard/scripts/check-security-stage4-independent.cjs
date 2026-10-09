#!/usr/bin/env node
"use strict";
// Independently execute the production TypeScript ingress implementation with
// transactional storage and adversarial input; no prior check-* helpers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let ts;
try { ts = require("typescript"); } catch { ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript"); }
const root = path.resolve(__dirname, "..");
process.env.SESSION_SECRET = "stage4-isolated-test-secret-" + "r".repeat(48);
function load(file, mocks) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((name) => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("node:") ? require(name) : (() => { throw Error("unmocked " + name); })(), exports);
  return exports;
}
function storage() {
  const rows = new Map();
  let q = Promise.resolve(), unavailable = false;
  const ref = (id) => ({ id, async delete() { rows.delete(id); } });
  const db = {
    collection() { return {
      doc: ref,
      where(key, op, value) { return { limit(max) { return { async get() {
        if (unavailable) throw Error("db down");
        const docs = [...rows].filter(([, data]) => op === "==" ? data[key] === value : op === "<=" ? data[key] <= value : false).slice(0, max).map(([id]) => ({ id, ref: ref(id), data: () => rows.get(id) }));
        return { docs };
      } }; } }; },
    }; },
    async runTransaction(fn) {
      const previous = q; let unlock; q = new Promise((resolve) => unlock = resolve);
      await previous;
      try {
        if (unavailable) throw Error("db down");
        const changes = [];
        const tx = { get: async (r) => ({ data: () => rows.get(r.id) }), set: (r, data) => changes.push([r.id, data]) };
        const value = await fn(tx);
        for (const [id, data] of changes) rows.set(id, data);
        return value;
      } finally { unlock(); }
    },
  };
  return { db, rows, fail(value) { unavailable = value; } };
}
(async () => {
  let count = 0;
  async function check(label, fn) { await fn(); count++; console.log("PASS", label); }
  const store = storage();
  const lib = load("src/lib/discordInteractionIngress.ts", { "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => store.db } });
  const base = Date.now();
  const original = { id: "1977770001112224401", type: 3, data: { custom_id: "test" }, token: "secret-should-be-encrypted" };
  const envelope = (id = original.id, at = base) => ({ id, rawBody: JSON.stringify({ ...original, id }), signature: "a".repeat(128), timestamp: String(Math.floor(at / 1000)), domain: "raid_poll" });
  await check("atomic durable insert for 20 parallel identical receipts", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => lib.enqueueInteractionIngress(envelope(), base)));
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(results.filter((r) => !r.created).length, 19);
  });
  await check("signed raw body and Discord webhook token encrypted at rest", async () => {
    const data = store.rows.get(original.id);
    assert.ok(data.payloadCipher);
    assert.ok(!JSON.stringify(data).includes("secret-should-be-encrypted"));
    assert.ok(!JSON.stringify(data).includes("a".repeat(128)));
  });
  await check("same interaction id cannot be reused with changed domain or signed body", async () => {
    await assert.rejects(lib.enqueueInteractionIngress({ ...envelope(), domain: "other" }, base), /different payload/);
    await assert.rejects(lib.enqueueInteractionIngress({ ...envelope(), rawBody: JSON.stringify({ ...original, token: "different" }) }, base), /different payload/);
  });
  await check("invalid id and missing signature rejected", async () => {
    await assert.rejects(lib.enqueueInteractionIngress({ ...envelope(), id: "x" }, base), /invalid/);
    await assert.rejects(lib.enqueueInteractionIngress({ ...envelope(), signature: "a" }, base), /invalid/);
  });
  await check("oversized raw content is rejected", async () => {
    const e = envelope("1977770001112224402");
    await assert.rejects(lib.enqueueInteractionIngress({ ...e, rawBody: "x".repeat(260_000) }, base), /invalid/);
  });
  await check("outdated and future timestamps cannot enter queue", async () => {
    await assert.rejects(lib.enqueueInteractionIngress(envelope("1977770001112224403", base - 360_000), base), /expired/);
    await assert.rejects(lib.enqueueInteractionIngress(envelope("1977770001112224404", base + 90_000), base), /expired/);
  });
  await check("a single lease is allocated among parallel workers", async () => {
    const [one, two, three] = await Promise.all([lib.leaseInteractionIngress(10, base + 100), lib.leaseInteractionIngress(10, base + 100), lib.leaseInteractionIngress(10, base + 100)]);
    assert.equal([...one, ...two, ...three].filter((r) => r.id === original.id).length, 1);
  });
  const first = store.rows.get(original.id).leaseId;
  await check("leased job decrypts to original raw request", async () => {
    // Active receipt is already leased. Lease has a transactional payload copy;
    // validate decryption by allowing its lease to expire.
    const entries = await lib.leaseInteractionIngress(1, base + 91_000);
    assert.equal(entries[0].id, original.id);
    assert.equal(entries[0].rawBody, envelope().rawBody);
    assert.equal(entries[0].domain, "raid_poll");
  });
  const fresh = store.rows.get(original.id).leaseId;
  await check("old lease cannot settle renewed claim", async () => {
    assert.equal(await lib.settleInteractionIngress(original.id, first, true, false, base + 91_010), false);
  });
  await check("failed dispatch requeues with backoff and no lost receipt", async () => {
    assert.equal(await lib.settleInteractionIngress(original.id, fresh, false, false, base + 91_020), true);
    assert.equal(store.rows.get(original.id).status, "ready");
    assert.ok(store.rows.get(original.id).payloadCipher);
    assert.deepEqual(await lib.leaseInteractionIngress(1, base + 91_030), []);
  });
  await check("successful dispatch scrubs encrypted request and retains fingerprint", async () => {
    const again = await lib.leaseInteractionIngress(1, base + 100_000);
    assert.equal(again.length, 1);
    assert.equal(await lib.settleInteractionIngress(original.id, again[0].leaseId, true, false, base + 100_020), true);
    assert.equal(store.rows.get(original.id).payloadCipher, "");
    assert.equal(store.rows.get(original.id).status, "dispatched");
    assert.equal((await lib.enqueueInteractionIngress(envelope(), base + 100_100)).created, false);
  });
  await check("failed store rejects receipt and does not mutate queue", async () => {
    store.fail(true);
    const before = store.rows.size;
    await assert.rejects(lib.enqueueInteractionIngress(envelope("1977770001112224405"), base), /db down/);
    assert.equal(store.rows.size, before);
    store.fail(false);
  });
  await check("unprocessed interactions expire before signatures go stale", async () => {
    const id = "1977770001112224406";
    await lib.enqueueInteractionIngress(envelope(id), base);
    const jobs = await lib.leaseInteractionIngress(15, base + 300_000);
    assert.ok(!jobs.some((j) => j.id === id));
    assert.equal(store.rows.get(id).status, "failed");
    assert.equal(store.rows.get(id).payloadCipher, "");
  });
  await check("maintenance purges old receipts and retains fresh fingerprints", async () => {
    const removed = await lib.pruneInteractionIngress(250, base + 25 * 60 * 60_000);
    assert.ok(removed >= 2);
    assert.equal(store.rows.has(original.id), false);
  });
  const outboxStore = storage();
  const outbox = load("src/lib/discordInteractionOutbox.ts", { "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => outboxStore.db } });
  const crashed = "1977770001112224498";
  const later = base + 26 * 60 * 60_000;
  await check("crashed outbox claim cannot execute a second time", async () => {
    assert.equal((await outbox.beginInteractionOutbox(crashed, "discord-webhook-token", later)).claimed, true);
    assert.equal((await outbox.beginInteractionOutbox(crashed, "discord-webhook-token", later + 1000)).claimed, false);
  });
  await check("outbox never retires a currently running interaction", async () => {
    assert.equal(await outbox.retireStalledInteractionResults(later + 3 * 60_000), 0);
    assert.equal(outboxStore.rows.get(crashed).deliveryState, "processing");
  });
  await check("orphaned outbox claim yields warning instead of replaying business action", async () => {
    const jobs = await outbox.leaseInteractionDeliveries(10, later + 4 * 60_000 + 1);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, crashed);
    assert.match(jobs[0].result.data.content, /Перевірте стан у панелі/);
    await assert.rejects(outbox.finishInteractionOutbox(crashed, { type: 4, data: { content: "late result" } }, later + 4 * 60_000 + 2), /already completed/);
  });
  await check("orphaned outbox delivery scrubs webhook token on confirmation", async () => {
    const record = outboxStore.rows.get(crashed);
    assert.equal(await outbox.settleInteractionDelivery(crashed, record.leaseId, true, false, later + 4 * 60_000 + 5), true);
    assert.equal(outboxStore.rows.get(crashed).tokenCipher, "");
  });
  console.log(`[security stage4 ingress] ${count}/${count} independent behavioral checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
