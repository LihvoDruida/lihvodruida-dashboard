import "server-only";

import { documentStoreMode, getLegacyFirestoreAdminDb, hasFirebaseCredentials } from "@/lib/firebaseAdmin";
import { pgQuery } from "@/lib/db/pgPool";
import { clearRuntimeCachedValuesByPrefix } from "@/lib/runtimeResilience";
import { clearCharacterProfileLinksCache, syncCharacterProfileLinksForProfileId } from "@/lib/profiles";

const COLLECTION = "dashboardProfiles";
const PAGE_SIZE = 250;

export type LegacyProfileImportStrategy = "safe" | "firestore-priority";

export type LegacyProfileImportResult = {
  dryRun: boolean;
  strategy: LegacyProfileImportStrategy;
  source: "firestore";
  target: "postgres";
  sourceProfiles: number;
  candidateProfiles: number;
  ownerSkipped: number;
  created: number;
  updated: number;
  unchanged: number;
  changed: number;
  duplicateProviderUsers: number;
  characterLinkRepairs: number;
  characterLinkRepairFailed: number;
  protectedOwnerDiscordId: string | null;
  protectedOwnerProfileId: string | null;
  samples: Array<{
    profileId: string;
    providerUserId: string | null;
    displayName: string | null;
    action: "create" | "update";
  }>;
};

type ImportParams = {
  dryRun?: boolean;
  strategy?: LegacyProfileImportStrategy;
  limit?: number;
  protectedOwnerDiscordId?: string | null;
  protectedOwnerProfileId?: string | null;
};

type PlainObject = Record<string, unknown>;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Firestore Timestamp / DocumentReference / GeoPoint are not JSON values.
 * Convert legacy documents before they reach the PostgreSQL JSONB store.
 */
function toPlainJson(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");

  const candidate = value as Record<string, unknown> & {
    toDate?: () => Date;
    seconds?: number;
    path?: string;
    id?: string;
    latitude?: number;
    longitude?: number;
  };

  if (typeof candidate.toDate === "function") {
    const date = candidate.toDate();
    if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
  }
  if (typeof candidate.path === "string" && typeof candidate.id === "string") {
    return candidate.path;
  }
  if (typeof candidate.latitude === "number" && typeof candidate.longitude === "number") {
    return { latitude: candidate.latitude, longitude: candidate.longitude };
  }
  if (Array.isArray(value)) return value.map((item) => toPlainJson(item));

  const out: PlainObject = {};
  for (const [key, item] of Object.entries(candidate)) {
    const next = toPlainJson(item);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

/** Deep merge where overlay wins. Arrays are intentionally atomic. */
function deepMerge(baseInput: PlainObject, overlayInput: PlainObject): PlainObject {
  const result: PlainObject = { ...baseInput };
  for (const [key, overlay] of Object.entries(overlayInput)) {
    const base = result[key];
    if (isPlainObject(base) && isPlainObject(overlay)) {
      result[key] = deepMerge(base, overlay);
    } else {
      result[key] = overlay;
    }
  }
  return result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  const out: PlainObject = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

function sameDocument(left: PlainObject, right: PlainObject) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function profileProviderUserId(data: PlainObject) {
  return cleanText(data.providerUserId || data.discordUserId || data.discordId) || null;
}

function isProtectedOwnerProfile(
  profileId: string,
  data: PlainObject,
  ownerDiscordId: string,
  ownerProfileId: string,
) {
  if (ownerProfileId && profileId === ownerProfileId) return true;
  if (!ownerDiscordId) return false;
  return [data.providerUserId, data.discordUserId, data.discordId]
    .some((value) => cleanText(value) === ownerDiscordId);
}

async function readTargetProfiles(profileIds: string[]) {
  if (!profileIds.length) return new Map<string, PlainObject>();
  const result = await pgQuery<{ doc_id: string; data: PlainObject }>(
    `SELECT doc_id, data
       FROM documents
      WHERE collection = $1
        AND doc_id = ANY($2::text[])`,
    [COLLECTION, profileIds],
  );
  return new Map(result.rows.map((row) => [row.doc_id, row.data || {}]));
}

async function writeTargetProfiles(rows: Array<{ profileId: string; data: PlainObject }>) {
  if (!rows.length) return;
  await pgQuery(
    `INSERT INTO documents (collection, doc_id, data)
     SELECT $1::text, UNNEST($2::text[]), UNNEST($3::jsonb[])
     ON CONFLICT (collection, doc_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [
      COLLECTION,
      rows.map((row) => row.profileId),
      rows.map((row) => JSON.stringify(row.data)),
    ],
  );
}

async function repairCharacterLinks(profileIds: string[]) {
  let repaired = 0;
  let failed = 0;
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < profileIds.length) {
      const index = cursor++;
      const profileId = profileIds[index];
      try {
        await syncCharacterProfileLinksForProfileId(profileId);
        repaired += 1;
      } catch {
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, profileIds.length) }, () => worker()));
  return { repaired, failed };
}

export function legacyProfileImportAvailability() {
  const storeMode = documentStoreMode();
  const sourceConfigured = hasFirebaseCredentials();
  return {
    sourceConfigured,
    targetMode: storeMode,
    ready: sourceConfigured && storeMode === "postgres",
    reason: !sourceConfigured
      ? "Не задані Firebase credentials для читання старого Firestore."
      : storeMode !== "postgres"
        ? "Цільове сховище має бути PostgreSQL; імпорт Firestore → Firestore заблоковано."
        : null,
  } as const;
}

export async function importLegacyDashboardProfiles(params: ImportParams = {}): Promise<LegacyProfileImportResult> {
  const availability = legacyProfileImportAvailability();
  if (!availability.ready) throw new Error(availability.reason || "Імпорт Firestore недоступний.");

  const ownerDiscordId = cleanText(params.protectedOwnerDiscordId);
  const ownerProfileId = cleanText(params.protectedOwnerProfileId);
  if (!ownerDiscordId && !ownerProfileId) {
    throw new Error("Імпорт заблоковано: не вдалося визначити профіль власника для обов’язкового виключення.");
  }

  const dryRun = params.dryRun !== false;
  const strategy: LegacyProfileImportStrategy = params.strategy === "firestore-priority"
    ? "firestore-priority"
    : "safe";
  const rawLimit = Number(params.limit || 0);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50_000, Math.floor(rawLimit)) : 50_000;

  const firestore = getLegacyFirestoreAdminDb();
  // Dynamic require keeps firebase-admin/firestore out of PostgreSQL-only cold paths.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FieldPath } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
  const baseQuery = firestore.collection(COLLECTION).orderBy(FieldPath.documentId());

  let cursor: any = null;
  let sourceProfiles = 0;
  let candidateProfiles = 0;
  let ownerSkipped = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const changedProfileIds: string[] = [];
  const samples: LegacyProfileImportResult["samples"] = [];
  const providerCounts = new Map<string, number>();

  while (sourceProfiles < limit) {
    const remaining = limit - sourceProfiles;
    let query: any = baseQuery.limit(Math.min(PAGE_SIZE, remaining));
    if (cursor) query = baseQuery.startAfter(cursor).limit(Math.min(PAGE_SIZE, remaining));
    const snapshot = await query.get();
    if (snapshot.empty) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
    sourceProfiles += snapshot.docs.length;

    const candidates: Array<{ profileId: string; data: PlainObject }> = [];
    for (const doc of snapshot.docs) {
      const plain = toPlainJson(doc.data() || {});
      const data = isPlainObject(plain) ? plain : {};
      if (isProtectedOwnerProfile(doc.id, data, ownerDiscordId, ownerProfileId)) {
        ownerSkipped += 1;
        continue;
      }
      const providerUserId = profileProviderUserId(data);
      if (providerUserId) providerCounts.set(providerUserId, (providerCounts.get(providerUserId) || 0) + 1);
      candidates.push({ profileId: doc.id, data });
    }

    candidateProfiles += candidates.length;
    const targetById = await readTargetProfiles(candidates.map((item) => item.profileId));
    const writes: Array<{ profileId: string; data: PlainObject }> = [];

    for (const item of candidates) {
      const current = targetById.get(item.profileId);
      const next = !current
        ? item.data
        : strategy === "firestore-priority"
          ? deepMerge(current, item.data)
          : deepMerge(item.data, current);

      if (!current) {
        created += 1;
        writes.push({ profileId: item.profileId, data: next });
        changedProfileIds.push(item.profileId);
        if (samples.length < 12) samples.push({
          profileId: item.profileId,
          providerUserId: profileProviderUserId(item.data),
          displayName: cleanText(item.data.displayName || item.data.preferredName) || null,
          action: "create",
        });
      } else if (!sameDocument(current, next)) {
        updated += 1;
        writes.push({ profileId: item.profileId, data: next });
        changedProfileIds.push(item.profileId);
        if (samples.length < 12) samples.push({
          profileId: item.profileId,
          providerUserId: profileProviderUserId(item.data),
          displayName: cleanText(item.data.displayName || item.data.preferredName) || null,
          action: "update",
        });
      } else {
        unchanged += 1;
      }
    }

    if (!dryRun && writes.length) await writeTargetProfiles(writes);
    if (snapshot.docs.length < Math.min(PAGE_SIZE, remaining)) break;
  }

  let characterLinkRepairs = 0;
  let characterLinkRepairFailed = 0;
  if (!dryRun && changedProfileIds.length) {
    clearRuntimeCachedValuesByPrefix("profile:");
    clearRuntimeCachedValuesByPrefix("profiles:");
    clearCharacterProfileLinksCache();
    const repair = await repairCharacterLinks(changedProfileIds);
    characterLinkRepairs = repair.repaired;
    characterLinkRepairFailed = repair.failed;
  }

  const duplicateProviderUsers = Array.from(providerCounts.values()).filter((count) => count > 1).length;
  return {
    dryRun,
    strategy,
    source: "firestore",
    target: "postgres",
    sourceProfiles,
    candidateProfiles,
    ownerSkipped,
    created,
    updated,
    unchanged,
    changed: created + updated,
    duplicateProviderUsers,
    characterLinkRepairs,
    characterLinkRepairFailed,
    protectedOwnerDiscordId: ownerDiscordId || null,
    protectedOwnerProfileId: ownerProfileId || null,
    samples,
  };
}
