import test from "node:test";
import assert from "node:assert/strict";
import { drainInteractionOutbox } from "../src/dashboardClient.mjs";

const original = {
  fetch: globalThis.fetch,
  token: process.env.INTERNAL_API_TOKEN,
  app: process.env.DISCORD_APPLICATION_ID,
  url: process.env.DASHBOARD_INTERNAL_URL,
};
const job = {
  id: "1977770001112223399",
  leaseId: "aabbeeff-1111-2222-3333-aabbccddeeff",
  interactionToken: "very-sensitive-test-token",
  result: { type: 4, data: { content: "✅ Результат дії", components: [] } },
};

async function scenario({ discordStatus = 200, discordBody = "", failAck = false }) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (url.endsWith("/api/internal/discord/interaction-deliveries") && options.method === "GET") {
      return new Response(JSON.stringify({ jobs: [job] }), { status: 200 });
    }
    if (url.endsWith("/api/internal/discord/interaction-deliveries") && options.method === "POST") {
      return new Response("{}", { status: failAck ? 503 : 200 });
    }
    if (url.includes("/messages/@original")) return new Response(discordBody, { status: discordStatus });
    throw new Error(`unexpected request to ${url}`);
  };
  await drainInteractionOutbox();
  return calls;
}

process.env.INTERNAL_API_TOKEN = "bot-outbox-test-token-" + "x".repeat(32);
process.env.DISCORD_APPLICATION_ID = "1977770001112223000";
process.env.DASHBOARD_INTERNAL_URL = "http://dashboard:3000";

try {
  await test("recovered receipt delivers exactly the stored callback and acknowledges", async () => {
    const calls = await scenario({});
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[1].options.method, "PATCH");
    assert.ok(calls[1].url.endsWith("/messages/@original"));
    const payload = JSON.parse(calls[1].options.body);
    assert.equal(payload.content, "✅ Результат дії");
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(JSON.parse(calls[2].options.body).success, true);
    assert.equal(JSON.parse(calls[2].options.body).leaseId, job.leaseId);
    assert.equal(calls[0].options.headers.authorization, `Bearer ${process.env.INTERNAL_API_TOKEN}`);
  });
  await test("Discord 429 remains retryable and is not dropped", async () => {
    const calls = await scenario({ discordStatus: 429, discordBody: '{"message":"rate limited"}' });
    const settled = calls.find((call) => call.url.endsWith("/interaction-deliveries") && call.options.method === "POST");
    const outcome = JSON.parse(settled.options.body);
    assert.equal(outcome.success, false);
    assert.equal(outcome.permanent, false);
  });
  await test("Discord expired token 404 is terminal to avoid loops", async () => {
    const calls = await scenario({ discordStatus: 404, discordBody: '{"message":"expired"}' });
    const settled = calls.find((call) => call.url.endsWith("/interaction-deliveries") && call.options.method === "POST");
    const outcome = JSON.parse(settled.options.body);
    assert.equal(outcome.success, false);
    assert.equal(outcome.permanent, true);
  });
  await test("failed settlement does not repeat the Discord PATCH in one poll", async () => {
    const calls = await scenario({ failAck: true });
    assert.equal(calls.filter((x) => x.options.method === "PATCH").length, 1);
  });
} finally {
  globalThis.fetch = original.fetch;
  for (const [key, previous] of [["INTERNAL_API_TOKEN",original.token],["DISCORD_APPLICATION_ID",original.app],["DASHBOARD_INTERNAL_URL",original.url]]) {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
}
