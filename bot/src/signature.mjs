import { verify, createPublicKey } from "node:crypto";

/**
 * Перевірка підпису Discord (Ed25519).
 *
 * Раніше це робив Cloudflare Worker через WebCrypto. У Node достатньо
 * вбудованого crypto — зовнішня бібліотека тут не потрібна й лише додала б
 * поверхню атаки в сервісі, який приймає запити з інтернету.
 */

const DISCORD_PUBLIC_KEY = () => String(process.env.DISCORD_PUBLIC_KEY || "").trim();

/** Наскільки старий підпис ще приймаємо. Захист від повторного відтворення. */
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

let cachedKey = null;
let cachedKeyHex = "";

/**
 * Ed25519 у форматі, який розуміє node:crypto.
 * Discord віддає сирі 32 байти, тому загортаємо їх у DER-обгортку SPKI.
 */
function publicKey() {
  const hex = DISCORD_PUBLIC_KEY();
  if (!hex) return null;
  if (cachedKey && cachedKeyHex === hex) return cachedKey;

  try {
    const raw = Buffer.from(hex, "hex");
    if (raw.length !== 32) return null;
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      raw,
    ]);
    cachedKey = createPublicKey({ key: der, format: "der", type: "spki" });
    cachedKeyHex = hex;
    return cachedKey;
  } catch {
    return null;
  }
}

export function verifyDiscordSignature(rawBody, signature, timestamp) {
  const key = publicKey();
  if (!key) return false;

  const signatureHex = String(signature || "");
  const timestampValue = String(timestamp || "");
  if (!/^[0-9a-f]{128}$/i.test(signatureHex) || !timestampValue) return false;

  // Свіжість перевіряємо до криптографії: відкидати старі запити дешевше.
  const sent = Number(timestampValue);
  if (!Number.isFinite(sent)) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - sent);
  if (skew > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  try {
    return verify(
      null,
      Buffer.from(timestampValue + rawBody, "utf8"),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}
