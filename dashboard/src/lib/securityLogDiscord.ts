import "server-only";

import { getStructuredLogSettings } from "@/lib/logSettings";

export type SecurityMirrorLog = {
  id: string;
  createdAt: string;
  level: "debug" | "info" | "success" | "warning" | "error";
  event: string;
  message: string | null;
  actorName?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  ip?: string | null;
  details?: Record<string, unknown>;
};

export type SecurityMirrorResult = {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  reason?: string;
  channelId?: string;
};

const SECURITY_MIRROR_DEDUPE_MS = 20_000;
const recentSecurityMirrors = new Map<string, number>();

function mirrorKey(log: SecurityMirrorLog) {
  return [log.level, log.event, log.method || "", log.path || "", log.ip || "", log.message || ""].join("\u001f");
}

function shouldMirrorNow(log: SecurityMirrorLog) {
  const now = Date.now();
  const key = mirrorKey(log);
  const previous = recentSecurityMirrors.get(key) || 0;
  if (recentSecurityMirrors.size > 256) {
    for (const [entry, at] of recentSecurityMirrors) {
      if (now - at > SECURITY_MIRROR_DEDUPE_MS) recentSecurityMirrors.delete(entry);
    }
  }
  if (now - previous < SECURITY_MIRROR_DEDUPE_MS) return false;
  recentSecurityMirrors.set(key, now);
  return true;
}

const LEVEL_RANK: Record<string, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warning: 2,
  error: 3,
};

function discordColor(level: string) {
  if (level === "error") return 0xed4245;
  if (level === "warning") return 0xf0b232;
  if (level === "success") return 0x57f287;
  return 0x5865f2;
}

function cleanText(value: unknown, max = 900) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactDetails(details: Record<string, unknown> | undefined) {
  if (!details) return "";
  const pairs = Object.entries(details)
    .filter(([key]) => !/token|secret|password|authorization|cookie|signature|body|html|stack/i.test(key))
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${cleanText(typeof value === "string" ? value : JSON.stringify(value), 180)}`)
    .filter((line) => !line.endsWith(": "));
  return pairs.join("\n").slice(0, 900);
}

export async function mirrorSecurityLogToDiscordDetailed(
  log: SecurityMirrorLog,
  options: { bypassDedupe?: boolean } = {},
): Promise<SecurityMirrorResult> {
  const settings = await getStructuredLogSettings().catch(() => null);
  if (!settings?.securityDiscordEnabled) {
    return { ok: false, skipped: true, reason: "security_mirror_disabled" };
  }
  if (!settings.securityDiscordChannelId) {
    return { ok: false, skipped: true, reason: "security_channel_missing" };
  }
  if ((LEVEL_RANK[log.level] ?? 1) < (LEVEL_RANK[settings.securityDiscordMinLevel] ?? 2)) {
    return { ok: false, skipped: true, reason: "below_min_level", channelId: settings.securityDiscordChannelId };
  }
  if (!options.bypassDedupe && !shouldMirrorNow(log)) {
    return { ok: false, skipped: true, reason: "deduplicated", channelId: settings.securityDiscordChannelId };
  }

  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) {
    return { ok: false, reason: "discord_bot_token_missing", channelId: settings.securityDiscordChannelId };
  }

  const details = compactDetails(log.details);
  const fields = [
    log.method || log.path ? { name: "Request", value: `\`${cleanText(log.method || "—", 12)} ${cleanText(log.path || "—", 220)}\``, inline: false } : null,
    log.actorName ? { name: "Actor", value: cleanText(log.actorName, 120), inline: true } : null,
    log.ip ? { name: "IP", value: `\`${cleanText(log.ip, 80)}\``, inline: true } : null,
    Number.isFinite(log.statusCode) ? { name: "HTTP", value: String(log.statusCode), inline: true } : null,
    details ? { name: "Details", value: `\`\`\`\n${details}\n\`\`\``, inline: false } : null,
  ].filter(Boolean);

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${settings.securityDiscordChannelId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `🛡️ Security · ${cleanText(log.event, 180)}`,
          description: cleanText(log.message || "Подія безпеки", 1800),
          color: discordColor(log.level),
          timestamp: log.createdAt,
          footer: { text: `Mistblossom Security · ${log.id.slice(0, 12)}` },
          fields,
        }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const reason = cleanText(body, 240) || `Discord HTTP ${response.status}`;
      console.warn("[structured-logs] security Discord mirror failed", response.status, reason);
      return { ok: false, status: response.status, reason, channelId: settings.securityDiscordChannelId };
    }
    return { ok: true, status: response.status, channelId: settings.securityDiscordChannelId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[structured-logs] security Discord mirror failed", reason);
    return { ok: false, reason, channelId: settings.securityDiscordChannelId };
  }
}

export async function mirrorSecurityLogToDiscord(log: SecurityMirrorLog) {
  const result = await mirrorSecurityLogToDiscordDetailed(log);
  return result.ok;
}
