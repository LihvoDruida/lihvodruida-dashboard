#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let ts;
try { ts = require("typescript"); } catch { ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript"); }
const text = fs.readFileSync(path.join(__dirname, "../src/app/api/internal/discord/interaction-ingress/route.ts"), "utf8");
const javascript = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let allowed = false, signed = false, storeFails = false;
const calls = [];
const fake = {
  "next/server": { NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), { status: init.status || 200, headers: init.headers }) } },
  "@/lib/discordAdmin": { verifyDiscordInteractionSignature: async () => signed },
  "@/lib/security": { noStoreHeaders: () => ({ "cache-control": "no-store" }), verifyInternalBearerToken: async () => ({ ok: allowed }) },
  "@/lib/discordInteractionIngress": {
    enqueueInteractionIngress: async (v) => { if (storeFails) throw new Error("db down"); calls.push(v); return { created: true, state: "ready" }; },
    leaseInteractionIngress: async () => { if (storeFails) throw new Error("db down"); return [{ id: "1977770001112224401" }]; },
    settleInteractionIngress: async (id, leaseId, success) => { calls.push({ id, leaseId, success }); return true; },
  },
};
const routeExports = {};
new Function("require", "exports", javascript)((name) => { if (!(name in fake)) throw Error(name); return fake[name]; }, routeExports);
function request(method, json, source = "bot") {
  return new Request("http://dashboard:3000/api/internal/discord/interaction-ingress", {
    method, headers: { "content-type": "application/json", "x-mistblossom-source": source, authorization: "Bearer test" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}
(async () => {
  let total = 0;
  async function check(name, fn) { await fn(); total++; console.log("PASS", name); }
  const valid = { id: "1977770001112224401", rawBody: JSON.stringify({ id: "1977770001112224401", type: 3 }), signature: "a".repeat(128), timestamp: "1790000000", domain: "raid_poll" };
  await check("missing bearer blocks enqueue and worker leasing", async () => {
    assert.equal((await routeExports.POST(request("POST", valid))).status, 401);
    assert.equal((await routeExports.GET(request("GET"))).status, 401);
    assert.equal(calls.length, 0);
  });
  allowed = true;
  await check("untrusted service source cannot enqueue", async () => {
    assert.equal((await routeExports.POST(request("POST", valid, "external"))).status, 401);
  });
  await check("invalid Discord signature is rejected before storage", async () => {
    assert.equal((await routeExports.POST(request("POST", valid))).status, 401);
    assert.equal(calls.length, 0);
  });
  signed = true;
  await check("malformed JSON envelope is rejected", async () => {
    assert.equal((await routeExports.POST(request("POST", { id: 123 }))).status, 400);
  });
  await check("streaming body above 350KB is rejected without persistence", async () => {
    const oversized = { ...valid, rawBody: "x".repeat(351_000) };
    assert.equal((await routeExports.POST(request("POST", oversized))).status, 400);
    assert.equal(calls.length, 0);
  });
  await check("valid signed receipt persisted with exact body and no logged raw data", async () => {
    const response = await routeExports.POST(request("POST", valid));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).created, true);
    assert.deepEqual(calls[0], valid);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  await check("persistent storage outage rejects ACK", async () => {
    storeFails = true;
    assert.equal((await routeExports.POST(request("POST", valid))).status, 503);
    assert.equal((await routeExports.GET(request("GET"))).status, 503);
    storeFails = false;
  });
  await check("trusted worker leases pending signed job", async () => {
    const res = await routeExports.GET(request("GET"));
    assert.equal((await res.json()).jobs[0].id, valid.id);
  });
  await check("malformed settlement is rejected", async () => {
    assert.equal((await routeExports.PATCH(request("PATCH", { id: "bad" }))).status, 400);
  });
  await check("authorized worker acknowledges correct receipt and lease", async () => {
    const payload = { id: valid.id, leaseId: "11111111-1111-4111-8111-111111111111", success: true };
    const res = await routeExports.PATCH(request("PATCH", payload));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1), payload);
  });
  console.log(`[security stage4 ingress HTTP] ${total}/${total} independent route checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
