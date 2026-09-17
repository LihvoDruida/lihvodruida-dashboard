import test from "node:test";
import assert from "node:assert/strict";

import { notifyDiscordMemberJoined } from "../src/dashboardClient.mjs";
import { rankGatewayQueueItems } from "../src/gateway.mjs";

test("gateway prioritizes newest joins while queue is fresh", () => {
  const now = Date.now();
  const items = [
    { userId: "1", joinedAt: new Date(now - 1000).toISOString(), queuedAt: now - 1000 },
    { userId: "2", joinedAt: new Date(now - 100).toISOString(), queuedAt: now - 100 },
  ];
  assert.equal(rankGatewayQueueItems(items, now)[0].userId, "2");
});

test("gateway starvation guard eventually promotes an older join", () => {
  const now = Date.now();
  const items = [
    { userId: "old", joinedAt: new Date(now - 30_000).toISOString(), queuedAt: now - 30_000 },
    { userId: "new", joinedAt: new Date(now - 50).toISOString(), queuedAt: now - 50 },
  ];
  assert.equal(rankGatewayQueueItems(items, now)[0].userId, "old");
});

test("member-joined bridge sends bearer/source payload and accepts success", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousUrl = process.env.DASHBOARD_INTERNAL_URL;
  process.env.INTERNAL_API_TOKEN = "x".repeat(32);
  process.env.DASHBOARD_INTERNAL_URL = "http://dashboard.test:3000";
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, result: { processed: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await notifyDiscordMemberJoined({
      guildId: "1449767281453301865",
      userId: "242712552050655232",
      joinedAt: "2026-09-17T16:26:00.000Z",
      eventId: "event-1",
    });
    assert.equal(result.ok, true);
    assert.equal(seen.url, "http://dashboard.test:3000/api/internal/discord/member-joined");
    assert.equal(seen.init.headers.authorization, `Bearer ${"x".repeat(32)}`);
    assert.equal(seen.init.headers["x-mistblossom-source"], "bot-gateway");
    const body = JSON.parse(seen.init.body);
    assert.equal(body.source, "discord_gateway");
    assert.equal(body.userId, "242712552050655232");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN; else process.env.INTERNAL_API_TOKEN = previousToken;
    if (previousUrl === undefined) delete process.env.DASHBOARD_INTERNAL_URL; else process.env.DASHBOARD_INTERNAL_URL = previousUrl;
  }
});

test("member-joined bridge retries 202 onboarding_busy instead of dropping event", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "y".repeat(32);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ ok: true, retry: true, reason: "onboarding_busy" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { processed: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await notifyDiscordMemberJoined({ guildId: "1449767281453301865", userId: "242712552050655232" });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN; else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test("member-joined bridge does not loop on explicit dashboard 4xx", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "z".repeat(32);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: false, error: "wrong_guild" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await assert.rejects(
      notifyDiscordMemberJoined({ guildId: "1449767281453301865", userId: "242712552050655232" }),
      /відхилила member-joined 403/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN; else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});
