const DISCORD_CDN = "https://cdn.discordapp.com";

function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function cleanHash(value: unknown) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_]{6,128}$/.test(text) ? text : "";
}

function normalizedSize(value: unknown) {
  const parsed = Number(value);
  const allowed = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
  return allowed.includes(parsed) ? parsed : 256;
}

export function discordDefaultAvatarIndex(userIdInput: unknown, discriminatorInput?: unknown) {
  const userId = cleanSnowflake(userIdInput);
  if (!userId) return 0;
  const discriminator = String(discriminatorInput || "").trim();
  if (/^\d{4}$/.test(discriminator) && discriminator !== "0000") {
    return Number.parseInt(discriminator, 10) % 5;
  }
  try {
    return Number((BigInt(userId) >> 22n) % 6n);
  } catch {
    return 0;
  }
}

export function discordDefaultAvatarUrl(userIdInput: unknown, discriminatorInput?: unknown) {
  const userId = cleanSnowflake(userIdInput);
  if (!userId) return null;
  return `${DISCORD_CDN}/embed/avatars/${discordDefaultAvatarIndex(userId, discriminatorInput)}.png`;
}

export function resolveDiscordAvatarUrl(input: {
  userId: unknown;
  guildId?: unknown;
  guildAvatarHash?: unknown;
  userAvatarHash?: unknown;
  discriminator?: unknown;
  size?: unknown;
}) {
  const userId = cleanSnowflake(input.userId);
  if (!userId) return null;
  const guildId = cleanSnowflake(input.guildId);
  const guildAvatar = cleanHash(input.guildAvatarHash);
  const userAvatar = cleanHash(input.userAvatarHash);
  const size = normalizedSize(input.size);

  if (guildId && guildAvatar) {
    return `${DISCORD_CDN}/guilds/${guildId}/users/${userId}/avatars/${guildAvatar}.webp?size=${size}`;
  }
  if (userAvatar) {
    return `${DISCORD_CDN}/avatars/${userId}/${userAvatar}.webp?size=${size}`;
  }
  return discordDefaultAvatarUrl(userId, input.discriminator);
}
