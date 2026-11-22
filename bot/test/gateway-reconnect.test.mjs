import test from "node:test";
import assert from "node:assert/strict";

// Fake WebSocket: records every instance so the test can drive events by hand.
const sockets = [];
class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; this.closed = null; sockets.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code, reason) { this.closed = { code, reason }; }
  emitOpen() { this.readyState = FakeWebSocket.OPEN; this.dispatchEvent(new Event("open")); }
  emitMessage(packet) { const event = new Event("message"); event.data = JSON.stringify(packet); this.dispatchEvent(event); }
  emitClose(code = 1006, reason = "") { this.readyState = 3; const event = new Event("close"); event.code = code; event.reason = reason; this.dispatchEvent(event); }
}

test("stale socket events never spawn a parallel gateway connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const previous = { ws: globalThis.WebSocket, token: process.env.DISCORD_BOT_TOKEN, guild: process.env.DISCORD_GUILD_ID, enabled: process.env.DISCORD_GATEWAY_ENABLED };
  globalThis.WebSocket = FakeWebSocket;
  process.env.DISCORD_BOT_TOKEN = "test-token";
  process.env.DISCORD_GUILD_ID = "123456789012345678";
  process.env.DISCORD_GATEWAY_ENABLED = "1";
  const { startDiscordGatewayBridge, discordGatewayHealth } = await import("../src/gateway.mjs");
  const stop = startDiscordGatewayBridge();
  try {
    assert.equal(sockets.length, 1);
    const first = sockets[0];
    first.emitOpen();
    first.emitMessage({ op: 10, d: { heartbeat_interval: 10_000 } });
    assert.equal(first.sent.at(-1).op, 2, "identify sent after HELLO");

    // Discord asks to reconnect: a new socket is scheduled even if `close` never arrives.
    first.emitMessage({ op: 7, d: null });
    assert.ok(first.closed, "old socket closed");
    t.mock.timers.tick(600);
    assert.equal(sockets.length, 2, "reconnect without waiting for close event");
    const second = sockets[1];
    second.emitOpen();

    // The late close of the old socket must not schedule a third connection.
    first.emitClose(4000, "server_reconnect");
    t.mock.timers.tick(31_000);
    assert.equal(sockets.length, 2, "late close of replaced socket is ignored");
    assert.equal(discordGatewayHealth().connected, true, "current socket state untouched");
  } finally {
    stop();
    globalThis.WebSocket = previous.ws;
    for (const [key, value] of [["DISCORD_BOT_TOKEN", previous.token], ["DISCORD_GUILD_ID", previous.guild], ["DISCORD_GATEWAY_ENABLED", previous.enabled]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("a socket that never completes the handshake is replaced", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const previous = { ws: globalThis.WebSocket, token: process.env.DISCORD_BOT_TOKEN, guild: process.env.DISCORD_GUILD_ID, enabled: process.env.DISCORD_GATEWAY_ENABLED };
  globalThis.WebSocket = FakeWebSocket;
  process.env.DISCORD_BOT_TOKEN = "test-token";
  process.env.DISCORD_GUILD_ID = "123456789012345678";
  process.env.DISCORD_GATEWAY_ENABLED = "1";
  const { startDiscordGatewayBridge } = await import("../src/gateway.mjs");
  const before = sockets.length;
  const stop = startDiscordGatewayBridge();
  try {
    const stuck = sockets[before];
    stuck.emitOpen(); // TCP open, but no HELLO / READY ever arrives
    t.mock.timers.tick(46_000);
    assert.ok(stuck.closed, "stuck socket closed by handshake watchdog");
    t.mock.timers.tick(31_000);
    assert.equal(sockets.length, before + 2, "exactly one replacement connection");
  } finally {
    stop();
    globalThis.WebSocket = previous.ws;
    for (const [key, value] of [["DISCORD_BOT_TOKEN", previous.token], ["DISCORD_GUILD_ID", previous.guild], ["DISCORD_GATEWAY_ENABLED", previous.enabled]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
