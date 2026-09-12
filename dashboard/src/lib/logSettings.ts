import "server-only";

import { hasPostgresConfig, pgQuery } from "@/lib/db/pgPool";
import {
  getRuntimeCachedValue,
  setRuntimeCachedValue,
} from "@/lib/runtimeResilience";
import type { DashboardSession } from "@/lib/auth";

const CACHE_KEY = "structured-logging-settings-v3";
const CACHE_TTL_MS = 10_000;
const SETTINGS_KEY = "default";

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

type SettingsRow = {
  security_discord_enabled: boolean;
  security_discord_channel_id: string;
  security_discord_min_level: SecurityDiscordMinLevel;
  max_storage_mb: number;
  max_rows: number;
  query_limit: number;
  updated_at: Date | string;
  updated_by: string | null;
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
    securityDiscordChannelId: cleanSnowflake(process.env.SECURITY_LOG_DISCORD_CHANNEL_ID),
    securityDiscordMinLevel: minLevel(process.env.SECURITY_LOG_DISCORD_MIN_LEVEL),
    updatedAt: null,
    updatedBy: null,
    source: "env",
  };
}

function fromRow(row: SettingsRow): StructuredLogSettings {
  return {
    retentionDays: 3,
    maxStorageMb: cleanInteger(row.max_storage_mb, 192, 32, 1024),
    maxRows: cleanInteger(row.max_rows, 50_000, 5_000, 250_000),
    queryLimit: cleanInteger(row.query_limit, 250, 50, 500),
    securityDiscordEnabled: Boolean(row.security_discord_enabled),
    securityDiscordChannelId: cleanSnowflake(row.security_discord_channel_id),
    securityDiscordMinLevel: minLevel(row.security_discord_min_level),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row.updated_by || null,
    source: "database",
  };
}

async function readDatabaseSettings(): Promise<StructuredLogSettings | null> {
  const result = await pgQuery<SettingsRow>(
    `SELECT security_discord_enabled, security_discord_channel_id, security_discord_min_level,
            max_storage_mb, max_rows, query_limit, updated_at, updated_by
       FROM system_log_settings
      WHERE settings_key = $1
      LIMIT 1`,
    [SETTINGS_KEY],
  );
  if (!result.rows[0]) return null;
  return fromRow(result.rows[0]);
}


export async function getStructuredLogSettings(options: { fresh?: boolean } = {}): Promise<StructuredLogSettings> {
  if (!hasPostgresConfig()) return envSettings();
  if (!options.fresh) {
    const cached = getRuntimeCachedValue<StructuredLogSettings>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) return cached;
  }
  try {
    const stored = (await readDatabaseSettings()) || envSettings();
    return setRuntimeCachedValue(CACHE_KEY, stored);
  } catch (error) {
    console.warn("[structured-logs] settings read failed", error instanceof Error ? error.message : String(error));
    return envSettings();
  }
}

export async function updateStructuredLogSettings(input: {
  securityDiscordEnabled?: unknown;
  securityDiscordChannelId?: unknown;
  securityDiscordMinLevel?: unknown;
  maxStorageMb?: unknown;
  maxRows?: unknown;
  queryLimit?: unknown;
}, actor: DashboardSession) {
  if (!hasPostgresConfig()) throw new Error("PostgreSQL для журналу не налаштований.");
  const current = await getStructuredLogSettings({ fresh: true });
  const owner = Boolean(actor.isServerOwner);
  const next = {
    securityDiscordEnabled: bool(input.securityDiscordEnabled, false),
    securityDiscordChannelId: cleanSnowflake(input.securityDiscordChannelId),
    securityDiscordMinLevel: minLevel(input.securityDiscordMinLevel),
    maxStorageMb: owner ? cleanInteger(input.maxStorageMb, current.maxStorageMb, 32, 1024) : current.maxStorageMb,
    maxRows: owner ? cleanInteger(input.maxRows, current.maxRows, 5_000, 250_000) : current.maxRows,
    queryLimit: owner ? cleanInteger(input.queryLimit, current.queryLimit, 50, 500) : current.queryLimit,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name || actor.login || actor.id,
  };

  const result = await pgQuery<SettingsRow>(
    `INSERT INTO system_log_settings (
       settings_key, security_discord_enabled, security_discord_channel_id,
       security_discord_min_level, max_storage_mb, max_rows, query_limit,
       updated_at, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9)
     ON CONFLICT (settings_key) DO UPDATE SET
       security_discord_enabled = EXCLUDED.security_discord_enabled,
       security_discord_channel_id = EXCLUDED.security_discord_channel_id,
       security_discord_min_level = EXCLUDED.security_discord_min_level,
       max_storage_mb = EXCLUDED.max_storage_mb,
       max_rows = EXCLUDED.max_rows,
       query_limit = EXCLUDED.query_limit,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by
     RETURNING security_discord_enabled, security_discord_channel_id, security_discord_min_level,
               max_storage_mb, max_rows, query_limit, updated_at, updated_by`,
    [
      SETTINGS_KEY,
      next.securityDiscordEnabled,
      next.securityDiscordChannelId,
      next.securityDiscordMinLevel,
      next.maxStorageMb,
      next.maxRows,
      next.queryLimit,
      next.updatedAt,
      next.updatedBy,
    ],
  );
  const saved = fromRow(result.rows[0]);
  // Update the in-process cache immediately: Security mirroring must see the
  // new toggle/channel on the very next event, not after the read TTL.
  setRuntimeCachedValue(CACHE_KEY, saved);
  return saved;
}
