import { mapConcurrent } from "@/lib/concurrency";
import { parseRulesRoleIdsFromUrl } from "@/lib/rulesOnboarding";
import { logDashboardEvent } from "@/lib/security";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DASHBOARD_CUSTOM_ID_PREFIX = "mbv1";


export type DiscordRulesStats = {
  rulesType: "guild";
  accepted: number;
  declined: number;
  total: number;
  updatedAt: string | null;
  configured: boolean;
  source: "kv" | "worker" | "missing-kv-binding" | "invalid-binding" | "unconfigured" | "error";
  error?: string;
};

export type DiscordRaidRulesStats = {
  rulesType: "raid";
  signed: number;
  total: number;
  updatedAt: string | null;
  configured: boolean;
  source: "kv" | "worker" | "missing-kv-binding" | "invalid-binding" | "unconfigured" | "error";
  error?: string;
};

export type DiscordRulesType = "guild" | "raid";

export type DiscordRaidRulesSignup = {
  discordId: string;
  discordName: string;
  signedAt: string;
  profileId?: string | null;
  mainCharacter?: {
    key?: string | null;
    name?: string | null;
    realmName?: string | null;
    realmSlug?: string | null;
    region?: string | null;
    className?: string | null;
    activeSpecName?: string | null;
    activeSpecId?: number | null;
    activeSpecRole?: string | null;
    profileUrl?: string | null;
  } | null;
};

export type DiscordRaidRulesSignupsResponse = {
  rulesType: "raid";
  configured: boolean;
  total: number;
  updatedAt: string | null;
  source: "kv" | "worker" | "missing-kv-binding" | "invalid-binding" | "unconfigured" | "error";
  signups: DiscordRaidRulesSignup[];
  error?: string;
};

const DEFAULT_WORKER_ENDPOINT = "https://guild-applications.melles-android.workers.dev/api/discord-interactions";

function workerApiEndpoint(path: string, explicitEnvKey: string) {
  const explicit = String(process.env[explicitEnvKey] || "").trim();
  if (explicit) return explicit;

  const interactions = String(process.env.DISCORD_INTERACTIONS_ENDPOINT || DEFAULT_WORKER_ENDPOINT).trim();
  if (!interactions) return "";

  if (/\/api\/discord-interactions\/?$/i.test(interactions)) {
    return interactions.replace(/\/api\/discord-interactions\/?$/i, path);
  }

  try {
    const url = new URL(interactions);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function rulesStatsEndpoint() {
  return workerApiEndpoint("/api/discord-rules-stats", "DISCORD_RULES_STATS_ENDPOINT");
}

function workerStatsToken() {
  return String(process.env.DISCORD_RULES_STATS_TOKEN || process.env.WORKER_STATS_TOKEN || "").trim();
}

function workerStatsHeaders(): HeadersInit {
  const token = workerStatsToken();
  return {
    accept: "application/json",
    ...(token
      ? {
          authorization: `Bearer ${token}`,
          "x-worker-stats-token": token,
        }
      : {}),
  };
}

function raidRulesStatsEndpoint() {
  return workerApiEndpoint("/api/discord-raid-rules-stats", "DISCORD_RAID_RULES_STATS_ENDPOINT");
}

function raidRulesSignupsEndpoint() {
  return workerApiEndpoint("/api/discord-raid-rules-signups", "DISCORD_RAID_RULES_SIGNUPS_ENDPOINT");
}

function safeNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
}

export async function fetchDiscordRulesStats(): Promise<DiscordRulesStats> {
  const endpoint = rulesStatsEndpoint();
  if (!endpoint) {
    return { rulesType: "guild", accepted: 0, declined: 0, total: 0, updatedAt: null, configured: false, source: "unconfigured" };
  }

  try {
    const statsUrl = new URL(endpoint);
    const guildId = getDiscordGuildId();
    if (guildId && !statsUrl.searchParams.has("guild_id")) {
      statsUrl.searchParams.set("guild_id", guildId);
    }
    if (!statsUrl.searchParams.has("type") && !statsUrl.searchParams.has("rules_type")) {
      statsUrl.searchParams.set("type", "guild");
    }

    const response = await fetch(statsUrl.toString(), {
      headers: workerStatsHeaders(),
      cache: "no-store",
    });

    const raw = await response.text().catch(() => "");
    const data = raw ? tryParseJson(raw) : null;

    if (!response.ok || !data || typeof data !== "object") {
      return {
        rulesType: "guild",
        accepted: 0,
        declined: 0,
        total: 0,
        updatedAt: null,
        configured: false,
        source: "error",
        error: typeof data?.error === "string" ? data.error : "Статистика звичайних правил тимчасово недоступна.",
      };
    }

    const returnedType = String(data.rules_type || data.rulesType || "guild").toLowerCase();
    if (returnedType && !["guild", "rules"].includes(returnedType)) {
      return {
        rulesType: "guild",
        accepted: 0,
        declined: 0,
        total: 0,
        updatedAt: null,
        configured: false,
        source: "error",
        error: `Статистика звичайних правил тимчасово недоступна.`,
      };
    }

    const accepted = safeNumber(data.accepted);
    const declined = safeNumber(data.declined);

    const source = typeof data.source === "string" ? data.source : "worker";

    return {
      rulesType: "guild",
      accepted,
      declined,
      total: safeNumber(data.total) || accepted + declined,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : typeof data.updatedAt === "string" ? data.updatedAt : null,
      configured: Boolean(data.configured ?? true),
      source: ["kv", "missing-kv-binding", "invalid-binding", "worker", "error"].includes(source) ? source as DiscordRulesStats["source"] : "worker",
      error: typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : undefined,
    };
  } catch (error) {
    return {
      rulesType: "guild",
      accepted: 0,
      declined: 0,
      total: 0,
      updatedAt: null,
      configured: false,
      source: "error",
      error: "Статистика правил тимчасово недоступна.",
    };
  }
}

export async function fetchDiscordRaidRulesStats(): Promise<DiscordRaidRulesStats> {
  const endpoint = raidRulesStatsEndpoint();
  if (!endpoint) {
    return { rulesType: "raid", signed: 0, total: 0, updatedAt: null, configured: false, source: "unconfigured" };
  }

  try {
    const statsUrl = new URL(endpoint);
    const guildId = getDiscordGuildId();
    if (guildId && !statsUrl.searchParams.has("guild_id")) {
      statsUrl.searchParams.set("guild_id", guildId);
    }

    const response = await fetch(statsUrl.toString(), {
      headers: workerStatsHeaders(),
      cache: "no-store",
    });

    const raw = await response.text().catch(() => "");
    const data = raw ? tryParseJson(raw) : null;

    if (!response.ok || !data || typeof data !== "object") {
      return {
        rulesType: "raid",
        signed: 0,
        total: 0,
        updatedAt: null,
        configured: false,
        source: "error",
        error: typeof data?.error === "string" ? data.error : "Статистика рейдових правил тимчасово недоступна.",
      };
    }

    const returnedType = String(data.rules_type || data.rulesType || "raid").toLowerCase();
    if (returnedType && !["raid", "raid-rules"].includes(returnedType)) {
      return {
        rulesType: "raid",
        signed: 0,
        total: 0,
        updatedAt: null,
        configured: false,
        source: "error",
        error: `Статистика рейдових правил тимчасово недоступна.`,
      };
    }

    const signed = safeNumber(data.signed ?? data.stats?.signed ?? data.total);
    const source = typeof data.source === "string" ? data.source : "worker";

    return {
      rulesType: "raid",
      signed,
      total: safeNumber(data.total) || signed,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : typeof data.updatedAt === "string" ? data.updatedAt : null,
      configured: Boolean(data.configured ?? true),
      source: ["kv", "missing-kv-binding", "invalid-binding", "worker", "error"].includes(source) ? source as DiscordRaidRulesStats["source"] : "worker",
      error: typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : undefined,
    };
  } catch (error) {
    return {
      rulesType: "raid",
      signed: 0,
      total: 0,
      updatedAt: null,
      configured: false,
      source: "error",
      error: "Статистика рейдових правил тимчасово недоступна.",
    };
  }
}

export async function fetchDiscordRaidRulesSignups(): Promise<DiscordRaidRulesSignupsResponse> {
  const endpoint = raidRulesSignupsEndpoint();
  if (!endpoint) {
    return { rulesType: "raid", configured: false, total: 0, updatedAt: null, source: "unconfigured", signups: [] };
  }

  try {
    const signupsUrl = new URL(endpoint);
    const guildId = getDiscordGuildId();
    if (guildId && !signupsUrl.searchParams.has("guild_id")) {
      signupsUrl.searchParams.set("guild_id", guildId);
    }

    const response = await fetch(signupsUrl.toString(), {
      headers: workerStatsHeaders(),
      cache: "no-store",
    });

    const raw = await response.text().catch(() => "");
    const data = raw ? tryParseJson(raw) : null;

    if (!response.ok || !data || typeof data !== "object") {
      return {
        rulesType: "raid",
        configured: false,
        total: 0,
        updatedAt: null,
        source: "error",
        signups: [],
        error: typeof data?.error === "string" ? data.error : "Список підписантів тимчасово недоступний.",
      };
    }

    const returnedType = String(data.rules_type || data.rulesType || "raid").toLowerCase();
    if (returnedType && !["raid", "raid-rules"].includes(returnedType)) {
      return {
        rulesType: "raid",
        configured: false,
        total: 0,
        updatedAt: null,
        source: "error",
        signups: [],
        error: `Список підписантів тимчасово недоступний.`,
      };
    }

    const source = typeof data.source === "string" ? data.source : "worker";
    const signups = Array.isArray(data.signups)
      ? data.signups.map((item: any) => ({
          discordId: String(item?.discordId || item?.discord_id || ""),
          discordName: String(item?.discordName || item?.discord_name || "Discord user"),
          signedAt: String(item?.signedAt || item?.signed_at || ""),
          profileId: item?.profileId || item?.profile_id || null,
          mainCharacter: item?.mainCharacter || item?.main_character || null,
        })).filter((item: DiscordRaidRulesSignup) => item.discordId)
      : [];

    return {
      rulesType: "raid",
      configured: Boolean(data.configured ?? true),
      total: safeNumber(data.total) || safeNumber(data.stats?.signed) || signups.length,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : typeof data.updatedAt === "string" ? data.updatedAt : null,
      source: ["kv", "missing-kv-binding", "invalid-binding", "worker", "error"].includes(source) ? source as DiscordRaidRulesSignupsResponse["source"] : "worker",
      signups,
      error: typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : undefined,
    };
  } catch (error) {
    return {
      rulesType: "raid",
      configured: false,
      total: 0,
      updatedAt: null,
      source: "error",
      signups: [],
      error: error instanceof Error ? error.message : "Список підписантів тимчасово недоступний",
    };
  }
}

export type DiscordTextChannel = {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id?: string | null;
};

export type DiscordRoleOption = {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
};

export type DiscordManageableRoleOption = DiscordRoleOption & {
  manageable: boolean;
  blockedReason?: string | null;
  isBotTopRole?: boolean;
};

export type DiscordBotRoleControlSnapshot = {
  guild: DiscordGuildSnapshot | null;
  bot: {
    id: string;
    username: string;
    displayName: string;
  } | null;
  botTopRole: DiscordRoleOption | null;
  botCanManageRoles: boolean;
  roles: DiscordManageableRoleOption[];
  manageableRoles: DiscordManageableRoleOption[];
  blockedRoles: DiscordManageableRoleOption[];
  error?: string | null;
};

export type DiscordGuildSnapshot = {
  id: string;
  name: string;
  ownerId?: string | null;
  rules_channel_id?: string | null;
};

export type DiscordMessageRef = {
  guildId?: string;
  channelId: string;
  messageId: string;
};

export type DiscordGuildMemberSnapshot = {
  userId: string;
  nick: string | null;
  username: string | null;
  globalName: string | null;
  displayName: string;
  roleIds: string[];
};

export type DiscordGuildBanSnapshot = {
  userId: string;
  reason: string | null;
  username: string | null;
  globalName: string | null;
};

type DiscordRolesCacheEntry = {
  checkedAt: number;
  roles: DiscordRoleOption[];
};

export type DiscordTextChannelsSnapshot = {
  guild: DiscordGuildSnapshot | null;
  channels: DiscordTextChannel[];
  suggestedChannelId: string;
  suggestedRulesChannelId: string;
  warning?: string | null;
};

type DiscordChannelsCacheEntry = {
  checkedAt: number;
  snapshot: DiscordTextChannelsSnapshot;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomDiscordRolesCache: Map<string, DiscordRolesCacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomDiscordChannelsCache: Map<string, DiscordChannelsCacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomDiscordRouteCooldowns: Map<string, number> | undefined;
}

function discordRolesCacheTtlMs() {
  const parsed = Number(process.env.DISCORD_ROLES_CACHE_SECONDS || 300);
  if (!Number.isFinite(parsed)) return 300_000;
  return Math.max(30, Math.min(1800, Math.floor(parsed))) * 1000;
}

function discordChannelsCacheTtlMs() {
  const parsed = Number(process.env.DISCORD_CHANNELS_CACHE_SECONDS || process.env.DISCORD_ROLES_CACHE_SECONDS || 300);
  if (!Number.isFinite(parsed)) return 300_000;
  return Math.max(30, Math.min(1800, Math.floor(parsed))) * 1000;
}

type DiscordEmbedInput = Record<string, unknown>;

type DiscordRequestInit = Omit<RequestInit, "headers"> & {
  headers?: HeadersInit;
  auditReason?: string;
};

function getBotToken() {
  return String(process.env.DISCORD_BOT_TOKEN || "").trim();
}

export function getDiscordGuildId() {
  return String(process.env.DISCORD_GUILD_ID || "").trim();
}

export function getDiscordPublicKey() {
  return String(process.env.DISCORD_PUBLIC_KEY || "").trim();
}

export function getDiscordDefaultChannelId() {
  return snowflake(process.env.DISCORD_CHANNEL_ID || "");
}

function workerRelayToken() {
  return String(
    process.env.DISCORD_RULES_STATS_TOKEN ||
    process.env.WORKER_STATS_TOKEN ||
    process.env.INTERNAL_PROFILE_LOOKUP_TOKEN ||
    ""
  ).trim();
}

function workerRelayHeaders(): HeadersInit {
  const token = workerRelayToken();
  return {
    accept: "application/json",
    ...(token
      ? {
          authorization: `Bearer ${token}`,
          "x-worker-stats-token": token,
        }
      : {}),
  };
}

export function hasDiscordEmbedConfig() {
  return Boolean(getBotToken() || (raidDiscordMessageEndpoint() && workerRelayToken()));
}

function hasDirectDiscordBotConfig() {
  return Boolean(getBotToken());
}

function raidDiscordMessageEndpoint() {
  return workerApiEndpoint("/api/discord-raid-message", "DISCORD_RAID_MESSAGE_ENDPOINT");
}

function discordGuildChannelsEndpoint() {
  return workerApiEndpoint("/api/discord-guild-channels", "DISCORD_GUILD_CHANNELS_ENDPOINT");
}

function raidDiscordRelayToken() {
  return workerRelayToken();
}

async function discordRaidMessageRelay<T = any>(payload: Record<string, unknown>): Promise<T> {
  const endpoint = raidDiscordMessageEndpoint();
  const token = raidDiscordRelayToken();
  if (!endpoint || !token) {
    throw new Error("Публікація рейдів у Discord тимчасово недоступна. Спробуй пізніше або звернись до гільдмайстра.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
      "x-worker-stats-token": token,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const raw = await response.text().catch(() => "");
  const data = raw ? tryParseJson(raw) : null;
  if (!response.ok || !data || typeof data !== "object") {
    const message = typeof data?.error === "string" ? data.error : raw || `Worker relay ${response.status}`;
    throw new Error(`Discord relay ${response.status}: ${String(message).slice(0, 220)}`);
  }
  return data as T;
}

function encodeAuditReason(reason?: string) {
  const value = String(reason || "").trim();
  if (!value) return undefined;
  return encodeURIComponent(value.slice(0, 512));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function discordRouteCooldowns() {
  const map = globalThis.__mistblossomDiscordRouteCooldowns || new Map<string, number>();
  globalThis.__mistblossomDiscordRouteCooldowns = map;
  return map;
}

function discordRouteKey(path: string, method: string) {
  // Keep major parameters but collapse snowflakes. This approximates Discord route buckets
  // and avoids hammering the same message/member route after a 429.
  return `${method}:${String(path || "")}`
    .replace(/\/\d{16,25}/g, "/:id")
    .replace(/[?&](?:limit|before|after|around)=[^&]+/g, "")
    .slice(0, 180);
}

function discordApiTimeoutMs(method: string) {
  const configured = Number(process.env.DISCORD_API_TIMEOUT_MS || "");
  const fallback = method === "GET" ? 10_000 : 14_000;
  return Math.max(3_000, Math.min(45_000, Math.floor(Number.isFinite(configured) && configured > 0 ? configured : fallback)));
}

async function waitForDiscordCooldown(key: string) {
  const until = discordRouteCooldowns().get(key) || 0;
  const delay = until - Date.now();
  if (delay > 0) await sleep(Math.min(delay, 15_000));
}

function setDiscordCooldown(key: string, delayMs: number) {
  discordRouteCooldowns().set(key, Date.now() + Math.max(500, Math.min(30_000, Math.floor(delayMs))));
}

function discordRetryAfterMs(response: Response, json: any, attempt: number) {
  const retryAfter = Number(json?.retry_after ?? response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset-after") ?? 0);
  const normalized = Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter > 50 ? retryAfter : retryAfter * 1000
    : 900 + attempt * 650;
  const jitter = 150 + Math.floor(Math.random() * 300);
  return Math.max(500, Math.min(20_000, Math.floor(normalized + jitter)));
}

function shouldRetryDiscordStatus(status: number) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function shouldLogDiscordSuccess() {
  return String(process.env.DISCORD_API_LOG_SUCCESS || "").trim() === "1";
}

function sanitizeDiscordApiPath(path: string) {
  return String(path || "")
    .replace(/([?&](?:access_token|token|authorization)=)[^&]+/gi, "$1[redacted]")
    .slice(0, 320);
}

export async function discordApi<T = any>(path: string, init: DiscordRequestInit = {}): Promise<T> {
  const token = getBotToken();
  if (!token) throw new Error("Discord bot token не налаштований. Дії з ролями, ніками та учасниками не можуть виконуватись напряму через Discord API.");

  const method = String(init.method || "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bot ${token}`);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  const auditReason = encodeAuditReason(init.auditReason);
  if (auditReason) headers.set("X-Audit-Log-Reason", auditReason);

  const routeKey = discordRouteKey(path, method);
  const maxAttempts = method === "DELETE" ? 7 : isMutation ? 5 : 4;
  const timeoutMs = discordApiTimeoutMs(method);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForDiscordCooldown(routeKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${DISCORD_API_BASE}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.status === 204) {
        if (isMutation && shouldLogDiscordSuccess()) {
          logDashboardEvent("info", "discord.api.mutation_ok", undefined, {
            method,
            path: sanitizeDiscordApiPath(path),
            status: response.status,
            attempt: attempt + 1,
          });
        }
        return undefined as T;
      }

      const raw = await response.text().catch(() => "");
      const json = raw ? tryParseJson(raw) : null;

      if (response.status === 429) {
        const delay = discordRetryAfterMs(response, json, attempt);
        setDiscordCooldown(routeKey, delay);
        if (attempt < maxAttempts - 1) {
          await sleep(delay);
          continue;
        }
      } else if (shouldRetryDiscordStatus(response.status) && attempt < maxAttempts - 1) {
        await sleep(discordRetryAfterMs(response, json, attempt));
        continue;
      }

      if (!response.ok) {
        const detail = typeof json?.message === "string" ? json.message : raw;
        logDashboardEvent("warn", "discord.api.request_failed", undefined, {
          method,
          path: sanitizeDiscordApiPath(path),
          status: response.status,
          attempt: attempt + 1,
          detail: String(detail || "невідома помилка").slice(0, 220),
        });
        const rateHint = response.status === 429 ? " Після кількох повторів Discord усе ще обмежує запити." : "";
        throw new Error(`Discord API ${response.status}: ${String(detail || "невідома помилка").slice(0, 220)}${rateHint}`);
      }

      if (isMutation && shouldLogDiscordSuccess()) {
        logDashboardEvent("info", "discord.api.mutation_ok", undefined, {
          method,
          path: sanitizeDiscordApiPath(path),
          status: response.status,
          attempt: attempt + 1,
        });
      }

      return (json ?? raw) as T;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        if (attempt < maxAttempts - 1) {
          await sleep(500 + attempt * 650);
          continue;
        }
        throw new Error(`Discord API timeout after ${timeoutMs}ms: ${sanitizeDiscordApiPath(path)}`);
      }
      if (attempt < maxAttempts - 1 && /ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(String((error as Error)?.message || error))) {
        await sleep(500 + attempt * 650);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Discord API 429: Discord продовжує обмежувати запити після кількох повторів.");
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function snowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function cleanText(value: unknown, max: number) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .trim())
    .slice(0, Math.max(0, max))
    .join("");
}

function cleanRoleIds(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];
  return Array.from(new Set(values.map(snowflake).filter(Boolean))).slice(0, 100);
}

function roleMentionLine(roleIds: string[]) {
  return cleanRoleIds(roleIds).map((roleId) => `<@&${roleId}>`).join(" ");
}

function stripLeadingRoleMentionLine(value: unknown) {
  return cleanText(value, 2000).replace(/^(?:<@&\d{16,25}>\s*)+\n?/u, "").trimStart();
}

function messageContentWithRoleMentions(content: unknown, roleIds: string[]) {
  const cleanContent = stripLeadingRoleMentionLine(content);
  const mentions = roleMentionLine(roleIds);
  return [mentions, cleanContent].filter(Boolean).join(mentions && cleanContent ? "\n" : "").slice(0, 2000) || undefined;
}

function allowedMentionsForRoles(roleIds: string[]) {
  const roles = cleanRoleIds(roleIds);
  return roles.length ? { parse: [] as string[], roles } : { parse: [] as string[] };
}

function extractRoleMentionsFromContent(value: unknown) {
  const content = String(value || "");
  const roleIds: string[] = [];
  for (const match of content.matchAll(/<@&(\d{16,25})>/g)) {
    if (match[1]) roleIds.push(match[1]);
  }
  return Array.from(new Set(roleIds));
}

function extractMentionRoleIdsFromMessage(message: Record<string, unknown>) {
  const explicit = cleanRoleIds(message.mention_roles);
  const fromContent = extractRoleMentionsFromContent(message.content);
  return Array.from(new Set([...explicit, ...fromContent]));
}

function cleanUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.toString().slice(0, 2048);
  } catch {
    return undefined;
  }
}

function cleanColor(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(0xffffff, Math.floor(parsed)));
}

function cleanImageObject(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const url = cleanUrl((value as Record<string, unknown>).url);
  return url ? { url } : undefined;
}

function cleanAuthor(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const name = cleanText(item.name, 256);
  if (!name) return undefined;
  return {
    name,
    url: cleanUrl(item.url),
    icon_url: cleanUrl(item.icon_url),
  };
}

function cleanFooter(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const text = cleanText(item.text, 2048);
  if (!text) return undefined;
  return {
    text,
    icon_url: cleanUrl(item.icon_url),
  };
}

function cleanFields(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const fields = value
    .slice(0, 25)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const field = item as Record<string, unknown>;
      const name = cleanText(field.name, 256);
      const fieldValue = cleanText(field.value, 1024);
      if (!name || !fieldValue) return null;
      return { name, value: fieldValue, inline: Boolean(field.inline) };
    })
    .filter(Boolean);

  return fields.length ? fields : undefined;
}

export function normalizeDiscordEmbed(input: DiscordEmbedInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Повідомлення має бути коректним JSON-обʼєктом.");
  }

  const embed = {
    title: cleanText(input.title, 256) || undefined,
    description: cleanText(input.description, 4096) || undefined,
    url: cleanUrl(input.url),
    color: cleanColor(input.color),
    thumbnail: cleanImageObject(input.thumbnail),
    image: cleanImageObject(input.image),
    author: cleanAuthor(input.author),
    footer: cleanFooter(input.footer),
    fields: cleanFields(input.fields),
    timestamp: input.timestamp === true ? new Date().toISOString() : typeof input.timestamp === "string" ? cleanText(input.timestamp, 80) : undefined,
  };

  const normalized = Object.fromEntries(
    Object.entries(embed).filter(([, value]) => value !== undefined && value !== null)
  );

  if (!normalized.title && !normalized.description && !normalized.image && !normalized.thumbnail && !normalized.fields && !normalized.author && !normalized.footer) {
    throw new Error("Повідомлення порожнє: додай заголовок, опис, автора, футер, зображення або поля.");
  }

  return normalized;
}

export function parseEmbedJson(raw: FormDataEntryValue | null) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("JSON embed порожній.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Невалідний JSON embed: ${error instanceof Error ? error.message : "помилка парсингу"}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON embed має бути одним обʼєктом, не масивом.");
  }

  return normalizeDiscordEmbed(parsed as DiscordEmbedInput);
}

export async function fetchDiscordGuildSnapshot(): Promise<DiscordGuildSnapshot> {
  const guildId = getDiscordGuildId();
  if (!guildId) throw new Error("Discord-сервер не підключений до панелі.");
  const guild = await discordApi<any>(`/guilds/${guildId}`);
  return {
    id: String(guild.id || guildId),
    name: String(guild.name || "Discord guild"),
    ownerId: guild.owner_id ? String(guild.owner_id) : null,
    rules_channel_id: guild.rules_channel_id ? String(guild.rules_channel_id) : null,
  };
}

function fallbackDiscordTextChannels(fallbackChannelId = "", guild: DiscordGuildSnapshot | null = null, warning?: string | null): DiscordTextChannelsSnapshot {
  const fallback = snowflake(fallbackChannelId);
  return {
    guild,
    channels: fallback ? [{ id: fallback, name: "канал за замовчуванням", type: 0, position: 0, parent_id: null }] : [],
    suggestedChannelId: fallback || "",
    suggestedRulesChannelId: fallback || "",
    warning: warning || null,
  };
}

function discordChannelsCacheKey(guildId: string, fallbackChannelId: string) {
  const source = discordGuildChannelsEndpoint() && workerRelayToken() ? "worker" : getBotToken() ? "bot" : "fallback";
  return `${source}:${guildId || "no-guild"}:${fallbackChannelId || "no-default"}`;
}

export async function fetchDiscordTextChannels(): Promise<DiscordTextChannelsSnapshot> {
  const guildId = getDiscordGuildId();
  const fallbackChannelId = getDiscordDefaultChannelId();
  const cacheKey = discordChannelsCacheKey(guildId, fallbackChannelId);
  const cache = globalThis.__mistblossomDiscordChannelsCache || new Map<string, DiscordChannelsCacheEntry>();
  globalThis.__mistblossomDiscordChannelsCache = cache;
  const cached = cache.get(cacheKey);
  const ttlMs = discordChannelsCacheTtlMs();
  if (cached && Date.now() - cached.checkedAt < ttlMs) return cached.snapshot;

  try {
    let snapshot: DiscordTextChannelsSnapshot;

    if (discordGuildChannelsEndpoint() && workerRelayToken()) {
      snapshot = await fetchDiscordTextChannelsViaWorker(fallbackChannelId);
    } else if (!getBotToken()) {
      if (!fallbackChannelId) throw new Error("Публікація в Discord тимчасово недоступна. Спробуй пізніше або звернись до гільдмайстра.");
      snapshot = fallbackDiscordTextChannels(fallbackChannelId);
    } else if (!guildId) {
      if (!fallbackChannelId) throw new Error("Discord-сервер не підключений до панелі.");
      snapshot = fallbackDiscordTextChannels(fallbackChannelId);
    } else {
      const [guild, channels] = await Promise.all([
        fetchDiscordGuildSnapshot().catch(() => null),
        discordApi<any[]>(`/guilds/${guildId}/channels`),
      ]);
      snapshot = normalizeDiscordTextChannels(channels, guild, fallbackChannelId);
    }

    cache.set(cacheKey, { checkedAt: Date.now(), snapshot });
    return snapshot;
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error || "Discord channels unavailable");
    if (cached?.snapshot?.channels?.length) {
      return { ...cached.snapshot, warning };
    }
    const fallback = fallbackDiscordTextChannels(fallbackChannelId, null, warning);
    if (fallback.channels.length) return fallback;
    throw error;
  }
}

async function fetchDiscordTextChannelsViaWorker(fallbackChannelId = ""): Promise<DiscordTextChannelsSnapshot> {
  const endpoint = discordGuildChannelsEndpoint();
  if (!endpoint) throw new Error("Список Discord-каналів тимчасово недоступний. Спробуй пізніше або звернись до гільдмайстра.");

  const url = new URL(endpoint);
  const guildId = getDiscordGuildId();
  if (guildId && !url.searchParams.has("guild_id")) url.searchParams.set("guild_id", guildId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: workerRelayHeaders(),
    cache: "no-store",
  });
  const raw = await response.text().catch(() => "");
  const data = raw ? tryParseJson(raw) : null;
  if (!response.ok || !data || typeof data !== "object") {
    const message = typeof data?.error === "string" ? data.error : raw || `Worker channels ${response.status}`;
    throw new Error(`Discord channels relay ${response.status}: ${String(message).slice(0, 220)}`);
  }

  const guildRaw = data.guild && typeof data.guild === "object" ? data.guild as Record<string, unknown> : null;
  const guild: DiscordGuildSnapshot | null = guildRaw ? {
    id: String(guildRaw.id || ""),
    name: String(guildRaw.name || "Discord guild"),
    ownerId: guildRaw.owner_id ? String(guildRaw.owner_id) : guildRaw.ownerId ? String(guildRaw.ownerId) : null,
    rules_channel_id: guildRaw.rules_channel_id ? String(guildRaw.rules_channel_id) : null,
  } : null;

  const snapshot = normalizeDiscordTextChannels(
    Array.isArray(data.channels) ? data.channels : [],
    guild,
    String(data.suggestedRulesChannelId || fallbackChannelId || ""),
    String(data.suggestedChannelId || fallbackChannelId || ""),
  );
  const warning = typeof data.warning === "string" && data.warning.trim() ? data.warning.trim().slice(0, 240) : null;
  return warning ? { ...snapshot, warning } : snapshot;
}

function normalizeDiscordTextChannels(
  channels: any[],
  guild: DiscordGuildSnapshot | null,
  fallbackChannelId = "",
  suggestedRaidChannelId = "",
): DiscordTextChannelsSnapshot {
  const textChannels: DiscordTextChannel[] = channels
    .filter((channel) => channel && (channel.type === 0 || channel.type === 5))
    .map((channel) => ({
      id: String(channel.id),
      name: String(channel.name || "channel"),
      type: Number(channel.type || 0),
      position: Number(channel.position || 0),
      parent_id: channel.parent_id ? String(channel.parent_id) : null,
    }))
    .filter((channel) => snowflake(channel.id))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "uk"));

  const rulesByGuild = guild?.rules_channel_id
    ? textChannels.find((channel) => channel.id === guild.rules_channel_id)
    : undefined;

  const rulesByName = textChannels.find((channel) => {
    const name = channel.name.toLowerCase();
    return name.includes("rules") || name.includes("rule") || name.includes("правил") || name.includes("pravyl") || name.includes("правила");
  });

  const raidById = snowflake(suggestedRaidChannelId)
    ? textChannels.find((channel) => channel.id === snowflake(suggestedRaidChannelId))
    : undefined;
  const raidByName = textChannels.find((channel) => {
    const name = channel.name.toLowerCase();
    return (
      name.includes("raid") ||
      name.includes("рейд") ||
      name.includes("анонс") ||
      name.includes("announce") ||
      name.includes("оголош")
    );
  });
  const fallback = snowflake(fallbackChannelId);
  const fallbackById = fallback
    ? textChannels.find((channel) => channel.id === fallback)
    : undefined;
  const suggestedChannelId =
    raidById?.id || raidByName?.id || fallbackById?.id || fallback || textChannels[0]?.id || "";

  return {
    guild,
    channels: textChannels.length > 0 ? textChannels : fallback ? [{ id: fallback, name: "канал за замовчуванням", type: 0, position: 0, parent_id: null }] as DiscordTextChannel[] : [],
    suggestedChannelId,
    suggestedRulesChannelId: rulesByGuild?.id || rulesByName?.id || fallback || textChannels[0]?.id || "",
    warning: null,
  };
}


function rolePermissions(value: unknown) {
  try {
    const raw = typeof value === "bigint" ? value : BigInt(String(value || "0"));
    return raw >= 0n ? raw : 0n;
  } catch {
    return 0n;
  }
}

function discordRoleSort(a: Pick<DiscordRoleOption, "id" | "name" | "position">, b: Pick<DiscordRoleOption, "id" | "name" | "position">) {
  const position = Number(b.position || 0) - Number(a.position || 0);
  if (position !== 0) return position;
  try {
    const snowflakeOrder = BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0;
    if (snowflakeOrder !== 0) return snowflakeOrder;
  } catch {
    // fall back to name sorting
  }
  return String(a.name || "").localeCompare(String(b.name || ""), "uk");
}

function normalizeDiscordRole(role: any): DiscordRoleOption & { permissionsRaw?: bigint } | null {
  const id = snowflake(role?.id);
  if (!id) return null;
  return {
    id,
    name: cleanText(role?.name || "role", 100) || "role",
    color: Number(role?.color || 0),
    position: Number(role?.position || 0),
    managed: Boolean(role?.managed),
    permissionsRaw: rolePermissions(role?.permissions),
  };
}

async function fetchDiscordRawRoles(guildId: string) {
  const roles = await discordApi<any[]>(`/guilds/${guildId}/roles`);
  return (Array.isArray(roles) ? roles : [])
    .map(normalizeDiscordRole)
    .filter(Boolean) as Array<DiscordRoleOption & { permissionsRaw?: bigint }>;
}

async function fetchDiscordCurrentBotUser() {
  const user = await discordApi<any>("/users/@me");
  const id = snowflake(user?.id);
  if (!id) throw new Error("Discord bot token не повернув ID бота.");
  return {
    id,
    username: cleanText(user?.username, 80) || "Discord bot",
    displayName: cleanText(user?.global_name || user?.username, 100) || "Discord bot",
  };
}

function isDiscordRoleOption(value: DiscordRoleOption | undefined): value is DiscordRoleOption {
  return Boolean(value?.id);
}

function highestRoleForMember(roleIds: string[], roles: DiscordRoleOption[]) {
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  return roleIds
    .map((roleId) => roleMap.get(roleId))
    .filter(isDiscordRoleOption)
    .sort(discordRoleSort)[0] || null;
}

function memberHasManageRolesPermission(memberRoleIds: string[], roles: Array<DiscordRoleOption & { permissionsRaw?: bigint }>, guildId: string) {
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  let permissions = roleMap.get(guildId)?.permissionsRaw || 0n;
  for (const roleId of memberRoleIds) {
    permissions |= roleMap.get(roleId)?.permissionsRaw || 0n;
  }

  const ADMINISTRATOR = 1n << 3n;
  const MANAGE_ROLES = 1n << 28n;
  return Boolean((permissions & ADMINISTRATOR) === ADMINISTRATOR || (permissions & MANAGE_ROLES) === MANAGE_ROLES);
}

function roleBlockedReason(role: DiscordRoleOption, guildId: string, botTopRole: DiscordRoleOption | null, botCanManageRoles: boolean) {
  if (role.id === guildId) return "@everyone не можна видавати або знімати вручну.";
  if (role.managed) return "Керована Discord/integration роль не може видаватися вручну.";
  if (!botTopRole) return "Не вдалося визначити найвищу роль бота.";
  if (!botCanManageRoles) return "У бота немає дозволу “Керувати ролями”.";
  if (role.id === botTopRole.id) return "Це найвища роль самого бота.";
  if (Number(role.position || 0) >= Number(botTopRole.position || 0)) {
    return "Роль знаходиться вище або на одному рівні з найвищою роллю бота.";
  }
  return null;
}

export async function fetchDiscordRoleControlSnapshot(): Promise<DiscordBotRoleControlSnapshot> {
  const guildId = getDiscordGuildId();
  if (!guildId) {
    return {
      guild: null,
      bot: null,
      botTopRole: null,
      botCanManageRoles: false,
      roles: [],
      manageableRoles: [],
      blockedRoles: [],
      error: "Discord-сервер не підключений.",
    };
  }

  try {
    const [guild, bot, rawRoles] = await Promise.all([
      fetchDiscordGuildSnapshot().catch(() => null),
      fetchDiscordCurrentBotUser(),
      fetchDiscordRawRoles(guildId),
    ]);

    const botMember = await discordApi<any>(`/guilds/${guildId}/members/${bot.id}`);
    const botRoleIds = Array.isArray(botMember?.roles)
      ? botMember.roles.map((roleId: unknown) => snowflake(roleId)).filter(Boolean)
      : [];
    const sortedRoles = rawRoles.sort(discordRoleSort);
    const botTopRole = highestRoleForMember(botRoleIds, sortedRoles);
    const botCanManageRoles = memberHasManageRolesPermission(botRoleIds, rawRoles, guildId);

    const roles = sortedRoles
      .filter((role) => role.id !== guildId)
      .map((role) => {
        const blockedReason = roleBlockedReason(role, guildId, botTopRole, botCanManageRoles);
        return {
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
          managed: role.managed,
          manageable: !blockedReason,
          blockedReason,
          isBotTopRole: botTopRole?.id === role.id,
        } satisfies DiscordManageableRoleOption;
      });

    return {
      guild,
      bot,
      botTopRole,
      botCanManageRoles,
      roles,
      manageableRoles: roles.filter((role) => role.manageable),
      blockedRoles: roles.filter((role) => !role.manageable),
      error: null,
    };
  } catch (error) {
    return {
      guild: null,
      bot: null,
      botTopRole: null,
      botCanManageRoles: false,
      roles: [],
      manageableRoles: [],
      blockedRoles: [],
      error: error instanceof Error ? error.message : String(error || "Discord API недоступний."),
    };
  }
}

export async function assertDiscordRolesManageable(roleIdsInput: unknown[]) {
  const requested = Array.from(new Set(roleIdsInput.map(snowflake).filter(Boolean)));
  if (!requested.length) throw new Error("Вибери хоча б одну Discord-роль.");
  const snapshot = await fetchDiscordRoleControlSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);
  const roleMap = new Map(snapshot.roles.map((role) => [role.id, role]));
  const blocked = requested
    .map((roleId) => roleMap.get(roleId) || { id: roleId, name: roleId, manageable: false, blockedReason: "Роль не знайдено на сервері." })
    .filter((role) => !role.manageable);
  if (blocked.length) {
    throw new Error(blocked.map((role) => `${role.name}: ${role.blockedReason || "роль недоступна для керування."}`).join(" "));
  }
  return requested;
}

export async function fetchDiscordRoles() {
  const guildId = getDiscordGuildId();
  if (!guildId) throw new Error("Discord-сервер не підключений до панелі.");

  const cache = globalThis.__mistblossomDiscordRolesCache || new Map<string, DiscordRolesCacheEntry>();
  globalThis.__mistblossomDiscordRolesCache = cache;
  const cached = cache.get(guildId);
  const ttlMs = discordRolesCacheTtlMs();
  if (cached && Date.now() - cached.checkedAt < ttlMs) return cached.roles;

  try {
    const roles = await fetchDiscordRawRoles(guildId);
    const normalized = roles
      .filter((role) => role.id !== guildId && !role.managed)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed,
      } satisfies DiscordRoleOption))
      .sort(discordRoleSort);

    cache.set(guildId, { checkedAt: Date.now(), roles: normalized });
    return normalized;
  } catch (error) {
    // Role names are display-only. Returning stale names is safer than making
    // profile pages fail because Discord's roles endpoint is temporarily down.
    if (cached?.roles?.length) return cached.roles;
    throw error;
  }
}


function snowflakeToBase36(id: string) {
  return BigInt(id).toString(36);
}

function base36ToSnowflake(value: string) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = 0n;
  for (const raw of value.toLowerCase()) {
    const digit = alphabet.indexOf(raw);
    if (digit < 0) throw new Error("Некоректний custom_id кнопки.");
    result = result * 36n + BigInt(digit);
  }
  return result.toString(10);
}

function encodedRoleIds(roleIds: string[]) {
  const cleaned = Array.from(new Set(roleIds.map(snowflake).filter(Boolean)));
  if (cleaned.length === 0) throw new Error("Для кнопки “Прийняти” потрібно вибрати хоча б одну роль.");
  return cleaned.map(snowflakeToBase36).join(".");
}

export function buildRulesAcceptCustomId(roleIds: string[]) {
  const customId = `${DASHBOARD_CUSTOM_ID_PREFIX}:a:${encodedRoleIds(roleIds)}`;
  if (customId.length > 100) {
    throw new Error("Вибрано забагато ролей для однієї Discord-кнопки. Зменш кількість ролей або створи одну збірну роль.");
  }
  return customId;
}

export function buildRulesConfirmAcceptCustomId(roleIds: string[]) {
  const customId = `${DASHBOARD_CUSTOM_ID_PREFIX}:c:a:${encodedRoleIds(roleIds)}`;
  if (customId.length > 100) {
    throw new Error("Вибрано забагато ролей для однієї Discord-кнопки. Зменш кількість ролей або створи одну збірну роль.");
  }
  return customId;
}

export function buildRulesDeclineCustomId() {
  return `${DASHBOARD_CUSTOM_ID_PREFIX}:d`;
}

export function buildRulesConfirmDeclineCustomId() {
  return `${DASHBOARD_CUSTOM_ID_PREFIX}:c:d`;
}

function decodeRoleIds(value: string, prefix: string) {
  try {
    return value
      .slice(prefix.length)
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(base36ToSnowflake)
      .filter((id) => /^\d{16,25}$/.test(id));
  } catch {
    return [] as string[];
  }
}

export function buildRaidRulesSignupCustomId() {
  return `${DASHBOARD_CUSTOM_ID_PREFIX}:r:s`;
}

export function buildRaidRulesConfirmSignupCustomId() {
  return `${DASHBOARD_CUSTOM_ID_PREFIX}:r:c:s`;
}

export function decodeRulesCustomId(customId: string) {
  const value = String(customId || "").trim();

  if (value === buildRaidRulesSignupCustomId()) {
    return { type: "raid" as const, action: "raid_signup" as const, roleIds: [] as string[] };
  }

  if (value === buildRaidRulesConfirmSignupCustomId()) {
    return { type: "raid" as const, action: "confirm_raid_signup" as const, roleIds: [] as string[] };
  }

  if (value === buildRulesDeclineCustomId()) return { type: "guild" as const, action: "decline" as const, roleIds: [] as string[] };
  if (value === buildRulesConfirmDeclineCustomId()) return { type: "guild" as const, action: "confirm_decline" as const, roleIds: [] as string[] };

  const directPrefix = `${DASHBOARD_CUSTOM_ID_PREFIX}:a:`;
  if (value.startsWith(directPrefix)) {
    const roleIds = decodeRoleIds(value, directPrefix);
    return roleIds.length ? { type: "guild" as const, action: "accept" as const, roleIds } : null;
  }

  const confirmPrefix = `${DASHBOARD_CUSTOM_ID_PREFIX}:c:a:`;
  if (value.startsWith(confirmPrefix)) {
    const roleIds = decodeRoleIds(value, confirmPrefix);
    return roleIds.length ? { type: "guild" as const, action: "confirm_accept" as const, roleIds } : null;
  }

  return null;
}

export function buildRulesComponents(roleIds: string[], rulesType: DiscordRulesType = "guild") {
  if (rulesType === "raid") {
    return [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Підписатися на правила рейду",
            custom_id: buildRaidRulesConfirmSignupCustomId(),
          },
        ],
      },
    ];
  }

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: "Прийняти правила",
          custom_id: buildRulesAcceptCustomId(roleIds),
        },
        {
          type: 2,
          style: 4,
          label: "Відмовитися",
          custom_id: buildRulesConfirmDeclineCustomId(),
        },
      ],
    },
  ];
}

export function parseDiscordMessageRef(value: string): DiscordMessageRef | null {
  const text = String(value || "").trim();
  if (!text) return null;

  const link = text.match(/discord(?:app)?\.com\/channels\/(\d{16,25}|@me)\/(\d{16,25})\/(\d{16,25})/i);
  if (link) {
    return {
      guildId: link[1] === "@me" ? undefined : link[1],
      channelId: link[2],
      messageId: link[3],
    };
  }

  const ids = text.match(/^(\d{16,25})[\s,/|:]+(\d{16,25})$/);
  if (ids) return { channelId: ids[1], messageId: ids[2] };

  return null;
}

export async function createDiscordEmbedMessage(params: {
  channelId: string;
  content?: string;
  embed: Record<string, unknown>;
  roleIds?: string[];
  mentionRoleIds?: string[];
  withRulesButtons?: boolean;
  rulesType?: DiscordRulesType;
  components?: unknown[];
  auditReason?: string;
}) {
  const channelId = snowflake(params.channelId);
  if (!channelId) throw new Error("Канал Discord не вибрано або ID невалідний.");

  const body: Record<string, unknown> = {
    content: messageContentWithRoleMentions(params.content, params.mentionRoleIds || []),
    embeds: [params.embed],
    allowed_mentions: allowedMentionsForRoles(params.mentionRoleIds || []),
  };

  if (params.components) {
    body.components = params.components;
  } else if (params.withRulesButtons) {
    body.components = buildRulesComponents(params.roleIds || [], params.rulesType || "guild");
  }

  return discordApi<any>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
    auditReason: params.auditReason,
  });
}

export async function editDiscordEmbedMessage(params: {
  ref: DiscordMessageRef;
  content?: string;
  embed: Record<string, unknown>;
  roleIds?: string[];
  mentionRoleIds?: string[];
  withRulesButtons?: boolean;
  rulesType?: DiscordRulesType;
  components?: unknown[];
  auditReason?: string;
}) {
  if (!params.ref.channelId || !params.ref.messageId) throw new Error("Посилання на Discord-повідомлення невалідне.");

  const nextContent = messageContentWithRoleMentions(params.content, params.mentionRoleIds || []);
  const body: Record<string, unknown> = {
    content: nextContent ?? "",
    embeds: [params.embed],
    components: params.components ?? (params.withRulesButtons ? buildRulesComponents(params.roleIds || [], params.rulesType || "guild") : []),
    allowed_mentions: allowedMentionsForRoles(params.mentionRoleIds || []),
  };

  return discordApi<any>(`/channels/${params.ref.channelId}/messages/${params.ref.messageId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    auditReason: params.auditReason,
  });
}

export async function createDiscordRaidMessage(params: {
  channelId: string;
  content?: string;
  embed: Record<string, unknown>;
  components?: unknown[];
  mentionRoleIds?: string[];
  auditReason?: string;
}) {
  if (hasDirectDiscordBotConfig()) {
    return createDiscordEmbedMessage(params);
  }

  return discordRaidMessageRelay({
    action: "create",
    channelId: params.channelId,
    content: messageContentWithRoleMentions(params.content || "", params.mentionRoleIds || []) || "",
    embed: params.embed,
    components: params.components || [],
    mentionRoleIds: cleanRoleIds(params.mentionRoleIds || []),
    allowed_mentions: allowedMentionsForRoles(params.mentionRoleIds || []),
    auditReason: params.auditReason || "Raid published from dashboard",
  });
}

export async function editDiscordRaidMessage(params: {
  ref: DiscordMessageRef;
  content?: string;
  embed: Record<string, unknown>;
  components?: unknown[];
  mentionRoleIds?: string[];
  auditReason?: string;
}) {
  if (hasDirectDiscordBotConfig()) {
    return editDiscordEmbedMessage(params);
  }

  return discordRaidMessageRelay({
    action: "edit",
    channelId: params.ref.channelId,
    messageId: params.ref.messageId,
    content: messageContentWithRoleMentions(params.content || "", params.mentionRoleIds || []) || "",
    embed: params.embed,
    components: params.components || [],
    mentionRoleIds: cleanRoleIds(params.mentionRoleIds || []),
    allowed_mentions: allowedMentionsForRoles(params.mentionRoleIds || []),
    auditReason: params.auditReason || "Raid updated from dashboard",
  });
}

export async function deleteDiscordRaidMessage(params: {
  ref: DiscordMessageRef;
  auditReason?: string;
}) {
  if (!params.ref.channelId || !params.ref.messageId) return { ok: true, skipped: true };

  if (hasDirectDiscordBotConfig()) {
    await discordApi<void>(`/channels/${params.ref.channelId}/messages/${params.ref.messageId}`, {
      method: "DELETE",
      auditReason: params.auditReason || "Raid deleted from dashboard",
    });
    return { ok: true };
  }

  return discordRaidMessageRelay({
    action: "delete",
    channelId: params.ref.channelId,
    messageId: params.ref.messageId,
    auditReason: params.auditReason || "Raid deleted from dashboard",
  });
}

function readComponentCustomIds(components: unknown): string[] {
  if (!Array.isArray(components)) return [];
  const ids: string[] = [];

  const walk = (items: unknown[]) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const component = item as Record<string, unknown>;
      if (typeof component.custom_id === "string") ids.push(component.custom_id);
      if (Array.isArray(component.components)) walk(component.components);
    }
  };

  walk(components);
  return ids;
}

function readComponentUrls(components: unknown): string[] {
  if (!Array.isArray(components)) return [];
  const urls: string[] = [];

  const walk = (items: unknown[]) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const component = item as Record<string, unknown>;
      if (typeof component.url === "string") urls.push(component.url);
      if (Array.isArray(component.components)) walk(component.components);
    }
  };

  walk(components);
  return urls;
}

export function extractRulesRoleIdsFromMessage(message: Record<string, unknown>) {
  const roleIds: string[] = [];

  for (const customId of readComponentCustomIds(message.components)) {
    const decoded = decodeRulesCustomId(customId);
    if (decoded?.type === "guild" && (decoded.action === "accept" || decoded.action === "confirm_accept")) {
      roleIds.push(...decoded.roleIds);
    }
  }

  // Новий потік правил використовує URL-кнопку, щоб одразу вести на сайт.
  // Тому роль потрібно діставати не тільки з custom_id, а й з підписаного rt-токена в URL.
  for (const url of readComponentUrls(message.components)) {
    roleIds.push(...parseRulesRoleIdsFromUrl(url));
  }

  return Array.from(new Set(roleIds));
}

export function isRulesEmbedMessage(message: Record<string, unknown>) {
  return readComponentCustomIds(message.components).some((customId) => Boolean(decodeRulesCustomId(customId)));
}

function firstEmbed(message: Record<string, unknown>) {
  const embeds = Array.isArray(message.embeds) ? message.embeds : [];
  const embed = embeds[0];
  return embed && typeof embed === "object" ? (embed as Record<string, unknown>) : null;
}

export type DiscordEditableMessage = {
  id: string;
  channelId: string;
  url: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  embed: Record<string, unknown> | null;
  embedJson: string;
  title: string;
  roleIds: string[];
  isRules: boolean;
  rulesType: DiscordRulesType | "general";
};

export function normalizeDiscordMessageForEditor(message: Record<string, unknown>, channelIdFallback?: string): DiscordEditableMessage {
  const id = snowflake(message.id) || "";
  const channelId = snowflake(message.channel_id) || snowflake(channelIdFallback) || "";
  const embed = firstEmbed(message);
  const title = cleanText(embed?.title, 256) || cleanText(embed?.description, 64) || "Discord-повідомлення";
  const rulesRoleIds = extractRulesRoleIdsFromMessage(message);
  const mentionRoleIds = extractMentionRoleIdsFromMessage(message);
  const decodedRules = readComponentCustomIds(message.components)
    .map((customId) => decodeRulesCustomId(customId))
    .filter(Boolean);
  const isRules = decodedRules.length > 0;
  const rulesType: DiscordRulesType | "general" = decodedRules.some((item) => item?.type === "raid") ? "raid" : isRules ? "guild" : "general";
  const roleIds = isRules ? rulesRoleIds : mentionRoleIds;

  return {
    id,
    channelId,
    url: channelId && id ? discordMessageUrl(channelId, id) : "",
    content: stripLeadingRoleMentionLine(message.content) || "",
    createdAt: cleanText(message.timestamp, 80) || "",
    editedAt: cleanText(message.edited_timestamp, 80) || null,
    embed,
    embedJson: JSON.stringify(embed || {}, null, 2),
    title,
    roleIds,
    isRules,
    rulesType,
  };
}

export async function fetchDiscordEditableMessage(ref: DiscordMessageRef) {
  if (!ref.channelId || !ref.messageId) throw new Error("Посилання на Discord-повідомлення невалідне.");
  const message = await discordApi<Record<string, unknown>>(`/channels/${ref.channelId}/messages/${ref.messageId}`);
  return normalizeDiscordMessageForEditor(message, ref.channelId);
}

export async function listRulesEmbedMessages(channelId: string, limit = 50) {
  const cleanChannelId = snowflake(channelId);
  if (!cleanChannelId) return [] as DiscordEditableMessage[];

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const messages = await discordApi<Array<Record<string, unknown>>>(`/channels/${cleanChannelId}/messages?limit=${safeLimit}`);

  return messages
    .filter((message) => isRulesEmbedMessage(message))
    .map((message) => normalizeDiscordMessageForEditor(message, cleanChannelId));
}

export async function addGuildMemberRoles(params: {
  guildId: string;
  userId: string;
  roleIds: string[];
  reason?: string;
  concurrency?: number;
  maxConcurrency?: number;
}) {
  const guildId = snowflake(params.guildId);
  const userId = snowflake(params.userId);
  const roleIds = Array.from(new Set(params.roleIds.map(snowflake).filter(Boolean)));

  if (!guildId || !userId || roleIds.length === 0) throw new Error("Не вистачає guild/user/role ID для видачі ролі.");

  await mapConcurrent(
    roleIds,
    async (roleId) => {
      await discordApi<void>(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
        method: "PUT",
        auditReason: params.reason,
      });
    },
    {
      profile: "external-api",
      concurrency: Number(params.concurrency || 0) > 0 ? Number(params.concurrency) : undefined,
      envKey: "DISCORD_ROLE_ASSIGN_CONCURRENCY",
      maxEnvKey: "DISCORD_ROLE_ASSIGN_MAX_CONCURRENCY",
      min: 1,
      max: Math.max(1, Math.min(5, Math.floor(Number(params.maxConcurrency || 5)))),
    },
  );
}

export async function fetchDiscordGuildMemberSnapshot(userIdInput: string, guildIdInput = getDiscordGuildId()): Promise<DiscordGuildMemberSnapshot> {
  const guildId = snowflake(guildIdInput);
  const userId = snowflake(userIdInput);
  if (!guildId || !userId) throw new Error("Не вистачає guild/user ID для читання Discord-імені.");

  const member = await discordApi<any>(`/guilds/${guildId}/members/${userId}`);
  const user = member?.user && typeof member.user === "object" ? member.user : {};
  const nick = cleanText(member?.nick, 32) || null;
  const globalName = cleanText(user.global_name, 32) || null;
  const username = cleanText(user.username, 32) || null;
  const roleIds = Array.isArray(member?.roles)
    ? member.roles.map((roleId: unknown) => snowflake(roleId)).filter(Boolean).slice(0, 100)
    : [];

  return {
    userId,
    nick,
    username,
    globalName,
    displayName: nick || globalName || username || "Discord",
    roleIds,
  };
}

export async function fetchDiscordGuildBanSnapshot(userIdInput: string, guildIdInput = getDiscordGuildId()): Promise<DiscordGuildBanSnapshot | null> {
  const guildId = snowflake(guildIdInput);
  const userId = snowflake(userIdInput);
  if (!guildId || !userId) throw new Error("Не вистачає guild/user ID для перевірки Discord-бану.");

  let ban: any;
  try {
    ban = await discordApi<any>(`/guilds/${guildId}/bans/${userId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/404|unknown ban|10026/i.test(message)) return null;
    logDashboardEvent("warn", "discord.ban_check_failed", undefined, {
      guildId,
      userId,
      detail: message.slice(0, 220),
    });
    throw error;
  }

  if (!ban || typeof ban !== "object") throw new Error("Discord API: ban lookup returned invalid payload.");
  const user = ban.user && typeof ban.user === "object" ? ban.user : {};
  return {
    userId,
    reason: cleanText(ban.reason, 240) || null,
    username: cleanText(user.username, 80) || null,
    globalName: cleanText(user.global_name, 80) || null,
  };
}

export async function fetchDiscordGuildBans(limitInput: unknown = 50_000): Promise<DiscordGuildBanSnapshot[]> {
  const guildId = snowflake(getDiscordGuildId());
  if (!guildId) throw new Error("Discord-сервер не підключений до панелі.");

  const parsedLimit = Number(limitInput);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(50_000, Math.floor(parsedLimit))
    : 50_000;
  const result: DiscordGuildBanSnapshot[] = [];
  let after = "0";

  while (result.length < safeLimit) {
    const batchSize = Math.min(1000, safeLimit - result.length);
    const bans = await discordApi<any[]>(`/guilds/${guildId}/bans?limit=${batchSize}&after=${after}`);
    if (!Array.isArray(bans) || bans.length === 0) break;

    for (const ban of bans) {
      const user = ban?.user && typeof ban.user === "object" ? ban.user : {};
      const userId = snowflake(user.id || ban?.user_id || ban?.id);
      if (!userId) continue;
      result.push({
        userId,
        reason: cleanText(ban?.reason, 240) || null,
        username: cleanText(user.username, 80) || null,
        globalName: cleanText(user.global_name, 80) || null,
      });
      if (result.length >= safeLimit) break;
    }

    const lastUserId = bans[bans.length - 1]?.user?.id;
    if (!lastUserId || String(lastUserId) === after || bans.length < batchSize) break;
    after = String(lastUserId);
  }

  return result;
}


export async function replaceGuildMemberRoles(params: {
  guildId: string;
  userId: string;
  roleIds: string[];
  reason?: string;
}) {
  const guildId = snowflake(params.guildId);
  const userId = snowflake(params.userId);
  const roleIds = Array.from(new Set(params.roleIds.map(snowflake).filter(Boolean))).slice(0, 100);

  if (!guildId || !userId) throw new Error("Не вистачає guild/user ID для оновлення ролей.");

  await discordApi<void>(`/guilds/${guildId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ roles: roleIds }),
    auditReason: params.reason,
  });
}

export async function updateGuildMemberNickname(params: {
  guildId: string;
  userId: string;
  nickname: string;
  reason?: string;
}) {
  const guildId = snowflake(params.guildId);
  const userId = snowflake(params.userId);
  const nickname = cleanText(params.nickname, 32);
  if (!guildId || !userId) throw new Error("Не вистачає guild/user ID для зміни імені.");
  if (!nickname) throw new Error("Discord-імʼя порожнє.");

  await discordApi<void>(`/guilds/${guildId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ nick: nickname }),
    auditReason: params.reason,
  });
}
export async function kickGuildMember(params: {
  guildId: string;
  userId: string;
  reason?: string;
}) {
  const guildId = snowflake(params.guildId);
  const userId = snowflake(params.userId);
  if (!guildId || !userId) throw new Error("Не вистачає guild/user ID для кіку.");

  await discordApi<void>(`/guilds/${guildId}/members/${userId}`, {
    method: "DELETE",
    auditReason: params.reason,
  });
}

export async function verifyDiscordInteractionSignature(request: Request, rawBody: string) {
  const publicKey = getDiscordPublicKey();
  if (!publicKey) throw new Error("Перевірка Discord-команд тимчасово недоступна.");

  const signature = request.headers.get("x-signature-ed25519") || "";
  const timestamp = request.headers.get("x-signature-timestamp") || "";
  if (!signature || !timestamp) return false;

  const keyBytes = hexToBytes(publicKey);
  const signatureBytes = hexToBytes(signature);
  const bodyBytes = new TextEncoder().encode(`${timestamp}${rawBody}`);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  return crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, signatureBytes, bodyBytes);
}

function hexToBytes(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Некоректний hex-ключ або підпис Discord.");
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

export function discordMessageUrl(channelId: string, messageId: string) {
  const guildId = getDiscordGuildId() || "@me";
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export type DiscordGuildMemberModerationItem = {
  userId: string;
  username: string | null;
  globalName: string | null;
  nick: string | null;
  displayName: string;
  roleIds: string[];
};

function normalizeGuildMemberForModeration(member: any): DiscordGuildMemberModerationItem | null {
  if (!member || typeof member !== "object") return null;
  const user = member.user && typeof member.user === "object" ? member.user : {};
  const userId = snowflake(user.id || member.user_id || member.id);
  if (!userId || Boolean(user.bot)) return null;
  const nick = cleanText(member.nick, 32) || null;
  const username = cleanText(user.username, 32) || null;
  const globalName = cleanText(user.global_name, 32) || null;
  const roleIds = Array.isArray(member.roles)
    ? member.roles.map((roleId: unknown) => snowflake(roleId)).filter(Boolean).slice(0, 100)
    : [];
  return {
    userId,
    username,
    globalName,
    nick,
    displayName: nick || globalName || username || `Discord ${userId.slice(-6)}`,
    roleIds,
  };
}

export async function fetchDiscordGuildMembers(limitInput: unknown = 1000) {
  const guildId = getDiscordGuildId();
  if (!guildId) throw new Error("Discord-сервер не підключений до панелі.");

  const parsedLimit = Number(limitInput);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(50_000, Math.floor(parsedLimit))
    : 50_000;
  const result: DiscordGuildMemberModerationItem[] = [];
  let after = "0";

  while (result.length < safeLimit) {
    const batchSize = Math.min(1000, safeLimit - result.length);
    const members = await discordApi<any[]>(`/guilds/${guildId}/members?limit=${batchSize}&after=${after}`);
    if (!Array.isArray(members) || members.length === 0) break;
    for (const member of members) {
      const normalized = normalizeGuildMemberForModeration(member);
      if (normalized) result.push(normalized);
    }
    const lastUserId = members[members.length - 1]?.user?.id;
    if (!lastUserId || String(lastUserId) === after || members.length < batchSize) break;
    after = String(lastUserId);
  }

  return result;
}

export async function removeGuildMemberRoles(params: {
  guildId: string;
  userId: string;
  roleIds: string[];
  reason?: string;
  concurrency?: number;
  maxConcurrency?: number;
}) {
  const guildId = snowflake(params.guildId);
  const userId = snowflake(params.userId);
  const roleIds = Array.from(new Set(params.roleIds.map(snowflake).filter(Boolean)));

  if (!guildId || !userId || roleIds.length === 0) throw new Error("Не вистачає guild/user/role ID для зняття ролі.");

  await mapConcurrent(
    roleIds,
    async (roleId) => {
      await discordApi<void>(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
        method: "DELETE",
        auditReason: params.reason,
      });
    },
    {
      profile: "external-api",
      concurrency: Number(params.concurrency || 0) > 0 ? Number(params.concurrency) : undefined,
      min: 1,
      max: Math.max(1, Math.min(5, Math.floor(Number(params.maxConcurrency || 5)))),
    },
  );
}
