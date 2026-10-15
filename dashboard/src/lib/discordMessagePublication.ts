import "server-only";

import { getDocumentDb } from "@/lib/documentDb";
import {
  createDiscordRaidMessage, editDiscordRaidMessage, deleteDiscordRaidMessage,
  findDiscordPublicationMessage, discordMessageUrl, parseDiscordMessageRef, type DiscordMessageRef,
} from "@/lib/discordAdmin";
import {
  getDiscordPublicationOperation, publicationRevision, runDiscordPublicationCreation,
  updateDiscordPublicationOperation,
  type PublicationOperation,
} from "@/lib/discordPublication";

type MessagePayload = {
  content: string; embed: Record<string, unknown>; components: unknown[]; mentionRoleIds: string[];
};
type MessageResult = { channelId: string; messageId: string; messageUrl: string };
type Options = {
  kind: "raid-message" | "poll-message";
  collection: string; resourceId: string; channelId: string;
  assertOwned: () => Promise<void>;
  manualRef?: DiscordMessageRef | null;
  build: (current: Record<string, unknown>) => Promise<{ payload: MessagePayload; resourceUrl: string }>;
  patch?: (current: Record<string, unknown>) => Record<string, unknown>;
};
const missing = (error: unknown) => /404|unknown message|10008/i.test(error instanceof Error ? error.message : String(error));

/** Caller owns a per-resource lease, shared by all publishers and deletion. */
export async function publishDiscordResourceMessage(options: Options): Promise<MessageResult & { cleanupWarning: string | null }> {
  const db = getDocumentDb();
  const ref = db.collection(options.collection).doc(options.resourceId);
  const read = async () => {
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("Обʼєкт не знайдено. Публікацію зупинено.");
    return snapshot.data() || {};
  };
  const messageChannel = (data: Record<string, unknown>) => String(data.discordMessageChannelId || parseDiscordMessageRef(String(data.messageUrl || ""))?.channelId || data.channelId || "");
  let current = await read();
  const previous = await getDiscordPublicationOperation(options.kind, options.resourceId);
  let cleanupWarning: string | null = null;

  const references = (result: Record<string, unknown>, operation: PublicationOperation): MessageResult => ({
    channelId: operation.target, messageId: String(result.id), messageUrl: discordMessageUrl(operation.target, String(result.id)),
  });
  const commitPatch = (result: Record<string, unknown>, data: Record<string, unknown>, operation: PublicationOperation) => {
    if (data.messageId && data.messageId !== operation.previousId && data.messageId !== result.id)
      throw new Error("Посилання на повідомлення змінилося. Потрібна звірка публікації.");
    return {
      ...(options.patch?.(data) || {}), ...references(result, operation),
      channelId: data.channelId || operation.target,
      discordMessageChannelId: operation.target, discordPublicationRevision: operation.revision,
    };
  };
  const cleanup = async (operation: PublicationOperation) => {
    const oldChannel = String(operation.context.previousChannelId || "");
    if (operation.cleanupDone || !oldChannel || oldChannel === operation.target || !operation.previousId) return;
    // Keep the previous receipt until deletion succeeds; a later call retries
    // cleanup before it can replace this receipt with a new move operation.
    await options.assertOwned();
    try {
      await deleteDiscordRaidMessage({ ref: { channelId: oldChannel, messageId: operation.previousId }, auditReason: `Published message moved: ${options.resourceId}` });
    } catch (error) {
      if (!missing(error)) {
        cleanupWarning = "Нове оголошення збережено. Старе повідомлення ще не вдалося прибрати; повтори оновлення Discord.";
        throw new Error(cleanupWarning);
      }
    }
    await updateDiscordPublicationOperation(options.kind, options.resourceId, operation.nonce, { cleanupDone: true });
  };
  const create = async (data: Record<string, unknown>) => {
    const built = await options.build(data);
    // Embed timestamp is presentation metadata, not a new content revision.
    const stablePayload = { ...built.payload, embed: { ...built.payload.embed, timestamp: undefined } };
    const result = await runDiscordPublicationCreation({
      kind: options.kind, resourceId: options.resourceId, collection: options.collection,
      target: options.channelId, revision: publicationRevision(stablePayload), previousId: String(data.messageId || ""),
      context: { payload: built.payload, resourceUrl: built.resourceUrl, previousChannelId: messageChannel(data) },
      assertOwned: options.assertOwned,
      create: async operation => {
        const payload = operation.context.payload as MessagePayload;
        const message = await createDiscordRaidMessage({
          ...payload, channelId: operation.target, nonce: operation.nonce, retry: "never",
          auditReason: `Durable ${options.kind} publication: ${options.resourceId}`,
        });
        if (message?.channel_id && String(message.channel_id) !== operation.target)
          throw new Error("Discord повернув повідомлення з іншого каналу; потрібна звірка.");
        return { id: String(message?.id || ""), channel_id: String(message?.channel_id || operation.target) };
      },
      reconcile: operation => findDiscordPublicationMessage({
        channelId: operation.target, nonce: operation.nonce, startedAt: operation.startedAt,
        resourceUrl: String(operation.context.resourceUrl || ""), manualRef: options.manualRef,
      }),
      patch: commitPatch,
    });
    await cleanup(result.operation);
    // A signup/closure can commit while the HTTP request is in flight. Render
    // that fresh state once before returning rather than leave live buttons.
    const latest = await read();
    const rendered = await options.build(latest);
    const revision = publicationRevision({ ...rendered.payload, embed: { ...rendered.payload.embed, timestamp: undefined } });
    if (result.operation.target === options.channelId && revision !== result.operation.revision) {
      await options.assertOwned();
      await editDiscordRaidMessage({ ...rendered.payload,
        ref: { channelId: result.operation.target, messageId: String(result.result.id) },
        auditReason: `Published message refreshed after concurrent change: ${options.resourceId}`,
      });
    }
    return references(result.result, result.operation);
  };

  if (previous && !["complete", "rejected"].includes(previous.state)) {
    await create(current); // Always finish/reconcile the old operation first.
    current = await read();
  } else if (previous?.state === "complete") {
    await cleanup(previous);
  }

  const oldChannel = messageChannel(current);
  const oldMessageId = String(current.messageId || "");
  if (!oldMessageId || oldChannel !== options.channelId) {
    return { ...await create(current), cleanupWarning };
  }
  const built = await options.build(current);
  await options.assertOwned();
  try {
    await editDiscordRaidMessage({ ...built.payload, ref: { channelId: oldChannel, messageId: oldMessageId }, auditReason: `Published message updated: ${options.resourceId}` });
  } catch (error) {
    if (!missing(error)) throw error;
    return { ...await create(current), cleanupWarning };
  }
  await options.assertOwned();
  const result = { channelId: oldChannel, messageId: oldMessageId, messageUrl: discordMessageUrl(oldChannel, oldMessageId) };
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error("Обʼєкт видалено. Оновлення зупинено.");
    const data = snapshot.data() || {};
    if (data.messageId !== oldMessageId) throw new Error("Посилання змінилося. Повтори оновлення.");
    tx.update(ref, { ...(options.patch?.(data) || {}), ...result, channelId: data.channelId || oldChannel, discordMessageChannelId: oldChannel });
  });
  return { ...result, cleanupWarning };
}
