import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { DashboardSession } from "@/lib/auth";
import {
  getFirebaseAdminDb,
  hasFirebaseProfileConfig,
} from "@/lib/firebaseAdmin";
import { logDashboardEvent } from "@/lib/security";
import { resilientRead } from "@/lib/runtimeResilience";
import { firebaseWrite } from "@/lib/firebaseAccess";

const SETTINGS_COLLECTION = "dashboardSettings";
const DASHBOARD_API_SETTINGS_DOC_ID = "backgroundApiPolicy";

const MIN_BACKGROUND_REFRESH_SECONDS = 10 * 60;
const MAX_REFRESH_SECONDS = 24 * 60 * 60;
const DEFAULT_CHARACTER_CACHE_TTL_MS = 120_000;
const DEFAULT_ECO_CHARACTER_CACHE_TTL_MS = 600_000;
const MAX_CHARACTER_CACHE_TTL_MS = 900_000;
const DEFAULT_GUILD_ROSTER_MEMBER_LIMIT = 1000;
const DEFAULT_GUILD_ROSTER_REFRESH_STEP_BUDGET_MS = 22_000;
const DEFAULT_ECO_GUILD_ROSTER_REFRESH_STEP_BUDGET_MS = 10_000;
const DEFAULT_GUILD_ROSTER_SYNC_JOB_TTL_SECONDS = 30 * 60;
const DEFAULT_GUILD_ROSTER_SHARDED_CACHE_ENABLED = true;
const DEFAULT_GUILD_ROSTER_SHARDED_CACHE_THRESHOLD = 150;
const DEFAULT_GUILD_ROSTER_BATTLENET_STEP_SIZE = 8;
const DEFAULT_ECO_GUILD_ROSTER_BATTLENET_STEP_SIZE = 3;
const DEFAULT_GUILD_ROSTER_BATTLENET_TTL_SECONDS = 21_600;
const DEFAULT_ECO_GUILD_ROSTER_BATTLENET_TTL_SECONDS = 86_400;
const DEFAULT_GUILD_ROSTER_RAIDERIO_STEP_SIZE = 5;
const DEFAULT_ECO_GUILD_ROSTER_RAIDERIO_STEP_SIZE = 2;
const DEFAULT_GUILD_ROSTER_RAIDERIO_TTL_SECONDS = 21_600;
const DEFAULT_ECO_GUILD_ROSTER_RAIDERIO_TTL_SECONDS = 86_400;
const DEFAULT_GUILD_ROSTER_CLIENT_DRIVEN_SYNC_ENABLED = true;
const DEFAULT_ECO_GUILD_ROSTER_CLIENT_DRIVEN_SYNC_ENABLED = false;
const DEFAULT_GUILD_ROSTER_CLIENT_STEP_DELAY_MS = 250;
const DEFAULT_GUILD_ROSTER_CLIENT_REQUEST_TIMEOUT_MS = 40_000;
const DEFAULT_GUILD_ROSTER_CLIENT_MAX_STEPS = 2_200;
const DEFAULT_DASHBOARD_API_DEBUG_AUDIT_LOGS = false;
const DEFAULT_DASHBOARD_API_WARNING_AUDIT_LOGS = true;

const DEFAULT_GUILD_ROSTER_CACHE_TTL_SECONDS = 1800;
const DEFAULT_ECO_GUILD_ROSTER_CACHE_TTL_SECONDS = 21_600;
const DEFAULT_GUILD_ROSTER_CACHE_READ_TTL_MS = 120_000;
const DEFAULT_ECO_GUILD_ROSTER_CACHE_READ_TTL_MS = 300_000;
const DEFAULT_GUILD_ROSTER_CACHE_WRITE_BATCH_SIZE = 50;
const DEFAULT_ECO_GUILD_ROSTER_CACHE_WRITE_BATCH_SIZE = 25;
const DEFAULT_GUILD_ROSTER_CACHE_DELETE_STALE_MEMBERS = false;
const DEFAULT_GUILD_ROSTER_REFRESH_CONCURRENCY = 2;
const DEFAULT_ECO_GUILD_ROSTER_REFRESH_CONCURRENCY = 1;
const DEFAULT_GUILD_ROSTER_REFRESH_MAX_CONCURRENCY = 6;
const DEFAULT_ECO_GUILD_ROSTER_REFRESH_MAX_CONCURRENCY = 2;
const DEFAULT_RAIDERIO_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RAIDERIO_REQUEST_RETRIES = 1;
const DEFAULT_RAIDERIO_RATE_LIMIT_COOLDOWN_SECONDS = 900;
const DEFAULT_RAIDERIO_REQUEST_MIN_DELAY_MS = 350;
const DEFAULT_BATTLENET_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BATTLENET_REQUEST_RETRIES = 2;
const DEFAULT_PROFILE_READ_CACHE_TTL_MS = 60_000;
const DEFAULT_ECO_PROFILE_READ_CACHE_TTL_MS = 300_000;
const DEFAULT_PROFILE_LIST_CACHE_TTL_MS = 120_000;
const DEFAULT_ECO_PROFILE_LIST_CACHE_TTL_MS = 300_000;
const DEFAULT_PROFILE_CHARACTER_LINKS_CACHE_TTL_MS = 300_000;
const DEFAULT_ECO_PROFILE_CHARACTER_LINKS_CACHE_TTL_MS = 600_000;
const DEFAULT_RAID_LIST_CACHE_TTL_MS = 60_000;
const DEFAULT_ECO_RAID_LIST_CACHE_TTL_MS = 300_000;
const DEFAULT_RAID_ITEM_CACHE_TTL_MS = 60_000;
const DEFAULT_ECO_RAID_ITEM_CACHE_TTL_MS = 180_000;
const DEFAULT_RAID_DISCORD_DELETE_AFTER_START_HOURS = 4;
const DEFAULT_GUILD_ROSTER_RECORDS_CHUNK_SIZE = 64;
const DEFAULT_GUILD_ROSTER_READ_LEGACY_MEMBER_DOCS = false;
const DEFAULT_GUILD_ROSTER_WRITE_LEGACY_MEMBER_DOCS = false;
const DEFAULT_AUDIT_LOG_READ_CACHE_TTL_MS = 30_000;
const DEFAULT_ECO_AUDIT_LOG_READ_CACHE_TTL_MS = 120_000;
const DEFAULT_AUDIT_LOG_DEDUPE_WINDOW_MS = 120_000;
const DEFAULT_AUDIT_LOG_MAX_STORED = 500;
const DEFAULT_ECO_AUDIT_LOG_MAX_STORED = 250;

const SETTINGS_CACHE_TTL_MS = Math.max(
  60_000,
  Math.min(
    30 * 60_000,
    Number(process.env.DASHBOARD_API_SETTINGS_CACHE_TTL_MS || 5 * 60_000),
  ),
);
const SETTINGS_ERROR_LOG_TTL_MS = 5 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomDashboardApiSettingsCache:
    | { settings: DashboardApiSettings; cachedAt: number }
    | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomDashboardApiSettingsErrorLoggedAt: number | undefined;
}

function settingsCacheFresh() {
  const cached = globalThis.__mistblossomDashboardApiSettingsCache;
  return Boolean(cached && Date.now() - cached.cachedAt < SETTINGS_CACHE_TTL_MS);
}

function setSettingsCache(settings: DashboardApiSettings) {
  globalThis.__mistblossomDashboardApiSettingsCache = {
    settings,
    cachedAt: Date.now(),
  };
  return settings;
}

function logSettingsReadFailureOnce(event: string, error: unknown) {
  const now = Date.now();
  const last = globalThis.__mistblossomDashboardApiSettingsErrorLoggedAt || 0;
  if (now - last < SETTINGS_ERROR_LOG_TTL_MS) return;
  globalThis.__mistblossomDashboardApiSettingsErrorLoggedAt = now;
  logDashboardEvent("warn", event, undefined, {
    message: error instanceof Error ? error.message : String(error || "unknown"),
  });
}

export type DashboardApiSettingsSource = "firestore" | "defaults";

export type DashboardApiSettings = {
  backgroundRefreshMinSeconds: number;
  profileViewRefreshMinSeconds: number;
  profileExternalRefreshMinSeconds: number;
  profileExternalRefreshBatchLimit: number;
  profileCharacterRefreshConcurrency: number;
  profileCharacterRefreshMaxConcurrency: number;
  profileExternalRefreshConcurrency: number;
  profileExternalRefreshMaxConcurrency: number;
  dashboardApiDebugAuditLogs: boolean;
  dashboardApiWarningAuditLogs: boolean;
  guildRosterRegion: string;
  guildRosterRealm: string;
  guildRosterName: string;
  guildRosterCacheTtlSeconds: number;
  guildRosterCacheReadTtlMs: number;
  guildRosterCacheWriteBatchSize: number;
  guildRosterCacheDeleteStaleMembers: boolean;
  guildRosterRefreshConcurrency: number;
  guildRosterRefreshMaxConcurrency: number;
  raiderIoRequestTimeoutMs: number;
  raiderIoRequestRetries: number;
  raiderIoRateLimitCooldownSeconds: number;
  raiderIoRequestMinDelayMs: number;
  battleNetRequestTimeoutMs: number;
  battleNetRequestRetries: number;
  profileReadCacheTtlMs: number;
  profileListCacheTtlMs: number;
  profileCharacterLinksCacheTtlMs: number;
  raidListCacheTtlMs: number;
  raidItemCacheTtlMs: number;
  raidDiscordDeleteAfterStartHours: number;
  guildRosterRecordsChunkSize: number;
  guildRosterReadLegacyMemberDocs: boolean;
  guildRosterWriteLegacyMemberDocs: boolean;
  auditLogReadCacheTtlMs: number;
  auditLogDedupeWindowMs: number;
  auditLogMaxStored: number;
  raiderIoCharacterCacheTtlMs: number;
  guildRosterMemberLimit: number;
  guildRosterRefreshStepBudgetMs: number;
  guildRosterSyncJobTtlSeconds: number;
  guildRosterShardedCacheEnabled: boolean;
  guildRosterShardedCacheThreshold: number;
  guildRosterBattleNetStepSize: number;
  guildRosterBattleNetTtlSeconds: number;
  guildRosterRaiderIoStepSize: number;
  guildRosterRaiderIoTtlSeconds: number;
  guildRosterClientDrivenSyncEnabled: boolean;
  guildRosterClientStepDelayMs: number;
  guildRosterClientRequestTimeoutMs: number;
  guildRosterClientMaxSteps: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
  source: DashboardApiSettingsSource;
};

type DashboardApiSettingsInput = Partial<Record<keyof DashboardApiSettings, unknown>>;

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.floor(value), max));
}

function integerValue(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const text = cleanText(value, 20).toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function envFlagValue(names: string[], fallback = false) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== null && raw !== "") return booleanValue(raw, fallback);
  }
  return fallback;
}

function firebaseEcoModeEnabled() {
  return envFlagValue(["FIREBASE_ECO_MODE", "FIRESTORE_ECO_MODE", "DASHBOARD_ECO_MODE"], false);
}

function ecoFallback(normal: number, economy: number) {
  return firebaseEcoModeEnabled() ? economy : normal;
}

function ecoFlagFallback(normal: boolean, economy: boolean) {
  return firebaseEcoModeEnabled() ? economy : normal;
}

function truthyFormFlag(value: unknown) {
  return booleanValue(value, false);
}

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") {
    return maybeTimestamp.toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

function envDashboardApiDebugAuditLogs() {
  const raw = cleanText(process.env.DASHBOARD_API_DEBUG_AUDIT_LOGS, 20);
  if (!raw) return DEFAULT_DASHBOARD_API_DEBUG_AUDIT_LOGS;
  return booleanValue(raw, DEFAULT_DASHBOARD_API_DEBUG_AUDIT_LOGS);
}

function envDashboardApiWarningAuditLogs() {
  const raw = cleanText(process.env.DASHBOARD_API_WARNING_AUDIT_LOGS, 20);
  if (!raw) return DEFAULT_DASHBOARD_API_WARNING_AUDIT_LOGS;
  return booleanValue(raw, DEFAULT_DASHBOARD_API_WARNING_AUDIT_LOGS);
}

function envGuildRosterRegion() {
  return cleanText(process.env.GUILD_ROSTER_REGION, 20).toLowerCase() || "eu";
}

function envGuildRosterRealm() {
  return cleanText(process.env.GUILD_ROSTER_REALM, 80).toLowerCase() || "terokkar";
}

function envGuildRosterName() {
  return cleanText(process.env.GUILD_ROSTER_NAME, 120) || "Mistblossom Vanguard";
}

function envGuildRosterCacheTtlSeconds() {
  return integerEnv("GUILD_ROSTER_CACHE_TTL_SECONDS", ecoFallback(DEFAULT_GUILD_ROSTER_CACHE_TTL_SECONDS, DEFAULT_ECO_GUILD_ROSTER_CACHE_TTL_SECONDS), 300, 86_400);
}

function envGuildRosterCacheReadTtlMs() {
  return integerEnv("GUILD_ROSTER_CACHE_READ_TTL_MS", ecoFallback(DEFAULT_GUILD_ROSTER_CACHE_READ_TTL_MS, DEFAULT_ECO_GUILD_ROSTER_CACHE_READ_TTL_MS), 30_000, 300_000);
}

function envGuildRosterCacheWriteBatchSize() {
  return integerEnv("GUILD_ROSTER_CACHE_WRITE_BATCH_SIZE", ecoFallback(DEFAULT_GUILD_ROSTER_CACHE_WRITE_BATCH_SIZE, DEFAULT_ECO_GUILD_ROSTER_CACHE_WRITE_BATCH_SIZE), 1, 250);
}

function envGuildRosterCacheDeleteStaleMembers() {
  const raw = cleanText(process.env.GUILD_ROSTER_CACHE_DELETE_STALE_MEMBERS, 20);
  if (!raw) return DEFAULT_GUILD_ROSTER_CACHE_DELETE_STALE_MEMBERS;
  return booleanValue(raw, DEFAULT_GUILD_ROSTER_CACHE_DELETE_STALE_MEMBERS);
}

function envGuildRosterRefreshMaxConcurrency() {
  return integerEnv("GUILD_ROSTER_REFRESH_MAX_CONCURRENCY", ecoFallback(DEFAULT_GUILD_ROSTER_REFRESH_MAX_CONCURRENCY, DEFAULT_ECO_GUILD_ROSTER_REFRESH_MAX_CONCURRENCY), 1, 12);
}

function envGuildRosterRefreshConcurrency() {
  return integerEnv("GUILD_ROSTER_REFRESH_CONCURRENCY", ecoFallback(DEFAULT_GUILD_ROSTER_REFRESH_CONCURRENCY, DEFAULT_ECO_GUILD_ROSTER_REFRESH_CONCURRENCY), 1, envGuildRosterRefreshMaxConcurrency());
}

function envRaiderIoRequestTimeoutMs() {
  return integerEnv("RAIDERIO_REQUEST_TIMEOUT_MS", DEFAULT_RAIDERIO_REQUEST_TIMEOUT_MS, 2_500, 30_000);
}

function envRaiderIoRequestRetries() {
  return integerEnv("RAIDERIO_REQUEST_RETRIES", DEFAULT_RAIDERIO_REQUEST_RETRIES, 0, 4);
}

function envRaiderIoRateLimitCooldownSeconds() {
  return integerEnv("RAIDERIO_RATE_LIMIT_COOLDOWN_SECONDS", DEFAULT_RAIDERIO_RATE_LIMIT_COOLDOWN_SECONDS, 60, 86_400);
}

function envRaiderIoRequestMinDelayMs() {
  return integerEnv("RAIDERIO_REQUEST_MIN_DELAY_MS", DEFAULT_RAIDERIO_REQUEST_MIN_DELAY_MS, 0, 10_000);
}

function envBattleNetRequestTimeoutMs() {
  return integerEnv("BATTLENET_REQUEST_TIMEOUT_MS", DEFAULT_BATTLENET_REQUEST_TIMEOUT_MS, 2_500, 30_000);
}

function envBattleNetRequestRetries() {
  return integerEnv("BATTLENET_REQUEST_RETRIES", DEFAULT_BATTLENET_REQUEST_RETRIES, 0, 5);
}

function envProfileReadCacheTtlMs() {
  return integerEnv("PROFILE_READ_CACHE_TTL_MS", ecoFallback(DEFAULT_PROFILE_READ_CACHE_TTL_MS, DEFAULT_ECO_PROFILE_READ_CACHE_TTL_MS), 30_000, 300_000);
}

function envProfileListCacheTtlMs() {
  return integerEnv("PROFILE_LIST_CACHE_TTL_MS", ecoFallback(DEFAULT_PROFILE_LIST_CACHE_TTL_MS, DEFAULT_ECO_PROFILE_LIST_CACHE_TTL_MS), 30_000, 300_000);
}

function envProfileCharacterLinksCacheTtlMs() {
  return integerEnv("PROFILE_CHARACTER_LINKS_CACHE_TTL_MS", ecoFallback(DEFAULT_PROFILE_CHARACTER_LINKS_CACHE_TTL_MS, DEFAULT_ECO_PROFILE_CHARACTER_LINKS_CACHE_TTL_MS), 30_000, 600_000);
}

function envRaidListCacheTtlMs() {
  return integerEnv("RAID_LIST_CACHE_TTL_MS", ecoFallback(DEFAULT_RAID_LIST_CACHE_TTL_MS, DEFAULT_ECO_RAID_LIST_CACHE_TTL_MS), 30_000, 300_000);
}

function envRaidItemCacheTtlMs() {
  return integerEnv("RAID_ITEM_CACHE_TTL_MS", ecoFallback(DEFAULT_RAID_ITEM_CACHE_TTL_MS, DEFAULT_ECO_RAID_ITEM_CACHE_TTL_MS), 10_000, 300_000);
}

function envRaidDiscordDeleteAfterStartHours() {
  return integerEnv("RAID_DISCORD_DELETE_AFTER_START_HOURS", DEFAULT_RAID_DISCORD_DELETE_AFTER_START_HOURS, 0, 168);
}

function envGuildRosterRecordsChunkSize() {
  return integerEnv("GUILD_ROSTER_RECORDS_CHUNK_SIZE", DEFAULT_GUILD_ROSTER_RECORDS_CHUNK_SIZE, 25, 120);
}

function envGuildRosterReadLegacyMemberDocs() {
  const raw = cleanText(process.env.GUILD_ROSTER_READ_LEGACY_MEMBER_DOCS, 20);
  if (!raw) return DEFAULT_GUILD_ROSTER_READ_LEGACY_MEMBER_DOCS;
  return booleanValue(raw, DEFAULT_GUILD_ROSTER_READ_LEGACY_MEMBER_DOCS);
}

function envGuildRosterWriteLegacyMemberDocs() {
  const raw = cleanText(process.env.GUILD_ROSTER_WRITE_LEGACY_MEMBER_DOCS, 20);
  if (!raw) return DEFAULT_GUILD_ROSTER_WRITE_LEGACY_MEMBER_DOCS;
  return booleanValue(raw, DEFAULT_GUILD_ROSTER_WRITE_LEGACY_MEMBER_DOCS);
}

function envAuditLogReadCacheTtlMs() {
  return integerEnv("ADMIN_AUDIT_READ_CACHE_TTL_MS", ecoFallback(DEFAULT_AUDIT_LOG_READ_CACHE_TTL_MS, DEFAULT_ECO_AUDIT_LOG_READ_CACHE_TTL_MS), 10_000, 120_000);
}

function envAuditLogDedupeWindowMs() {
  return integerEnv("ADMIN_AUDIT_DEDUPE_WINDOW_MS", DEFAULT_AUDIT_LOG_DEDUPE_WINDOW_MS, 0, 600_000);
}

function envAuditLogMaxStored() {
  return integerEnv("ADMIN_AUDIT_MAX_STORED", ecoFallback(DEFAULT_AUDIT_LOG_MAX_STORED, DEFAULT_ECO_AUDIT_LOG_MAX_STORED), 100, 1000);
}

function envRaiderIoCharacterCacheTtlMs() {
  return integerEnv("RAIDERIO_CHARACTER_CACHE_TTL_MS", ecoFallback(DEFAULT_CHARACTER_CACHE_TTL_MS, DEFAULT_ECO_CHARACTER_CACHE_TTL_MS), 0, MAX_CHARACTER_CACHE_TTL_MS);
}

function envGuildRosterMemberLimit() {
  return integerEnv("GUILD_ROSTER_MEMBER_LIMIT", DEFAULT_GUILD_ROSTER_MEMBER_LIMIT, 1, 1000);
}

function envGuildRosterRefreshStepBudgetMs() {
  return integerEnv("GUILD_ROSTER_REFRESH_STEP_BUDGET_MS", ecoFallback(DEFAULT_GUILD_ROSTER_REFRESH_STEP_BUDGET_MS, DEFAULT_ECO_GUILD_ROSTER_REFRESH_STEP_BUDGET_MS), 5_000, 38_000);
}

function envGuildRosterSyncJobTtlSeconds() {
  return integerEnv("GUILD_ROSTER_SYNC_JOB_TTL_SECONDS", DEFAULT_GUILD_ROSTER_SYNC_JOB_TTL_SECONDS, 5 * 60, 6 * 60 * 60);
}

function envGuildRosterShardedCacheEnabled() {
  const raw = cleanText(process.env.GUILD_ROSTER_SHARDED_CACHE_ENABLED, 20);
  if (!raw) return DEFAULT_GUILD_ROSTER_SHARDED_CACHE_ENABLED;
  return booleanValue(raw, DEFAULT_GUILD_ROSTER_SHARDED_CACHE_ENABLED);
}

function envGuildRosterShardedCacheThreshold() {
  return integerEnv("GUILD_ROSTER_SHARDED_CACHE_THRESHOLD", DEFAULT_GUILD_ROSTER_SHARDED_CACHE_THRESHOLD, 1, 1000);
}

function envGuildRosterBattleNetStepSize() {
  return integerEnv("GUILD_ROSTER_BATTLENET_STEP_SIZE", ecoFallback(DEFAULT_GUILD_ROSTER_BATTLENET_STEP_SIZE, DEFAULT_ECO_GUILD_ROSTER_BATTLENET_STEP_SIZE), 0, 100);
}

function envGuildRosterBattleNetTtlSeconds() {
  return integerEnv("GUILD_ROSTER_BATTLENET_TTL_SECONDS", ecoFallback(DEFAULT_GUILD_ROSTER_BATTLENET_TTL_SECONDS, DEFAULT_ECO_GUILD_ROSTER_BATTLENET_TTL_SECONDS), 300, 604_800);
}

function envGuildRosterRaiderIoStepSize() {
  const fallback = ecoFallback(DEFAULT_GUILD_ROSTER_RAIDERIO_STEP_SIZE, DEFAULT_ECO_GUILD_ROSTER_RAIDERIO_STEP_SIZE);
  return integerEnv(
    "GUILD_ROSTER_RAIDERIO_STEP_SIZE",
    integerEnv("GUILD_ROSTER_RAIDERIO_BATCH_SIZE", fallback, 0, 100),
    0,
    100,
  );
}

function envGuildRosterRaiderIoTtlSeconds() {
  return integerEnv("GUILD_ROSTER_RAIDERIO_TTL_SECONDS", ecoFallback(DEFAULT_GUILD_ROSTER_RAIDERIO_TTL_SECONDS, DEFAULT_ECO_GUILD_ROSTER_RAIDERIO_TTL_SECONDS), 300, 604_800);
}

function envGuildRosterClientDrivenSyncEnabled() {
  const raw = cleanText(process.env.GUILD_ROSTER_CLIENT_DRIVEN_SYNC_ENABLED, 20);
  const fallback = ecoFlagFallback(DEFAULT_GUILD_ROSTER_CLIENT_DRIVEN_SYNC_ENABLED, DEFAULT_ECO_GUILD_ROSTER_CLIENT_DRIVEN_SYNC_ENABLED);
  if (!raw) return fallback;
  return booleanValue(raw, fallback);
}

function envGuildRosterClientStepDelayMs() {
  return integerEnv("GUILD_ROSTER_CLIENT_STEP_DELAY_MS", DEFAULT_GUILD_ROSTER_CLIENT_STEP_DELAY_MS, 0, 5_000);
}

function envGuildRosterClientRequestTimeoutMs() {
  return integerEnv("GUILD_ROSTER_CLIENT_REQUEST_TIMEOUT_MS", DEFAULT_GUILD_ROSTER_CLIENT_REQUEST_TIMEOUT_MS, 5_000, 60_000);
}

function envGuildRosterClientMaxSteps() {
  return integerEnv("GUILD_ROSTER_CLIENT_MAX_STEPS", DEFAULT_GUILD_ROSTER_CLIENT_MAX_STEPS, 1, 10_000);
}

function defaultDashboardApiSettings(): DashboardApiSettings {
  const backgroundRefreshFallbackSeconds = ecoFallback(MIN_BACKGROUND_REFRESH_SECONDS, 30 * 60);
  const backgroundRefreshMinSeconds = integerEnv(
    "DASHBOARD_BACKGROUND_REFRESH_MIN_SECONDS",
    integerEnv("PROFILE_VIEW_REFRESH_MIN_SECONDS", backgroundRefreshFallbackSeconds, MIN_BACKGROUND_REFRESH_SECONDS, MAX_REFRESH_SECONDS),
    MIN_BACKGROUND_REFRESH_SECONDS,
    MAX_REFRESH_SECONDS,
  );
  const profileViewRefreshMinSeconds = integerEnv(
    "PROFILE_VIEW_REFRESH_MIN_SECONDS",
    backgroundRefreshMinSeconds,
    MIN_BACKGROUND_REFRESH_SECONDS,
    MAX_REFRESH_SECONDS,
  );

  return {
    backgroundRefreshMinSeconds,
    profileViewRefreshMinSeconds,
    profileExternalRefreshMinSeconds: integerEnv("PROFILE_EXTERNAL_REFRESH_MIN_SECONDS", ecoFallback(30 * 60, 6 * 60 * 60), MIN_BACKGROUND_REFRESH_SECONDS, MAX_REFRESH_SECONDS),
    profileExternalRefreshBatchLimit: integerEnv("PROFILE_EXTERNAL_REFRESH_BATCH_LIMIT", ecoFallback(50, 10), 1, 500),
    profileCharacterRefreshConcurrency: integerEnv("PROFILE_CHARACTER_REFRESH_CONCURRENCY", 0, 0, 8),
    profileCharacterRefreshMaxConcurrency: integerEnv("PROFILE_CHARACTER_REFRESH_MAX_CONCURRENCY", 8, 1, 8),
    profileExternalRefreshConcurrency: integerEnv("PROFILE_EXTERNAL_REFRESH_CONCURRENCY", 0, 0, 6),
    profileExternalRefreshMaxConcurrency: integerEnv("PROFILE_EXTERNAL_REFRESH_MAX_CONCURRENCY", 6, 1, 6),
    dashboardApiDebugAuditLogs: envDashboardApiDebugAuditLogs(),
    dashboardApiWarningAuditLogs: envDashboardApiWarningAuditLogs(),
    guildRosterRegion: envGuildRosterRegion(),
    guildRosterRealm: envGuildRosterRealm(),
    guildRosterName: envGuildRosterName(),
    guildRosterCacheTtlSeconds: envGuildRosterCacheTtlSeconds(),
    guildRosterCacheReadTtlMs: envGuildRosterCacheReadTtlMs(),
    guildRosterCacheWriteBatchSize: envGuildRosterCacheWriteBatchSize(),
    guildRosterCacheDeleteStaleMembers: envGuildRosterCacheDeleteStaleMembers(),
    guildRosterRefreshConcurrency: envGuildRosterRefreshConcurrency(),
    guildRosterRefreshMaxConcurrency: envGuildRosterRefreshMaxConcurrency(),
    raiderIoRequestTimeoutMs: envRaiderIoRequestTimeoutMs(),
    raiderIoRequestRetries: envRaiderIoRequestRetries(),
    raiderIoRateLimitCooldownSeconds: envRaiderIoRateLimitCooldownSeconds(),
    raiderIoRequestMinDelayMs: envRaiderIoRequestMinDelayMs(),
    battleNetRequestTimeoutMs: envBattleNetRequestTimeoutMs(),
    battleNetRequestRetries: envBattleNetRequestRetries(),
    profileReadCacheTtlMs: envProfileReadCacheTtlMs(),
    profileListCacheTtlMs: envProfileListCacheTtlMs(),
    profileCharacterLinksCacheTtlMs: envProfileCharacterLinksCacheTtlMs(),
    raidListCacheTtlMs: envRaidListCacheTtlMs(),
    raidItemCacheTtlMs: envRaidItemCacheTtlMs(),
    raidDiscordDeleteAfterStartHours: envRaidDiscordDeleteAfterStartHours(),
    guildRosterRecordsChunkSize: envGuildRosterRecordsChunkSize(),
    guildRosterReadLegacyMemberDocs: envGuildRosterReadLegacyMemberDocs(),
    guildRosterWriteLegacyMemberDocs: envGuildRosterWriteLegacyMemberDocs(),
    auditLogReadCacheTtlMs: envAuditLogReadCacheTtlMs(),
    auditLogDedupeWindowMs: envAuditLogDedupeWindowMs(),
    auditLogMaxStored: envAuditLogMaxStored(),
    raiderIoCharacterCacheTtlMs: envRaiderIoCharacterCacheTtlMs(),
    guildRosterMemberLimit: envGuildRosterMemberLimit(),
    guildRosterRefreshStepBudgetMs: envGuildRosterRefreshStepBudgetMs(),
    guildRosterSyncJobTtlSeconds: envGuildRosterSyncJobTtlSeconds(),
    guildRosterShardedCacheEnabled: envGuildRosterShardedCacheEnabled(),
    guildRosterShardedCacheThreshold: envGuildRosterShardedCacheThreshold(),
    guildRosterBattleNetStepSize: envGuildRosterBattleNetStepSize(),
    guildRosterBattleNetTtlSeconds: envGuildRosterBattleNetTtlSeconds(),
    guildRosterRaiderIoStepSize: envGuildRosterRaiderIoStepSize(),
    guildRosterRaiderIoTtlSeconds: envGuildRosterRaiderIoTtlSeconds(),
    guildRosterClientDrivenSyncEnabled: envGuildRosterClientDrivenSyncEnabled(),
    guildRosterClientStepDelayMs: envGuildRosterClientStepDelayMs(),
    guildRosterClientRequestTimeoutMs: envGuildRosterClientRequestTimeoutMs(),
    guildRosterClientMaxSteps: envGuildRosterClientMaxSteps(),
    updatedAt: null,
    updatedBy: null,
    source: "defaults",
  };
}

function normalizeSettings(
  data?: DashboardApiSettingsInput | null,
  source: DashboardApiSettingsSource = "firestore",
): DashboardApiSettings {
  const fallback = defaultDashboardApiSettings();
  const backgroundRefreshMinSeconds = integerValue(data?.backgroundRefreshMinSeconds, fallback.backgroundRefreshMinSeconds, MIN_BACKGROUND_REFRESH_SECONDS, MAX_REFRESH_SECONDS);
  const profileViewRefreshMinSeconds = integerValue(data?.profileViewRefreshMinSeconds, fallback.profileViewRefreshMinSeconds, MIN_BACKGROUND_REFRESH_SECONDS, MAX_REFRESH_SECONDS);
  const profileCharacterRefreshMaxConcurrency = integerValue(data?.profileCharacterRefreshMaxConcurrency, fallback.profileCharacterRefreshMaxConcurrency, 1, 8);
  const profileExternalRefreshMaxConcurrency = integerValue(data?.profileExternalRefreshMaxConcurrency, fallback.profileExternalRefreshMaxConcurrency, 1, 6);
  const guildRosterRefreshMaxConcurrency = integerValue(data?.guildRosterRefreshMaxConcurrency, fallback.guildRosterRefreshMaxConcurrency, 1, 12);

  return {
    backgroundRefreshMinSeconds,
    profileViewRefreshMinSeconds,
    profileExternalRefreshMinSeconds: integerValue(data?.profileExternalRefreshMinSeconds, fallback.profileExternalRefreshMinSeconds, MIN_BACKGROUND_REFRESH_SECONDS, MAX_REFRESH_SECONDS),
    profileExternalRefreshBatchLimit: integerValue(data?.profileExternalRefreshBatchLimit, fallback.profileExternalRefreshBatchLimit, 1, 500),
    profileCharacterRefreshConcurrency: integerValue(data?.profileCharacterRefreshConcurrency, fallback.profileCharacterRefreshConcurrency, 0, profileCharacterRefreshMaxConcurrency),
    profileCharacterRefreshMaxConcurrency,
    profileExternalRefreshConcurrency: integerValue(data?.profileExternalRefreshConcurrency, fallback.profileExternalRefreshConcurrency, 0, profileExternalRefreshMaxConcurrency),
    profileExternalRefreshMaxConcurrency,
    dashboardApiDebugAuditLogs: booleanValue(data?.dashboardApiDebugAuditLogs, fallback.dashboardApiDebugAuditLogs),
    dashboardApiWarningAuditLogs: booleanValue(data?.dashboardApiWarningAuditLogs, fallback.dashboardApiWarningAuditLogs),
    guildRosterRegion: cleanText(data?.guildRosterRegion, 20).toLowerCase() || fallback.guildRosterRegion,
    guildRosterRealm: cleanText(data?.guildRosterRealm, 80).toLowerCase() || fallback.guildRosterRealm,
    guildRosterName: cleanText(data?.guildRosterName, 120) || fallback.guildRosterName,
    guildRosterCacheTtlSeconds: integerValue(data?.guildRosterCacheTtlSeconds, fallback.guildRosterCacheTtlSeconds, 300, 86_400),
    guildRosterCacheReadTtlMs: integerValue(data?.guildRosterCacheReadTtlMs, fallback.guildRosterCacheReadTtlMs, 30_000, 300_000),
    guildRosterCacheWriteBatchSize: integerValue(data?.guildRosterCacheWriteBatchSize, fallback.guildRosterCacheWriteBatchSize, 1, 250),
    guildRosterCacheDeleteStaleMembers: booleanValue(data?.guildRosterCacheDeleteStaleMembers, fallback.guildRosterCacheDeleteStaleMembers),
    guildRosterRefreshConcurrency: integerValue(data?.guildRosterRefreshConcurrency, fallback.guildRosterRefreshConcurrency, 1, guildRosterRefreshMaxConcurrency),
    guildRosterRefreshMaxConcurrency,
    raiderIoRequestTimeoutMs: integerValue(data?.raiderIoRequestTimeoutMs, fallback.raiderIoRequestTimeoutMs, 2_500, 30_000),
    raiderIoRequestRetries: integerValue(data?.raiderIoRequestRetries, fallback.raiderIoRequestRetries, 0, 4),
    raiderIoRateLimitCooldownSeconds: integerValue(data?.raiderIoRateLimitCooldownSeconds, fallback.raiderIoRateLimitCooldownSeconds, 60, 86_400),
    raiderIoRequestMinDelayMs: integerValue(data?.raiderIoRequestMinDelayMs, fallback.raiderIoRequestMinDelayMs, 0, 10_000),
    battleNetRequestTimeoutMs: integerValue(data?.battleNetRequestTimeoutMs, fallback.battleNetRequestTimeoutMs, 2_500, 30_000),
    battleNetRequestRetries: integerValue(data?.battleNetRequestRetries, fallback.battleNetRequestRetries, 0, 5),
    profileReadCacheTtlMs: integerValue(data?.profileReadCacheTtlMs, fallback.profileReadCacheTtlMs, 30_000, 300_000),
    profileListCacheTtlMs: integerValue(data?.profileListCacheTtlMs, fallback.profileListCacheTtlMs, 30_000, 300_000),
    profileCharacterLinksCacheTtlMs: integerValue(data?.profileCharacterLinksCacheTtlMs, fallback.profileCharacterLinksCacheTtlMs, 30_000, 600_000),
    raidListCacheTtlMs: integerValue(data?.raidListCacheTtlMs, fallback.raidListCacheTtlMs, 30_000, 300_000),
    raidItemCacheTtlMs: integerValue(data?.raidItemCacheTtlMs, fallback.raidItemCacheTtlMs, 10_000, 300_000),
    raidDiscordDeleteAfterStartHours: integerValue(data?.raidDiscordDeleteAfterStartHours, fallback.raidDiscordDeleteAfterStartHours, 0, 168),
    guildRosterRecordsChunkSize: integerValue(data?.guildRosterRecordsChunkSize, fallback.guildRosterRecordsChunkSize, 25, 120),
    guildRosterReadLegacyMemberDocs: booleanValue(data?.guildRosterReadLegacyMemberDocs, fallback.guildRosterReadLegacyMemberDocs),
    guildRosterWriteLegacyMemberDocs: booleanValue(data?.guildRosterWriteLegacyMemberDocs, fallback.guildRosterWriteLegacyMemberDocs),
    auditLogReadCacheTtlMs: integerValue(data?.auditLogReadCacheTtlMs, fallback.auditLogReadCacheTtlMs, 10_000, 120_000),
    auditLogDedupeWindowMs: integerValue(data?.auditLogDedupeWindowMs, fallback.auditLogDedupeWindowMs, 0, 600_000),
    auditLogMaxStored: integerValue(data?.auditLogMaxStored, fallback.auditLogMaxStored, 100, 1000),
    raiderIoCharacterCacheTtlMs: integerValue(data?.raiderIoCharacterCacheTtlMs, fallback.raiderIoCharacterCacheTtlMs, 0, MAX_CHARACTER_CACHE_TTL_MS),
    guildRosterMemberLimit: integerValue(data?.guildRosterMemberLimit, fallback.guildRosterMemberLimit, 1, 1000),
    guildRosterRefreshStepBudgetMs: integerValue(data?.guildRosterRefreshStepBudgetMs, fallback.guildRosterRefreshStepBudgetMs, 5_000, 38_000),
    guildRosterSyncJobTtlSeconds: integerValue(data?.guildRosterSyncJobTtlSeconds, fallback.guildRosterSyncJobTtlSeconds, 5 * 60, 6 * 60 * 60),
    guildRosterShardedCacheEnabled: booleanValue(data?.guildRosterShardedCacheEnabled, fallback.guildRosterShardedCacheEnabled),
    guildRosterShardedCacheThreshold: integerValue(data?.guildRosterShardedCacheThreshold, fallback.guildRosterShardedCacheThreshold, 1, 1000),
    guildRosterBattleNetStepSize: integerValue(data?.guildRosterBattleNetStepSize, fallback.guildRosterBattleNetStepSize, 0, 100),
    guildRosterBattleNetTtlSeconds: integerValue(data?.guildRosterBattleNetTtlSeconds, fallback.guildRosterBattleNetTtlSeconds, 300, 604_800),
    guildRosterRaiderIoStepSize: integerValue(data?.guildRosterRaiderIoStepSize, fallback.guildRosterRaiderIoStepSize, 0, 100),
    guildRosterRaiderIoTtlSeconds: integerValue(data?.guildRosterRaiderIoTtlSeconds, fallback.guildRosterRaiderIoTtlSeconds, 300, 604_800),
    guildRosterClientDrivenSyncEnabled: booleanValue(data?.guildRosterClientDrivenSyncEnabled, fallback.guildRosterClientDrivenSyncEnabled),
    guildRosterClientStepDelayMs: integerValue(data?.guildRosterClientStepDelayMs, fallback.guildRosterClientStepDelayMs, 0, 5_000),
    guildRosterClientRequestTimeoutMs: integerValue(data?.guildRosterClientRequestTimeoutMs, fallback.guildRosterClientRequestTimeoutMs, 5_000, 60_000),
    guildRosterClientMaxSteps: integerValue(data?.guildRosterClientMaxSteps, fallback.guildRosterClientMaxSteps, 1, 10_000),
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
    source,
  };
}

export async function getDashboardApiSettings(options: { bypassCache?: boolean } = {}): Promise<DashboardApiSettings> {
  if (!options.bypassCache && settingsCacheFresh()) {
    return globalThis.__mistblossomDashboardApiSettingsCache!.settings;
  }

  if (!hasFirebaseProfileConfig()) return setSettingsCache(defaultDashboardApiSettings());

  const settings = await resilientRead(
    "dashboard-api-settings",
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(DASHBOARD_API_SETTINGS_DOC_ID)
        .get();
      return snapshot.exists
        ? normalizeSettings(snapshot.data() || null, "firestore")
        : globalThis.__mistblossomDashboardApiSettingsCache?.settings || defaultDashboardApiSettings();
    },
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      timeoutMs: 2_500,
      circuitKey: "firebase-settings-read",
      circuitTtlMs: 90_000,
      bypassCache: Boolean(options.bypassCache),
      fallback: () => globalThis.__mistblossomDashboardApiSettingsCache?.settings || defaultDashboardApiSettings(),
      logEvent: "dashboard_api.settings_read_failed",
    },
  );

  return setSettingsCache(settings);
}

export async function setDashboardApiSettings(input: DashboardApiSettingsInput, actor?: DashboardSession | null) {
  if (!hasFirebaseProfileConfig()) {
    throw new Error("Firebase не налаштований для збереження параметрів фонового API.");
  }

  const doc = getFirebaseAdminDb()
    .collection(SETTINGS_COLLECTION)
    .doc(DASHBOARD_API_SETTINGS_DOC_ID);
  const settings = normalizeSettings(input, "firestore");

  const payload: Record<string, unknown> = {
    backgroundRefreshMinSeconds: settings.backgroundRefreshMinSeconds,
    profileViewRefreshMinSeconds: settings.profileViewRefreshMinSeconds,
    profileExternalRefreshMinSeconds: settings.profileExternalRefreshMinSeconds,
    profileExternalRefreshBatchLimit: settings.profileExternalRefreshBatchLimit,
    profileCharacterRefreshConcurrency: settings.profileCharacterRefreshConcurrency,
    profileCharacterRefreshMaxConcurrency: settings.profileCharacterRefreshMaxConcurrency,
    profileExternalRefreshConcurrency: settings.profileExternalRefreshConcurrency,
    profileExternalRefreshMaxConcurrency: settings.profileExternalRefreshMaxConcurrency,
    dashboardApiDebugAuditLogs: settings.dashboardApiDebugAuditLogs,
    dashboardApiWarningAuditLogs: settings.dashboardApiWarningAuditLogs,
    guildRosterRegion: settings.guildRosterRegion,
    guildRosterRealm: settings.guildRosterRealm,
    guildRosterName: settings.guildRosterName,
    guildRosterCacheTtlSeconds: settings.guildRosterCacheTtlSeconds,
    guildRosterCacheReadTtlMs: settings.guildRosterCacheReadTtlMs,
    guildRosterCacheWriteBatchSize: settings.guildRosterCacheWriteBatchSize,
    guildRosterCacheDeleteStaleMembers: settings.guildRosterCacheDeleteStaleMembers,
    guildRosterRefreshConcurrency: settings.guildRosterRefreshConcurrency,
    guildRosterRefreshMaxConcurrency: settings.guildRosterRefreshMaxConcurrency,
    raiderIoRequestTimeoutMs: settings.raiderIoRequestTimeoutMs,
    raiderIoRequestRetries: settings.raiderIoRequestRetries,
    raiderIoRateLimitCooldownSeconds: settings.raiderIoRateLimitCooldownSeconds,
    raiderIoRequestMinDelayMs: settings.raiderIoRequestMinDelayMs,
    battleNetRequestTimeoutMs: settings.battleNetRequestTimeoutMs,
    battleNetRequestRetries: settings.battleNetRequestRetries,
    profileReadCacheTtlMs: settings.profileReadCacheTtlMs,
    profileListCacheTtlMs: settings.profileListCacheTtlMs,
    profileCharacterLinksCacheTtlMs: settings.profileCharacterLinksCacheTtlMs,
    raidListCacheTtlMs: settings.raidListCacheTtlMs,
    raidItemCacheTtlMs: settings.raidItemCacheTtlMs,
    raidDiscordDeleteAfterStartHours: settings.raidDiscordDeleteAfterStartHours,
    guildRosterRecordsChunkSize: settings.guildRosterRecordsChunkSize,
    guildRosterReadLegacyMemberDocs: settings.guildRosterReadLegacyMemberDocs,
    guildRosterWriteLegacyMemberDocs: settings.guildRosterWriteLegacyMemberDocs,
    auditLogReadCacheTtlMs: settings.auditLogReadCacheTtlMs,
    auditLogDedupeWindowMs: settings.auditLogDedupeWindowMs,
    auditLogMaxStored: settings.auditLogMaxStored,
    raiderIoCharacterCacheTtlMs: settings.raiderIoCharacterCacheTtlMs,
    guildRosterMemberLimit: settings.guildRosterMemberLimit,
    guildRosterRefreshStepBudgetMs: settings.guildRosterRefreshStepBudgetMs,
    guildRosterSyncJobTtlSeconds: settings.guildRosterSyncJobTtlSeconds,
    guildRosterShardedCacheEnabled: settings.guildRosterShardedCacheEnabled,
    guildRosterShardedCacheThreshold: settings.guildRosterShardedCacheThreshold,
    guildRosterBattleNetStepSize: settings.guildRosterBattleNetStepSize,
    guildRosterBattleNetTtlSeconds: settings.guildRosterBattleNetTtlSeconds,
    guildRosterRaiderIoStepSize: settings.guildRosterRaiderIoStepSize,
    guildRosterRaiderIoTtlSeconds: settings.guildRosterRaiderIoTtlSeconds,
    guildRosterClientDrivenSyncEnabled: settings.guildRosterClientDrivenSyncEnabled,
    guildRosterClientStepDelayMs: settings.guildRosterClientStepDelayMs,
    guildRosterClientRequestTimeoutMs: settings.guildRosterClientRequestTimeoutMs,
    guildRosterClientMaxSteps: settings.guildRosterClientMaxSteps,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  };

  await firebaseWrite(
    "settings",
    "dashboard-api-settings:save",
    () => doc.set(payload, { merge: true }),
    { timeoutMs: 3_000, logEvent: "dashboard_api.settings_write_failed" },
  );

  return setSettingsCache({
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
    source: "firestore",
  });
}

export async function getExternalCharacterDataSettings() {
  const settings = await getDashboardApiSettings();
  return {
    raiderIoCharacterCacheTtlMs: settings.raiderIoCharacterCacheTtlMs,
  };
}

export async function getGuildRosterSyncSettings() {
  const settings = await getDashboardApiSettings();
  return {
    region: settings.guildRosterRegion,
    realm: settings.guildRosterRealm,
    guildName: settings.guildRosterName,
    cacheTtlSeconds: settings.guildRosterCacheTtlSeconds,
    cacheReadTtlMs: settings.guildRosterCacheReadTtlMs,
    cacheWriteBatchSize: settings.guildRosterCacheWriteBatchSize,
    recordsChunkSize: settings.guildRosterRecordsChunkSize,
    readLegacyMemberDocs: settings.guildRosterReadLegacyMemberDocs,
    writeLegacyMemberDocs: settings.guildRosterWriteLegacyMemberDocs,
    cacheDeleteStaleMembers: settings.guildRosterCacheDeleteStaleMembers,
    refreshConcurrency: settings.guildRosterRefreshConcurrency,
    refreshMaxConcurrency: settings.guildRosterRefreshMaxConcurrency,
    raiderIoRequestTimeoutMs: settings.raiderIoRequestTimeoutMs,
    raiderIoRequestRetries: settings.raiderIoRequestRetries,
    raiderIoRateLimitCooldownSeconds: settings.raiderIoRateLimitCooldownSeconds,
    raiderIoRequestMinDelayMs: settings.raiderIoRequestMinDelayMs,
    battleNetRequestTimeoutMs: settings.battleNetRequestTimeoutMs,
    battleNetRequestRetries: settings.battleNetRequestRetries,
    memberLimit: settings.guildRosterMemberLimit,
    stepBudgetMs: settings.guildRosterRefreshStepBudgetMs,
    syncJobTtlSeconds: settings.guildRosterSyncJobTtlSeconds,
    shardedCacheEnabled: settings.guildRosterShardedCacheEnabled,
    shardedCacheThreshold: settings.guildRosterShardedCacheThreshold,
    battleNetStepSize: settings.guildRosterBattleNetStepSize,
    battleNetTtlSeconds: settings.guildRosterBattleNetTtlSeconds,
    raiderIoStepSize: settings.guildRosterRaiderIoStepSize,
    raiderIoTtlSeconds: settings.guildRosterRaiderIoTtlSeconds,
    clientDrivenSyncEnabled: settings.guildRosterClientDrivenSyncEnabled,
    clientStepDelayMs: settings.guildRosterClientStepDelayMs,
    clientRequestTimeoutMs: settings.guildRosterClientRequestTimeoutMs,
    clientMaxSteps: settings.guildRosterClientMaxSteps,
    debugAuditLogs: settings.dashboardApiDebugAuditLogs,
    warningAuditLogs: settings.dashboardApiWarningAuditLogs,
  };
}

export async function getSiteRuntimeSettings() {
  const settings = await getDashboardApiSettings();
  return {
    profileReadCacheTtlMs: settings.profileReadCacheTtlMs,
    profileListCacheTtlMs: settings.profileListCacheTtlMs,
    profileCharacterLinksCacheTtlMs: settings.profileCharacterLinksCacheTtlMs,
    raidListCacheTtlMs: settings.raidListCacheTtlMs,
    raidItemCacheTtlMs: settings.raidItemCacheTtlMs,
    raidDiscordDeleteAfterStartHours: settings.raidDiscordDeleteAfterStartHours,
    auditLogReadCacheTtlMs: settings.auditLogReadCacheTtlMs,
    auditLogDedupeWindowMs: settings.auditLogDedupeWindowMs,
    auditLogMaxStored: settings.auditLogMaxStored,
    dashboardApiWarningAuditLogs: settings.dashboardApiWarningAuditLogs,
    dashboardApiDebugAuditLogs: settings.dashboardApiDebugAuditLogs,
  };
}

export async function getAuditLogRuntimeSettings() {
  const settings = await getDashboardApiSettings();
  return {
    readCacheTtlMs: settings.auditLogReadCacheTtlMs,
    dedupeWindowMs: settings.auditLogDedupeWindowMs,
    maxStored: settings.auditLogMaxStored,
    debugAuditLogs: settings.dashboardApiDebugAuditLogs,
    warningAuditLogs: settings.dashboardApiWarningAuditLogs,
  };
}

export function dashboardApiSettingsSummary(settings: DashboardApiSettings) {
  const rosterSync = `Guild roster: ${settings.guildRosterName}-${settings.guildRosterRealm}-${settings.guildRosterRegion}; ${settings.guildRosterMemberLimit} перс.; Battle.net крок ${settings.guildRosterBattleNetStepSize}; Raider.IO крок ${settings.guildRosterRaiderIoStepSize}; cooldown ${settings.raiderIoRateLimitCooldownSeconds}с; кеш ${settings.guildRosterCacheTtlSeconds}с; бюджет ${settings.guildRosterRefreshStepBudgetMs}мс; client ${settings.guildRosterClientDrivenSyncEnabled ? "ON" : "OFF"}`;
  const apiDebug = `Discord audit: debug ${settings.dashboardApiDebugAuditLogs ? "ON" : "OFF"}, warnings ${settings.dashboardApiWarningAuditLogs ? "ON" : "OFF"}, read cache ${Math.round(settings.auditLogReadCacheTtlMs / 1000)}с, dedupe ${Math.round(settings.auditLogDedupeWindowMs / 1000)}с`;
  return `Оновлення: ${Math.round(settings.backgroundRefreshMinSeconds / 60)} хв; Discord-рейди закриваються через ${settings.raidDiscordDeleteAfterStartHours} год після старту; персонажі: ${Math.round(settings.profileViewRefreshMinSeconds / 60)} хв; batch: ${settings.profileExternalRefreshBatchLimit}; ${apiDebug}; ${rosterSync}; chunks ${settings.guildRosterRecordsChunkSize}; legacy read ${settings.guildRosterReadLegacyMemberDocs ? "ON" : "OFF"}; legacy write ${settings.guildRosterWriteLegacyMemberDocs ? "ON" : "OFF"}.`;
}

export function dashboardApiSettingsMinBackgroundRefreshSeconds() {
  return MIN_BACKGROUND_REFRESH_SECONDS;
}
