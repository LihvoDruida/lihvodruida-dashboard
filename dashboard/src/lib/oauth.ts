export function getDashboardUrl() {
  return (
    process.env.DASHBOARD_URL ||
    process.env.NEXT_PUBLIC_DASHBOARD_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function discordRedirectUri() {
  return `${getDashboardUrl()}/api/auth/discord/callback`;
}

export function buildDiscordOAuthUrl(state: string) {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID || process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    throw new Error("DISCORD_OAUTH_CLIENT_ID is not configured.");
  }

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", discordRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify email guilds.members.read");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeDiscordCode(code: string) {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Discord OAuth env is not configured.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: discordRedirectUri(),
  });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function fetchDiscordUser(accessToken: string) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function fetchDiscordGuildMember(accessToken: string) {
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!guildId) {
    throw new Error("DISCORD_GUILD_ID is not configured.");
  }

  const response = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord guild member ${response.status}: ${body || "member lookup failed"}`);
  }

  return response.json();
}
