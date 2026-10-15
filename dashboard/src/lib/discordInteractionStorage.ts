import "server-only";

import {
  documentStoreMode,
  getDocumentDb,
} from "@/lib/documentDb";

export type DiscordInteractionMessageRef = {
  channelId?: string | null;
  messageId?: string | null;
};

export type DiscordInteractionDocument = {
  id: string;
  data: Record<string, unknown>;
  source: "primary-id" | "primary-message" | "primary-query";
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

export function assertDiscordInteractionStore() {
  const mode = documentStoreMode();
  if (mode !== "postgres") {
    throw new Error(
      `Discord interaction storage mismatch: expected PostgreSQL, active store is ${mode}. ` +
      "Check the Discord Interactions Endpoint URL and DATABASE_URL in the runtime receiving the click.",
    );
  }
  return mode;
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

type SnapshotLike = {
  id?: string;
  exists?: boolean;
  data?: () => Record<string, unknown> | undefined;
};

type QuerySnapshotLike = {
  docs?: SnapshotLike[];
};

async function authoritativeGet(ref: any, label: string): Promise<SnapshotLike> {
  return authoritativeRead<SnapshotLike>(
    async () => (await ref.get()) as SnapshotLike,
    label,
  );
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

  const docs = Array.isArray((snapshot as QuerySnapshotLike)?.docs)
    ? ((snapshot as QuerySnapshotLike).docs || [])
    : [];
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


function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storedDiscordRef(data: Record<string, unknown>) {
  const discord = nestedRecord(data.discord) || nestedRecord(data.discordMessage) || nestedRecord(data.message);
  const channelId = cleanText(
    data.channelId || data.channel_id || data.discordChannelId || data.discord_channel_id || discord?.channelId || discord?.channel_id,
    32,
  );
  const messageId = cleanText(
    data.messageId || data.message_id || data.discordMessageId || data.discord_message_id || discord?.messageId || discord?.message_id || discord?.id,
    32,
  );
  const messageUrl = cleanText(data.messageUrl || data.message_url || data.discordMessageUrl || data.discord_message_url, 2048);
  return { channelId, messageId, messageUrl };
}

function embeddedResourceIds(data: Record<string, unknown>) {
  return [
    data.id,
    data.resourceId,
    data.resource_id,
    data.raidId,
    data.raid_id,
    data.pollId,
    data.poll_id,
    data.rosterId,
    data.roster_id,
  ]
    .map((value) => cleanText(value, 100))
    .filter(Boolean);
}

function messageUrlMatches(url: string, ref: { channelId: string; messageId: string }) {
  if (!url) return false;
  return url.includes(`/channels/`) && url.includes(`/${ref.channelId}/${ref.messageId}`);
}

/**
 * Compatibility fallback for data written by older adapters/migrations.
 * It intentionally runs only after the indexed exact lookup missed, so the
 * normal interaction path stays O(1). Resource collections are small, and a
 * bounded scan is preferable to reporting a live Discord button as deleted
 * just because an older document used message_id/discordMessageId/nested keys.
 */
async function scanStoreForResource(
  db: any,
  collection: string,
  resourceId: string,
  messageRef?: DiscordInteractionMessageRef | null,
) {
  const ref = cleanMessageRef(messageRef);
  const snapshot = await authoritativeRead<QuerySnapshotLike>(
    async () => (await db.collection(collection).limit(500).get()) as QuerySnapshotLike,
    `${collection}:compat-scan`,
  );
  const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];

  for (const doc of docs) {
    const id = cleanText(doc?.id, 100);
    const data = (doc?.data?.() || {}) as Record<string, unknown>;
    if (!id) continue;

    if (embeddedResourceIds(data).includes(resourceId)) {
      return { id, data, matchedBy: "embedded-id" as const };
    }

    if (ref) {
      const stored = storedDiscordRef(data);
      const exactPair = stored.channelId === ref.channelId && stored.messageId === ref.messageId;
      const idOnly = stored.messageId === ref.messageId && (!stored.channelId || stored.channelId === ref.channelId);
      if (exactPair || idOnly || messageUrlMatches(stored.messageUrl, ref)) {
        return { id, data, matchedBy: "message-scan" as const };
      }
    }
  }
  return null;
}

export async function resolveDiscordInteractionDocument(params: {
  collection: string;
  resourceId: string;
  messageRef?: DiscordInteractionMessageRef | null;
}): Promise<DiscordInteractionDocument | null> {
  const collection = cleanText(params.collection, 160);
  const resourceId = cleanText(params.resourceId, 100);
  if (!collection || !resourceId) return null;

  assertDiscordInteractionStore();
  const primary = getDocumentDb();
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

  const primaryScan = await scanStoreForResource(primary, collection, resourceId, params.messageRef);
  if (primaryScan?.id) {
    return {
      id: primaryScan.id,
      data: primaryScan.data,
      source: "primary-query",
      recovered: primaryScan.id !== resourceId || primaryScan.matchedBy !== "embedded-id",
    };
  }

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
      const docs = Array.isArray((snapshot as QuerySnapshotLike)?.docs)
        ? ((snapshot as QuerySnapshotLike).docs || [])
        : [];
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

  const primary = getDocumentDb();
  const primaryMatch = await findInStore(primary);
  if (primaryMatch?.id) {
    return {
      id: primaryMatch.id,
      data: primaryMatch.data,
      source: primaryMatch.matchedBy === "id" ? "primary-id" : "primary-query",
      recovered: primaryMatch.id !== stableProfileId || primaryMatch.matchedBy !== "id",
    };
  }

  return null;
}
