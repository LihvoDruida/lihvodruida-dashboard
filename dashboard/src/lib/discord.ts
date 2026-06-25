import {
  ApplicationStatus,
  extractDiscordMessageRef,
  getIssueStatusFromLabels,
  statusColor,
  statusEmoji,
  statusText,
} from "./github";
import { discordApi } from "@/lib/discordAdmin";

function cleanText(value: unknown, max = 200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function getDiscordBotConfig() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  return {
    botToken,
    channelId,
    ok: !!botToken,
  };
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
  const { botToken, channelId } = getDiscordBotConfig();

  if (!botToken || !channelId) {
    return { skipped: true, reason: "DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID is missing" };
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
