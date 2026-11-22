import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

test("a replayed signed interaction is rejected and never reaches the ingress", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  let receipts = 0;
  const dashboard = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/internal/discord/interaction-ingress" && req.method === "POST") { receipts += 1; res.end(JSON.stringify({ ok: true, created: true })); }
    else res.end(JSON.stringify({ ok: true, jobs: [] }));
  });
  dashboard.listen(0, "127.0.0.1"); await once(dashboard, "listening");
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const child = spawn(process.execPath, [new URL("../src/server.mjs", import.meta.url).pathname], { stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, PORT: String(port), HOST: "127.0.0.1", DASHBOARD_INTERNAL_URL: `http://127.0.0.1:${dashboard.address().port}`,
    INTERNAL_API_TOKEN: "fixture-internal-token-" + "x".repeat(40), DISCORD_PUBLIC_KEY: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex"),
    DISCORD_GUILD_ID: "1977770001112223001", DISCORD_APPLICATION_ID: "1977770001112223000", DISCORD_GATEWAY_ENABLED: "0", BOT_LOG_SINK_LEVEL: "error",
  } });
  let output = ""; child.stdout.on("data", (d) => { output += d; }); child.stderr.on("data", (d) => { output += d; });
  // One captured request (same body, timestamp and signature) sent twice.
  const raw = JSON.stringify({ id: "1977770001112229901", type: 3, guild_id: "1977770001112223001", token: "fixture-token", data: { custom_id: "unrelated-button" } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + raw), privateKey).toString("hex");
  const send = () => fetch(`http://127.0.0.1:${port}/discord/interactions`, { method: "POST", body: raw, signal: AbortSignal.timeout(3000),
    headers: { "content-type": "application/json", "x-signature-ed25519": signature, "x-signature-timestamp": timestamp } });
  try {
    let ready = false;
    for (let i = 0; i < 100; i += 1) { if ((await fetch(`http://127.0.0.1:${port}/healthz`).catch(() => null))?.ok) { ready = true; break; } await wait(20); }
    assert.ok(ready, output);
    const first = await send();
    assert.equal(first.status, 200);
    await first.arrayBuffer();
    const receiptsAfterFirst = receipts;
    const replay = await send();
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).error, "duplicate_interaction");
    await wait(100);
    assert.equal(receipts, receiptsAfterFirst, "replay never enqueued");
  } finally {
    const exit = once(child, "exit"); child.kill("SIGTERM"); await exit; await new Promise((r) => dashboard.close(r));
  }
});
