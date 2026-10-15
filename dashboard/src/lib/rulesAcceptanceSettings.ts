import "server-only";

import { FieldValue } from "@/lib/db/documentValues";
import { getDocumentDb, hasDocumentDbConfig } from "@/lib/documentDb";
import { storageWrite } from "@/lib/storageAccess";
import { withTimeout, resilientRead } from "@/lib/runtimeResilience";
import type { DashboardSession } from "@/lib/auth";
import { timestampToIso } from "@/lib/values";

const SETTINGS_COLLECTION = "dashboardSettings";
const SETTINGS_DOC_ID = "rulesAcceptanceSettings";
const SETTINGS_CACHE_TTL_MS = Math.max(5_000, Math.min(5 * 60_000, Number(process.env.RULES_ACCEPTANCE_SETTINGS_CACHE_TTL_MS || 15_000)));

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRulesAcceptanceSettingsCache: { settings: RulesAcceptanceSettings; cachedAt: number } | undefined;
}

export type RulesAcceptanceSettings = {
  allowRepeatedAcceptForTesting: boolean;
  publicRulesMessageUrl?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};
function cleanBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled", "увімкнено"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled", "вимкнено"].includes(text)) return false;
  return fallback;
}

function normalizeSettings(data: Record<string, unknown> | null | undefined): RulesAcceptanceSettings {
  return {
    allowRepeatedAcceptForTesting: cleanBoolean(data?.allowRepeatedAcceptForTesting, false),
    publicRulesMessageUrl: typeof data?.publicRulesMessageUrl === "string" ? data.publicRulesMessageUrl : null,
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

function settingsCacheFresh() {
  const cached = globalThis.__mistblossomRulesAcceptanceSettingsCache;
  return Boolean(cached && Date.now() - cached.cachedAt < SETTINGS_CACHE_TTL_MS);
}

function setSettingsCache(settings: RulesAcceptanceSettings) {
  globalThis.__mistblossomRulesAcceptanceSettingsCache = { settings, cachedAt: Date.now() };
  return settings;
}

export async function getRulesAcceptanceSettings(options: { bypassCache?: boolean } = {}): Promise<RulesAcceptanceSettings> {
  if (!options.bypassCache && settingsCacheFresh()) {
    return globalThis.__mistblossomRulesAcceptanceSettingsCache!.settings;
  }

  const fallback = globalThis.__mistblossomRulesAcceptanceSettingsCache?.settings || normalizeSettings(null);
  if (!hasDocumentDbConfig()) return setSettingsCache(fallback);

  const settings = await resilientRead(
    "rules-acceptance-settings",
    async () => {
      const snapshot = await getDocumentDb()
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC_ID)
        .get();
      return snapshot.exists ? normalizeSettings(snapshot.data() || null) : fallback;
    },
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      timeoutMs: 2_000,
      fallback: () => fallback,
      circuitKey: "storage-rules-acceptance-settings-read",
      circuitTtlMs: 60_000,
      logEvent: "rules.acceptance_settings_read_failed",
      bypassCache: options.bypassCache,
    },
  );

  return setSettingsCache(settings);
}

export async function setRulesAcceptanceSettings(input: { allowRepeatedAcceptForTesting?: unknown }, actor?: DashboardSession | null) {
  const allowRepeatedAcceptForTesting = cleanBoolean(input.allowRepeatedAcceptForTesting, false);
  const previous = await getRulesAcceptanceSettings({ bypassCache: true });
  if (!hasDocumentDbConfig()) throw new Error("Storage не налаштований для збереження налаштувань правил.");

  await storageWrite(
    "settings",
    "rules-acceptance-settings:save",
    () => getDocumentDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set({
      allowRepeatedAcceptForTesting,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "rules.acceptance_settings_write_failed" },
  );

  return setSettingsCache({
    ...previous,
    allowRepeatedAcceptForTesting,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}

/** Called only by the guarded guild-rules publisher after Discord confirms save. */
export async function setPublicRulesMessage(url: string, actor: DashboardSession) {
  if (!/^https:\/\/discord\.com\/channels\/\d{16,25}\/\d{16,25}\/\d{16,25}$/.test(url)) throw new Error("Invalid rules publication reference");
  if (!hasDocumentDbConfig()) throw new Error("Rules publication storage unavailable");
  const previous = await getRulesAcceptanceSettings({ bypassCache: true });
  await storageWrite("settings", "rules-publication:save", () => getDocumentDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set({
    publicRulesMessageUrl: url, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.id,
  }, { merge: true }), { timeoutMs: 3_000, logEvent: "rules.publication_write_failed" });
  setSettingsCache({ ...previous, publicRulesMessageUrl: url, updatedAt: new Date().toISOString(), updatedBy: actor.id });
  globalThis.__mistblossomConfiguredRulesRoleIdsCache = undefined;
}

/** Role-grant decisions require a fresh publication binding, never a stale
 * resilience fallback after an administrator switches the current rules. */
export async function getPublicRulesMessageUrl(): Promise<string | null> {
  if (!hasDocumentDbConfig()) return null;
  const snapshot = await withTimeout(getDocumentDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).get(), 2_000, "rules-publication-read");
  return snapshot.exists ? normalizeSettings(snapshot.data() || null).publicRulesMessageUrl || null : null;
}
