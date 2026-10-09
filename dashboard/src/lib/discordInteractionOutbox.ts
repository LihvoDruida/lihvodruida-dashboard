import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";

// Interaction tokens are short lived. The outbox retains delivery state longer
// than the delivery window to prevent replay of already executed actions.
const COLLECTION = "discordInteractionClaims";
const REPLAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_MS = 14 * 60 * 1000;
const LEASE_MS = 90_000;
const MAX_ATTEMPTS = 8;
const MAX_RESULT_BYTES = 128 * 1024;
const ID_PATTERN = /^\d{16,25}$/;

type Callback = { type: number; data?: Record<string, unknown> };
type RecordData = {
  claimedAt: string;
  expiresAt: string;
  deliveryExpiresAt: string;
  tokenCipher: string;
  deliveryState: "processing" | "ready" | "leased" | "delivered" | "failed";
  result?: Callback;
  attempts?: number;
  leaseId?: string;
  leaseUntil?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
};

function encryptionKey() {
  const secret = String(process.env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be configured for interaction outbox");
  return createHash("sha256").update("mistblossom:discord-interaction-outbox:v1\0").update(secret).digest();
}

function seal(token: string) {
  if (!token || token.length > 512) throw new Error("invalid interaction token");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}

function unseal(encoded: string) {
  const data = Buffer.from(encoded, "base64");
  if (data.length < 29) throw new Error("outbox token ciphertext damaged");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export async function beginInteractionOutbox(id: string, token: string, now = Date.now()) {
  if (!ID_PATTERN.test(id)) throw new Error("invalid interaction id");
  // Never change the first claim, even after delivery expires. A duplicate
  // interaction must not repeat an irreversible Discord moderation action.
  const db = getFirebaseAdminDb();
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as RecordData | undefined;
    if (current) return { claimed: false, result: current.result || null, state: current.deliveryState };
    const doc: RecordData = {
      claimedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + REPLAY_MS).toISOString(),
      deliveryExpiresAt: new Date(now + DELIVERY_MS).toISOString(),
      tokenCipher: seal(token),
      deliveryState: "processing",
      attempts: 0,
      nextAttemptAt: new Date(now).toISOString(),
    };
    tx.set(ref, doc);
    return { claimed: true, result: null, state: "processing" as const };
  });
}

export async function finishInteractionOutbox(id: string, callback: Callback, now = Date.now()) {
  const serialized = JSON.stringify(callback);
  const safeCallback: Callback = Buffer.byteLength(serialized, "utf8") <= MAX_RESULT_BYTES
    ? callback
    : { type: 4, data: { content: "⚠️ Відповідь завелика. Перевірте результат дії на сайті.", components: [] } };
  const db = getFirebaseAdminDb();
  const ref = db.collection(COLLECTION).doc(id);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as RecordData | undefined;
    if (!current || current.deliveryState !== "processing" || current.result) {
      throw new Error("outbox claim missing or already completed");
    }
    tx.set(ref, { ...current, result: safeCallback, deliveryState: "ready", nextAttemptAt: new Date(now).toISOString() });
  });
}

// Crash after the outbox claim but before its result is stored is inherently
// ambiguous: the business operation may already have happened. Never rerun it.
// Retire the abandoned claim with a warning callback instead of leaving the
// Discord client on an endless deferred response.
export async function retireStalledInteractionResults(now = Date.now()) {
  const db = getFirebaseAdminDb();
  const collection = db.collection(COLLECTION);
  const cutoff = new Date(now - 4 * 60_000).toISOString();
  const stuck = await collection.where("deliveryState", "==", "processing").limit(150).get();
  let retired = 0;
  for (const snapshot of stuck.docs) {
    const candidate = snapshot.data() as RecordData | undefined;
    if (!candidate || candidate.claimedAt > cutoff) continue;
    const completed = await db.runTransaction(async (tx) => {
      const ref = collection.doc(snapshot.id);
      const current = (await tx.get(ref)).data() as RecordData | undefined;
      if (!current || current.deliveryState !== "processing" || current.result || current.claimedAt > cutoff) return false;
      const canDeliver = Date.parse(current.deliveryExpiresAt) > now;
      tx.set(ref, {
        ...current,
        deliveryState: canDeliver ? "ready" : "failed",
        result: canDeliver ? {
          type: 4,
          data: { content: "⚠️ Підтвердження дії перервалося. Перевірте стан у панелі, перш ніж повторювати дію.", components: [] },
        } : undefined,
        tokenCipher: canDeliver ? current.tokenCipher : "",
        nextAttemptAt: new Date(now).toISOString(),
      });
      return true;
    });
    if (completed) retired++;
  }
  return retired;
}

// PostgreSQL and Firestore support chained where predicates. Keep the old
// mocked collection contract for independent unit tests that expose only a
// single filter; the transaction still validates due time before claiming.
function dueQuery<T extends { where?: (field: string, op: "<=", value: string) => T }>(query: T, field: string, now: number): T {
  return typeof query.where === "function" ? query.where(field, "<=", new Date(now).toISOString()) : query;
}

export async function leaseInteractionDeliveries(limit = 10, now = Date.now()) {
  // Resolve abandoned executions before looking for pending deliveries.
  await retireStalledInteractionResults(now);
  const db = getFirebaseAdminDb();
  const coll = db.collection(COLLECTION);
  const size = Math.min(25, Math.max(1, Math.floor(limit)));
  // Scan a bounded set of eligible statuses; individual claims are guarded by
  // transactions. No bot can deliver the same receipt concurrently.
  const [ready, leased] = await Promise.all([
    dueQuery(coll.where("deliveryState", "==", "ready"), "nextAttemptAt", now).limit(150).get(),
    dueQuery(coll.where("deliveryState", "==", "leased"), "leaseUntil", now).limit(150).get(),
  ]);
  const candidates = [...ready.docs, ...leased.docs];
  const jobs: Array<{ id: string; leaseId: string; interactionToken: string; result: Callback }> = [];
  for (const snapshot of candidates) {
    if (jobs.length >= size) break;
    const ref = coll.doc(snapshot.id);
    const leaseId = randomUUID();
    const claimed = await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as RecordData | undefined;
      if (!current?.result || !current.tokenCipher || !["ready", "leased"].includes(current.deliveryState)) return null;
      if (Date.parse(current.deliveryExpiresAt) <= now) {
        tx.set(ref, { ...current, deliveryState: "failed", tokenCipher: "", leaseId: "", leaseUntil: "" });
        return null;
      }
      if (current.deliveryState === "leased" && Date.parse(current.leaseUntil || "") > now) return null;
      if (Date.parse(current.nextAttemptAt || "") > now) return null;
      if ((current.attempts || 0) >= MAX_ATTEMPTS) {
        tx.set(ref, { ...current, deliveryState: "failed", tokenCipher: "", leaseId: "", leaseUntil: "" });
        return null;
      }
      tx.set(ref, { ...current, deliveryState: "leased", leaseId, leaseUntil: new Date(now + LEASE_MS).toISOString(), attempts: (current.attempts || 0) + 1 });
      return { result: current.result, tokenCipher: current.tokenCipher };
    });
    if (claimed) jobs.push({ id: snapshot.id, leaseId, interactionToken: unseal(claimed.tokenCipher), result: claimed.result });
  }
  return jobs;
}

export async function settleInteractionDelivery(id: string, leaseId: string, success: boolean, permanent = false, now = Date.now()) {
  if (!ID_PATTERN.test(id) || !/^[0-9a-f-]{36}$/.test(leaseId)) return false;
  const db = getFirebaseAdminDb();
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as RecordData | undefined;
    if (!current || current.deliveryState !== "leased" || current.leaseId !== leaseId || Date.parse(current.leaseUntil || "") <= now) return false;
    if (success) {
      // Discard webhook token after successful delivery; retain the response
      // fingerprint/result to handle repeated signed requests deterministically.
      tx.set(ref, { ...current, deliveryState: "delivered", tokenCipher: "", leaseId: "", leaseUntil: "", deliveredAt: new Date(now).toISOString() });
    } else {
      const failed = permanent || (current.attempts || 0) >= MAX_ATTEMPTS || Date.parse(current.deliveryExpiresAt) <= now;
      const backoff = Math.min(60_000, 1_000 * 2 ** Math.min(current.attempts || 1, 6));
      tx.set(ref, { ...current, deliveryState: failed ? "failed" : "ready", tokenCipher: failed ? "" : current.tokenCipher, leaseId: "", leaseUntil: "", nextAttemptAt: new Date(now + backoff).toISOString() });
    }
    return true;
  });
}

export async function pruneInteractionOutbox(limit = 250) {
  const db = getFirebaseAdminDb();
  const now = new Date().toISOString();
  // Scrub expired webhook credentials even while retaining the claim for
  // replay protection. This also retires unfinished work after 14 minutes.
  const collection = db.collection(COLLECTION);
  for (const state of ["processing", "ready", "leased"] as const) {
    const snapshots = await collection.where("deliveryState", "==", state).limit(Math.min(150, Math.max(1, limit))).get();
    for (const snapshot of snapshots.docs) {
      const ref = collection.doc(snapshot.id);
      await db.runTransaction(async (tx) => {
        const record = (await tx.get(ref)).data() as RecordData | undefined;
        if (!record || record.deliveryState !== state || record.deliveryExpiresAt > now) return;
        tx.set(ref, { ...record, tokenCipher: "", deliveryState: "failed", leaseId: "", leaseUntil: "" });
      });
    }
  }
  const expired = await db.collection(COLLECTION).where("expiresAt", "<=", new Date().toISOString()).limit(Math.min(500, Math.max(1, limit))).get();
  await Promise.all(expired.docs.map((doc) => doc.ref.delete()));
  return expired.docs.length;
}
