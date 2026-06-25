import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { resilientRead } from "@/lib/runtimeResilience";
import type { DashboardSession } from "@/lib/auth";

const SETTINGS_COLLECTION = "dashboardSettings";
const SETTINGS_DOC_ID = "rulesAcceptanceSettings";
const SETTINGS_CACHE_TTL_MS = Math.max(5_000, Math.min(5 * 60_000, Number(process.env.RULES_ACCEPTANCE_SETTINGS_CACHE_TTL_MS || 15_000)));

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRulesAcceptanceSettingsCache: { settings: RulesAcceptanceSettings; cachedAt: number } | undefined;
}

export type RulesAcceptanceSettings = {
  allowRepeatedAcceptForTesting: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate().toISOString();
  return null;
}

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
  if (!hasFirebaseProfileConfig()) return setSettingsCache(fallback);

  const settings = await resilientRead(
    "rules-acceptance-settings",
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC_ID)
        .get();
      return snapshot.exists ? normalizeSettings(snapshot.data() || null) : fallback;
    },
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      timeoutMs: 2_000,
      fallback: () => fallback,
      circuitKey: "firebase-rules-acceptance-settings-read",
      circuitTtlMs: 60_000,
      logEvent: "rules.acceptance_settings_read_failed",
      bypassCache: options.bypassCache,
    },
  );

  return setSettingsCache(settings);
}

export async function setRulesAcceptanceSettings(input: { allowRepeatedAcceptForTesting?: unknown }, actor?: DashboardSession | null) {
  const allowRepeatedAcceptForTesting = cleanBoolean(input.allowRepeatedAcceptForTesting, false);
  if (!hasFirebaseProfileConfig()) throw new Error("Firebase не налаштований для збереження налаштувань правил.");

  await firebaseWrite(
    "settings",
    "rules-acceptance-settings:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set({
      allowRepeatedAcceptForTesting,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "rules.acceptance_settings_write_failed" },
  );

  return setSettingsCache({
    allowRepeatedAcceptForTesting,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}
