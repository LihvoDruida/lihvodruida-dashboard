import "server-only";

import { randomUUID } from "node:crypto";
import { getDocumentDb } from "@/lib/documentDb";
import { assertStorageWriteAvailable } from "@/lib/storageAccess";

/** Shared by manual and scheduled work across processes; never keep a DB transaction open during HTTP calls. */
export async function acquireAutomationLease(key: string, source: string, ttlMs = 180_000) {
  assertStorageWriteAvailable("settings");
  const db = getDocumentDb();
  const ref = db.collection("automationLeases").doc(key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160));
  const owner = randomUUID();
  const acquired = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const now = Date.now();
    if (Number(current?.expiresAtMs || 0) > now) return false;
    tx.set(ref, { owner, source: source.slice(0, 120), expiresAtMs: now + ttlMs, startedAt: new Date(now).toISOString() });
    return true;
  });
  if (!acquired) return null;
  let released = false;
  let lost = false;
  let renewal: Promise<boolean> | null = null;
  async function renew() {
    if (released || lost) return false;
    if (renewal) return renewal;
    renewal = db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (current?.owner !== owner || Number(current.expiresAtMs || 0) <= Date.now()) return false;
      tx.set(ref, { expiresAtMs: Date.now() + ttlMs }, { merge: true });
      return true;
    }).catch(() => false);
    const ok = await renewal;
    renewal = null;
    if (!ok) lost = true;
    return ok;
  }
  const heartbeat = setInterval(() => { void renew(); }, Math.floor(ttlMs / 3));
  heartbeat.unref();
  return {
    owner,
    async assertOwned() {
      if (!(await renew())) throw new Error("Захист автоматизації втрачено. Дію зупинено до наступної перевірки.");
    },
    async release() {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      if (renewal) await renewal;
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current?.owner === owner) tx.set(ref, { expiresAtMs: 0, releasedAt: new Date().toISOString() }, { merge: true });
      });
    },
  };
}
