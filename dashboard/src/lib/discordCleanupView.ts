import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { isCleanupPeriod } from "@/lib/discordCleanupPolicy";
import type { CleanupTab, DiscordCleanupRow, DiscordCleanupSettings, DiscordCleanupState, DiscordCleanupExecution } from "@/lib/discordMemberCleanup";

export type CleanupPage = { rows: DiscordCleanupRow[]; cursor: string | null; scanId: string | null; stale?: boolean };
export type CleanupSummary = { settings: DiscordCleanupSettings; state: DiscordCleanupState; execution?: DiscordCleanupExecution };
export type CleanupOverview = CleanupSummary & { page: CleanupPage };
const API = "/api/dashboard/discord/member-cleanup";
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function isCleanupSettings(value: unknown): value is DiscordCleanupSettings {
  return record(value) && typeof value.enabled === "boolean" && typeof value.roleId === "string" && typeof value.roleName === "string" && isCleanupPeriod(value.period) && typeof value.revision === "string";
}
function isSummary(value: unknown): value is CleanupSummary & { ok: true } {
  if (!record(value) || value.ok !== true || !isCleanupSettings(value.settings) || !record(value.state)) return false;
  const state = value.state;
  return ["checked", "candidates", "overdue", "blocked", "kickedTotal", "uncertainTotal"].every(key => Number.isFinite(state[key])) &&
    Array.isArray(state.recentRuns) && state.recentRuns.every(run => record(run) && typeof run.at === "string" && typeof run.summary === "string");
}
function isPage(value: unknown): value is CleanupPage {
  return record(value) && Array.isArray(value.rows) && value.rows.every(row => record(row) && ["id", "userId", "displayName", "roleName", "checkedAt"].every(key => typeof row[key] === "string")) &&
    (value.cursor === null || typeof value.cursor === "string") && (value.scanId === null || typeof value.scanId === "string");
}
export function mergeCleanupRows(previous: DiscordCleanupRow[], next: DiscordCleanupRow[]) {
  const keys = new Set(previous.map(row => row.id));
  return [...previous, ...next.filter(row => { if (keys.has(row.id)) return false; keys.add(row.id); return true; })];
}
async function read(tab: CleanupTab, signal: AbortSignal, page?: { cursor?: string | null; scanId?: string | null }, summary = false) {
  const params = new URLSearchParams({ tab });
  if (summary) params.set("summary", "1");
  if (page?.cursor) params.set("cursor", page.cursor);
  if (page?.scanId) params.set("scanId", page.scanId);
  const data = await dashboardApiJson<unknown>(`${API}?${params}`, { signal, timeoutMs: 12_000, retries: 0 });
  if (!isSummary(data)) throw new Error("Сервер не повернув коректний стан очищення.");
  if (summary) return data;
  const resultPage = "page" in data ? data.page : null;
  if (!isPage(resultPage)) throw new Error("Сервер не повернув коректний список учасників.");
  return { ...data, page: resultPage };
}
export async function readCleanupView(tab: CleanupTab, signal: AbortSignal, previous: CleanupPage, mode: "replace" | "more" | "refresh" | "background") {
  if (mode === "background" && previous.rows.length > 25) {
    const summary = await read(tab, signal, undefined, true);
    return { ...summary, page: previous, listUpdated: false, reset: false };
  }
  let data = await read(tab, signal, mode === "more" ? previous : undefined) as CleanupOverview;
  let stale = Boolean(data.page.stale);
  if (stale) {
    data = await read(tab, signal) as CleanupOverview;
    if (data.page.stale) throw new Error("Знімок списку змінився. Повтори читання.");
  }
  stale = stale || ((mode === "more" || mode === "refresh") && previous.scanId !== data.page.scanId);
  if (mode === "refresh" && previous.rows.length > 25 && previous.scanId === data.page.scanId && !stale) {
    const seen = new Set<string>();
    let page = data.page;
    while (page.cursor && page.rows.length < previous.rows.length) {
      if (seen.has(page.cursor)) throw new Error("Список не просувається. Попередні дані збережено; повтори читання пізніше.");
      seen.add(page.cursor);
      const next = await read(tab, signal, page) as CleanupOverview;
      if (next.page.stale || next.page.scanId !== page.scanId) {
        data = await read(tab, signal) as CleanupOverview;
        if (data.page.stale) throw new Error("Знімок списку змінився. Повтори читання.");
        stale = true;
        page = data.page;
        break;
      }
      const rows = mergeCleanupRows(page.rows, next.page.rows);
      if (rows.length === page.rows.length && next.page.cursor) throw new Error("Список не просувається. Попередні дані збережено; повтори читання пізніше.");
      page = { ...next.page, rows };
    }
    data = { ...data, page };
  } else if (mode === "more" && !stale && previous.scanId === data.page.scanId) {
    if (data.page.cursor && data.page.cursor === previous.cursor) throw new Error("Курсор списку не змінився. Повтори читання пізніше.");
    data = { ...data, page: { ...data.page, rows: mergeCleanupRows(previous.rows, data.page.rows) } };
  }
  return { ...data, listUpdated: true, reset: stale };
}
