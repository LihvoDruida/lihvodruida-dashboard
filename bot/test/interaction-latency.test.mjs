import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";

await test("signed HTTP click is ACKed after commit and delivered without idle polling waits", { timeout: 10_000 }, async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const ingress = [], outbox = [], events = [];
  let committed = false, delivered;
  const delivery = new Promise((resolve) => { delivered = resolve; });
  const dashboard = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const reply = (body) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
    if (req.url.endsWith("/interaction-ingress")) {
      if (req.method === "POST") {
        // Model a commit that is not instantaneous: ACK must await it.
        await wait(25); committed = true; events.push("commit");
        ingress.push({ ...data, leaseId: "11111111-1111-4111-8111-111111111111" });
        return reply({ ok: true, created: true });
      }
      if (req.method === "PATCH") return reply({ ok: true });
      return reply({ jobs: ingress.length ? [ingress.shift()] : [] });
    }
    if (req.url.endsWith("/interaction-deliveries")) {
      if (req.method === "POST") return reply({ ok: true });
      return reply({ jobs: outbox.length ? [outbox.shift()] : [] });
    }
    if (req.url === "/api/discord/interactions") {
      events.push("process");
      outbox.push({ id: data.id, leaseId: "22222222-2222-4222-8222-222222222222",
        interactionToken: data.token, result: { type: 4, data: { content: "ready", components: [] } } });
      return reply({ type: 4, data: { content: "ready" } });
    }
    if (req.url === "/test-webhook") {
      events.push("delivery"); assert.equal(data.content, "ready"); delivered(); return reply({ id: "message" });
    }
    return reply({ ok: true }); // isolated structured log sink
  });
  dashboard.listen(0, "127.0.0.1"); await once(dashboard, "listening");
  const base = `http://127.0.0.1:${dashboard.address().port}`;
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const serverUrl = new URL("../src/server.mjs", import.meta.url).href;
  // Only the external Discord PATCH is redirected to the local fixture.
  const bootstrap = `const realFetch = globalThis.fetch; globalThis.fetch = (url, opts) => realFetch(String(url).startsWith("https://discord.com/api/v10/webhooks/") ? ${JSON.stringify(base + "/test-webhook")} : url, opts); await import(${JSON.stringify(serverUrl)});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], { stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, PORT: String(port), HOST: "127.0.0.1", DASHBOARD_INTERNAL_URL: base,
    INTERNAL_API_TOKEN: "isolated-http-token-" + "x".repeat(40),
    DISCORD_PUBLIC_KEY: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex"),
    DISCORD_APPLICATION_ID: "1977770001112223000", DISCORD_GATEWAY_ENABLED: "0", LOG_LEVEL: "info", BOT_LOG_SINK_LEVEL: "error",
  } });
  let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`).catch(() => null);
      if (response?.ok) { ready = true; break; } await wait(20);
    }
    assert.ok(ready, output);
    const raw = JSON.stringify({ id: "1977770001112224401", token: "test-webhook-secret", type: 3,
      data: { custom_id: "mbv1:raid:abc123def456ghi789:going" }, guild_id: "1977770001112223001" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + raw), privateKey).toString("hex");
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/discord/interactions`, { method: "POST", body: raw,
      headers: { "content-type": "application/json", "x-signature-ed25519": signature, "x-signature-timestamp": timestamp } });
    assert.equal(response.status, 200, output); assert.ok(committed);
    assert.ok([5, 6].includes((await response.json()).type));
    const deadline = new AbortController();
    try {
      await Promise.race([delivery, wait(2_000, null, { signal: deadline.signal }).then(() => { throw Error("still waiting for a polling tick"); })]);
    } finally { deadline.abort(); }
    assert.ok(performance.now() - started < 2_000, "No 3s ingress / 5s outbox idle wait");
    assert.deepEqual(events, ["commit", "process", "delivery"]);
  } catch (error) {
    error.message += ` events=${JSON.stringify(events)} child=${output}`; throw error;
  } finally {
    const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
    await new Promise((resolve) => dashboard.close(resolve));
  }
});
