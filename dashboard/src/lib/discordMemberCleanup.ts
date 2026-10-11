import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { acquireAutomationLease } from "@/lib/automationLease";
import { assertFirebaseWriteAvailable } from "@/lib/firebaseAccess";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";
import { fetchDiscordCleanupControl, fetchDiscordCleanupMemberPage, fetchDiscordGuildMemberSnapshot, getDiscordGuildId, kickDiscordCleanupMember } from "@/lib/discordAdmin";
import { cleanupRoleBlockedReason, evaluateCleanupMember, isCleanupPeriod, type CleanupControl, type CleanupMember, type DiscordCleanupPeriod } from "@/lib/discordCleanupPolicy";
import { logDashboardEvent } from "@/lib/security";

const SCAN_INTERVAL_MS = 60 * 60_000;
const PAGE_SIZE = 200;
const KICK_BATCH_SIZE = 5;
const NEVER = "9999-12-31T23:59:59.999Z";
type Scan = { id: string; after: string; checked: number; candidates: number; overdue: number; blocked: number; startedAt: string };
type Run = { at: string; checked: number; kicked: number; failed: number; summary: string };
export type DiscordCleanupSettings = {
  enabled: boolean; roleId: string; roleName: string; period: DiscordCleanupPeriod; revision: string;
  updatedAt: string | null; updatedBy: string | null;
};
export type DiscordCleanupState = {
  activeScanId: string | null; scan: Scan | null; lastScanAt: string | null;
  checked: number; candidates: number; overdue: number; blocked: number;
  kickedTotal: number; uncertainTotal: number; lastRunAt: string | null; lastError: string | null;
  recentRuns: Run[]; garbage: string[];
};
export type DiscordCleanupRow = {
  id: string; userId: string; displayName: string; joinedAt: string | null; dueAt: string | null;
  roleId: string | null; roleName: string; period: DiscordCleanupPeriod;
  blockedReason: string | null; lastError: string | null; checkedAt: string;
  kickedAt: string | null; outcome: "candidate" | "kicked" | "uncertain";
};
type Candidate = DiscordCleanupRow & { nextAttemptAt: string; listKey: string; revision: string };
type Operation = DiscordCleanupRow & { status: "prepared" | "kicked" | "uncertain" | "retry"; sortKey: string; attemptId: string; attemptedAt: string; reason: string };
function guildId() {
  const id = getDiscordGuildId();
  if (!/^\d{16,25}$/.test(id)) throw new Error("Discord-сервер не підключено.");
  return id;
}
function refs(id = guildId()) {
  const db = getFirebaseAdminDb();
  return { db, settings: db.collection("dashboardSettings").doc(`discordMemberCleanup_${id}`), state: db.collection("dashboardSettings").doc(`discordMemberCleanupState_${id}`), events: db.collection(`discordCleanupEvents_${id}`), candidates: (scanId: string) => db.collection(`discordCleanupCandidates_${id}_${scanId}`) };
}
function defaultSettings(): DiscordCleanupSettings { return { enabled: false, roleId: "", roleName: "", period: "month", revision: "unconfigured", updatedAt: null, updatedBy: null }; }
function defaultState(): DiscordCleanupState { return { activeScanId: null, scan: null, lastScanAt: null, checked: 0, candidates: 0, overdue: 0, blocked: 0, kickedTotal: 0, uncertainTotal: 0, lastRunAt: null, lastError: null, recentRuns: [], garbage: [] }; }
export async function getDiscordCleanupOverview() {
  const store = refs();
  const [settings, state] = await Promise.all([store.settings.get(), store.state.get()]);
  return { settings: { ...defaultSettings(), ...settings.data() } as DiscordCleanupSettings, state: { ...defaultState(), ...state.data() } as DiscordCleanupState };
}
export async function saveDiscordCleanupSettings(input: { enabled: unknown; roleId: unknown; period: unknown }, actorId: string) {
  assertFirebaseWriteAvailable("settings");
  if (typeof input.enabled !== "boolean" || !isCleanupPeriod(input.period) || !/^\d{16,25}$/.test(String(input.roleId || ""))) throw new Error("Вибери одну роль і строк очищення.");
  const control = await fetchDiscordCleanupControl();
  const role = control.roles.find((item) => item.id === input.roleId);
  if (!role) throw new Error("Вибрану роль не знайдено на сервері.");
  const blocked = cleanupRoleBlockedReason(role, control);
  if (blocked) throw new Error(blocked);
  if (input.enabled && !control.canKick) throw new Error("Боту потрібен дозвіл «Виключати учасників» (Kick Members).");
  const lease = await acquireAutomationLease(`discord-member-cleanup_${control.guildId}`, `settings:${actorId}`);
  if (!lease) throw new Error("Перевірка вже виконується. Збережи налаштування після її завершення.");
  try {
    const { settings: current, state } = await getDiscordCleanupOverview();
    const changed = current.roleId !== role.id || current.period !== input.period;
    const settings: DiscordCleanupSettings = { enabled: input.enabled, roleId: role.id, roleName: role.name, period: input.period, revision: changed ? randomUUID() : current.revision, updatedAt: new Date().toISOString(), updatedBy: actorId };
    const store = refs();
    await store.db.runTransaction(async (tx) => {
      tx.set(store.settings, settings);
      if (changed) tx.set(store.state, { ...state, activeScanId: null, scan: null, lastScanAt: null, candidates: 0, overdue: 0, blocked: 0, garbage: [...new Set([...state.garbage, state.activeScanId, state.scan?.id].filter(Boolean) as string[])] });
    });
    return settings;
  } finally { await lease.release(); }
}
export async function pauseDiscordCleanup(actorId: string) {
  const lease = await acquireAutomationLease(`discord-member-cleanup_${guildId()}`, `pause:${actorId}`);
  if (!lease) throw new Error("Перевірка вже виконується. Повтори призупинення після її завершення.");
  try {
    const store = refs();
    const { settings } = await getDiscordCleanupOverview();
    const paused = { ...settings, enabled: false, updatedAt: new Date().toISOString(), updatedBy: actorId };
    await store.settings.set(paused);
    return paused;
  } finally { await lease.release(); }
}
function message(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 1000); }
function operationId(member: CleanupMember) { return createHash("sha256").update(`${member.userId}:${new Date(member.joinedAt!).toISOString()}`).digest("hex"); }
function candidateRow(member: CleanupMember, settings: DiscordCleanupSettings, control: CleanupControl): Candidate {
  const assessment = evaluateCleanupMember(member, settings.roleId, settings.period, control);
  const joinedAt = member.joinedAt && Number.isFinite(Date.parse(member.joinedAt)) ? new Date(member.joinedAt).toISOString() : null;
  const hasRole = member.roleIds.some((id) => id !== control.guildId);
  return {
    id: member.userId, userId: member.userId, displayName: member.displayName, joinedAt, dueAt: assessment.dueAt,
    roleId: hasRole ? settings.roleId : null, roleName: hasRole ? (control.roles.find((role) => role.id === settings.roleId)?.name || settings.roleName) : "Без ролей", period: settings.period,
    blockedReason: assessment.blockedReason, lastError: null, checkedAt: new Date().toISOString(), kickedAt: null, outcome: "candidate",
    nextAttemptAt: assessment.blockedReason ? NEVER : assessment.dueAt || NEVER,
    listKey: `c_${joinedAt || NEVER}_${member.userId}`, revision: settings.revision,
  };
}
async function confirmedKick(operation: Operation, candidate: Candidate, scanId: string) {
  const store = refs();
  // The event and counters commit together; retrying finalization is idempotent.
  await store.db.runTransaction(async (tx) => {
    const eventRef = store.events.doc(operation.id);
    const [event, currentState] = await Promise.all([tx.get(eventRef), tx.get(store.state)]);
    const previous = event.data() as Operation | undefined;
    if (previous?.status === "kicked") return;
    if (previous?.attemptId !== operation.attemptId) throw new Error("Запис виключення змінився.");
    const kickedAt = new Date().toISOString();
    tx.set(eventRef, { ...operation, status: "kicked", outcome: "kicked", kickedAt, sortKey: `k_${kickedAt}_${operation.id}`, lastError: null });
    tx.set(store.candidates(scanId).doc(candidate.id), { ...candidate, outcome: "kicked", kickedAt, nextAttemptAt: NEVER, listKey: `x_${candidate.id}` });
    tx.set(store.state, { kickedTotal: Number(currentState.data()?.kickedTotal || 0) + 1 }, { merge: true });
  });
}
async function markUncertain(operation: Operation, candidate: Candidate, scanId: string, error: string) {
  const store = refs();
  await store.db.runTransaction(async (tx) => {
    const eventRef = store.events.doc(operation.id);
    const [event, state] = await Promise.all([tx.get(eventRef), tx.get(store.state)]);
    if (event.data()?.status === "kicked") return;
    const alreadyUncertain = event.data()?.status === "uncertain";
    tx.set(eventRef, { ...operation, status: "uncertain", outcome: "uncertain", lastError: error, sortKey: `u_${operation.attemptedAt}_${operation.id}` });
    tx.set(store.candidates(scanId).doc(candidate.id), { ...candidate, blockedReason: "Результат попереднього виключення не підтверджено. Повтор заблоковано.", lastError: error, nextAttemptAt: NEVER });
    if (!alreadyUncertain) tx.set(store.state, { uncertainTotal: Number(state.data()?.uncertainTotal || 0) + 1 }, { merge: true });
  });
}
export async function runDiscordMemberCleanup(options: { source: "automatic" | "manual"; inspectOnly?: boolean } = { source: "automatic" }) {
  const id = guildId();
  const lease = await acquireAutomationLease(`discord-member-cleanup_${id}`, options.source);
  if (!lease) return { skipped: true, reason: "in_flight", checked: 0, kicked: 0, failed: 0 };
  const started = Date.now();
  const store = refs(id);
  let checked = 0, kicked = 0, failed = 0;
  try {
    const overview = await getDiscordCleanupOverview();
    const settings = overview.settings;
    let state = overview.state;
    if (!settings.roleId || !isCleanupPeriod(settings.period)) return { skipped: true, reason: "not_configured", checked, kicked, failed };
    // A process may die after Discord accepted the kick but before the DB commit.
    // Keep that attempt visible for review; absence alone never proves who kicked a member.
    const abandoned = await store.events.where("sortKey", ">=", "p_").where("sortKey", "<", "p_\uffff").orderBy("sortKey").limit(10).get();
    for (const doc of abandoned.docs) {
      const operation = doc.data() as Operation;
      if (Date.now() - Date.parse(operation.attemptedAt) < 180_000) continue;
      await store.db.runTransaction(async (tx) => {
        const [event, current] = await Promise.all([tx.get(doc.ref), tx.get(store.state)]);
        if (event.data()?.status !== "prepared") return;
        tx.set(doc.ref, { ...operation, status: "uncertain", outcome: "uncertain", sortKey: `u_${operation.attemptedAt}_${operation.id}`, lastError: "Спробу перервано до збереження підтвердження. Перевір журнал аудиту Discord." });
        tx.set(store.state, { uncertainTotal: Number(current.data()?.uncertainTotal || 0) + 1 }, { merge: true });
      });
    }
    const control = await fetchDiscordCleanupControl();
    const selectedRole = control.roles.find((role) => role.id === settings.roleId);
    if (!selectedRole || cleanupRoleBlockedReason(selectedRole, control)) throw new Error("Вибрана роль більше не підходить для очищення. Перевір налаштування та ієрархію ролей.");
    if (!state.scan && (options.source === "manual" || !state.lastScanAt || Date.now() - Date.parse(state.lastScanAt) >= SCAN_INTERVAL_MS)) {
      state.scan = { id: randomUUID(), after: "0", checked: 0, candidates: 0, overdue: 0, blocked: 0, startedAt: new Date().toISOString() };
      await store.state.set({ scan: state.scan }, { merge: true });
    }
    // Bound memory and write size; an interrupted scan resumes at its last committed cursor.
    if (state.scan) {
      await lease.assertOwned();
      const page = await fetchDiscordCleanupMemberPage(state.scan.after, PAGE_SIZE);
      const scan = { ...state.scan, after: page.after, checked: state.scan.checked + page.members.length };
      const batch = store.db.batch();
      for (const member of page.members) {
        if (!evaluateCleanupMember(member, settings.roleId, settings.period, control).matches) continue;
        const row = candidateRow(member, settings, control);
        batch.set(store.candidates(scan.id).doc(row.id), row);
        scan.candidates++;
        if (row.blockedReason) scan.blocked++;
        if (row.dueAt && Date.now() > Date.parse(row.dueAt)) scan.overdue++;
      }
      batch.set(store.state, page.complete ? {
        scan: null, activeScanId: scan.id, lastScanAt: new Date().toISOString(), checked: scan.checked,
        candidates: scan.candidates, overdue: scan.overdue, blocked: scan.blocked,
        garbage: [...new Set([...state.garbage, state.activeScanId].filter((old) => old && old !== scan.id) as string[])],
      } : { scan }, { merge: true });
      await batch.commit();
      checked = page.members.length;
      state = (await getDiscordCleanupOverview()).state;
    }
    if (!options.inspectOnly && settings.enabled && state.activeScanId && control.canKick && Date.now() - started < 30_000) {
      const scanId = state.activeScanId;
      const due = await store.candidates(scanId).where("nextAttemptAt", "<", new Date().toISOString()).orderBy("nextAttemptAt").limit(KICK_BATCH_SIZE).get();
      for (const document of due.docs) {
        if (Date.now() - started >= 30_000) break;
        let candidate = document.data() as Candidate;
        if (candidate.outcome !== "candidate" || candidate.revision !== settings.revision) continue;
        let operation: Operation | null = null;
        try {
          await lease.assertOwned();
          const fresh = await fetchDiscordGuildMemberSnapshot(candidate.userId, id);
          // joined_at changes on rejoin. Roles and membership must be checked immediately before each kick.
          const latestControl = await fetchDiscordCleanupControl();
          const assessment = evaluateCleanupMember(fresh, settings.roleId, settings.period, latestControl);
          if (!assessment.matches || !assessment.eligible || new Date(fresh.joinedAt || 0).toISOString() !== candidate.joinedAt) {
            if (!assessment.matches) await document.ref.set({ listKey: `x_${candidate.id}`, nextAttemptAt: NEVER }, { merge: true });
            else await document.ref.set(candidateRow(fresh, settings, latestControl));
            continue;
          }
          candidate = candidateRow(fresh, settings, latestControl);
          const currentSettings = (await getDiscordCleanupOverview()).settings;
          if (!currentSettings.enabled || currentSettings.revision !== settings.revision) break;
          const eventRef = store.events.doc(operationId(fresh));
          const prior = (await eventRef.get()).data() as Operation | undefined;
          if (prior && ["prepared", "uncertain", "kicked"].includes(prior.status)) {
            if (prior.status === "kicked") await document.ref.set({ listKey: `x_${candidate.id}`, nextAttemptAt: NEVER }, { merge: true });
            else await markUncertain(prior, candidate, scanId, "Попередню спробу перервано; автоматичний повтор для цього вступу заборонений.");
            continue;
          }
          const attemptId = randomUUID();
          operation = { ...candidate, id: eventRef.id, status: "prepared", attemptId, attemptedAt: new Date().toISOString(), sortKey: `p_${attemptId}`, reason: `Guild cleanup ${attemptId}: ${settings.period}; joined ${candidate.joinedAt}; role ${candidate.roleId || "none"}` };
          await eventRef.set(operation);
          await lease.assertOwned();
          // One attempt only. A 429/403 is safe to defer; a timeout/5xx is ambiguous and must never be replayed.
          await kickDiscordCleanupMember(id, candidate.userId, operation.reason);
          await confirmedKick(operation, candidate, scanId);
          kicked++;
          logDashboardEvent("info", "discord.member_cleanup.kicked", undefined, { userId: candidate.userId, joinedAt: candidate.joinedAt, roleId: candidate.roleId, attemptId }, { category: "action" });
        } catch (error) {
          const text = message(error);
          failed++;
          if (operation && !/Discord API (?:400|401|403|404|429):/.test(text)) {
            await markUncertain(operation, candidate, scanId, text);
          } else {
            if (operation) await store.events.doc(operation.id).set({ status: "retry", lastError: text }, { merge: true });
            if (/Discord API 404:/.test(text)) await document.ref.set({ listKey: `x_${candidate.id}`, nextAttemptAt: NEVER }, { merge: true });
            else await document.ref.set({ lastError: text, nextAttemptAt: new Date(Date.now() + 15 * 60_000).toISOString() }, { merge: true });
          }
          logDashboardEvent("warn", "discord.member_cleanup.member_failed", undefined, { userId: candidate.userId, message: text }, { category: "action" });
          // Permission loss and transport errors should stop the batch, rather than hammering Discord.
          if (!/Discord API 404:/.test(text)) break;
        }
      }
    }
    if (Date.now() - started < 30_000 && state.garbage.length) {
      const oldId = state.garbage[0];
      const old = await store.candidates(oldId).limit(PAGE_SIZE).get();
      const batch = store.db.batch();
      old.docs.forEach((doc) => batch.delete(doc.ref));
      if (old.size < PAGE_SIZE) batch.set(store.state, { garbage: state.garbage.slice(1) }, { merge: true });
      await batch.commit();
    }
    const final = await getDiscordCleanupOverview();
    const summary = `Перевірено: ${checked}; виключено: ${kicked}; помилок: ${failed}.`;
    const run: Run = { at: new Date().toISOString(), checked, kicked, failed, summary };
    await store.state.set({ lastRunAt: run.at, lastError: failed ? "Є помилки окремих учасників. Переглянь список і журнал дій." : !control.canKick && settings.enabled ? "Бот втратив дозвіл Kick Members. Виключення призупинено." : null, recentRuns: checked || kicked || failed ? [run, ...final.state.recentRuns].slice(0, 8) : final.state.recentRuns }, { merge: true });
    return { skipped: false, checked, kicked, failed, scanning: Boolean(final.state.scan), summary };
  } catch (error) {
    await store.state.set({ lastRunAt: new Date().toISOString(), lastError: message(error) }, { merge: true }).catch(() => undefined);
    throw error;
  } finally { await lease.release(); }
}
export type CleanupTab = "candidates" | "kicked" | "uncertain";
export async function listDiscordCleanupMembers(tab: CleanupTab, cursor?: string | null, requestedScanId?: string | null) {
  const { state } = await getDiscordCleanupOverview();
  if (tab === "candidates" && requestedScanId && state.activeScanId !== requestedScanId) return { stale: true, rows: [] as DiscordCleanupRow[], cursor: null, scanId: state.activeScanId };
  if (tab === "candidates" && !state.activeScanId) return { stale: false, rows: [] as DiscordCleanupRow[], cursor: null, scanId: null };
  const store = refs();
  const prefix = tab === "candidates" ? "c_" : tab === "kicked" ? "k_" : "u_";
  const field = tab === "candidates" ? "listKey" : "sortKey";
  if (cursor && (cursor.length > 180 || !cursor.startsWith(prefix))) throw new Error("Некоректний курсор списку.");
  const collection = tab === "candidates" ? store.candidates(state.activeScanId!) : store.events;
  let query = collection.where(field, ">=", prefix).where(field, "<", `${prefix}\uffff`).orderBy(field, tab === "candidates" ? "asc" : "desc").limit(26);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  const rows = page.docs.slice(0, 25).map((doc) => doc.data() as DiscordCleanupRow);
  return { stale: false, rows, cursor: page.size > 25 ? String(page.docs[24].get(field)) : null, scanId: tab === "candidates" ? state.activeScanId : null };
}
