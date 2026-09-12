import "server-only";

import type { DashboardSession } from "@/lib/auth";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { resilientRead } from "@/lib/runtimeResilience";
import { timestampToIso } from "@/lib/values";

const SETTINGS_COLLECTION = "dashboardSettings";
const SETTINGS_DOC_ID = "accountCleanupAutomation";
const CACHE_TTL_MS = 15_000;
const MAX_RECENT_RUNS = 8;

export type AccountCleanupRunMode = "inspect" | "apply";

export type AccountCleanupExecutionLock = {
  source: string;
  startedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAccountCleanupExecutionLock: AccountCleanupExecutionLock | undefined;
}

export function acquireAccountCleanupExecutionLock(source: string) {
  const now = Date.now();
  const active = globalThis.__mistblossomAccountCleanupExecutionLock;
  // Defensive stale-lock expiry: one cleanup run should never be allowed to
  // block all future maintenance after an unexpected rejected promise.
  if (active && now - active.startedAt < 2 * 60 * 60_000) return null;
  const lock = { source: String(source || "unknown").slice(0, 80), startedAt: now };
  globalThis.__mistblossomAccountCleanupExecutionLock = lock;
  let released = false;
  return {
    lock,
    release() {
      if (released) return;
      released = true;
      if (globalThis.__mistblossomAccountCleanupExecutionLock === lock) {
        globalThis.__mistblossomAccountCleanupExecutionLock = undefined;
      }
    },
  };
}

export function getAccountCleanupExecutionLock() {
  return globalThis.__mistblossomAccountCleanupExecutionLock || null;
}
export type AccountCleanupRunSource = "automatic" | "manual";
export type AccountCleanupRunStatus = "success" | "warning" | "error";

export type AccountCleanupRunSummary = {
  id: string;
  mode: AccountCleanupRunMode;
  source: AccountCleanupRunSource;
  status: AccountCleanupRunStatus;
  startedAt: string;
  completedAt: string;
  checkedProfiles: number;
  candidates: number;
  deletedProfiles: number;
  removedRaidSignups: number;
  removedRosterPicks: number;
  removedPollVotes: number;
  errors: number;
  summary: string;
};

export type AccountCleanupAutomationSettings = {
  autoCheckEnabled: boolean;
  autoCleanupEnabled: boolean;
  checkIntervalHours: number;
  cleanupIntervalHours: number;
  profileLimit: number;
  lastCheckAt: string | null;
  lastCheckStatus: AccountCleanupRunStatus | null;
  lastCheckCandidates: number;
  lastCheckCheckedProfiles: number;
  lastCleanupAt: string | null;
  lastCleanupStatus: AccountCleanupRunStatus | null;
  lastCleanupDeletedProfiles: number;
  lastError: string | null;
  recentRuns: AccountCleanupRunSummary[];
  updatedAt: string | null;
  updatedBy: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAccountCleanupSettingsCache:
    | { value: AccountCleanupAutomationSettings; cachedAt: number }
    | undefined;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled", "увімкнено"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled", "вимкнено"].includes(text)) return false;
  return fallback;
}

function int(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function cleanStatus(value: unknown): AccountCleanupRunStatus | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "success" || text === "warning" || text === "error") return text;
  return null;
}

function cleanMode(value: unknown): AccountCleanupRunMode {
  return String(value ?? "").trim().toLowerCase() === "apply" ? "apply" : "inspect";
}

function cleanSource(value: unknown): AccountCleanupRunSource {
  return String(value ?? "").trim().toLowerCase() === "manual" ? "manual" : "automatic";
}

function defaultSettings(): AccountCleanupAutomationSettings {
  return {
    // Dry-run checks are safe, so they are enabled by default. Destructive cleanup
    // remains opt-in and is never silently enabled by a deployment.
    autoCheckEnabled: true,
    autoCleanupEnabled: false,
    checkIntervalHours: 6,
    cleanupIntervalHours: 24,
    profileLimit: 0,
    lastCheckAt: null,
    lastCheckStatus: null,
    lastCheckCandidates: 0,
    lastCheckCheckedProfiles: 0,
    lastCleanupAt: null,
    lastCleanupStatus: null,
    lastCleanupDeletedProfiles: 0,
    lastError: null,
    recentRuns: [],
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizeRun(value: unknown): AccountCleanupRunSummary | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Record<string, unknown>;
  const completedAt = timestampToIso(run.completedAt);
  const startedAt = timestampToIso(run.startedAt) || completedAt;
  if (!completedAt || !startedAt) return null;
  return {
    id: String(run.id || `${completedAt}:${run.mode || "inspect"}`).slice(0, 160),
    mode: cleanMode(run.mode),
    source: cleanSource(run.source),
    status: cleanStatus(run.status) || "warning",
    startedAt,
    completedAt,
    checkedProfiles: int(run.checkedProfiles, 0, 0, 1_000_000),
    candidates: int(run.candidates, 0, 0, 1_000_000),
    deletedProfiles: int(run.deletedProfiles, 0, 0, 1_000_000),
    removedRaidSignups: int(run.removedRaidSignups, 0, 0, 1_000_000),
    removedRosterPicks: int(run.removedRosterPicks, 0, 0, 1_000_000),
    removedPollVotes: int(run.removedPollVotes, 0, 0, 1_000_000),
    errors: int(run.errors, 0, 0, 1_000_000),
    summary: String(run.summary || "").slice(0, 1500),
  };
}

function normalizeSettings(data: Record<string, unknown> | null | undefined): AccountCleanupAutomationSettings {
  const fallback = defaultSettings();
  const recentRuns = Array.isArray(data?.recentRuns)
    ? data!.recentRuns.map(normalizeRun).filter(Boolean).slice(0, MAX_RECENT_RUNS) as AccountCleanupRunSummary[]
    : [];
  const autoCleanupEnabled = bool(data?.autoCleanupEnabled, fallback.autoCleanupEnabled);
  return {
    autoCheckEnabled: autoCleanupEnabled ? true : bool(data?.autoCheckEnabled, fallback.autoCheckEnabled),
    autoCleanupEnabled,
    checkIntervalHours: int(data?.checkIntervalHours, fallback.checkIntervalHours, 1, 168),
    cleanupIntervalHours: int(data?.cleanupIntervalHours, fallback.cleanupIntervalHours, 6, 336),
    profileLimit: int(data?.profileLimit, fallback.profileLimit, 0, 50_000),
    lastCheckAt: timestampToIso(data?.lastCheckAt),
    lastCheckStatus: cleanStatus(data?.lastCheckStatus),
    lastCheckCandidates: int(data?.lastCheckCandidates, 0, 0, 1_000_000),
    lastCheckCheckedProfiles: int(data?.lastCheckCheckedProfiles, 0, 0, 1_000_000),
    lastCleanupAt: timestampToIso(data?.lastCleanupAt),
    lastCleanupStatus: cleanStatus(data?.lastCleanupStatus),
    lastCleanupDeletedProfiles: int(data?.lastCleanupDeletedProfiles, 0, 0, 1_000_000),
    lastError: data?.lastError ? String(data.lastError).slice(0, 1500) : null,
    recentRuns,
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

function setCache(value: AccountCleanupAutomationSettings) {
  globalThis.__mistblossomAccountCleanupSettingsCache = { value, cachedAt: Date.now() };
  return value;
}

function cacheFresh() {
  const cached = globalThis.__mistblossomAccountCleanupSettingsCache;
  return Boolean(cached && Date.now() - cached.cachedAt < CACHE_TTL_MS);
}

export async function getAccountCleanupAutomationSettings(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cacheFresh()) return globalThis.__mistblossomAccountCleanupSettingsCache!.value;
  const fallback = globalThis.__mistblossomAccountCleanupSettingsCache?.value || defaultSettings();
  if (!hasFirebaseProfileConfig()) return setCache(fallback);

  const value = await resilientRead(
    "account-cleanup-automation-settings",
    async () => {
      const snapshot = await getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).get();
      return snapshot.exists ? normalizeSettings(snapshot.data() || null) : fallback;
    },
    {
      ttlMs: CACHE_TTL_MS,
      timeoutMs: 2_500,
      fallback: () => fallback,
      circuitKey: "account-cleanup-automation-settings-read",
      circuitTtlMs: 60_000,
      logEvent: "profiles.orphan_cleanup.settings_read_failed",
      bypassCache: options.fresh,
    },
  );
  return setCache(value);
}

export async function updateAccountCleanupAutomationSettings(
  input: {
    autoCheckEnabled?: unknown;
    autoCleanupEnabled?: unknown;
    checkIntervalHours?: unknown;
    cleanupIntervalHours?: unknown;
    profileLimit?: unknown;
  },
  actor: DashboardSession,
) {
  if (!hasFirebaseProfileConfig()) throw new Error("Сховище налаштувань не налаштоване.");
  const current = await getAccountCleanupAutomationSettings({ fresh: true });
  const autoCleanupEnabled = bool(input.autoCleanupEnabled, false);
  const next: AccountCleanupAutomationSettings = {
    ...current,
    autoCheckEnabled: autoCleanupEnabled ? true : bool(input.autoCheckEnabled, false),
    autoCleanupEnabled,
    checkIntervalHours: int(input.checkIntervalHours, current.checkIntervalHours, 1, 168),
    cleanupIntervalHours: int(input.cleanupIntervalHours, current.cleanupIntervalHours, 6, 336),
    profileLimit: int(input.profileLimit, current.profileLimit, 0, 50_000),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name || actor.login || actor.id,
  };

  await firebaseWrite(
    "settings",
    "account-cleanup-automation-settings:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set(next, { merge: true }),
    { timeoutMs: 3_500, logEvent: "profiles.orphan_cleanup.settings_write_failed" },
  );
  return setCache(next);
}

export function isAccountCleanupDue(lastRunAt: string | null, intervalHours: number, now = Date.now()) {
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= Math.max(1, intervalHours) * 60 * 60_000;
}

export function nextAccountCleanupAt(lastRunAt: string | null, intervalHours: number, enabled: boolean, now = Date.now()) {
  if (!enabled) return null;
  if (!lastRunAt) return new Date(now).toISOString();
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return new Date(now).toISOString();
  return new Date(Math.max(now, last + Math.max(1, intervalHours) * 60 * 60_000)).toISOString();
}

export async function recordAccountCleanupRun(input: {
  mode: AccountCleanupRunMode;
  source: AccountCleanupRunSource;
  status: AccountCleanupRunStatus;
  startedAt: string;
  completedAt?: string;
  checkedProfiles?: number;
  candidates?: number;
  deletedProfiles?: number;
  removedRaidSignups?: number;
  removedRosterPicks?: number;
  removedPollVotes?: number;
  errors?: number;
  summary?: string;
  error?: string | null;
}) {
  if (!hasFirebaseProfileConfig()) return null;
  const current = await getAccountCleanupAutomationSettings({ fresh: true });
  const completedAt = input.completedAt || new Date().toISOString();
  const run: AccountCleanupRunSummary = {
    id: `${completedAt}:${input.mode}:${input.source}`,
    mode: input.mode,
    source: input.source,
    status: input.status,
    startedAt: input.startedAt,
    completedAt,
    checkedProfiles: int(input.checkedProfiles, 0, 0, 1_000_000),
    candidates: int(input.candidates, 0, 0, 1_000_000),
    deletedProfiles: int(input.deletedProfiles, 0, 0, 1_000_000),
    removedRaidSignups: int(input.removedRaidSignups, 0, 0, 1_000_000),
    removedRosterPicks: int(input.removedRosterPicks, 0, 0, 1_000_000),
    removedPollVotes: int(input.removedPollVotes, 0, 0, 1_000_000),
    errors: int(input.errors, 0, 0, 1_000_000),
    summary: String(input.summary || "").slice(0, 1500),
  };

  const next: AccountCleanupAutomationSettings = {
    ...current,
    ...(input.mode === "inspect" ? {
      lastCheckAt: completedAt,
      lastCheckStatus: input.status,
      lastCheckCandidates: run.candidates,
      lastCheckCheckedProfiles: run.checkedProfiles,
    } : {
      lastCleanupAt: completedAt,
      lastCleanupStatus: input.status,
      lastCleanupDeletedProfiles: run.deletedProfiles,
    }),
    lastError: input.status === "success" ? null : String(input.error || input.summary || "Невідоме попередження").slice(0, 1500),
    recentRuns: [run, ...current.recentRuns.filter((item) => item.id !== run.id)].slice(0, MAX_RECENT_RUNS),
  };

  await firebaseWrite(
    "settings",
    `account-cleanup-automation-state:${input.mode}`,
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set({
      lastCheckAt: next.lastCheckAt,
      lastCheckStatus: next.lastCheckStatus,
      lastCheckCandidates: next.lastCheckCandidates,
      lastCheckCheckedProfiles: next.lastCheckCheckedProfiles,
      lastCleanupAt: next.lastCleanupAt,
      lastCleanupStatus: next.lastCleanupStatus,
      lastCleanupDeletedProfiles: next.lastCleanupDeletedProfiles,
      lastError: next.lastError,
      recentRuns: next.recentRuns,
    }, { merge: true }),
    { timeoutMs: 3_500, logEvent: "profiles.orphan_cleanup.state_write_failed" },
  );
  return setCache(next);
}
