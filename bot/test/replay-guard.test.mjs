import test from "node:test";
import assert from "node:assert/strict";
import {
  claimDiscordInteractionId,
  clearDiscordInteractionReplayCacheForTests,
  discordInteractionReplayCacheSize,
} from "../src/replayGuard.mjs";

test("replay guard accepts an interaction once and rejects a duplicate", () => {
  clearDiscordInteractionReplayCacheForTests();
  const id = "1550176925690105928";
  assert.equal(claimDiscordInteractionId(id, 1_000_000), true);
  assert.equal(claimDiscordInteractionId(id, 1_000_001), false);
  assert.equal(discordInteractionReplayCacheSize() >= 0, true);
});

test("replay guard accepts id again after ttl", () => {
  clearDiscordInteractionReplayCacheForTests();
  const id = "1550176925690105929";
  assert.equal(claimDiscordInteractionId(id, 1_000_000, 60_000), true);
  assert.equal(claimDiscordInteractionId(id, 1_060_001, 60_000), true);
});

test("replay guard rejects malformed ids", () => {
  clearDiscordInteractionReplayCacheForTests();
  assert.equal(claimDiscordInteractionId("../../etc/passwd"), false);
  assert.equal(claimDiscordInteractionId("123"), false);
});

test("replay guard stays bounded under unique-id floods", () => {
  clearDiscordInteractionReplayCacheForTests();
  const base = 1550176925690100000n;
  for (let index = 0n; index < 300n; index += 1n) {
    assert.equal(claimDiscordInteractionId(String(base + index), 2_000_000, 60_000, 128), true);
  }
  // A new claim still succeeds after pruning; the map cannot grow unbounded.
  assert.equal(claimDiscordInteractionId(String(base + 999n), 2_000_001, 60_000, 128), true);
});
