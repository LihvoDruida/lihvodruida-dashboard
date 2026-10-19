export function getDashboardUrl() {
  return (process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}
export function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function discordRedirectUri() { return `${getDashboardUrl()}/api/auth/discord/callback`; }
export function buildDiscordOAuthUrl(state: string) {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
  if (!clientId) throw new Error("DISCORD_OAUTH_CLIENT_ID is not configured.");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", discordRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify email guilds.members.read");
  url.searchParams.set("state", state);
  return url.toString();
}
export class DiscordOAuthError extends Error {
  constructor(public readonly reason: "http" | "timeout" | "schema" | "body_limit" | "scope", public readonly status = 0, public readonly apiCode: number | null = null) {
    super(`Discord OAuth ${reason}${status ? ` ${status}` : ""}`);
    this.name = "DiscordOAuthError";
  }
}
type OAuthOptions = { signal?: AbortSignal };
const snowflake = (value: unknown): value is string => typeof value === "string" && /^\d{16,25}$/.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
async function discordOAuthJson(url: string, init: RequestInit, options: OAuthOptions) {
  const deadline = AbortSignal.timeout(10_000);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  try {
    signal.throwIfAborted();
    const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal });
    const reader = response.body?.getReader();
    if (!reader) throw new DiscordOAuthError("schema", response.status);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 128 * 1024) throw new DiscordOAuthError("body_limit", response.status);
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    let data: Record<string, unknown>;
    try { data = record(JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))); }
    catch { throw new DiscordOAuthError("schema", response.status); }
    if (!response.ok) throw new DiscordOAuthError("http", response.status, typeof data.code === "number" ? data.code : null);
    if (!/application\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get("content-type") || "")) throw new DiscordOAuthError("schema", response.status);
    return data;
  } catch (error) {
    if (signal.aborted) throw new DiscordOAuthError("timeout");
    throw error;
  }
}
export async function exchangeDiscordCode(code: string, options: OAuthOptions = {}) {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Discord OAuth env is not configured.");
  // A one-use authorization code is sent exactly once, including on timeout.
  const data = await discordOAuthJson("https://discord.com/api/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: discordRedirectUri() }),
  }, options);
  if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 4096 || String(data.token_type).toLowerCase() !== "bearer" || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0) throw new DiscordOAuthError("schema");
  if (typeof data.scope !== "string" || !["identify", "guilds.members.read"].every(scope => (data.scope as string).split(/\s+/).includes(scope))) throw new DiscordOAuthError("scope");
  return { access_token: data.access_token };
}
export async function fetchDiscordUser(accessToken: string, options: OAuthOptions = {}) {
  const data = await discordOAuthJson("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${accessToken}` } }, options);
  if (!snowflake(data.id) || typeof data.username !== "string" || !data.username || data.username.length > 80) throw new DiscordOAuthError("schema");
  for (const field of ["global_name", "avatar", "discriminator"]) if (data[field] != null && (typeof data[field] !== "string" || (data[field] as string).length > 128)) throw new DiscordOAuthError("schema");
  return data as { id: string; username: string; global_name?: string | null; avatar?: string | null; discriminator?: string };
}
export async function fetchDiscordGuildMember(accessToken: string, options: OAuthOptions = {}) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!snowflake(guildId)) throw new Error("DISCORD_GUILD_ID is not configured.");
  const data = await discordOAuthJson(`https://discord.com/api/users/@me/guilds/${guildId}/member`, { headers: { Authorization: `Bearer ${accessToken}` } }, options);
  if (!Array.isArray(data.roles) || data.roles.length > 250 || !data.roles.every(snowflake) || typeof data.joined_at !== "string" || !Number.isFinite(Date.parse(data.joined_at)) || data.avatar != null && typeof data.avatar !== "string") throw new DiscordOAuthError("schema");
  return data as { roles: string[]; joined_at: string; avatar?: string | null };
}
