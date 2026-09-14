import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { inspectDiscordSignature, verifyDiscordSignature } from "../src/signature.mjs";

// Ключова пара Ed25519 як у Discord: публічний ключ віддається у hex.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicHex = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
process.env.DISCORD_PUBLIC_KEY = publicHex;

function signBody(body, timestamp) {
  return sign(null, Buffer.from(timestamp + body, "utf8"), privateKey).toString("hex");
}

const now = () => String(Math.floor(Date.now() / 1000));

test("коректний підпис проходить", () => {
  const body = JSON.stringify({ type: 1 });
  const ts = now();
  assert.equal(verifyDiscordSignature(body, signBody(body, ts), ts), true);
});

test("змінене тіло не проходить", () => {
  const ts = now();
  const signature = signBody(JSON.stringify({ type: 1 }), ts);
  assert.equal(verifyDiscordSignature(JSON.stringify({ type: 3 }), signature, ts), false);
});

test("чужий підпис не проходить", () => {
  const body = JSON.stringify({ type: 1 });
  const ts = now();
  assert.equal(verifyDiscordSignature(body, "ab".repeat(64), ts), false);
});

test("старий timestamp відхиляється (захист від повтору)", () => {
  const body = JSON.stringify({ type: 1 });
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  assert.equal(verifyDiscordSignature(body, signBody(body, old), old), false);
});

test("порожні або сміттєві заголовки відхиляються", () => {
  const body = JSON.stringify({ type: 1 });
  assert.equal(verifyDiscordSignature(body, "", now()), false);
  assert.equal(verifyDiscordSignature(body, "not-hex", now()), false);
  assert.equal(verifyDiscordSignature(body, "ab".repeat(64), ""), false);
  assert.equal(verifyDiscordSignature(body, "ab".repeat(64), "not-a-number"), false);
});

test("без налаштованого ключа нічого не проходить", () => {
  const saved = process.env.DISCORD_PUBLIC_KEY;
  process.env.DISCORD_PUBLIC_KEY = "";
  const body = JSON.stringify({ type: 1 });
  const ts = now();
  assert.equal(verifyDiscordSignature(body, signBody(body, ts), ts), false);
  process.env.DISCORD_PUBLIC_KEY = saved;
});


test("діагностика не повертає секрет і пояснює причину", () => {
  const body = JSON.stringify({ type: 1 });
  const ts = now();
  const missing = inspectDiscordSignature(body, "", ts);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_ed25519");
  assert.equal(missing.ed25519Present, false);
  assert.equal(missing.bodyBytes, Buffer.byteLength(body));
  assert.equal(Object.hasOwn(missing, "signature"), false);

  const malformed = inspectDiscordSignature(body, "not-hex", ts);
  assert.equal(malformed.reason, "invalid_ed25519_format");
  assert.equal(malformed.ed25519Length, 7);
  assert.equal(malformed.ed25519FormatValid, false);
});

test("діагностика відрізняє replay/timestamp від криптографічної помилки", () => {
  const body = JSON.stringify({ type: 1 });
  const nowSec = Math.floor(Date.now() / 1000);
  const old = String(nowSec - 3600);
  const replay = inspectDiscordSignature(body, signBody(body, old), old, nowSec * 1000);
  assert.equal(replay.reason, "timestamp_out_of_window");
  assert.equal(replay.timestampAgeSec, 3600);

  const ts = String(nowSec);
  const bad = inspectDiscordSignature(body, "ab".repeat(64), ts, nowSec * 1000);
  assert.equal(bad.reason, "ed25519_verification_failed");
  assert.equal(bad.timestampSkewSec, 0);
});
