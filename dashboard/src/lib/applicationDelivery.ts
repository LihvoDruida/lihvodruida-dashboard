import "server-only";
import { getDocumentDb } from "@/lib/documentDb";
import { APPLICATION_DELIVERY_QUEUE, applicationDeliveryId, applicationDeliveryKind as kind, applicationsCollectionName, normalizeStatus } from "@/lib/applicationsStore";
import { buildDiscordApplicationPayload, resolveApplicationsDiscordChannelId } from "@/lib/discord";
import { discordApi, discordMessageUrl, findDiscordPublicationMessage, type DiscordMessageRef } from "@/lib/discordAdmin";
import { DiscordRestError } from "@/lib/discordRest";
import { getCanonicalDashboardOrigin } from "@/lib/security";
import { DiscordPublicationPendingError, getDiscordPublicationOperation, publicationRevision, runDiscordPublicationCreation, withDiscordPublicationLease } from "@/lib/discordPublication";

type Job = { collection: string; resourceId: string; number: number; state: string; dueAtMs: number | null; attempts: number };
type Options = { collection?: string; resourceId?: string; force?: boolean; signal?: AbortSignal; manualRef?: DiscordMessageRef | null };
const terminal = (state: string) => ["delivered", "cancelled"].includes(state);
const identifiers = (number: number, options: Options) => {
  const collection = options.collection || applicationsCollectionName(), resourceId = options.resourceId || `application-${number}`;
  if (!Number.isSafeInteger(number) || number <= 0 || !collection || collection.length > 300 || !resourceId || resourceId.includes("/") || resourceId.length > 300) throw new Error("Invalid application delivery identity");
  return { collection, resourceId, id: applicationDeliveryId(collection, resourceId) };
};
export function withApplicationDeliveryLease<T>(number: number, run: (owned: () => Promise<void>) => Promise<T>, collection = applicationsCollectionName()) {
  return withDiscordPublicationLease(`application:${collection}:${number}`, run);
}
export async function assertApplicationDeliveryDeletable(number: number, resourceId: string) {
  const operation = await getDiscordPublicationOperation(kind(applicationsCollectionName()), resourceId);
  if (operation && ["sending", "uncertain", "confirmed"].includes(operation.state)) throw new DiscordPublicationPendingError("uncertain");
}
export async function readApplicationDelivery(number: number, options: Options = {}) {
  const identity = identifiers(number, options), db = getDocumentDb();
  const job = (await db.collection(APPLICATION_DELIVERY_QUEUE).doc(identity.id).get()).data();
  return { state: String(job?.state || "untracked"), attempts: Number(job?.attempts || 0), nextAttemptAt: typeof job?.dueAtMs === "number" ? new Date(job.dueAtMs).toISOString() : null, code: String(job?.code || ""), messageUrl: typeof job?.messageUrl === "string" ? job.messageUrl : "" };
}
function payload(data: Record<string, unknown>, number: number, resourceUrl: string) {
  return buildDiscordApplicationPayload({ issueNumber: number, trackingNumber: String(data.tracking_number || ""), characterName: String(data.character_name || ""), realm: String(data.realm || ""), region: String(data.region || "eu"), faction: String(data.faction || ""), className: String(data.class_name || ""), discord: String(data.discord || ""), battleTag: String(data.battle_tag || ""), source: String(data.source || ""), availability: String(data.availability || ""), status: normalizeStatus(String(data.status_key || data.status || "review")), resourceUrl });
}
const stable = (data: ReturnType<typeof payload>) => ({ ...data, embeds: data.embeds.map(embed => ({ ...embed, timestamp: undefined })) });

/** Persistent job + publication receipt. HTTP calls never hold a DB transaction. */
export async function processApplicationDelivery(number: number, options: Options = {}) {
  const identity = identifiers(number, options), db = getDocumentDb();
  try {
    const signal = options.signal || AbortSignal.timeout(35_000);
    return await withApplicationDeliveryLease(number, async owned => {
      const ref = db.collection(APPLICATION_DELIVERY_QUEUE).doc(identity.id), job = (await ref.get()).data() as Job | undefined;
      if (!job || terminal(job.state) || !options.force && Number(job.dueAtMs) > Date.now()) return readApplicationDelivery(number, options);
      const resource = db.collection(identity.collection).doc(identity.resourceId);
      const document = await resource.get();
      if (!document.exists) { await ref.update({ state: "cancelled", dueAtMs: null }); return readApplicationDelivery(number, options); }
      const previous = await getDiscordPublicationOperation(kind(identity.collection), identity.resourceId);
      if (options.manualRef && (!previous || !["sending", "uncertain"].includes(previous.state))) return { ...await readApplicationDelivery(number, options), code: "recovery_not_pending" };
      const attempts = Number(job.attempts || 0) + 1;
      await ref.update({ state: "processing", attempts, dueAtMs: Date.now() + 180_000, updatedAtMs: Date.now() });
      try {
        const channel = previous && previous.state !== "rejected" ? previous.target : await resolveApplicationsDiscordChannelId();
        if (!/^\d{16,25}$/.test(channel) || !process.env.DISCORD_BOT_TOKEN?.trim() && !["confirmed", "complete"].includes(previous?.state || "")) throw new DiscordRestError("Configuration unavailable", 401);
        const resourceUrl = `${getCanonicalDashboardOrigin()}/applications?q=${number}&delivery=${identity.id}`;
        const built = payload(document.data() || {}, number, resourceUrl);
        await owned();
        const result = await runDiscordPublicationCreation({
          kind: kind(identity.collection), collection: identity.collection, resourceId: identity.resourceId,
          target: channel, revision: publicationRevision(["initial-application", identity.id]), assertOwned: owned,
          context: { payload: built, resourceUrl },
          create: async operation => {
            const message = await discordApi<Record<string, unknown>>(`/channels/${operation.target}/messages`, {
              method: "POST", retry: "never", beforeSend: owned, signal,
              body: JSON.stringify({ ...(operation.context.payload as Record<string, unknown>), nonce: operation.nonce, enforce_nonce: true }),
            });
            if (message.channel_id && message.channel_id !== operation.target) throw new Error("Unexpected Discord channel");
            return { id: String(message.id || ""), channel_id: operation.target };
          },
          reconcile: operation => findDiscordPublicationMessage({ channelId: operation.target, nonce: operation.nonce, startedAt: operation.startedAt, resourceUrl: String(operation.context.resourceUrl || ""), manualRef: options.manualRef, signal }),
          patch: (result, current, operation) => {
            const existing = current.discord_message_ref as { message_id?: string } | undefined;
            if (existing?.message_id && existing.message_id !== result.id) throw new Error("Application reference changed");
            const link = { channel_id: operation.target, message_id: String(result.id) };
            return { discord_message_ref: link, discord_ref: link };
          },
        });
        // A decision may have committed while CREATE/recovery was in flight.
        // PATCH the latest state, then verify it did not change again.
        const latest = (await resource.get()).data();
        if (!latest) throw new Error("Application removed during delivery");
        const rendered = payload(latest, number, resourceUrl);
        await owned();
        await discordApi(`/channels/${result.operation.target}/messages/${result.result.id}`, { method: "PATCH", body: JSON.stringify(rendered), beforeSend: owned, signal });
        const checked = (await resource.get()).data();
        if (!checked || publicationRevision(stable(rendered)) !== publicationRevision(stable(payload(checked, number, resourceUrl)))) throw new Error("Application changed during delivery");
        await owned();
        await ref.update({ state: "delivered", dueAtMs: null, code: "", messageUrl: discordMessageUrl(result.operation.target, String(result.result.id)), updatedAtMs: Date.now() });
      } catch (error) {
        await owned();
        const stored = await getDiscordPublicationOperation(kind(identity.collection), identity.resourceId);
        const uncertain = error instanceof DiscordPublicationPendingError && error.reason === "uncertain" || !!stored && ["sending", "uncertain"].includes(stored.state);
        const blocked = error instanceof DiscordRestError && [400, 401, 403, 404, 405, 413].includes(error.status);
        const state = uncertain ? "uncertain" : blocked ? "blocked" : "retry";
        const wait = Math.max(error instanceof DiscordRestError ? error.retryAfterMs : 0, uncertain || blocked ? 300_000 : Math.min(3_600_000, 30_000 * 2 ** Math.min(attempts, 7)));
        await ref.update({ state, code: uncertain ? "needs_reconciliation" : blocked ? "discord_configuration" : "delivery_unavailable", dueAtMs: Date.now() + wait, updatedAtMs: Date.now() });
      }
      return readApplicationDelivery(number, options);
    }, identity.collection);
  } catch (error) {
    if (error instanceof DiscordPublicationPendingError && error.reason === "busy") return { ...await readApplicationDelivery(number, options), state: "processing" };
    throw error;
  }
}
export async function processApplicationDeliveryQueue() {
  const jobs = await getDocumentDb().collection(APPLICATION_DELIVERY_QUEUE).where("dueAtMs", "<=", Date.now()).orderBy("dueAtMs", "asc").limit(3).get();
  let processed = 0, sent = 0, deferred = 0, failed = 0;
  const start = Date.now(), signal = AbortSignal.timeout(40_000);
  for (const snapshot of jobs.docs) {
    if (signal.aborted || Date.now() - start > 35_000) break;
    const job = snapshot.data() as Job;
    try {
      const result = await processApplicationDelivery(job.number, { collection: job.collection, resourceId: job.resourceId, signal }); processed++;
      if (result.state === "delivered") sent++; else if (["pending", "processing", "cancelled"].includes(result.state)) deferred++; else failed++;
    } catch { failed++; }
  }
  return { processed, sent, deferred, failed };
}
