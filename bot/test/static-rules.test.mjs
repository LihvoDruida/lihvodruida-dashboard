import test from "node:test";
import assert from "node:assert/strict";
import { parseStaticDmCommand } from "../src/gateway.mjs";

const dm = (content, patch = {}) => ({ content, channel_id: "123456789012345678", author: { id: "234567890123456789", bot: false }, ...patch });

test("Статик: only real Discord DM with 72-bit code is accepted", () => {
  assert.deepEqual(parseStaticDmCommand(dm("статик 0123456789abcdef01")), { code: "0123456789ABCDEF01", userId: "234567890123456789", channelId: "123456789012345678" });
  assert.equal(parseStaticDmCommand(dm("статик 0123456789abcdef01", { guild_id: "345678901234567890" })), null);
  assert.equal(parseStaticDmCommand(dm("static 0123456789abcdef01", { author: { id: "234567890123456789", bot: true } })), null);
  assert.equal(parseStaticDmCommand(dm("статик 0123456789abcdef0g")), null);
  assert.equal(parseStaticDmCommand(dm("статик 0123456789abcdef01 and extra")), null);
  assert.equal(parseStaticDmCommand(dm("статик 0123456789abcdef01", { author: { id: "not-a-discord-user" } })), null);
});
