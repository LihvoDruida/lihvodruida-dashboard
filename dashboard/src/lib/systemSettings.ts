import "server-only";

import { FieldValue } from "@/lib/db/documentValues";
import { getDocumentDb, hasDocumentDbConfig } from "@/lib/documentDb";
import { withTimeout } from "@/lib/runtimeResilience";
import { logDashboardEvent } from "@/lib/security";
import { timestampToIso } from "@/lib/values";
import type { DashboardSession } from "@/types/auth";
import { SYSTEM_SETTINGS, SYSTEM_SETTING_KEYS, applySystemSettingsToEnv } from "@/lib/systemSettingsSchema";

const COLLECTION = "dashboardSettings";
const DOC_ID = "systemRuntime";
const SYNC_INTERVAL_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomSystemSettings: { base: Record<string, string | undefined>; values: Record<string, string>; revision: number; updatedAt: string | null; updatedBy: string | null; timer?: ReturnType<typeof setInterval> } | undefined;
}

export type SystemSettingsState = {
  values: Record<string, string>;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export class SystemSettingsConflictError extends Error {
  constructor() { super("Налаштування вже змінено в іншій вкладці. Онови сторінку й повтори зміни."); }
}

function holder() {
  globalThis.__mistblossomSystemSettings ||= { base: {}, values: {}, revision: 0, updatedAt: null, updatedBy: null };
  return globalThis.__mistblossomSystemSettings;
}

function normalizeStored(data: Record<string, unknown> | undefined | null): SystemSettingsState {
  const raw = data?.values && typeof data.values === "object" && !Array.isArray(data.values) ? data.values as Record<string, unknown> : {};
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) if (SYSTEM_SETTING_KEYS.has(key) && typeof value === "string" && value) values[key] = value;
  const revision = Number(data?.revision);
  return {
    values,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    updatedAt: timestampToIso(data?.updatedAt) || null,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

function applyState(state: SystemSettingsState) {
  const current = holder();
  applySystemSettingsToEnv(state.values, process.env, current.base);
  Object.assign(current, state);
  return state;
}

/** Fresh read from storage, applied to process.env. Throws when storage is unavailable. */
export async function loadSystemSettings(): Promise<SystemSettingsState> {
  if (!hasDocumentDbConfig()) throw new Error("Сховище не налаштоване.");
  const snapshot = await withTimeout(getDocumentDb().collection(COLLECTION).doc(DOC_ID).get(), 3_000, "system-settings-read");
  return applyState(normalizeStored(snapshot.exists ? snapshot.data() : null));
}

/** Original .env value of a setting (before any stored override). */
export function envValueOf(key: string) {
  const base = holder().base;
  return key in base ? base[key] : process.env[key];
}

/** Saves the complete set of overrides if `expectedRevision` is still current. */
export async function saveSystemSettings(values: Record<string, string>, expectedRevision: number, actor: DashboardSession): Promise<SystemSettingsState> {
  if (!hasDocumentDbConfig()) throw new Error("Сховище не налаштоване.");
  const ref = getDocumentDb().collection(COLLECTION).doc(DOC_ID);
  const updatedBy = actor.name || actor.login || actor.id;
  const next = await getDocumentDb().runTransaction(async tx => {
    const current = normalizeStored((await tx.get(ref)).data());
    if (current.revision !== expectedRevision) throw new SystemSettingsConflictError();
    const revision = current.revision + 1;
    tx.set(ref, { values, revision, updatedAt: FieldValue.serverTimestamp(), updatedBy });
    return { values, revision, updatedAt: new Date().toISOString(), updatedBy } satisfies SystemSettingsState;
  });
  return applyState(next);
}

/** Loads overrides at start-up and re-reads them every minute (other replicas, manual DB edits). */
export function startSystemSettingsSync() {
  const current = holder();
  if (current.timer || !hasDocumentDbConfig()) return;
  const tick = () => loadSystemSettings().catch(error => {
    logDashboardEvent("warn", "system_settings.sync_failed", undefined, { message: error instanceof Error ? error.message : "unknown" });
  });
  void tick();
  current.timer = setInterval(tick, SYNC_INTERVAL_MS);
  current.timer.unref?.();
}

// --- .env status (never values) --------------------------------------------------
export type EnvStatus = { key: string; label: string; state: "set" | "missing" | "weak"; hint: string };

const ENV_STATUS: Array<{ key: string; label: string; required: boolean; minLength?: number }> = [
  { key: "DATABASE_URL", label: "Підключення до PostgreSQL", required: true },
  { key: "SESSION_SECRET", label: "Підпис сесій", required: true, minLength: 32 },
  { key: "INTERNAL_API_TOKEN", label: "Токен між панеллю, ботом і cron", required: true, minLength: 24 },
  { key: "PUBLIC_SITE_BRIDGE_TOKEN", label: "Токен звʼязку з публічним сайтом", required: true, minLength: 32 },
  { key: "DISCORD_BOT_TOKEN", label: "Токен Discord-бота", required: true, minLength: 50 },
  { key: "DISCORD_PUBLIC_KEY", label: "Public Key Discord", required: true, minLength: 64 },
  { key: "DISCORD_OAUTH_CLIENT_ID", label: "Discord OAuth Client ID", required: true },
  { key: "DISCORD_OAUTH_CLIENT_SECRET", label: "Discord OAuth Client Secret", required: true, minLength: 16 },
  { key: "DISCORD_GUILD_ID", label: "ID Discord-сервера", required: true },
  { key: "DASHBOARD_RULES_TOKEN_SECRET", label: "Підпис посилань правил", required: false, minLength: 32 },
  { key: "BATTLENET_CLIENT_ID", label: "Battle.net Client ID", required: false },
  { key: "BATTLENET_CLIENT_SECRET", label: "Battle.net Client Secret", required: false, minLength: 16 },
  { key: "RAIDERIO_ACCESS_KEY", label: "Ключ Raider.IO", required: false },
  { key: "ADMIN_DASHBOARD_TOKEN", label: "Аварійний вхід власника", required: false, minLength: 32 },
];

export function envStatus(env: NodeJS.ProcessEnv = process.env): EnvStatus[] {
  return ENV_STATUS.map(item => {
    const value = String(env[item.key] || "").trim();
    if (!value) return { key: item.key, label: item.label, state: "missing", hint: item.required ? "Обовʼязково: make configure" : "Не налаштовано" };
    if (item.minLength && value.length < item.minLength) return { key: item.key, label: item.label, state: "weak", hint: `Закоротке (потрібно ≥ ${item.minLength}): make configure KEY=${item.key}` };
    return { key: item.key, label: item.label, state: "set", hint: "Задано" };
  });
}

export function systemSettingsView(state: SystemSettingsState) {
  return SYSTEM_SETTINGS.map(def => ({
    ...def,
    override: state.values[def.key] || "",
    envValue: envValueOf(def.key) || "",
  }));
}
