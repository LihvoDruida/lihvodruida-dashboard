import "server-only";

import { createHash } from "node:crypto";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";

const COLLECTION = "authRevokedSessions";

function tokenDigest(token: string): string {
  // Never persist or log bearer session tokens, even in the revocation list.
  return createHash("sha256").update(token).digest("hex");
}

export async function isSessionTokenRevoked(token: string): Promise<boolean> {
  const doc = await getFirebaseAdminDb().collection(COLLECTION).doc(tokenDigest(token)).get();
  return doc.exists;
}

export async function revokeSessionToken(token: string, maxAgeSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  await getFirebaseAdminDb().collection(COLLECTION).doc(tokenDigest(token)).set({
    revokedAt: new Date().toISOString(),
    expiresAt,
  });
}

export async function pruneRevokedSessions(limit = 250): Promise<number> {
  const db = getFirebaseAdminDb();
  const expired = await db.collection(COLLECTION).where("expiresAt", "<=", new Date().toISOString()).limit(Math.min(500, Math.max(1, limit))).get();
  await Promise.all(expired.docs.map((doc) => doc.ref.delete()));
  return expired.docs.length;
}
