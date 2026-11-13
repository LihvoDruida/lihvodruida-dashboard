import "server-only";
import { getDocumentDb, hasDocumentDbConfig } from "@/lib/documentDb";
import { findWowSpec } from "@/lib/wowClassCatalog";

/** Discord-owned registration preferences. Not an account, login or site profile. */
const COLLECTION = "discordRaidSignupPreferences";
export type RaidDiscordPreset = { classKey: string; specKey: string; count: number; lastUsedAt: string };
export type RaidDiscordPreference = {
  discordId: string;
  displayName: string;
  lastClassKey: string;
  lastSpecKey: string;
  lastStatus: "going" | "tentative" | "late" | "skipped";
  reminderEnabled: boolean;
  presets: RaidDiscordPreset[];
  updatedAt: string;
};
function isDiscordId(value: string) { return /^\d{16,25}$/.test(value); }
function cleanName(value: unknown) { return String(value || "Discord user").normalize("NFKC").replace(/[<>\x00-\x1f\x7f]/g, "").trim().slice(0, 80) || "Discord user"; }
function parsePreference(id: string, value: Record<string, unknown> | undefined): RaidDiscordPreference | null {
  if (!isDiscordId(id) || !value) return null;
  const presets = (Array.isArray(value.presets) ? value.presets : []).filter((item) => item && typeof item === "object")
    .flatMap((item: Record<string, unknown>) => findWowSpec(String(item.classKey || ""), String(item.specKey || ""))
      ? [{ classKey: String(item.classKey), specKey: String(item.specKey), count: Math.max(1, Math.min(100000, Number(item.count) || 1)), lastUsedAt: String(item.lastUsedAt || "").slice(0, 35) }]
      : []).slice(0, 5);
  const first = findWowSpec(String(value.lastClassKey || ""), String(value.lastSpecKey || ""));
  return {
    discordId: id, displayName: cleanName(value.displayName),
    lastClassKey: first?.cls.key || presets[0]?.classKey || "",
    lastSpecKey: first?.spec.key || presets[0]?.specKey || "",
    lastStatus: (["going", "tentative", "late", "skipped"].includes(String(value.lastStatus)) ? value.lastStatus : "going") as RaidDiscordPreference["lastStatus"],
    reminderEnabled: value.reminderEnabled !== false,
    presets,
    updatedAt: String(value.updatedAt || "").slice(0, 35),
  };
}
export async function getRaidDiscordPreference(discordId: string) {
  if (!isDiscordId(discordId) || !hasDocumentDbConfig()) return null;
  const snapshot = await getDocumentDb().collection(COLLECTION).doc(discordId).get();
  return snapshot.exists ? parsePreference(discordId, snapshot.data() as Record<string, unknown>) : null;
}
export async function saveRaidDiscordPreference(input: {
  discordId: string; displayName: string; classKey?: string | null; specKey?: string | null;
  status: RaidDiscordPreference["lastStatus"]; reminderEnabled: boolean;
}) {
  if (!isDiscordId(input.discordId) || !hasDocumentDbConfig()) return null;
  const spec = findWowSpec(input.classKey || "", input.specKey || "");
  const ref = getDocumentDb().collection(COLLECTION).doc(input.discordId);
  const now = new Date().toISOString();
  return getDocumentDb().runTransaction(async (tx) => {
    const previous = parsePreference(input.discordId, (await tx.get(ref)).data() as Record<string, unknown> | undefined);
    const nextPreset = spec ? { classKey: spec.cls.key, specKey: spec.spec.key, count: (previous?.presets.find((p) => p.classKey === spec.cls.key && p.specKey === spec.spec.key)?.count || 0) + 1, lastUsedAt: now } : null;
    const presets = [ ...(nextPreset ? [nextPreset] : []), ...(previous?.presets || []).filter((p) => !nextPreset || p.classKey !== nextPreset.classKey || p.specKey !== nextPreset.specKey) ].slice(0, 5);
    const result: RaidDiscordPreference = {
      discordId: input.discordId, displayName: cleanName(input.displayName),
      lastClassKey: spec?.cls.key || previous?.lastClassKey || "",
      lastSpecKey: spec?.spec.key || previous?.lastSpecKey || "",
      lastStatus: input.status, reminderEnabled: input.reminderEnabled,
      presets, updatedAt: now,
    };
    tx.set(ref, result);
    return result;
  });
}
export async function listRaidDiscordPreferences(limit = 100) {
  if (!hasDocumentDbConfig()) return [] as RaidDiscordPreference[];
  const snapshot = await getDocumentDb().collection(COLLECTION).orderBy("updatedAt", "desc").limit(Math.max(1, Math.min(limit, 200))).get();
  return snapshot.docs.flatMap((doc) => {
    const item = parsePreference(doc.id, doc.data());
    return item ? [item] : [];
  });
}
