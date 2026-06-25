import { discordApi } from "@/lib/discordAdmin";

export type GuildBranding = {
  name: string;
  iconUrl: string;
};

const FALLBACK_GUILD_NAME = "Mistblossom Vanguard";
const FALLBACK_GUILD_ICON = "/favicon.ico";

let cachedBranding: {
  value: GuildBranding;
  expiresAt: number;
} | null = null;

function buildDiscordGuildIconUrl(guildId: string, iconHash: string) {
  // Static PNG avoids Chrome CORB warnings from animated Discord GIF CDN responses.
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=128`;
}

export async function getGuildBranding(): Promise<GuildBranding> {
  const now = Date.now();

  if (cachedBranding && cachedBranding.expiresAt > now) {
    return cachedBranding.value;
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!guildId || !botToken) {
    return {
      name: process.env.DISCORD_GUILD_NAME || FALLBACK_GUILD_NAME,
      iconUrl: FALLBACK_GUILD_ICON,
    };
  }

  try {
    const guild = await discordApi<any>(`/guilds/${guildId}`, { method: "GET" });

    const value: GuildBranding = {
      name: guild?.name || process.env.DISCORD_GUILD_NAME || FALLBACK_GUILD_NAME,
      iconUrl: guild?.icon ? buildDiscordGuildIconUrl(guildId, guild.icon) : FALLBACK_GUILD_ICON,
    };

    cachedBranding = {
      value,
      expiresAt: now + 1000 * 60 * 10,
    };

    return value;
  } catch {
    return {
      name: process.env.DISCORD_GUILD_NAME || FALLBACK_GUILD_NAME,
      iconUrl: FALLBACK_GUILD_ICON,
    };
  }
}

// Backward-compatible helpers for old imports.
export async function getGuildIconUrl() {
  return (await getGuildBranding()).iconUrl;
}

export async function getGuildName() {
  return (await getGuildBranding()).name;
}
