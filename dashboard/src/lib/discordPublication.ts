import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getDocumentDb } from "@/lib/documentDb";
import { acquireAutomationLease } from "@/lib/automationLease";
import type { Transaction } from "@/lib/db/documentValues";
import { DiscordRestError } from "@/lib/discordRest";

export type PublicationOperation = {
  key: string;
  nonce: string;
  kind: string;
  resourceId: string;
  target: string;
  revision: string;
  previousId: string;
  startedAt: string;
  state: "prepared" | "sending" | "uncertain" | "confirmed" | "complete" | "rejected";
  result: Record<string, unknown> | null;
  context: Record<string, unknown>;
  error: string | null;
  cleanupDone?: boolean;
};

export class DiscordPublicationPendingError extends Error {
  constructor(public readonly reason: "busy" | "uncertain") {
    super(reason === "busy"
      ? "Публікація вже виконується. Зачекай кілька секунд і онови сторінку."
      : "Результат надсилання потребує звірки з Discord. Нове оголошення не надсилається. Натисни «Оновити Discord», щоб перевірити знову, або вкажи посилання на вже створене повідомлення.");
    this.name = "DiscordPublicationPendingError";
  }
}

export function publicationRevision(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function operationRef(kind: string, resourceId: string) {
  return getDocumentDb().collection("discordPublications")
    .doc(publicationRevision([kind, resourceId]));
}

export async function getDiscordPublicationOperation(kind: string, resourceId: string) {
  return (await operationRef(kind, resourceId).get()).data() as PublicationOperation | undefined;
}

export async function updateDiscordPublicationOperation(kind: string, resourceId: string, nonce: string, patch: Partial<PublicationOperation>) {
  const ref = operationRef(kind, resourceId);
  await getDocumentDb().runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.nonce !== nonce) throw new DiscordPublicationPendingError("uncertain");
    tx.update(ref, patch);
  });
}

/** Process-independent lease. The callback must read the resource afresh.
 * No database transaction is held while Discord is called. */
export async function withDiscordPublicationLease<T>(resourceKey: string, run: (assertOwned: () => Promise<void>) => Promise<T>) {
  const lease = await acquireAutomationLease("publication_" + publicationRevision(resourceKey), "discord-publication");
  if (!lease) throw new DiscordPublicationPendingError("busy");
  try { return await run(() => lease.assertOwned()); }
  finally { await lease.release().catch(error => console.warn("[publication] lease release failed", error instanceof Error ? error.message : "storage unavailable")); }
}

type CreationOptions = {
  kind: string;
  resourceId: string;
  collection: string;
  target: string;
  revision: string;
  previousId?: string | null;
  context?: Record<string, unknown>;
  assertOwned: () => Promise<void>;
  create: (operation: PublicationOperation) => Promise<Record<string, unknown>>;
  reconcile: (operation: PublicationOperation) => Promise<Record<string, unknown> | null>;
  patch: (result: Record<string, unknown>, current: Record<string, unknown>, operation: PublicationOperation) => Record<string, unknown>;
};

/** Write-ahead receipt for a non-idempotent Discord CREATE. A sending/uncertain
 * receipt is reconciled even if the requested channel or payload changed.
 * Missing history/nonce never proves that Discord did not create the object. */
export async function runDiscordPublicationCreation(options: CreationOptions) {
  const db = getDocumentDb();
  const ref = operationRef(options.kind, options.resourceId);
  const resource = db.collection(options.collection).doc(options.resourceId);
  const key = publicationRevision([options.kind, options.resourceId, options.target, options.revision, options.previousId || ""]);
  let operation = await db.runTransaction(async tx => {
    const document = await tx.get(resource);
    const previous = (await tx.get(ref)).data() as PublicationOperation | undefined;
    if (!document.exists) throw new Error("Обʼєкт видалено. Публікацію зупинено.");
    if (previous && !["complete", "rejected"].includes(previous.state)) return previous;
    if (previous?.state === "complete" && previous.key === key) return previous;
    const next: PublicationOperation = {
      key, kind: options.kind, resourceId: options.resourceId,
      target: options.target, revision: options.revision, previousId: options.previousId || "",
      nonce: publicationRevision(randomUUID()).slice(0, 25), startedAt: new Date().toISOString(),
      state: "prepared", result: null, context: options.context || {}, error: null,
    };
    tx.set(ref, next);
    return next;
  });

  const change = async (patch: Partial<PublicationOperation>) => db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as PublicationOperation | undefined;
    if (current?.nonce !== operation.nonce) throw new DiscordPublicationPendingError("uncertain");
    if (current.state === "complete") return;
    tx.update(ref, patch);
  });
  const finish = async (result: Record<string, unknown>) => {
    await options.assertOwned();
    await db.runTransaction(async (tx: Transaction) => {
      const receipt = (await tx.get(ref)).data() as PublicationOperation | undefined;
      const document = await tx.get(resource);
      if (receipt?.nonce !== operation.nonce) throw new DiscordPublicationPendingError("uncertain");
      if (receipt.state === "complete") return;
      if (!document.exists) throw new Error("Обʼєкт видалено; підтвердження Discord збережено для звірки.");
      tx.update(resource, options.patch(result, document.data() || {}, operation));
      tx.update(ref, { state: "complete", result, error: null, completedAt: new Date().toISOString() });
    });
    return { result, operation, recovered: operation.key !== key };
  };
  if (operation.state === "complete" && operation.result) return { result: operation.result, operation, recovered: false };
  if (operation.state === "confirmed" && operation.result) return finish(operation.result);

  if (operation.state === "sending" || operation.state === "uncertain") {
    const result = await options.reconcile(operation);
    if (!result) {
      await change({ state: "uncertain" });
      throw new DiscordPublicationPendingError("uncertain");
    }
    await change({ state: "confirmed", result, error: null });
    return finish(result);
  }

  // CAS also protects callers that accidentally omit the outer lease.
  await options.assertOwned();
  const sending = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as PublicationOperation | undefined;
    if (current?.nonce !== operation.nonce || current.state !== "prepared") return false;
    tx.update(ref, { state: "sending", sentAt: new Date().toISOString() });
    return true;
  });
  if (!sending) throw new DiscordPublicationPendingError("busy");
  operation = { ...operation, state: "sending" };
  let result: Record<string, unknown>;
  try {
    result = await options.create(operation);
    if (!String(result?.id || "").match(/^\d{16,25}$/)) throw new Error("Discord не повернув ID створеного обʼєкта.");
  } catch (error) {
    // Only an explicit rejection is proof of no external creation. Network
    // timeout, 5xx, malformed response and unknown exceptions remain uncertain.
    const rejected = error instanceof DiscordRestError && [400, 401, 403, 404, 405, 413, 429].includes(error.status);
    await change({ state: rejected ? "rejected" : "uncertain", error: error instanceof Error ? error.message.slice(0, 400) : "Discord unavailable" }).catch(() => undefined);
    if (!rejected) throw new DiscordPublicationPendingError("uncertain");
    throw error;
  }
  // Save a known external ID before committing references. Restart can finish
  // without another POST even if the following resource transaction fails.
  await change({ state: "confirmed", result, error: null });
  return finish(result);
}
