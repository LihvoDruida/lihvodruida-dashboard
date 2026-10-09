import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";

// One durable receipt per signed Discord interaction. Processing a receipt is
// separate from ACK and always passes through the existing outbox dedupe gate.
const COLLECTION = "discordInteractionIngress";
const ID = /^\d{16,25}$/;
const SIG = /^[0-9a-f]{128}$/i;
const RETENTION_MS = 24 * 60 * 60_000;
const CLAIM_MS = 90_000;
const SIGNATURE_MAX_AGE_MS = 300_000;
const SAFETY_MARGIN_MS = 20_000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ATTEMPTS = 12;

type Receipt = {
  fingerprint: string;
  payloadCipher: string;
  status: "ready" | "leased" | "dispatched" | "failed";
  createdAt: string;
  expiresAt: string;
  dispatchDeadlineAt: string;
  nextAttemptAt: string;
  leaseId?: string;
  leaseUntil?: string;
  attempts: number;
  settledAt?: string;
};
type Envelope = { id: string; rawBody: string; signature: string; timestamp: string; domain: string };

function key() {
  const secret = String(process.env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("SESSION_SECRET required for Discord ingress");
  return createHash("sha256").update("mistblossom:discord-interaction-ingress:v1\0").update(secret).digest();
}
function encrypt(text: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}
function decrypt(value: string) {
  const encoded = Buffer.from(value, "base64");
  if (encoded.length < 29) throw new Error("ingress ciphertext corrupt");
  const cipher = createDecipheriv("aes-256-gcm", key(), encoded.subarray(0, 12));
  cipher.setAuthTag(encoded.subarray(12, 28));
  return Buffer.concat([cipher.update(encoded.subarray(28)), cipher.final()]).toString("utf8");
}
function validate(payload: Envelope, now: number) {
  if (!ID.test(payload.id) || !SIG.test(payload.signature) || !/^\d{10}$/.test(payload.timestamp)) throw new Error("invalid ingress envelope");
  if (typeof payload.rawBody !== "string" || Buffer.byteLength(payload.rawBody, "utf8") > MAX_BODY_BYTES || !payload.rawBody) throw new Error("invalid ingress body");
  if (typeof payload.domain !== "string" || payload.domain.length > 80) throw new Error("invalid ingress domain");
  let body: Record<string, unknown>;
  try { body = JSON.parse(payload.rawBody); } catch { throw new Error("invalid ingress JSON"); }
  if (String(body?.id || "") !== payload.id || Number(body?.type) !== 3) throw new Error("invalid interaction identity/type");
  const age = now - Number(payload.timestamp) * 1000;
  if (age < -30_000 || age >= SIGNATURE_MAX_AGE_MS - SAFETY_MARGIN_MS) throw new Error("expired ingress signature");
  return Number(payload.timestamp) * 1000 + SIGNATURE_MAX_AGE_MS - SAFETY_MARGIN_MS;
}

export async function enqueueInteractionIngress(payload: Envelope, now = Date.now()) {
  const deadline = validate(payload, now);
  const fingerprint = createHash("sha256").update(payload.timestamp).update("\0").update(payload.signature).update("\0").update(payload.rawBody).update("\0").update(payload.domain).digest("hex");
  const ref = getFirebaseAdminDb().collection(COLLECTION).doc(payload.id);
  return getFirebaseAdminDb().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as Receipt | undefined;
    if (current) {
      if (current.fingerprint !== fingerprint) throw new Error("interaction id reused with different payload");
      return { created: false, state: current.status };
    }
    const doc: Receipt = {
      fingerprint, payloadCipher: encrypt(JSON.stringify(payload)), status: "ready",
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + RETENTION_MS).toISOString(),
      dispatchDeadlineAt: new Date(deadline).toISOString(), nextAttemptAt: new Date(now).toISOString(), attempts: 0,
    };
    tx.set(ref, doc);
    return { created: true, state: "ready" as const };
  });
}

// PostgreSQL and Firestore support chained where predicates. Keep the old
// mocked collection contract for independent unit tests that expose only a
// single filter; the transaction still validates due time before claiming.
function dueQuery<T extends { where?: (field: string, op: "<=", value: string) => T }>(query: T, field: string, now: number): T {
  return typeof query.where === "function" ? query.where(field, "<=", new Date(now).toISOString()) : query;
}

export async function leaseInteractionIngress(limit = 10, now = Date.now()) {
  const collection = getFirebaseAdminDb().collection(COLLECTION);
  const size = Math.max(1, Math.min(20, Math.floor(limit)));
  const [ready, leased] = await Promise.all([
    dueQuery(collection.where("status", "==", "ready"), "nextAttemptAt", now).limit(150).get(),
    dueQuery(collection.where("status", "==", "leased"), "leaseUntil", now).limit(150).get(),
  ]);
  const results: Array<Envelope & { leaseId: string }> = [];
  for (const snapshot of [...ready.docs, ...leased.docs]) {
    if (results.length >= size) break;
    const ref = collection.doc(snapshot.id);
    const leaseId = randomUUID();
    const cipher = await getFirebaseAdminDb().runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as Receipt | undefined;
      if (!current?.payloadCipher || !["ready", "leased"].includes(current.status)) return null;
      if (Date.parse(current.dispatchDeadlineAt) <= now || current.attempts >= MAX_ATTEMPTS) {
        tx.set(ref, { ...current, status: "failed", payloadCipher: "", leaseId: "", leaseUntil: "" });
        return null;
      }
      if (current.status === "leased" && Date.parse(current.leaseUntil || "") > now) return null;
      if (Date.parse(current.nextAttemptAt) > now) return null;
      tx.set(ref, { ...current, status: "leased", leaseId, leaseUntil: new Date(now + CLAIM_MS).toISOString(), attempts: current.attempts + 1 });
      return current.payloadCipher;
    });
    if (cipher) results.push({ ...JSON.parse(decrypt(cipher)) as Envelope, leaseId });
  }
  return results;
}

export async function settleInteractionIngress(id: string, leaseId: string, success: boolean, permanent = false, now = Date.now()) {
  if (!ID.test(id) || !/^[0-9a-f-]{36}$/.test(leaseId)) return false;
  const ref = getFirebaseAdminDb().collection(COLLECTION).doc(id);
  return getFirebaseAdminDb().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as Receipt | undefined;
    if (!current || current.status !== "leased" || current.leaseId !== leaseId || Date.parse(current.leaseUntil || "") <= now) return false;
    const failed = permanent || current.attempts >= MAX_ATTEMPTS || Date.parse(current.dispatchDeadlineAt) <= now;
    const nextStatus = success ? "dispatched" : failed ? "failed" : "ready";
    const backoff = Math.min(30_000, 750 * 2 ** Math.min(current.attempts, 5));
    tx.set(ref, {
      ...current, status: nextStatus, payloadCipher: nextStatus === "ready" ? current.payloadCipher : "",
      leaseId: "", leaseUntil: "", settledAt: success ? new Date(now).toISOString() : current.settledAt,
      nextAttemptAt: new Date(now + backoff).toISOString(),
    });
    return true;
  });
}

export async function pruneInteractionIngress(limit = 250, now = Date.now()) {
  const collection = getFirebaseAdminDb().collection(COLLECTION);
  const time = new Date(now).toISOString();
  for (const status of ["ready", "leased"] as const) {
    const records = await collection.where("status", "==", status).limit(Math.min(limit, 150)).get();
    for (const snapshot of records.docs) {
      await getFirebaseAdminDb().runTransaction(async (tx) => {
        const ref = collection.doc(snapshot.id);
        const doc = (await tx.get(ref)).data() as Receipt | undefined;
        if (doc?.status === status && doc.dispatchDeadlineAt <= time) tx.set(ref, { ...doc, status: "failed", payloadCipher: "", leaseId: "", leaseUntil: "" });
      });
    }
  }
  const expired = await collection.where("expiresAt", "<=", time).limit(Math.min(500, limit)).get();
  await Promise.all(expired.docs.map((doc) => doc.ref.delete()));
  return expired.docs.length;
}
