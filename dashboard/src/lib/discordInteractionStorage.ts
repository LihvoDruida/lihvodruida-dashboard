import "server-only";

import {
  documentStoreMode,
  getFirebaseAdminDb,
  getLegacyFirestoreAdminDb,
  hasFirebaseCredentials,
} from "@/lib/firebaseAdmin";

export type DiscordInteractionMessageRef = {
  channelId?: string | null;
  messageId?: string | null;
};

export type DiscordInteractionDocument = {
  id: string;
  data: Record<string, unknown>;
  source: "primary-id" | "primary-message" | "primary-query" | "legacy-id" | "legacy-message" | "legacy-query";
  recovered: boolean;
};

function cleanText(value: unknown, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function cleanMessageRef(ref?: DiscordInteractionMessageRef | null) {
  const channelId = cleanText(ref?.channelId, 32);
  const messageId = cleanText(ref?.messageId, 32);
  return channelId && messageId ? { channelId, messageId } : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Discord interactions are user-triggered mutations, not background reads.
 * They must not inherit a stale/null result from the page cache or a broad
 * circuit-breaker. A local PostgreSQL connection can occasionally need a
 * moment after deploy/restart, so do a tiny bounded retry here instead.
 */
async function authoritativeRead<T>(loader: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(120 * (attempt + 1));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${label}: authoritative read failed`);
}

async function authoritativeGet(ref: any, label: string) {
  return authoritativeRead(() => ref.get(), label);
}

async function queryByMessageRef(db: any, collection: string, messageRef: DiscordInteractionMessageRef | null | undefined) {
  const ref = cleanMessageRef(messageRef);
  if (!ref) return null;

  const snapshot = await authoritativeRead(
    () => db
      .collection(collection)
      .where("messageId", "==", ref.messageId)
      .where("channelId", "==", ref.channelId)
      .limit(2)
      .get(),
    `${collection}:message:${ref.channelId}/${ref.messageId}`,
  );

  const docs = Array.isArray((snapshot as any)?.docs) ? (snapshot as any).docs : [];
  if (!docs.length) return null;
  if (docs.length > 1) {
    throw new Error(`${collection}: Discord message maps to more than one document`);
  }
  const doc = docs[0];
  return {
    id: cleanText(doc?.id, 100),
    data: (doc?.data?.() || {}) as Record<string, unknown>,
  };
}

/** Convert Firestore values into JSON-safe values accepted by the PostgreSQL document adapter. */
function toPlainJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (typeof value !== "object") return value;

  const item = value as Record<string, unknown> & {
    toDate?: () => Date;
    seconds?: number;
    path?: string;
    id?: string;
  };

  if (typeof item.toDate === "function" && typeof item.seconds === "number") {
    try {
      return item.toDate().toISOString();
    } catch {
      // Fall through to the generic object conversion.
    }
  }
  if (typeof item.path === "string" && typeof item.id === "string") return item.path;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(item)) {
    const normalized = toPlainJson(child);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

async function backfillLegacyDocument(collection: string, id: string, data: Record<string, unknown>) {
  const primary = getFirebaseAdminDb();
  const normalized = toPlainJson(data) as Record<string, unknown>;
  await primary.collection(collection).doc(id).set(normalized, { merge: true });
  return normalized;
}

/**
 * Resolve the resource behind a Discord button.
 *
 * Order is deliberate:
 *   1. exact ID in the active store;
 *   2. same Discord message in the active store (republished/recreated item);
 *   3. exact ID in legacy Firestore, then copy it into PostgreSQL;
 *   4. same Discord message in legacy Firestore, then copy it into PostgreSQL.
 *
 * This makes already-published Discord messages survive both transient cache
 * failures and the Firestore -> PostgreSQL migration. Missing really means
 * missing only after every authoritative source has been checked.
 */
export async function resolveDiscordInteractionDocument(params: {
  collection: string;
  resourceId: string;
  messageRef?: DiscordInteractionMessageRef | null;
}): Promise<DiscordInteractionDocument | null> {
  const collection = cleanText(params.collection, 160);
  const resourceId = cleanText(params.resourceId, 100);
  if (!collection || !resourceId) return null;

  const primary = getFirebaseAdminDb();
  const direct = await authoritativeGet(
    primary.collection(collection).doc(resourceId),
    `${collection}/${resourceId}`,
  );
  if (direct?.exists) {
    return {
      id: resourceId,
      data: (direct.data?.() || {}) as Record<string, unknown>,
      source: "primary-id",
      recovered: false,
    };
  }

  const byMessage = await queryByMessageRef(primary, collection, params.messageRef);
  if (byMessage?.id) {
    return {
      id: byMessage.id,
      data: byMessage.data,
      source: "primary-message",
      recovered: byMessage.id !== resourceId,
    };
  }

  // During/after migration old Discord messages may still reference documents
  // that exist only in Firestore. Read-through is intentionally limited to
  // interaction misses; normal page traffic remains PostgreSQL-only.
  if (documentStoreMode() !== "postgres" || !hasFirebaseCredentials()) {
    console.warn("[discordInteractionStorage] resource missing from active store", {
      collection,
      resourceId,
      channelId: cleanMessageRef(params.messageRef)?.channelId || null,
      messageId: cleanMessageRef(params.messageRef)?.messageId || null,
      storeMode: documentStoreMode(),
      legacyFirestoreAvailable: hasFirebaseCredentials(),
    });
    return null;
  }

  const legacy = getLegacyFirestoreAdminDb();
  const legacyDirect = await authoritativeGet(
    legacy.collection(collection).doc(resourceId),
    `legacy:${collection}/${resourceId}`,
  );
  if (legacyDirect?.exists) {
    const raw = (legacyDirect.data?.() || {}) as Record<string, unknown>;
    const data = await backfillLegacyDocument(collection, resourceId, raw);
    return { id: resourceId, data, source: "legacy-id", recovered: true };
  }

  const legacyByMessage = await queryByMessageRef(legacy, collection, params.messageRef);
  if (legacyByMessage?.id) {
    const data = await backfillLegacyDocument(collection, legacyByMessage.id, legacyByMessage.data);
    return {
      id: legacyByMessage.id,
      data,
      source: "legacy-message",
      recovered: true,
    };
  }

  console.warn("[discordInteractionStorage] resource missing from active and legacy stores", {
    collection,
    resourceId,
    channelId: cleanMessageRef(params.messageRef)?.channelId || null,
    messageId: cleanMessageRef(params.messageRef)?.messageId || null,
  });
  return null;
}

export async function resolveDiscordInteractionProfileDocument(params: {
  stableProfileId?: string | null;
  discordUserId: string;
}): Promise<DiscordInteractionDocument | null> {
  const stableProfileId = cleanText(params.stableProfileId, 100);
  const discordUserId = cleanText(params.discordUserId, 32);
  if (!/^\d{16,25}$/.test(discordUserId)) return null;

  async function findInStore(db: any) {
    if (stableProfileId) {
      const direct = await authoritativeGet(
        db.collection("dashboardProfiles").doc(stableProfileId),
        `dashboardProfiles/${stableProfileId}`,
      );
      if (direct?.exists) {
        return {
          id: stableProfileId,
          data: (direct.data?.() || {}) as Record<string, unknown>,
          matchedBy: "id" as const,
        };
      }
    }

    for (const field of ["providerUserId", "discordId", "discordUserId"]) {
      const snapshot = await authoritativeRead(
        () => db
          .collection("dashboardProfiles")
          .where(field, "==", discordUserId)
          .limit(5)
          .get(),
        `dashboardProfiles:${field}:${discordUserId}`,
      );
      const docs = Array.isArray((snapshot as any)?.docs) ? (snapshot as any).docs : [];
      for (const doc of docs) {
        const data = (doc?.data?.() || {}) as Record<string, unknown>;
        const provider = cleanText(data.provider, 32);
        const providerUserId = cleanText(data.providerUserId, 32);
        const directDiscordId = cleanText(data.discordId || data.discordUserId, 32);
        if (providerUserId === discordUserId || directDiscordId === discordUserId || provider === "discord") {
          return { id: cleanText(doc?.id, 100), data, matchedBy: field as string };
        }
      }
    }
    return null;
  }

  const primary = getFirebaseAdminDb();
  const primaryMatch = await findInStore(primary);
  if (primaryMatch?.id) {
    return {
      id: primaryMatch.id,
      data: primaryMatch.data,
      source: primaryMatch.matchedBy === "id" ? "primary-id" : "primary-query",
      recovered: primaryMatch.id !== stableProfileId || primaryMatch.matchedBy !== "id",
    };
  }

  if (documentStoreMode() !== "postgres" || !hasFirebaseCredentials()) {
    console.warn("[discordInteractionStorage] profile missing from active store", {
      discordUserId,
      stableProfileId: stableProfileId || null,
      storeMode: documentStoreMode(),
      legacyFirestoreAvailable: hasFirebaseCredentials(),
    });
    return null;
  }

  const legacy = getLegacyFirestoreAdminDb();
  const legacyMatch = await findInStore(legacy);
  if (!legacyMatch?.id) {
    console.warn("[discordInteractionStorage] profile missing from active and legacy stores", {
      discordUserId,
      stableProfileId: stableProfileId || null,
    });
    return null;
  }
  const data = await backfillLegacyDocument("dashboardProfiles", legacyMatch.id, legacyMatch.data);
  return {
    id: legacyMatch.id,
    data,
    source: legacyMatch.matchedBy === "id" ? "legacy-id" : "legacy-query",
    recovered: true,
  };
}
