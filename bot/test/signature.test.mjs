import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyDiscordSignature } from "../src/signature.mjs";

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
