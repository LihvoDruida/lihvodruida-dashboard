import "server-only";

import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";

// A shared, transactional replay guard: the bot's bounded in-memory cache is
// only an early optimization. This is the authoritative claim across replicas.
const COLLECTION = "discordInteractionClaims";
const REPLAY_TTL_MS = 10 * 60 * 1000;

export async function claimVerifiedDiscordInteraction(id: string, now = Date.now()): Promise<boolean> {
  if (!/^\d{16,25}$/.test(id)) return false;
  const ref = getFirebaseAdminDb().collection(COLLECTION).doc(id);
  return getFirebaseAdminDb().runTransaction(async (tx) => {
    const existing = (await tx.get(ref)).data() as { expiresAt?: string } | undefined;
    // Never reuse a claim during the lifetime of the Discord signed timestamp.
    if (existing) return false;
    tx.set(ref, { claimedAt: new Date(now).toISOString(), expiresAt: new Date(now + REPLAY_TTL_MS).toISOString() });
    return true;
  });
}

// Can be run from an authenticated scheduled maintenance task. Never clean
// in the hot interaction path (where the first response must be fast).
export async function pruneDiscordInteractionClaims(limit = 250): Promise<number> {
  const db = getFirebaseAdminDb();
  const expired = await db.collection(COLLECTION).where("expiresAt", "<=", new Date().toISOString()).limit(Math.min(500, Math.max(1, limit))).get();
  await Promise.all(expired.docs.map((doc) => doc.ref.delete()));
  return expired.docs.length;
}
