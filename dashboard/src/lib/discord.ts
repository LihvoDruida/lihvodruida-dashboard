import {
  ApplicationStatus,
  extractDiscordMessageRef,
  statusColor,
  statusEmoji,
  statusText,
} from "./github";
import { discordApi, getDiscordDefaultChannelId } from "@/lib/discordAdmin";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { buildApplicationCustomId } from "@mistblossom/discord-contract";

function buildApplicationModerationComponents(issueNumber: number) {
  return [{
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        label: "Прийняти",
        emoji: { name: "✅" },
        custom_id: buildApplicationCustomId("accept", issueNumber),
      },
      {
        type: 2,
        style: 4,
        label: "Відхилити",
        emoji: { name: "❌" },
        custom_id: buildApplicationCustomId("decline", issueNumber),
      },
    ],
  }];
}

function cleanText(value: unknown, max = 200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function getDiscordBotConfig() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  return {
    botToken,
    ok: !!botToken,
  };
}

export async function resolveApplicationsDiscordChannelId() {
  const legacyChannelId = getDiscordDefaultChannelId();
  try {
    const policy = await getGuildNicknamePolicy();
    return String(policy.applicationsChannelId || legacyChannelId || "").trim();
  } catch {
    return legacyChannelId;
  }
}


function updateEmbedDescription(description: string | undefined, status: ApplicationStatus) {
  const statusLine = `**Статус:** ${statusEmoji(status)} ${statusText(status)}`;
  const text = String(description || "").trim();

  if (!text) return statusLine;

  if (/\*\*Статус:\*\*[^\n]*/.test(text)) {
    return text.replace(/\*\*Статус:\*\*[^\n]*/, statusLine);
  }

  return [statusLine, text].join("\n");
}

function buildFallbackEmbed(params: {
  issueNumber: number;
  status: ApplicationStatus;
  moderator: string;
  issueUrl?: string;
  source: "dashboard" | "discord";
}) {
  return {
    title: `📋 Заявка #${params.issueNumber} оновлена`,
    description: [
      `**Статус:** ${statusEmoji(params.status)} **${statusText(params.status)}**`,
      `**Джерело:** ${params.source === "dashboard" ? "Панель" : "Discord"}`,
      `**Модератор:** ${cleanText(params.moderator, 80)}`,
      params.issueUrl ? `**Заявка:** ${params.issueUrl}` : "",
    ].filter(Boolean).join("\n"),
    color: statusColor(params.status),
    footer: { text: "Mistblossom Vanguard • Applications" },
    timestamp: new Date().toISOString(),
  };
}

export async function editDiscordApplicationMessage(params: {
  issue: any;
  issueNumber: number;
  status: ApplicationStatus;
  moderator: string;
  source: "dashboard" | "discord";
}) {
  const { botToken, ok } = getDiscordBotConfig();

  if (!ok || !botToken) {
    return { ok: false, skipped: true, reason: "DISCORD_BOT_TOKEN is missing" };
  }

  const ref = params.issue?.discord_message_ref || params.issue?.discord_ref || extractDiscordMessageRef(String(params.issue?.body || ""));

  if (!ref) {
    return { ok: false, skipped: true, reason: "Discord message marker is missing" };
  }

  let message: any;
  try {
    message = await discordApi<any>(`/channels/${ref.channel_id}/messages/${ref.message_id}`);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Could not fetch original Discord message",
    };
  }
  const embeds = Array.isArray(message.embeds) ? message.embeds.map((embed: any) => ({ ...embed })) : [];
  const primaryEmbed = embeds[0] || buildFallbackEmbed({
    issueNumber: params.issueNumber,
    status: params.status,
    moderator: params.moderator,
    issueUrl: params.issue?.html_url,
    source: params.source,
  });

  primaryEmbed.color = statusColor(params.status);
  primaryEmbed.description = updateEmbedDescription(primaryEmbed.description, params.status);
  primaryEmbed.footer = {
    text: `Mistblossom Vanguard • Оновив: ${cleanText(params.moderator, 80)}`,
  };
  primaryEmbed.timestamp = new Date().toISOString();

  embeds[0] = primaryEmbed;

  try {
    await discordApi<any>(`/channels/${ref.channel_id}/messages/${ref.message_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        content: `📋 **Заявка #${params.issueNumber} оновлена**\n> Статус: ${statusEmoji(params.status)} **${statusText(params.status)}**\n> Модератор: 👤 **${cleanText(params.moderator, 80)}**`,
        embeds: embeds.slice(0, 10),
        components: [],
        allowed_mentions: { parse: [] },
      }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Could not edit original Discord message",
    };
  }

  return {
    ok: true,
    channel_id: ref.channel_id,
    message_id: ref.message_id,
  };
}

export async function notifyDiscordStatusChange(params: {
  issueNumber: number;
  status: ApplicationStatus;
  moderator: string;
  issueUrl?: string;
  source: "dashboard" | "discord";
}) {
  const { botToken } = getDiscordBotConfig();
  const channelId = await resolveApplicationsDiscordChannelId();

  if (!botToken || !channelId) {
    return { skipped: true, reason: "DISCORD_BOT_TOKEN або канал заявок не налаштований" };
  }

  try {
    await discordApi<any>(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [buildFallbackEmbed(params)],
      }),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Discord API error" };
  }
}

export type DiscordApplicationDeliveryResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  channel_id?: string;
  message_id?: string;
};

export async function notifyDiscordNewApplication(params: {
  issueNumber: number;
  trackingNumber?: string | null;
  characterName: string;
  realm: string;
  region?: string | null;
  faction?: string | null;
  className?: string | null;
  discord?: string | null;
  battleTag?: string | null;
  source?: string | null;
  availability?: string | null;
}): Promise<DiscordApplicationDeliveryResult> {
  const { botToken } = getDiscordBotConfig();
  const channelId = await resolveApplicationsDiscordChannelId();
  if (!botToken || !channelId) {
    return { ok: false, skipped: true, reason: "DISCORD_BOT_TOKEN або канал заявок не налаштований" };
  }

  const fields = [
    { name: "Персонаж", value: `**${cleanText(params.characterName, 48)}** · ${cleanText(params.region || "eu", 8).toUpperCase()}-${cleanText(params.realm, 48)}`, inline: false },
    { name: "Клас / фракція", value: `${cleanText(params.className || "Не вказано", 40)} · ${cleanText(params.faction || "Не вказано", 24)}`, inline: true },
    { name: "Код", value: cleanText(params.trackingNumber || `#${params.issueNumber}`, 40), inline: true },
    { name: "Discord", value: cleanText(params.discord || "Не вказано", 64), inline: true },
    { name: "BattleTag", value: cleanText(params.battleTag || "Не вказано", 64), inline: true },
    { name: "Звідки дізнався", value: cleanText(params.source || "Не вказано", 180), inline: false },
    { name: "Коли грає", value: cleanText(params.availability || "Не вказано", 700), inline: false },
  ];

  try {
    const message = await discordApi<any>(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `📋 Нова заявка #${params.issueNumber} · ${cleanText(params.characterName, 48)}`,
          description: `**Статус:** ${statusEmoji("review")} **${statusText("review")}**\nНадіслано через lihvodruida.pp.ua`,
          color: statusColor("review"),
          fields,
          footer: { text: "Mistblossom Vanguard • Applications" },
          timestamp: new Date().toISOString(),
        }],
        components: buildApplicationModerationComponents(params.issueNumber),
      }),
    });

    return {
      ok: true,
      channel_id: String(message?.channel_id || channelId),
      message_id: String(message?.id || ""),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Discord API error" };
  }
}


export async function notifyDiscordApplicationChannelTest(params: { moderator: string; channelId?: string | null }) {
  const { botToken } = getDiscordBotConfig();
  const requestedChannelId = String(params.channelId || "").trim();
  const channelId = /^\d{16,25}$/.test(requestedChannelId) ? requestedChannelId : await resolveApplicationsDiscordChannelId();
  if (!botToken || !channelId) {
    return { ok: false, skipped: true, reason: "DISCORD_BOT_TOKEN або канал заявок не налаштований" };
  }

  try {
    const message = await discordApi<any>(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: "🧪 Тест каналу заявок",
          description: `Канал заявок Mistblossom Vanguard налаштований правильно.\n\nПеревірив: **${cleanText(params.moderator, 80)}**`,
          color: statusColor("review"),
          footer: { text: "Mistblossom Vanguard • Applications test" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    return { ok: true, channel_id: String(message?.channel_id || channelId), message_id: String(message?.id || "") };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Discord API error" };
  }
}

export type DeleteDiscordApplicationMessageResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  channel_id?: string;
  message_id?: string;
  deleted?: boolean;
  alreadyMissing?: boolean;
};

export async function deleteDiscordApplicationMessage(issue: any): Promise<DeleteDiscordApplicationMessageResult> {
  const { botToken } = getDiscordBotConfig();
  if (!botToken) return { ok: false, skipped: true, reason: "DISCORD_BOT_TOKEN is missing" };

  const ref = issue?.discord_message_ref || issue?.discord_ref || extractDiscordMessageRef(String(issue?.body || ""));
  if (!ref) return { ok: true, skipped: true, reason: "Discord message marker is missing" };

  try {
    await discordApi<void>(`/channels/${ref.channel_id}/messages/${ref.message_id}`, { method: "DELETE", expectedStatuses: [404] });
    return { ok: true, channel_id: ref.channel_id, message_id: ref.message_id, deleted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Discord API error");
    if (/Discord API 404/i.test(message)) {
      return { ok: true, channel_id: ref.channel_id, message_id: ref.message_id, deleted: false, alreadyMissing: true };
    }
    return { ok: false, channel_id: ref.channel_id, message_id: ref.message_id, reason: message };
  }
}
