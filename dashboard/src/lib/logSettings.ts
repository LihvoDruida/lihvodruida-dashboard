import "server-only";

import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { FieldValue } from "@/lib/db/firestoreCompat";
import { firebaseRead, firebaseWrite } from "@/lib/firebaseAccess";
import type { DashboardSession } from "@/lib/auth";

const SETTINGS_COLLECTION = "dashboardSettings";
const SETTINGS_DOC_ID = "structured-logging-v2";
const CACHE_KEY = "structured-logging-settings-v2";
const CACHE_TTL_MS = 60_000;

export type SecurityDiscordMinLevel = "info" | "warning" | "error";

export type StructuredLogSettings = {
  retentionDays: 3;
  maxStorageMb: number;
  maxRows: number;
  queryLimit: number;
  securityDiscordEnabled: boolean;
  securityDiscordChannelId: string;
  securityDiscordMinLevel: SecurityDiscordMinLevel;
  updatedAt: string | null;
  updatedBy: string | null;
  source: "database" | "env";
};

function cleanInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function cleanSnowflake(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function minLevel(value: unknown): SecurityDiscordMinLevel {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "info" || text === "error") return text;
  return "warning";
}

function envSettings(): StructuredLogSettings {
  return {
    retentionDays: 3,
    maxStorageMb: cleanInteger(process.env.LOG_STORAGE_MAX_MB, 192, 32, 1024),
    maxRows: cleanInteger(process.env.LOG_MAX_ROWS, 50_000, 5_000, 250_000),
    queryLimit: cleanInteger(process.env.LOG_QUERY_LIMIT, 250, 50, 500),
    securityDiscordEnabled: bool(process.env.SECURITY_LOG_DISCORD_ENABLED, false),
    securityDiscordChannelId: cleanSnowflake(process.env.SECURITY_LOG_DISCORD_CHANNEL_ID || process.env.DISCORD_AUDIT_CHANNEL_ID),
    securityDiscordMinLevel: minLevel(process.env.SECURITY_LOG_DISCORD_MIN_LEVEL),
    updatedAt: null,
    updatedBy: null,
    source: "env",
  };
}

function normalizeSettings(raw: Record<string, unknown> | null | undefined): StructuredLogSettings {
  const fallback = envSettings();
  if (!raw) return fallback;
  return {
    retentionDays: 3,
    maxStorageMb: cleanInteger(raw.maxStorageMb, fallback.maxStorageMb, 32, 1024),
    maxRows: cleanInteger(raw.maxRows, fallback.maxRows, 5_000, 250_000),
    queryLimit: cleanInteger(raw.queryLimit, fallback.queryLimit, 50, 500),
    securityDiscordEnabled: bool(raw.securityDiscordEnabled, fallback.securityDiscordEnabled),
    securityDiscordChannelId: cleanSnowflake(raw.securityDiscordChannelId || fallback.securityDiscordChannelId),
    securityDiscordMinLevel: minLevel(raw.securityDiscordMinLevel || fallback.securityDiscordMinLevel),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
    source: "database",
  };
}

export async function getStructuredLogSettings(): Promise<StructuredLogSettings> {
  if (!hasFirebaseProfileConfig()) return envSettings();
  return firebaseRead<StructuredLogSettings>(
    "system",
    CACHE_KEY,
    async () => {
      const snap = await getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).get();
      return snap.exists ? normalizeSettings(snap.data() || {}) : envSettings();
    },
    { ttlMs: CACHE_TTL_MS, fallback: envSettings, logEvent: "logging.settings.read_failed" },
  );
}

export async function updateStructuredLogSettings(input: {
  securityDiscordEnabled?: unknown;
  securityDiscordChannelId?: unknown;
  securityDiscordMinLevel?: unknown;
  maxStorageMb?: unknown;
  maxRows?: unknown;
  queryLimit?: unknown;
}, actor: DashboardSession) {
  const current = await getStructuredLogSettings();
  const owner = Boolean(actor.isServerOwner);
  const next = {
    securityDiscordEnabled: bool(input.securityDiscordEnabled, false),
    securityDiscordChannelId: cleanSnowflake(input.securityDiscordChannelId),
    securityDiscordMinLevel: minLevel(input.securityDiscordMinLevel),
    // Physical storage limits are owner-only: they directly affect VPS disk use.
    maxStorageMb: owner ? cleanInteger(input.maxStorageMb, current.maxStorageMb, 32, 1024) : current.maxStorageMb,
    maxRows: owner ? cleanInteger(input.maxRows, current.maxRows, 5_000, 250_000) : current.maxRows,
    queryLimit: owner ? cleanInteger(input.queryLimit, current.queryLimit, 50, 500) : current.queryLimit,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name || actor.login || actor.id,
  };

  if (!hasFirebaseProfileConfig()) throw new Error("Сховище налаштувань журналу не налаштоване.");
  await firebaseWrite(
    "system",
    "structured-logging-settings:update",
    async () => {
      await getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set({
        ...next,
        updatedAtServer: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    },
    { timeoutMs: 4_000, bypassCircuit: true, logEvent: "logging.settings.write_failed" },
  );
  return normalizeSettings(next);
}
