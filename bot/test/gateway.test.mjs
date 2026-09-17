import test from "node:test";
import assert from "node:assert/strict";

import { discordGatewayHealth, startDiscordGatewayBridge } from "../src/gateway.mjs";

test("gateway health exposes newcomer priority worker state", () => {
  const health = discordGatewayHealth();
  assert.equal(typeof health.enabled, "boolean");
  assert.equal(typeof health.configured, "boolean");
  assert.equal(typeof health.connected, "boolean");
  assert.equal(typeof health.ready, "boolean");
  assert.equal(typeof health.queueSize, "number");
  assert.equal(typeof health.activeWorkers, "number");
});

test("gateway can be disabled without opening a socket", () => {
  const previous = process.env.DISCORD_GATEWAY_ENABLED;
  process.env.DISCORD_GATEWAY_ENABLED = "0";
  const stop = startDiscordGatewayBridge();
  const health = discordGatewayHealth();
  assert.equal(health.enabled, false);
  assert.equal(health.connected, false);
  assert.equal(typeof stop, "function");
  stop();
  if (previous === undefined) delete process.env.DISCORD_GATEWAY_ENABLED;
  else process.env.DISCORD_GATEWAY_ENABLED = previous;
});
