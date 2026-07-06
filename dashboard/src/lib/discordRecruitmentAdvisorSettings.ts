import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { DashboardSession } from "@/lib/auth";
import { firebaseWrite } from "@/lib/firebaseAccess";
import {
  getFirebaseAdminDb,
  hasFirebaseProfileConfig,
} from "@/lib/firebaseAdmin";
import { resilientRead } from "@/lib/runtimeResilience";

const SETTINGS_COLLECTION = "dashboardSettings";
const SETTINGS_DOC_ID = "discordRecruitmentAdvisor";
const SETTINGS_CACHE_TTL_MS = Math.max(
  30_000,
  Math.min(
    10 * 60_000,
    Number(
      process.env.DISCORD_RECRUITMENT_ADVICE_SETTINGS_CACHE_TTL_MS || 60_000,
    ),
  ),
);

export type DiscordRecruitmentAdvisorSettings = {
  enabled: boolean;
  dryRun: boolean;
  lookbackHours: number;
  maxPages: number;
  maxReplies: number;
  maxChannels: number;
  minRio: number;
  minIlvl: number;
  manualScanLimit: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRecruitmentAdvisorSettingsCache:
    | { settings: DiscordRecruitmentAdvisorSettings; cachedAt: number }
    | undefined;
}

function envFlag(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function cleanInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function")
    return maybeTimestamp.toDate().toISOString();
  return null;
}

export function defaultRecruitmentAdvisorSettings(): DiscordRecruitmentAdvisorSettings {
  return {
    enabled: envFlag("DISCORD_RECRUITMENT_ADVICE_ENABLED", false),
    dryRun: envFlag("DISCORD_RECRUITMENT_ADVICE_DRY_RUN", false),
    lookbackHours: cleanInteger(
      process.env.DISCORD_RECRUITMENT_ADVICE_LOOKBACK_HOURS,
      48,
      1,
      168,
    ),
    maxPages: cleanInteger(
      process.env.DISCORD_RECRUITMENT_ADVICE_MAX_PAGES,
      4,
      1,
      20,
    ),
    maxReplies: cleanInteger(
      process.env.DISCORD_RECRUITMENT_ADVICE_MAX_REPLIES,
      4,
      1,
      20,
    ),
    maxChannels: cleanInteger(
      process.env.DISCORD_RECRUITMENT_ADVICE_MAX_CHANNELS,
      100,
      1,
      200,
    ),
    minRio: cleanInteger(
      process.env.DISCORD_RECRUITMENT_ADVICE_MIN_RIO,
      0,
      0,
      6000,
    ),
    minIlvl: cleanInteger(
      process.env.DISCORD_RECRUITMENT_ADVICE_MIN_ILVL,
      0,
      0,
      2000,
    ),
    manualScanLimit: cleanInteger(
      process.env.DISCORD_RECRUITMENT_ADVICE_MANUAL_SCAN_LIMIT,
      4,
      1,
      20,
    ),
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizeSettings(
  data: Record<string, unknown> | null | undefined,
  fallback = defaultRecruitmentAdvisorSettings(),
): DiscordRecruitmentAdvisorSettings {
  return {
    enabled:
      typeof data?.enabled === "boolean" ? data.enabled : fallback.enabled,
    dryRun: typeof data?.dryRun === "boolean" ? data.dryRun : fallback.dryRun,
    lookbackHours: cleanInteger(
      data?.lookbackHours,
      fallback.lookbackHours,
      1,
      168,
    ),
    maxPages: cleanInteger(data?.maxPages, fallback.maxPages, 1, 20),
    maxReplies: cleanInteger(data?.maxReplies, fallback.maxReplies, 1, 20),
    maxChannels: cleanInteger(data?.maxChannels, fallback.maxChannels, 1, 200),
    minRio: cleanInteger(data?.minRio, fallback.minRio, 0, 6000),
    minIlvl: cleanInteger(data?.minIlvl, fallback.minIlvl, 0, 2000),
    manualScanLimit: cleanInteger(
      data?.manualScanLimit,
      fallback.manualScanLimit,
      1,
      20,
    ),
    updatedAt: timestampToIso(data?.updatedAt) || fallback.updatedAt || null,
    updatedBy:
      typeof data?.updatedBy === "string"
        ? data.updatedBy
        : fallback.updatedBy || null,
  };
}

function cacheFresh() {
  const cached = globalThis.__mistblossomRecruitmentAdvisorSettingsCache;
  return Boolean(
    cached && Date.now() - cached.cachedAt < SETTINGS_CACHE_TTL_MS,
  );
}

function setCache(settings: DiscordRecruitmentAdvisorSettings) {
  globalThis.__mistblossomRecruitmentAdvisorSettingsCache = {
    settings,
    cachedAt: Date.now(),
  };
  return settings;
}

export async function getRecruitmentAdvisorSettings(
  options: { bypassCache?: boolean } = {},
): Promise<DiscordRecruitmentAdvisorSettings> {
  if (!options.bypassCache && cacheFresh())
    return globalThis.__mistblossomRecruitmentAdvisorSettingsCache!.settings;
  const fallback =
    globalThis.__mistblossomRecruitmentAdvisorSettingsCache?.settings ||
    defaultRecruitmentAdvisorSettings();
  if (!hasFirebaseProfileConfig()) return setCache(fallback);

  const settings = await resilientRead(
    "discord-recruitment-advisor-settings",
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC_ID)
        .get();
      return snapshot.exists
        ? normalizeSettings(snapshot.data() || null, fallback)
        : fallback;
    },
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      timeoutMs: 2_000,
      fallback: () => fallback,
      circuitKey: "firebase-discord-recruitment-advisor-settings-read",
      circuitTtlMs: 2 * 60_000,
      logEvent: "discord.recruitment_advice.settings_read_failed",
      bypassCache: options.bypassCache,
    },
  );
  return setCache(settings);
}

export async function setRecruitmentAdvisorSettings(
  input: Record<string, unknown>,
  actor?: DashboardSession | null,
) {
  const fallback = await getRecruitmentAdvisorSettings({ bypassCache: true });
  const settings = normalizeSettings(
    {
      enabled: ["1", "true", "yes", "on"].includes(
        String(input.enabled || "").toLowerCase(),
      ),
      dryRun: ["1", "true", "yes", "on"].includes(
        String(input.dryRun || "").toLowerCase(),
      ),
      lookbackHours: input.lookbackHours,
      maxPages: input.maxPages,
      maxReplies: input.maxReplies,
      maxChannels: input.maxChannels,
      minRio: input.minRio,
      minIlvl: input.minIlvl,
      manualScanLimit: input.manualScanLimit,
    },
    fallback,
  );

  if (!hasFirebaseProfileConfig())
    throw new Error(
      "Firebase не налаштований для збереження налаштувань автовідповідей.",
    );
  await firebaseWrite(
    "settings",
    "discord-recruitment-advisor:save",
    () =>
      getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(SETTINGS_DOC_ID)
        .set(
          {
            ...settings,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor?.name || actor?.login || actor?.id || null,
          },
          { merge: true },
        ),
    {
      timeoutMs: 3_000,
      logEvent: "discord.recruitment_advice.settings_write_failed",
    },
  );

  return setCache({
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}
