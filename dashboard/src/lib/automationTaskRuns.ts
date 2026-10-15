import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { getDocumentDb, hasDocumentDbConfig } from "@/lib/documentDb";
import { AUTOMATION_TASKS, AUTOMATION_TASK_RUN_COLLECTION, automationRunResult, type AutomationTaskId } from "@/lib/automationTaskCatalog";

export function automationExpectedIntervalSeconds(id: AutomationTaskId) {
  const scheduled = AUTOMATION_TASKS[id].intervalSeconds;
  if (id !== "raid-lifecycle") return scheduled; // Poll cron explicitly uses force=1.
  const value = Number(process.env.RAID_LIFECYCLE_MIN_INTERVAL_MS || process.env.DASHBOARD_RAID_LIFECYCLE_MIN_INTERVAL_MS || 0);
  return Number.isFinite(value) ? Math.max(scheduled, Math.ceil(Math.min(3_600_000, Math.max(30_000, value)) / 1000)) : scheduled;
}

export function automationTaskContextHash() {
  const names = ["DISCORD_GUILD_ID", "GUILD_ROSTER_REGION", "WOW_REGION", "GUILD_ROSTER_REALM", "WOW_REALM", "WOW_GUILD_REALM", "GUILD_ROSTER_NAME", "WOW_GUILD_NAME", "BATTLENET_ALLOWED_GUILD_NAME", "RAID_LIFECYCLE_MIN_INTERVAL_MS", "DASHBOARD_RAID_LIFECYCLE_MIN_INTERVAL_MS"];
  return createHash("sha256").update(JSON.stringify(names.map(name => String(process.env[name] || "").trim()))).digest("hex");
}

// Observations are best-effort and never authorize, replay or cancel business work.
// A stale completion cannot replace a newer observation from another process.
async function bounded<T>(work: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 750); })]);
  } catch { return undefined; }
  finally { if (timer) clearTimeout(timer); }
}
export async function observeAutomationRun<T>(id: AutomationTaskId, operation: () => Promise<T>): Promise<T> {
  if (!hasDocumentDbConfig()) return operation();
  const runId = randomUUID(), contextHash = automationTaskContextHash(), startedAtMs = Date.now(), startedAt = new Date(startedAtMs).toISOString();
  // Constructing a DB client may fail too; telemetry must not suppress a task.
  const store = (() => {
    try { const db = getDocumentDb(); return { db, ref: db.collection(AUTOMATION_TASK_RUN_COLLECTION).doc(id) }; }
    catch { return null; }
  })();
  if (!store) return operation();
  const { db, ref } = store;
  const start = bounded(() => db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.contextHash === contextHash && (Number(current?.startedAtMs || 0) > startedAtMs || (current?.startedAtMs === startedAtMs && String(current.runId) > runId))) return;
    tx.set(ref, { version: 1, runId, contextHash, startedAt, startedAtMs, finishedAt: null, status: "running", deadlineAtMs: startedAtMs + 90_000, counters: {}, reason: null });
  }));
  let outcome: ReturnType<typeof automationRunResult> = { status: "error", reason: null, counters: {} };
  try {
    const result = await operation();
    outcome = automationRunResult(result);
    return result;
  } finally {
    await start;
    const finishedAt = new Date().toISOString();
    await bounded(() => db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.runId !== runId) return;
      tx.set(ref, { ...outcome, finishedAt, durationMs: Math.max(0, Date.now() - startedAtMs) }, { merge: true });
    }));
  }
}
