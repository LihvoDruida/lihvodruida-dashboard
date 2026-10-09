import test from "node:test";
import assert from "node:assert/strict";
import { drainInteractionIngress, enqueueVerifiedInteraction } from "../src/dashboardClient.mjs";

const originalFetch = globalThis.fetch;
const oldToken = process.env.INTERNAL_API_TOKEN;
const oldUrl = process.env.DASHBOARD_INTERNAL_URL;
process.env.INTERNAL_API_TOKEN = "stage4-bot-internal-token-" + "k".repeat(32);
process.env.DASHBOARD_INTERNAL_URL = "http://dashboard:3000";
const ingress = "/api/internal/discord/interaction-ingress";
const interaction = { id: "1977770001112224401", token: "secret-token", type: 3 };
const envelope = { rawBody: JSON.stringify(interaction), signature: "a".repeat(128), timestamp: "1790000000", interaction, domain: "raid_poll" };
const job = { id: interaction.id, rawBody: envelope.rawBody, signature: envelope.signature, timestamp: envelope.timestamp, domain: envelope.domain, leaseId: "11111111-1111-4111-8111-111111111111" };

try {
  await test("ingress receipt is committed before ACK path resolves", async () => {
    let released;
    const blocked = new Promise((resolve) => { released = resolve; });
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts });
      await blocked;
      return new Response(JSON.stringify({ ok: true, created: true }), { status: 200 });
    };
    let finished = false;
    const request = enqueueVerifiedInteraction(envelope).then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(JSON.parse(calls[0].opts.body).rawBody, envelope.rawBody);
    released();
    await request;
    assert.equal(finished, true);
  });
  await test("ingress storage outage never authorizes ACK", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
    await assert.rejects(enqueueVerifiedInteraction(envelope), /HTTP 503/);
  });
  await test("worker replays signed request using original verification headers and settles", async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      const path = String(url);
      calls.push({ path, opts });
      if (path.endsWith(ingress) && !opts.method) return new Response(JSON.stringify({ jobs: [job] }), { status: 200 });
      if (path.endsWith("/api/discord/interactions") && opts.method === "POST") return new Response(JSON.stringify({ type: 4, data: { content: "ok" } }), { status: 200 });
      if (path.endsWith(ingress) && opts.method === "PATCH") return new Response("{}", { status: 200 });
      throw new Error("unexpected fetch " + path);
    };
    await drainInteractionIngress();
    assert.equal(calls.length, 3);
    assert.equal(calls[1].opts.headers["x-signature-ed25519"], envelope.signature);
    assert.equal(calls[1].opts.headers["x-interaction-id"], interaction.id);
    assert.equal(JSON.parse(calls[2].opts.body).success, true);
  });
  await test("dispatch 503 retains job for retry without claiming success", async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      const path = String(url);
      calls.push({ path, opts });
      if (path.endsWith(ingress) && !opts.method) return new Response(JSON.stringify({ jobs: [job] }), { status: 200 });
      if (path.endsWith("/api/discord/interactions")) return new Response("unavailable", { status: 503 });
      if (path.endsWith(ingress) && opts.method === "PATCH") return new Response("{}", { status: 200 });
      throw new Error("unexpected fetch " + path);
    };
    await drainInteractionIngress();
    assert.equal(JSON.parse(calls.at(-1).opts.body).success, false);
    assert.equal(JSON.parse(calls.at(-1).opts.body).permanent, false);
  });
  await test("invalid signed replay returned 401 stops retry attempts", async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      const path = String(url);
      calls.push({ path, opts });
      if (path.endsWith(ingress) && !opts.method) return new Response(JSON.stringify({ jobs: [job] }), { status: 200 });
      if (path.endsWith("/api/discord/interactions")) return new Response("invalid signature", { status: 401 });
      if (path.endsWith(ingress) && opts.method === "PATCH") return new Response("{}", { status: 200 });
      throw new Error("unexpected fetch " + path);
    };
    await drainInteractionIngress();
    assert.equal(JSON.parse(calls.at(-1).opts.body).permanent, true);
  });
} finally {
  globalThis.fetch = originalFetch;
  if (oldToken === undefined) delete process.env.INTERNAL_API_TOKEN; else process.env.INTERNAL_API_TOKEN = oldToken;
  if (oldUrl === undefined) delete process.env.DASHBOARD_INTERNAL_URL; else process.env.DASHBOARD_INTERNAL_URL = oldUrl;
}
