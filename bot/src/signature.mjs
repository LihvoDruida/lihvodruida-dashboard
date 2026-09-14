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
export const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

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

/**
 * Діагностика verification без витоку самого підпису/ключа.
 *
 * Поля навмисно названі `ed25519*`, а не `signature*`: structured logger
 * редагує будь-які ключі зі словом signature, щоб випадково не зберегти
 * секретний header. Тут зберігаємо лише boolean/length/reason.
 */
export function inspectDiscordSignature(rawBody, signature, timestamp, nowMs = Date.now()) {
  const body = String(rawBody || "");
  const signatureHex = String(signature || "").trim();
  const timestampValue = String(timestamp || "").trim();
  const configuredKey = DISCORD_PUBLIC_KEY();
  const key = publicKey();
  const ed25519Present = signatureHex.length > 0;
  const ed25519FormatValid = /^[0-9a-f]{128}$/i.test(signatureHex);
  const timestampPresent = timestampValue.length > 0;
  const sent = Number(timestampValue);
  const timestampNumeric = timestampPresent && Number.isFinite(sent);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const timestampAgeSec = timestampNumeric ? nowSeconds - sent : null;
  const timestampSkewSec = timestampNumeric ? Math.abs(timestampAgeSec) : null;

  const base = {
    ok: false,
    reason: "unknown",
    publicKeyConfigured: configuredKey.length > 0,
    publicKeyValid: Boolean(key),
    ed25519Present,
    ed25519Length: signatureHex.length,
    ed25519FormatValid,
    timestampPresent,
    timestampNumeric,
    timestampAgeSec,
    timestampSkewSec,
    bodyBytes: Buffer.byteLength(body, "utf8"),
  };

  if (!configuredKey) return { ...base, reason: "public_key_missing" };
  if (!key) return { ...base, reason: "public_key_invalid" };
  if (!ed25519Present) return { ...base, reason: "missing_ed25519" };
  if (!ed25519FormatValid) return { ...base, reason: "invalid_ed25519_format" };
  if (!timestampPresent) return { ...base, reason: "missing_timestamp" };
  if (!timestampNumeric) return { ...base, reason: "invalid_timestamp" };
  if (timestampSkewSec > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ...base, reason: "timestamp_out_of_window" };
  }

  try {
    const ok = verify(
      null,
      Buffer.from(timestampValue + body, "utf8"),
      key,
      Buffer.from(signatureHex, "hex"),
    );
    return { ...base, ok, reason: ok ? "ok" : "ed25519_verification_failed" };
  } catch {
    return { ...base, reason: "verification_error" };
  }
}

export function verifyDiscordSignature(rawBody, signature, timestamp) {
  return inspectDiscordSignature(rawBody, signature, timestamp).ok;
}
