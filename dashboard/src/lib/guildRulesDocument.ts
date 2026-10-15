import "server-only";

import { createHash } from "node:crypto";
import { fetchDiscordEditableMessage, parseDiscordMessageRef, listRulesEmbedMessages, type DiscordEditableMessage } from "@/lib/discordAdmin";
import { getPublicRulesMessageUrl } from "@/lib/rulesAcceptanceSettings";
import { MISTBLOSSOM_DISCORD_CHANNELS } from "@/lib/discordGuildLinks";

export type GuildRulesDocument = {
  title: string;
  markdown: string;
  revision: string;
  messageId: string;
};

/** One source of truth: the published guild message edited by DiscordEmbedEditor.
 * No second copy/cache that could keep showing rules after an editor update. */
export function guildRulesDocumentFromMessages(messages: DiscordEditableMessage[], roleIds: string[]): GuildRulesDocument | null {
  if (!roleIds.length) return null;
  const message = messages.find(item => item.rulesType === "guild" &&
    item.roleIds.length === roleIds.length && roleIds.every(id => item.roleIds.includes(id)));
  if (!message) return null;
  const embed = message.embed || {};
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const fields = Array.isArray(embed.fields) ? embed.fields.slice(0, 25) : [];
  const markdown = [text(message.content), text(embed.description), ...fields.map(field => {
    if (!field || typeof field !== "object") return "";
    const item = field as Record<string, unknown>;
    return [text(item.name) ? `### ${text(item.name)}` : "", text(item.value)].filter(Boolean).join("\n\n");
  })].filter(Boolean).join("\n\n");
  // Never accept a partial/truncated document or an empty publication.
  if (!markdown || markdown.length > 20_000) return null;
  const title = text(embed.title) || "Правила гільдії";
  const revision = createHash("sha256").update(JSON.stringify([message.id, title, markdown, [...roleIds].sort()])).digest("hex");
  return { title, markdown, revision, messageId: message.id };
}

export async function listPublishedGuildRulesMessages() {
  const publicRulesMessageUrl = await getPublicRulesMessageUrl();
  if (publicRulesMessageUrl) {
    const ref = parseDiscordMessageRef(publicRulesMessageUrl);
    if (!ref) return [];
    return [await fetchDiscordEditableMessage(ref)];
  }
  // Existing installations continue to use their original rules channel until
  // the next editor save records the explicit current publication.
  const channelId = String(process.env.DISCORD_GUILD_RULES_CHANNEL_ID || MISTBLOSSOM_DISCORD_CHANNELS.rules.id).trim();
  return listRulesEmbedMessages(channelId, 50);
}

export async function getGuildRulesDocument(roleIds: string[]) {
  return guildRulesDocumentFromMessages(await listPublishedGuildRulesMessages(), roleIds);
}
