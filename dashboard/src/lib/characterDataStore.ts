import { createHash } from "node:crypto";
import { FieldValue } from "@/lib/db/firestoreCompat";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { resilientRead, resilientWrite } from "@/lib/runtimeResilience";
import { currentSeasonRaidProgress, primaryCurrentRaidProgress, type CharacterRaidProgressLike } from "@/lib/characterRaidProgress";
import type { RaidSeasonSnapshot } from "@/lib/raidSeasonResolver";

export const GUILD_CHARACTER_DATA_COLLECTION = "guildCharacterData";
export const EXTERNAL_CHARACTER_DATA_COLLECTION = "externalCharacterData";
export const CHARACTER_DATA_META_COLLECTION = "characterDataMeta";
const RAID_SEASON_META_DOCUMENT = "raidSeason";

export type CanonicalCharacterData = {
  key: string;
  scope: "guild" | "external";
  region: string;
  name: string;
  normalizedName?: string | null;
  realmSlug: string;
  realmName: string;
  className?: string | null;
  specName?: string | null;
  activeSpecId?: number | null;
  role?: string | null;
  raceName?: string | null;
  genderName?: string | null;
  faction?: string | null;
  guildName?: string | null;
  guildRealmSlug?: string | null;
  guildRank?: number | null;
  verifiedGuild: boolean;
  itemLevel?: number | null;
  avatarUrl?: string | null;
  renderUrl?: string | null;
  mediaUrl?: string | null;
  profileUrl?: string | null;
  scores?: Record<string, number>;
  scoreColors?: Record<string, string>;
  raiderIo?: Record<string, unknown> | null;
  raidProgression: CharacterRaidProgressLike[];
  currentSeasonRaidProgression: CharacterRaidProgressLike[];
  primaryRaidProgress: CharacterRaidProgressLike | null;
  currentSeasonId?: string | null;
  currentSeasonSlug?: string | null;
  battleNetUpdatedAt?: string | null;
  raiderIoUpdatedAt?: string | null;
  updatedAt: string;
};

type GuildMemberLike = {
  key: string;
  region: string;
  name: string;
  realmSlug: string;
  realmName: string;
  className: string;
  specName: string;
  role: string;
  raceName: string;
  gender: string;
  faction: string;
  rank: number | null;
  itemLevel: number;
  avatarUrl: string | null;
  profileUrl: string | null;
  scores: Record<string, number>;
  scoreColors: Record<string, string> | Partial<Record<string, string>>;
  raidProgression: CharacterRaidProgressLike[];
  battleNetUpdatedAt?: string | null;
  raiderIoUpdatedAt?: string | null;
};

function docId(key: string) {
  return createHash("sha256").update(String(key || "").trim().toLowerCase()).digest("hex");
}

function cleanRecord(raw: unknown): CanonicalCharacterData | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, any>;
  const key = String(item.key || "").trim();
  const name = String(item.name || "").trim();
  const realmSlug = String(item.realmSlug || "").trim();
  if (!key || !name || !realmSlug) return null;
  return item as CanonicalCharacterData;
}

function canonicalDoc(scope: "guild" | "external", key: string) {
  return getFirebaseAdminDb()
    .collection(scope === "guild" ? GUILD_CHARACTER_DATA_COLLECTION : EXTERNAL_CHARACTER_DATA_COLLECTION)
    .doc(docId(key));
}

export function canonicalGuildCharacter(member: GuildMemberLike, snapshot: RaidSeasonSnapshot | null | undefined): CanonicalCharacterData {
  const raids = Array.isArray(member.raidProgression) ? member.raidProgression : [];
  return {
    key: member.key,
    scope: "guild",
    region: member.region,
    name: member.name,
    normalizedName: member.name.toLowerCase(),
    realmSlug: member.realmSlug,
    realmName: member.realmName,
    className: member.className,
    specName: member.specName,
    role: member.role,
    raceName: member.raceName,
    genderName: member.gender,
    faction: member.faction,
    guildRank: member.rank,
    verifiedGuild: true,
    itemLevel: member.itemLevel || null,
    avatarUrl: member.avatarUrl,
    profileUrl: member.profileUrl,
    scores: member.scores,
    scoreColors: member.scoreColors as Record<string, string>,
    raiderIo: {
      profileUrl: member.profileUrl,
      thumbnailUrl: member.avatarUrl,
      itemLevelEquipped: member.itemLevel || null,
      currentScore: member.scores?.all || 0,
      currentScores: {
        all: { score: member.scores?.all || 0, color: member.scoreColors?.all || null },
        dps: { score: member.scores?.dps || 0, color: member.scoreColors?.dps || null },
        healer: { score: member.scores?.healer || 0, color: member.scoreColors?.healer || null },
        tank: { score: member.scores?.tank || 0, color: member.scoreColors?.tank || null },
      },
      updatedAt: member.raiderIoUpdatedAt || new Date().toISOString(),
    },
    raidProgression: raids,
    currentSeasonRaidProgression: currentSeasonRaidProgress(raids, snapshot),
    primaryRaidProgress: primaryCurrentRaidProgress(raids, snapshot),
    currentSeasonId: snapshot?.currentSeasonId || null,
    currentSeasonSlug: snapshot?.currentSeasonSlug || null,
    battleNetUpdatedAt: member.battleNetUpdatedAt || null,
    raiderIoUpdatedAt: member.raiderIoUpdatedAt || null,
    updatedAt: new Date().toISOString(),
  };
}


export async function writeCharacterRaidSeasonSnapshot(snapshot: RaidSeasonSnapshot | null | undefined) {
  if (!hasFirebaseProfileConfig() || !snapshot) return false;
  return resilientWrite(
    "canonical-raid-season-write",
    async () => {
      await getFirebaseAdminDb().collection(CHARACTER_DATA_META_COLLECTION).doc(RAID_SEASON_META_DOCUMENT).set(
        { snapshot, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return true;
    },
    { circuitKey: "canonical-raid-season-write", timeoutMs: 3_000, fallback: () => false, logEvent: "character_data.raid_season_write_failed" },
  );
}

export async function readCharacterRaidSeasonSnapshot() {
  if (!hasFirebaseProfileConfig()) return null;
  return resilientRead<RaidSeasonSnapshot | null>(
    "canonical-raid-season",
    async () => {
      const doc = await getFirebaseAdminDb().collection(CHARACTER_DATA_META_COLLECTION).doc(RAID_SEASON_META_DOCUMENT).get();
      const data = doc.exists ? doc.data() || {} : {};
      return data.snapshot && typeof data.snapshot === "object" ? data.snapshot as RaidSeasonSnapshot : null;
    },
    { ttlMs: 60_000, timeoutMs: 2_000, fallback: () => null, logEvent: "character_data.raid_season_read_failed" },
  );
}

export async function writeGuildCharacterDataRecords(
  members: GuildMemberLike[],
  snapshot: RaidSeasonSnapshot | null | undefined,
  changedKeys?: Set<string>,
  replaceAll = false,
) {
  if (!hasFirebaseProfileConfig() || !members.length) return 0;
  const targets = changedKeys instanceof Set
    ? members.filter((member) => changedKeys.has(member.key))
    : members;
  if (!targets.length) return 0;

  return resilientWrite(
    "canonical-guild-character-write",
    async () => {
      let written = 0;
      if (replaceAll) {
        const liveIds = new Set(members.map((member) => docId(member.key)));
        const existing = await getFirebaseAdminDb().collection(GUILD_CHARACTER_DATA_COLLECTION).limit(1200).get();
        const stale = existing.docs.filter((item) => !liveIds.has(item.id));
        for (let start = 0; start < stale.length; start += 400) {
          const cleanup = getFirebaseAdminDb().batch();
          for (const item of stale.slice(start, start + 400)) cleanup.delete(item.ref);
          await cleanup.commit();
        }
      }

      for (let start = 0; start < targets.length; start += 350) {
        const batch = getFirebaseAdminDb().batch();
        for (const member of targets.slice(start, start + 350)) {
          const record = canonicalGuildCharacter(member, snapshot);
          batch.set(canonicalDoc("guild", member.key), { ...record, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
          // A character that joined the guild must stop being served from the
          // external/non-guild database immediately.
          batch.delete(canonicalDoc("external", member.key));
          written += 1;
        }
        await batch.commit();
      }
      return written;
    },
    {
      circuitKey: "canonical-guild-character-write",
      circuitTtlMs: 120_000,
      timeoutMs: 10_000,
      fallback: () => 0,
      logEvent: "character_data.guild_write_failed",
    },
  );
}

export async function readGuildCharacterData(key: string) {
  if (!hasFirebaseProfileConfig() || !key) return null;
  return resilientRead<CanonicalCharacterData | null>(
    `canonical-guild-character:${docId(key)}`,
    async () => {
      const snapshot = await canonicalDoc("guild", key).get();
      return snapshot.exists ? cleanRecord(snapshot.data()) : null;
    },
    { ttlMs: 30_000, timeoutMs: 2_500, fallback: () => null, logEvent: "character_data.guild_read_failed" },
  );
}

export async function readExternalCharacterData(key: string) {
  if (!hasFirebaseProfileConfig() || !key) return null;
  return resilientRead<CanonicalCharacterData | null>(
    `canonical-external-character:${docId(key)}`,
    async () => {
      const snapshot = await canonicalDoc("external", key).get();
      return snapshot.exists ? cleanRecord(snapshot.data()) : null;
    },
    { ttlMs: 30_000, timeoutMs: 2_500, fallback: () => null, logEvent: "character_data.external_read_failed" },
  );
}

export async function readCanonicalCharacterData(key: string) {
  return (await readGuildCharacterData(key)) || (await readExternalCharacterData(key));
}


export async function readCanonicalCharacterDataMany(keys: string[]) {
  if (!hasFirebaseProfileConfig()) return new Map<string, CanonicalCharacterData>();
  const unique = Array.from(new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))).slice(0, 600);
  const result = new Map<string, CanonicalCharacterData>();
  if (!unique.length) return result;

  const db = getFirebaseAdminDb();
  for (let start = 0; start < unique.length; start += 250) {
    const chunk = unique.slice(start, start + 250);
    const guildRefs = chunk.map((key) => canonicalDoc("guild", key));
    const guildSnapshots = await db.getAll(...guildRefs);
    const missing: string[] = [];
    guildSnapshots.forEach((snapshot: any, index: number) => {
      const key = chunk[index];
      const record = snapshot?.exists ? cleanRecord(snapshot.data()) : null;
      if (record && key) result.set(key, record);
      else if (key) missing.push(key);
    });
    if (!missing.length) continue;
    const externalSnapshots = await db.getAll(...missing.map((key) => canonicalDoc("external", key)));
    externalSnapshots.forEach((snapshot: any, index: number) => {
      const key = missing[index];
      const record = snapshot?.exists ? cleanRecord(snapshot.data()) : null;
      if (record && key) result.set(key, record);
    });
  }
  return result;
}

export async function writeExternalCharacterData(record: CanonicalCharacterData) {
  if (!hasFirebaseProfileConfig() || !record?.key) return false;
  // Guild data always wins. Never create a parallel non-guild copy when the
  // guild canonical record already exists.
  if (await readGuildCharacterData(record.key)) return false;
  return resilientWrite(
    `canonical-external-character-write:${docId(record.key)}`,
    async () => {
      await canonicalDoc("external", record.key).set(
        { ...record, scope: "external", verifiedGuild: false, updatedAtServer: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return true;
    },
    { circuitKey: "canonical-external-character-write", timeoutMs: 4_000, fallback: () => false, logEvent: "character_data.external_write_failed" },
  );
}
