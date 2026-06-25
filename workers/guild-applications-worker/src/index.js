const DEFAULT_CACHE_SECONDS = 0;
const DEFAULT_PUBLIC_API_CACHE_SECONDS = 120;
const MAX_PUBLIC_API_CACHE_SECONDS = 86_400;
const PUBLIC_API_CACHE_PREFIX = "public-api";
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 24;
const DEFAULT_FILTERED_LIST_PAGES = 3;
const MAX_GITHUB_LIST_PAGES = 5;
let firebaseAuthCache = { accessToken: "", expiresAt: 0 };
let battleNetAuthCache = { accessToken: "", expiresAt: 0, region: "" };
let geoAccessPolicyCache = { policy: null, expiresAt: 0 };
let discordRouteCooldowns = new Map();
let workerCronGuards = new Map();


const PATHS = new Set(["/", "/api/guild-applications", "/api/discord-interactions", "/api/discord-rules-stats", "/api/discord-raid-rules-stats", "/api/discord-raid-rules-signups", "/api/discord-raid-message", "/api/discord-guild-channels", "/api/public-cache", "/api/raids/lifecycle", "/api/polls/close-due"]);
const DEFAULT_LABEL = "guild-application";
const DEFAULT_REVIEW_LABEL = "status:review";

const STATUS = {
  REVIEW: { key: "review", label: "На розгляді", color: 0xd4a63a },
  ACCEPTED: { key: "accepted", label: "Прийнято", color: 0x3ba55d },
  DECLINED: { key: "declined", label: "Відхилено", color: 0xed4245 },
};

const STATUS_KEYS = new Set(Object.values(STATUS).map((status) => status.key));
const STATUS_ALIASES = {
  pending: STATUS.REVIEW.key,
  review: STATUS.REVIEW.key,
  approved: STATUS.ACCEPTED.key,
  accepted: STATUS.ACCEPTED.key,
  rejected: STATUS.DECLINED.key,
  declined: STATUS.DECLINED.key,
};

function normalizeStatusKey(value) {
  return STATUS_ALIASES[String(value || "").trim().toLowerCase()] || STATUS.REVIEW.key;
}

function resolveStatusFilter(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all") return raw === "all" ? "all" : null;
  const normalized = raw.replace(/\s+/g, "").replace(/_/g, "").replace(/-/g, "").replace(/:/g, "");
  const alias = STATUS_ALIASES[raw] || STATUS_ALIASES[normalized];
  if (alias) return alias;
  if (normalized === "statusreview") return STATUS.REVIEW.key;
  if (normalized === "statusaccepted" || normalized === "statusapproved") return STATUS.ACCEPTED.key;
  if (normalized === "statusdeclined" || normalized === "statusrejected") return STATUS.DECLINED.key;
  if (STATUS_KEYS.has(raw)) return raw;
  return null;
}

const INTERACTION_COOLDOWN_MS = 2500;
const interactionCooldowns = new Map();
const RULES_CUSTOM_ID_PREFIX = "mbv1";

function safeLogValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[max-depth]";
  if (typeof value === "string") {
    return value
      .replace(/ghp_[A-Za-z0-9_]+/g, "[redacted]")
      .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
      .replace(/Bot\s+[A-Za-z0-9._-]+/g, "Bot [redacted]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      .slice(0, 500);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeLogValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 40).map(([key, item]) => [
        key,
        /token|secret|password|authorization|cookie|signature/i.test(key) ? "[redacted]" : safeLogValue(item, depth + 1),
      ])
    );
  }
  return String(value).slice(0, 240);
}

function logWorkerEvent(level, event, details = {}) {
  const payload = safeLogValue({ event, time: new Date().toISOString(), ...details });
  const line = "[guild-worker:" + level + "] " + JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, nowMs() - startedAt);
}

function requestIdFromRequest(request) {
  return (
    request.headers.get("CF-Ray") ||
    request.headers.get("X-Request-ID") ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  );
}

function allowDebugQuery(env) {
  return ["1", "true", "yes", "on"].includes(String(env.ALLOW_DEBUG_QUERY || "").trim().toLowerCase());
}

function isDebugEnabled(request, env) {
  const url = new URL(request.url);
  const queryDebug = allowDebugQuery(env) && (url.searchParams.get("debug") === "1" || url.searchParams.get("diag") === "1");
  return (
    queryDebug ||
    String(env.DEBUG_LOGS || "").trim() === "1" ||
    String(env.DEBUG_RESPONSES || "").trim() === "1"
  );
}

function isDebugResponseEnabled(request, env) {
  const url = new URL(request.url);
  const queryDebug = allowDebugQuery(env) && (url.searchParams.get("debug") === "1" || url.searchParams.get("diag") === "1");
  return queryDebug || String(env.DEBUG_RESPONSES || "").trim() === "1";
}

function withTelemetryHeaders(response, requestId, startedAt) {
  try {
    response.headers.set("X-Guild-Worker-Request-Id", requestId);
    response.headers.set("X-Guild-Worker-Duration-Ms", String(elapsedMs(startedAt)));
  } catch {
    // Some platform responses may have immutable headers. Ignore telemetry header injection then.
  }
  return response;
}

function envDiagnostics(env) {
  return {
    github_token: Boolean(env.GITHUB_TOKEN),
    github_owner: Boolean(env.GITHUB_OWNER),
    github_repo: Boolean(env.GITHUB_REPO),
    firebase_project_id: Boolean(env.FIREBASE_PROJECT_ID),
    firebase_client_email: Boolean(env.FIREBASE_CLIENT_EMAIL),
    firebase_private_key: Boolean(env.FIREBASE_PRIVATE_KEY),
    firebase_applications_collection: firebaseApplicationsCollection(env),
    geo_access_block_enabled: geoAccessDefaultPolicy(env).enabled,
    geo_access_blocked_countries: geoAccessDefaultPolicy(env).blockedCountries,
    battlenet_client_id: Boolean(env.BATTLENET_CLIENT_ID || env.BATTLE_NET_CLIENT_ID || env.BLIZZARD_CLIENT_ID),
    battlenet_client_secret: Boolean(env.BATTLENET_CLIENT_SECRET || env.BATTLE_NET_CLIENT_SECRET || env.BLIZZARD_CLIENT_SECRET),
    guild_applications_label: env.GUILD_APPLICATIONS_LABEL || DEFAULT_LABEL,
    discord_bot_token: Boolean(env.DISCORD_BOT_TOKEN),
    discord_channel_id: Boolean(env.DISCORD_CHANNEL_ID),
    discord_public_key: Boolean(env.DISCORD_PUBLIC_KEY),
    discord_guild_id: Boolean(env.DISCORD_GUILD_ID),
    rules_stats_binding: hasValidRulesStatsBinding(env),
    public_api_cache_binding: hasValidPublicApiCacheBinding(env),
    dashboard_profile_lookup_endpoint: Boolean(String(env.DASHBOARD_PROFILE_LOOKUP_ENDPOINT || env.ADMIN_PROFILE_LOOKUP_ENDPOINT || env.ADMIN_DASHBOARD_URL || "").trim()),
    internal_profile_lookup_token: Boolean(String(env.INTERNAL_PROFILE_LOOKUP_TOKEN || "").trim()),
    cf_access_client_id: Boolean(String(env.CF_ACCESS_CLIENT_ID || env.CLOUDFLARE_ACCESS_CLIENT_ID || "").trim()),
    cf_access_client_secret: Boolean(String(env.CF_ACCESS_CLIENT_SECRET || env.CLOUDFLARE_ACCESS_CLIENT_SECRET || "").trim()),
    allowed_origins_configured: Boolean(String(env.ALLOWED_ORIGINS || "").trim()),
    rules_stats_token: Boolean(String(env.DISCORD_RULES_STATS_TOKEN || env.WORKER_STATS_TOKEN || "").trim()),
    discord_worker_token: Boolean(String(env.DISCORD_RULES_STATS_TOKEN || env.INTERNAL_PROFILE_LOOKUP_TOKEN || env.WORKER_STATS_TOKEN || "").trim()),
  };
}

function sanitizeApiPathForLog(path) {
  return String(path || "")
    .replace(/([?&]access_token=)[^&]+/gi, "$1[redacted]")
    .slice(0, 700);
}

function parsePositiveInt(value, fallback, min, max) {
  const number = parseInt(String(value || ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function readDurationMs(env, names, fallback, min, max) {
  for (const name of names) {
    const raw = env && env[name] !== undefined ? env[name] : undefined;
    if (raw === undefined || raw === null || raw === "") continue;
    const number = Number(raw);
    if (Number.isFinite(number)) return Math.max(min, Math.min(Math.floor(number), max));
  }
  return Math.max(min, Math.min(Math.floor(fallback), max));
}

async function runWorkerCronGuarded(env, key, reason, minIntervalMs, task) {
  const now = Date.now();
  const entry = workerCronGuards.get(key) || { lastStartedAt: 0, inFlight: null, lastResult: null };

  if (entry.inFlight) {
    logWorkerEvent("info", `${key}.skipped`, { reason, skipped: "in_flight" });
    return { ok: true, skipped: true, reason: "in_flight", ...(entry.lastResult || {}) };
  }

  if (entry.lastStartedAt && now - entry.lastStartedAt < minIntervalMs) {
    logWorkerEvent("info", `${key}.skipped`, { reason, skipped: "cooldown", cooldownMs: minIntervalMs });
    return { ok: true, skipped: true, reason: "cooldown", ...(entry.lastResult || {}) };
  }

  entry.lastStartedAt = now;
  entry.inFlight = Promise.resolve().then(task);
  workerCronGuards.set(key, entry);
  try {
    const result = await entry.inFlight;
    entry.lastResult = result || null;
    return result;
  } finally {
    entry.inFlight = null;
    workerCronGuards.set(key, entry);
  }
}

async function runMeasured(event, details, task, level = "info") {
  const startedAt = nowMs();
  try {
    const result = await task();
    logWorkerEvent(level, `${event}.ok`, { ...details, ms: elapsedMs(startedAt) });
    return result;
  } catch (error) {
    logWorkerEvent("error", `${event}.failed`, { ...details, ms: elapsedMs(startedAt), message: error?.message });
    throw error;
  }
}

function summarizeApplicationItems(items) {
  const summary = {
    total: items.length,
    states: {},
    statuses: {},
    labels: {},
  };

  for (const item of items) {
    const state = item.state || "unknown";
    const status = item.status_key || "unknown";
    summary.states[state] = (summary.states[state] || 0) + 1;
    summary.statuses[status] = (summary.statuses[status] || 0) + 1;

    for (const label of Array.isArray(item.labels) ? item.labels : []) {
      summary.labels[label] = (summary.labels[label] || 0) + 1;
    }
  }

  return summary;
}

function parseCsvSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function snowflake(value) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function getInteractionGuildId(interaction, env) {
  return snowflake(interaction?.guild_id) || snowflake(env.DISCORD_GUILD_ID);
}

function base36ToSnowflake(value) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = 0n;

  for (const raw of String(value || "").toLowerCase()) {
    const digit = alphabet.indexOf(raw);
    if (digit < 0) throw new Error("Некоректний custom_id правил.");
    result = result * 36n + BigInt(digit);
  }

  return result.toString(10);
}

function decodeRoleIdsFromCustomId(value, prefix) {
  try {
    const roleIds = String(value || "")
      .slice(prefix.length)
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(base36ToSnowflake)
      .filter(snowflake);

    return roleIds.length ? Array.from(new Set(roleIds)) : [];
  } catch {
    return [];
  }
}

function decodeRulesCustomId(customId) {
  const value = String(customId || "").trim();

  if (value === `${RULES_CUSTOM_ID_PREFIX}:r:s`) {
    return { type: "raid", action: "raid_signup", roleIds: [] };
  }

  if (value === `${RULES_CUSTOM_ID_PREFIX}:r:c:s`) {
    return { type: "raid", action: "confirm_raid_signup", roleIds: [] };
  }

  if (value === `${RULES_CUSTOM_ID_PREFIX}:d`) {
    return { type: "guild", action: "decline", roleIds: [] };
  }

  if (value === `${RULES_CUSTOM_ID_PREFIX}:c:d`) {
    return { type: "guild", action: "confirm_decline", roleIds: [] };
  }

  const acceptPrefix = `${RULES_CUSTOM_ID_PREFIX}:a:`;
  if (value.startsWith(acceptPrefix)) {
    const roleIds = decodeRoleIdsFromCustomId(value, acceptPrefix);
    return roleIds.length ? { type: "guild", action: "accept", roleIds } : null;
  }

  const confirmAcceptPrefix = `${RULES_CUSTOM_ID_PREFIX}:c:a:`;
  if (value.startsWith(confirmAcceptPrefix)) {
    const roleIds = decodeRoleIdsFromCustomId(value, confirmAcceptPrefix);
    return roleIds.length ? { type: "guild", action: "confirm_accept", roleIds } : null;
  }

  return null;
}

function getDiscordUserId(interaction) {
  return interaction?.member?.user?.id || interaction?.user?.id || "unknown";
}

function hasAllowedDiscordRole(interaction, env) {
  const allowedRoles = parseCsvSet(env.DISCORD_ALLOWED_ROLES);
  if (!allowedRoles.size) return true;

  const memberRoles = Array.isArray(interaction?.member?.roles)
    ? interaction.member.roles.map(String)
    : [];

  return memberRoles.some((roleId) => allowedRoles.has(roleId));
}

function isInteractionRateLimited(interaction, scope = "global") {
  const userId = getDiscordUserId(interaction);
  const cacheKey = `${scope}:${userId}`;
  const now = Date.now();
  const last = interactionCooldowns.get(cacheKey) || 0;

  if (interactionCooldowns.size > 500) {
    for (const [key, timestamp] of interactionCooldowns) {
      if (now - timestamp > 60_000) interactionCooldowns.delete(key);
    }
  }

  if (now - last < INTERACTION_COOLDOWN_MS) return true;
  interactionCooldowns.set(cacheKey, now);
  return false;
}

async function retryAsync(task, retries = 2, delayMs = 250) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms || 0))));
}

function timeoutMs(value, fallback, min = 500, max = 30_000) {
  const parsed = Number(value);
  const clean = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.floor(clean)));
}

function buildCorsHeaders(corsOrigin, status = 200) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": corsOrigin || "null",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Worker-Stats-Token",
    "Vary": "Origin",
  };
}

function json(data, status = 200, corsOrigin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildCorsHeaders(corsOrigin, status),
  });
}


function getRulesStatsKv(env) {
  const kv = env.RULES_STATS || null;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") return null;
  return kv;
}

function hasRulesStatsBinding(env) {
  return Boolean(env.RULES_STATS);
}

function hasValidRulesStatsBinding(env) {
  return Boolean(getRulesStatsKv(env));
}

function getPublicApiCacheKv(env) {
  const kv = env.PUBLIC_API_CACHE || null;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") return null;
  return kv;
}

function hasPublicApiCacheBinding(env) {
  return Boolean(env.PUBLIC_API_CACHE);
}

function hasValidPublicApiCacheBinding(env) {
  return Boolean(getPublicApiCacheKv(env));
}

function publicApiCacheVersion(env) {
  return cleanText(env.PUBLIC_API_CACHE_VERSION || "v1", 40).replace(/[^A-Za-z0-9_.:-]/g, "_") || "v1";
}

function publicApiCacheTtlSeconds(env, name, fallback = DEFAULT_PUBLIC_API_CACHE_SECONDS) {
  const raw = env[name] ?? env.PUBLIC_API_CACHE_TTL_SECONDS ?? fallback;
  const parsed = parseInt(String(raw || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(parsed, MAX_PUBLIC_API_CACHE_SECONDS));
}

function publicApiCacheEnabled(env) {
  return !envFlag(env, "PUBLIC_API_CACHE_DISABLED", false);
}

function normalizePublicApiCacheKeyInput(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, ":")
    .replace(/[^A-Za-z0-9:._/=-]/g, "_")
    .replace(/:{2,}/g, ":")
    .slice(0, 180);
}

async function publicApiCacheStorageKey(env, key) {
  const normalized = normalizePublicApiCacheKeyInput(key) || "unknown";
  if (normalized.length <= 150) return `${PUBLIC_API_CACHE_PREFIX}:${publicApiCacheVersion(env)}:${normalized}`;
  return `${PUBLIC_API_CACHE_PREFIX}:${publicApiCacheVersion(env)}:sha256:${await sha256Hex(normalized)}`;
}

function cacheableSearch(url) {
  const copy = new URL(url.toString());
  copy.searchParams.delete("debug");
  copy.searchParams.delete("diag");
  copy.searchParams.sort?.();
  return copy.searchParams.toString();
}

async function publicApiHttpCacheKey(env, request, namespace) {
  const url = new URL(request.url);
  const search = cacheableSearch(url);
  return publicApiCacheStorageKey(env, `worker:${namespace}:${url.pathname}${search ? `?${search}` : ""}`);
}

function responseWithCacheHeaders(body, status, origin, cacheState, ttlSeconds, extraHeaders = {}) {
  const headers = buildCorsHeaders(origin, status);
  headers["Cache-Control"] = ttlSeconds > 0
    ? `public, max-age=${Math.min(ttlSeconds, 300)}, stale-while-revalidate=${Math.min(Math.max(ttlSeconds, 60), 3600)}`
    : "no-store";
  headers["X-Mistblossom-Worker-Cache"] = cacheState;
  for (const [key, value] of Object.entries(extraHeaders || {})) headers[key] = String(value);
  return new Response(body, { status, headers });
}

async function withPublicApiHttpCache(request, env, ctx, options, handler) {
  const origin = allowedOrigin(request, env) || "null";
  const debug = isDebugResponseEnabled(request, env);
  const ttlSeconds = publicApiCacheTtlSeconds(env, options.ttlEnv || "PUBLIC_API_CACHE_TTL_SECONDS", options.ttlSeconds || DEFAULT_PUBLIC_API_CACHE_SECONDS);
  const kv = getPublicApiCacheKv(env);

  if (request.method !== "GET" || debug || ttlSeconds <= 0 || !publicApiCacheEnabled(env) || !kv) {
    const response = await handler();
    response.headers.set("X-Mistblossom-Worker-Cache", kv ? "BYPASS" : "DISABLED");
    return response;
  }

  const key = await publicApiHttpCacheKey(env, request, options.namespace || "default");
  try {
    const cached = await kv.get(key, { type: "json" });
    if (cached && cached.kind === "http-json" && typeof cached.body === "string") {
      return responseWithCacheHeaders(cached.body, Number(cached.status || 200), origin, "HIT", ttlSeconds, {
        "X-Mistblossom-Worker-Cache-Key": key.slice(0, 120),
        "X-Mistblossom-Worker-Cache-At": cached.cachedAt || "",
      });
    }
  } catch (error) {
    logWorkerEvent("warn", "public_cache.http_read_failed", { namespace: options.namespace, message: error?.message });
  }

  const response = await handler();
  const cloned = response.clone();
  if (response.ok) {
    const body = await cloned.text().catch(() => "");
    if (body && body.length <= parsePositiveInt(env.PUBLIC_API_CACHE_MAX_BODY_BYTES, 512_000, 16_384, 2_000_000)) {
      const entry = {
        kind: "http-json",
        status: response.status,
        body,
        tags: Array.isArray(options.tags) ? options.tags.slice(0, 12) : [],
        cachedAt: new Date().toISOString(),
      };
      const write = kv.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds }).catch((error) => {
        logWorkerEvent("warn", "public_cache.http_write_failed", { namespace: options.namespace, message: error?.message });
      });
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(write); else await write;
    }
  }
  response.headers.set("X-Mistblossom-Worker-Cache", "MISS");
  return response;
}

async function deletePublicApiCacheKey(env, key) {
  const kv = getPublicApiCacheKv(env);
  if (!kv || typeof kv.delete !== "function") return { ok: false, deleted: 0, reason: "missing-kv-binding" };
  const storageKey = await publicApiCacheStorageKey(env, key);
  await kv.delete(storageKey);
  return { ok: true, deleted: 1, key: storageKey };
}

async function deletePublicApiCachePrefix(env, prefix, maxKeys = 1000) {
  const kv = getPublicApiCacheKv(env);
  if (!kv || typeof kv.list !== "function" || typeof kv.delete !== "function") return { ok: false, deleted: 0, reason: "missing-kv-binding" };
  const storagePrefix = `${PUBLIC_API_CACHE_PREFIX}:${publicApiCacheVersion(env)}:${normalizePublicApiCacheKeyInput(prefix)}`;
  let deleted = 0;
  let cursor;
  do {
    const page = await kv.list({ prefix: storagePrefix, cursor, limit: 1000 });
    const keys = Array.isArray(page?.keys) ? page.keys : [];
    await Promise.all(keys.map((item) => item?.name ? kv.delete(item.name).then(() => { deleted += 1; }) : null));
    cursor = page?.list_complete ? undefined : page?.cursor;
    if (deleted >= maxKeys) break;
  } while (cursor);
  return { ok: true, deleted, prefix: storagePrefix };
}

async function putPublicApiValue(env, key, value, ttlSeconds, tags = []) {
  const kv = getPublicApiCacheKv(env);
  if (!kv) return { ok: false, reason: "missing-kv-binding" };
  const storageKey = await publicApiCacheStorageKey(env, key);
  const ttl = Math.max(60, Math.min(Number(ttlSeconds || env.PUBLIC_API_CACHE_TTL_SECONDS || 300), MAX_PUBLIC_API_CACHE_SECONDS));
  const entry = {
    kind: "json-value",
    value,
    tags: Array.isArray(tags) ? tags.slice(0, 20).map((item) => String(item).slice(0, 80)) : [],
    cachedAt: new Date().toISOString(),
  };
  await kv.put(storageKey, JSON.stringify(entry), { expirationTtl: ttl });
  return { ok: true, key: storageKey, ttlSeconds: ttl };
}

async function getPublicApiValue(env, key) {
  const kv = getPublicApiCacheKv(env);
  if (!kv) return { ok: false, hit: false, reason: "missing-kv-binding" };
  const storageKey = await publicApiCacheStorageKey(env, key);
  const entry = await kv.get(storageKey, { type: "json" }).catch(() => null);
  if (!entry || entry.kind !== "json-value") return { ok: true, hit: false, key: storageKey };
  return { ok: true, hit: true, key: storageKey, value: entry.value, cachedAt: entry.cachedAt || null, tags: entry.tags || [] };
}

async function invalidatePublicApiCache(env, options = {}) {
  const tasks = [];
  for (const key of Array.isArray(options.keys) ? options.keys : []) tasks.push(deletePublicApiCacheKey(env, key));
  for (const prefix of Array.isArray(options.prefixes) ? options.prefixes : []) tasks.push(deletePublicApiCachePrefix(env, prefix));
  if (!tasks.length && options.prefix) tasks.push(deletePublicApiCachePrefix(env, options.prefix));
  if (!tasks.length && options.key) tasks.push(deletePublicApiCacheKey(env, options.key));
  const results = await Promise.allSettled(tasks);
  const deleted = results.reduce((sum, item) => sum + (item.status === "fulfilled" ? Number(item.value?.deleted || 0) : 0), 0);
  return { ok: results.every((item) => item.status === "fulfilled"), deleted, results: results.map((item) => item.status === "fulfilled" ? item.value : { ok: false, error: item.reason?.message || String(item.reason || "failed") }) };
}

async function invalidateApplicationCaches(env, ctx) {
  const task = invalidatePublicApiCache(env, { prefixes: ["worker:applications", "dashboard:applications"] })
    .then((result) => logWorkerEvent("info", "public_cache.applications_invalidated", { deleted: result.deleted }))
    .catch((error) => logWorkerEvent("warn", "public_cache.applications_invalidate_failed", { message: error?.message }));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task); else await task;
}

async function handlePublicApiCache(request, env) {
  const origin = allowedOrigin(request, env) || "null";
  const tokens = publicApiCacheTokens(env);
  if (!tokens.length || !(await verifyAnyBearerOrStatsToken(request, tokens))) {
    return json({ ok: false, error: "Forbidden" }, 403, origin);
  }
  if (!hasValidPublicApiCacheBinding(env)) {
    return json({ ok: false, hit: false, error: "PUBLIC_API_CACHE KV binding is missing." }, 501, origin);
  }

  const url = new URL(request.url);
  if (request.method === "GET") {
    const key = cleanText(url.searchParams.get("key"), 240);
    if (!key) return json({ ok: false, error: "key_required" }, 400, origin);
    return json(await getPublicApiValue(env, key), 200, origin);
  }

  if (request.method === "POST" || request.method === "PUT") {
    const body = await request.json().catch(() => null);
    const key = cleanText(body?.key, 240);
    if (!key) return json({ ok: false, error: "key_required" }, 400, origin);
    return json(await putPublicApiValue(env, key, body?.value ?? null, body?.ttlSeconds || body?.ttl_seconds || undefined, body?.tags || []), 200, origin);
  }

  if (request.method === "DELETE") {
    const key = cleanText(url.searchParams.get("key"), 240);
    const prefix = cleanText(url.searchParams.get("prefix"), 240);
    const body = request.headers.get("content-length") ? await request.json().catch(() => null) : null;
    const result = await invalidatePublicApiCache(env, {
      key: key || body?.key,
      prefix: prefix || body?.prefix,
      keys: body?.keys,
      prefixes: body?.prefixes,
    });
    return json(result, 200, origin);
  }

  return json({ ok: false, error: "method_not_allowed" }, 405, origin);
}

function rulesStatsKey(guildId, suffix) {
  return `rules:${snowflake(guildId) || "global"}:${suffix}`;
}

function raidRulesKey(guildId, suffix) {
  return `raid-rules:${snowflake(guildId) || "global"}:${suffix}`;
}

function defaultAllowedOrigins(env) {
  const values = [
    env.ALLOWED_ORIGINS,
    env.SITE_BASE_URL,
    env.PUBLIC_SITE_URL,
    env.ADMIN_DASHBOARD_URL,
    env.DASHBOARD_URL,
    "https://lihvodruida.pp.ua",
    "https://admin.lihvodruida.pp.ua",
  ];

  const origins = new Set();
  for (const value of values) {
    for (const item of String(value || "").split(",")) {
      const raw = item.trim();
      if (!raw) continue;
      try {
        const url = new URL(raw);
        if (url.protocol === "https:" || url.hostname === "localhost") origins.add(url.origin);
      } catch {
        // ignore invalid origin values
      }
    }
  }
  return Array.from(origins);
}

function statsAuthToken(env) {
  return String(env.DISCORD_RULES_STATS_TOKEN || env.WORKER_STATS_TOKEN || "").trim();
}

function publicApiCacheTokens(env) {
  const explicit = String(env.PUBLIC_API_CACHE_TOKEN || "").trim();
  if (explicit) return [explicit];
  if (envFlag(env, "PUBLIC_API_CACHE_ALLOW_SHARED_TOKEN", false)) {
    return Array.from(new Set([
      env.DISCORD_RULES_STATS_TOKEN,
      env.INTERNAL_PROFILE_LOOKUP_TOKEN,
      env.WORKER_STATS_TOKEN,
    ].map((value) => String(value || "").trim()).filter(Boolean)));
  }
  return [];
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function verifyBearerOrStatsToken(request, expected) {
  if (!expected) return true;
  const auth = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const provided = bearer || String(request.headers.get("X-Worker-Stats-Token") || request.headers.get("x-worker-stats-token") || "").trim();
  if (!provided) return false;
  const [left, right] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  return constantTimeEqual(left, right);
}

async function assertWorkerReadAccess(request, env, scope) {
  const origin = allowedOrigin(request, env);
  if (request.headers.get("Origin") && !origin) {
    logWorkerEvent("warn", `${scope}.origin_denied`, { origin: request.headers.get("Origin") || "" });
    return { ok: false, response: json({ error: "Origin is not allowed." }, 403, "null") };
  }

  const token = statsAuthToken(env);
  if (token && !(await verifyBearerOrStatsToken(request, token))) {
    logWorkerEvent("warn", `${scope}.token_denied`, { hasToken: true });
    return { ok: false, response: json({ error: "Доступ до статистики заборонено." }, 401, origin || "null") };
  }

  return { ok: true, origin: origin || "null", authConfigured: Boolean(token) };
}

function dashboardAuthUrl(env) {
  const raw = String(env.ADMIN_DASHBOARD_URL || env.DASHBOARD_URL || "https://admin.lihvodruida.pp.ua/").trim() || "https://admin.lihvodruida.pp.ua/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function dashboardUrl(env, path = "/") {
  try {
    return new URL(path.startsWith("/") ? path : `/${path}`, dashboardAuthUrl(env)).toString();
  } catch {
    const base = dashboardAuthUrl(env).replace(/\/$/, "");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }
}

function dashboardProfileUrl(env) {
  return dashboardUrl(env, "/profile");
}

function dashboardRaidUrl(env, raidId) {
  const cleanRaidId = String(raidId || "").trim();
  return cleanRaidId ? dashboardUrl(env, `/raids/${encodeURIComponent(cleanRaidId)}`) : dashboardUrl(env, "/raids");
}

function dashboardLoginUrl(env, nextPath = "/profile") {
  try {
    const url = new URL("/login", dashboardAuthUrl(env));
    if (nextPath) url.searchParams.set("next", nextPath.startsWith("/") ? nextPath : `/${nextPath}`);
    url.searchParams.set("error", "session_required");
    return url.toString();
  } catch {
    return dashboardProfileUrl(env);
  }
}

function dashboardRaidRulesUrl(env) {
  const explicit = String(env.RAID_RULES_URL || env.DISCORD_RAID_RULES_URL || env.NEXT_PUBLIC_RAID_RULES_URL || "").trim();
  if (explicit) return explicit;
  return "https://discord.com/channels/1449767281453301865/1498719949550784540/1498732894326227024";
}

function discordLinkButton(label, url) {
  const text = limitText(label, 80, "Відкрити");
  const href = String(url || "").trim();
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return { type: 2, style: 5, label: text, url: parsed.toString() };
  } catch {
    return null;
  }
}


function cleanRulesTokenSecret(value) {
  const text = String(value || "").trim();
  return text.length >= 16 ? text : "";
}

function rulesTokenSecret(env) {
  const candidates = [
    env.DASHBOARD_RULES_TOKEN_SECRET,
    env.RULES_TOKEN_SECRET,
    env.DASHBOARD_WORKER_SHARED_SECRET,
    env.WORKER_SHARED_SECRET,
    env.DISCORD_INTERACTIONS_SHARED_SECRET,
    env.DISCORD_INTERACTION_SECRET,
    env.DISCORD_BOT_TOKEN,
    env.DASHBOARD_SESSION_SECRET,
    env.SESSION_SECRET,
    env.NEXTAUTH_SECRET,
    env.AUTH_SECRET,
    "mistblossom-rules-onboarding-dev-secret",
  ];
  for (const candidate of candidates) {
    const clean = cleanRulesTokenSecret(candidate);
    if (clean) return clean;
  }
  return "mistblossom-rules-onboarding-dev-secret";
}

function cleanRulesTokenText(value, maxLength = 80) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanRulesTokenUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString().slice(0, 300) : "";
  } catch {
    return "";
  }
}

async function hmacSha256Base64Url(secretValue, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function createRulesRoleToken(env, interaction, roleIdsInput) {
  const roleIds = Array.from(new Set((roleIdsInput || []).map(snowflake).filter(Boolean))).slice(0, 10);
  if (!roleIds.length) throw new Error("Для посилання правил не задано роль.");

  const user = interaction?.member?.user || interaction?.user || {};
  const userId = getDiscordUserId(interaction);
  const guildId = getInteractionGuildId(interaction, env);
  const payload = base64UrlEncodeString(JSON.stringify({
    v: 1,
    iat: Math.floor(Date.now() / 1000),
    r: roleIds,
    ...(userId ? { u: userId } : {}),
    ...(guildId ? { g: guildId } : {}),
    // Keep this token compact. Discord URL buttons are limited to 512 characters;
    // full member role lists/avatar URLs make Discord reject the response with “Дія не вдалася”.
    // The dashboard fetches the fresh member snapshot by userId when the page opens.
    ...(cleanRulesTokenText(user?.username, 32) ? { un: cleanRulesTokenText(user.username, 32) } : {}),
    ...(cleanRulesTokenText(user?.global_name, 32) ? { gn: cleanRulesTokenText(user.global_name, 32) } : {}),
    ...(cleanRulesTokenText(interaction?.member?.nick || user?.global_name || user?.username || userId, 32)
      ? { dn: cleanRulesTokenText(interaction?.member?.nick || user?.global_name || user?.username || userId, 32) }
      : {}),
  }));
  const signature = await hmacSha256Base64Url(rulesTokenSecret(env), payload);
  return `${payload}.${signature}`;
}

async function rulesAcceptUrlForInteraction(env, interaction, roleIds) {
  const token = await createRulesRoleToken(env, interaction, roleIds);
  const acceptUrl = dashboardUrl(env, `/rules/accept?rt=${encodeURIComponent(token)}`);
  if (acceptUrl.length > 512) {
    logWorkerEvent("warn", "rules.accept.url_too_long", {
      length: acceptUrl.length,
      roles: Array.isArray(roleIds) ? roleIds.length : 0,
      userId: getDiscordUserId(interaction),
    });
  }
  return acceptUrl;
}

function rulesSiteLinkComponents(acceptUrl) {
  const button = discordLinkButton("Відкрити сайт і прийняти правила", acceptUrl);
  return button
    ? [{ type: 1, components: [button] }]
    : [];
}

function raidActionHelpComponents(env, raidId) {
  const raidPath = raidId ? `/raids/${encodeURIComponent(String(raidId))}` : "/profile";
  const buttons = [
    discordLinkButton("Увійти через Discord", dashboardLoginUrl(env, raidPath)),
    discordLinkButton("Відкрити профіль", dashboardProfileUrl(env)),
    discordLinkButton("Правила рейду", dashboardRaidRulesUrl(env)),
    raidId ? discordLinkButton("Сторінка рейду", dashboardRaidUrl(env, raidId)) : null,
  ].filter(Boolean);

  return buttons.length ? [{ type: 1, components: buttons.slice(0, 5) }] : [];
}

function raidActionHelpText(env, reason, raidId) {
  const profile = dashboardProfileUrl(env);
  const raidPath = raidId ? `/raids/${encodeURIComponent(String(raidId))}` : "/profile";
  const login = dashboardLoginUrl(env, raidPath);
  const rules = dashboardRaidRulesUrl(env);
  const raid = raidId ? `
Сторінка рейду: ${dashboardRaidUrl(env, raidId)}` : "";

  if (reason === "main") {
    return `❌ Дію не виконано: у профілі потрібно додати персонажа Battle.net і вибрати мейна.
Увійти: ${login}
Профіль: ${profile}
Правила рейду: ${rules}${raid}`;
  }

  return `❌ Дію не виконано: спочатку увійди через Discord у панелі.
Увійти: ${login}
Профіль: ${profile}
Правила рейду: ${rules}${raid}`;
}

function dashboardProfileLookupEndpoint(env) {
  const explicit = String(env.DASHBOARD_PROFILE_LOOKUP_ENDPOINT || env.ADMIN_PROFILE_LOOKUP_ENDPOINT || "").trim();
  if (explicit) return explicit;
  try {
    return new URL("/api/profile/discord-lookup", dashboardAuthUrl(env)).toString();
  } catch {
    return "https://admin.lihvodruida.pp.ua/api/profile/discord-lookup";
  }
}

function dashboardProfileLookupHeaders(env, token) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "user-agent": "Mistblossom-Guild-Worker/ProfileLookup",
  };

  const accessClientId = String(env.CF_ACCESS_CLIENT_ID || env.CLOUDFLARE_ACCESS_CLIENT_ID || "").trim();
  const accessClientSecret = String(env.CF_ACCESS_CLIENT_SECRET || env.CLOUDFLARE_ACCESS_CLIENT_SECRET || "").trim();

  // Cloudflare Access Service Auth for server-to-server calls.
  // Without these headers Access returns the login/block page instead of JSON.
  if (accessClientId && accessClientSecret) {
    headers["CF-Access-Client-Id"] = accessClientId;
    headers["CF-Access-Client-Secret"] = accessClientSecret;
  }

  return headers;
}

function hasCloudflareAccessServiceAuth(env) {
  return Boolean(
    String(env.CF_ACCESS_CLIENT_ID || env.CLOUDFLARE_ACCESS_CLIENT_ID || "").trim() &&
    String(env.CF_ACCESS_CLIENT_SECRET || env.CLOUDFLARE_ACCESS_CLIENT_SECRET || "").trim()
  );
}

async function fetchDashboardText(env, url, token, init = {}, options = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const retries = Math.max(0, Math.min(3, Number(options.retries ?? (method === "GET" ? 2 : 1))));
  const timeout = timeoutMs(options.timeoutMs || env.DASHBOARD_API_TIMEOUT_MS, method === "GET" ? 7000 : 9000, 1500, 30000);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...dashboardProfileLookupHeaders(env, token),
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      const raw = await response.text().catch(() => "");
      if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempt < retries) {
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        await sleep(Math.max(350, Math.min(5000, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 450 + attempt * 650))));
        continue;
      }
      return { response, raw };
    } catch (error) {
      lastError = error;
      if (attempt < retries && (error?.name === "AbortError" || /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || error)))) {
        await sleep(350 + attempt * 650);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("Dashboard request failed");
}

function pickMainCharacter(value) {
  if (!value || typeof value !== "object") return null;
  return {
    key: String(value.key || ""),
    name: String(value.name || ""),
    realmName: String(value.realmName || value.realm_name || ""),
    realmSlug: String(value.realmSlug || value.realm_slug || ""),
    region: String(value.region || ""),
    className: String(value.className || value.class_name || ""),
    profileUrl: String(value.profileUrl || value.profile_url || ""),
  };
}

function hasUsableMainCharacter(value) {
  const main = pickMainCharacter(value);
  return Boolean(main?.name && (main.realmName || main.realmSlug));
}

function formatMainCharacterForMessage(mainCharacter) {
  const main = pickMainCharacter(mainCharacter);
  if (!main?.name) return "main-персонаж не знайдений";
  const realm = main.realmName || main.realmSlug || "realm не вказано";
  return `${main.name} • ${realm}`;
}

async function lookupDashboardProfileByDiscord(env, discordId) {
  const cleanDiscordId = snowflake(discordId);
  const token = String(env.INTERNAL_PROFILE_LOOKUP_TOKEN || "").trim();
  if (!cleanDiscordId) return { ok: false, reason: "invalid-discord-id" };
  if (!token) return { ok: false, reason: "missing-profile-lookup-token" };

  const url = new URL(dashboardProfileLookupEndpoint(env));
  url.searchParams.set("discord_id", cleanDiscordId);

  try {
    const { response, raw } = await fetchDashboardText(env, url.toString(), token, { method: "GET" }, { timeoutMs: 7000, retries: 2 });
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

    if (response.status === 404) return { ok: false, reason: data?.reason || "profile-not-found", status: response.status, message: data?.error || raw };
    if (!response.ok || !data?.found) {
      let reason = data?.reason || "profile-lookup-failed";
      if (response.status === 401 || response.status === 403) reason = "profile-lookup-forbidden";
      if (!data && /cloudflare|access|forbidden|cdn-cgi/i.test(raw || "")) {
        reason = hasCloudflareAccessServiceAuth(env) ? "profile-lookup-blocked" : "profile-lookup-access-service-auth-missing";
      }
      return { ok: false, reason, status: response.status, message: data?.error || raw };
    }

    return { ok: true, profile: data, mainCharacter: pickMainCharacter(data.mainCharacter) };
  } catch (error) {
    return { ok: false, reason: "profile-lookup-exception", message: error?.message };
  }
}

function raidRulesSignupProfileErrorMessage(env, profileResult) {
  const profileUrl = dashboardProfileUrl(env);
  const loginUrl = dashboardLoginUrl(env, "/profile");
  const rulesUrl = dashboardRaidRulesUrl(env);
  const suffix = `
Увійти: ${loginUrl}
Профіль: ${profileUrl}
Правила рейду: ${rulesUrl}`;

  if (profileResult?.ok && !hasUsableMainCharacter(profileResult.mainCharacter)) {
    return "❌ Підпис не зараховано: профіль знайдено, але main-персонаж не вибраний. Відкрий профіль, додай персонажа Battle.net або натисни ‘Зробити мейном’ біля потрібного персонажа, а потім повтори підпис." + suffix;
  }

  switch (profileResult?.reason) {
    case "missing-profile-lookup-token":
      return "❌ Підпис не зараховано: панель тимчасово не може перевірити твій профіль. Звернись до гільдмайстра." + suffix;
    case "profile-lookup-forbidden":
      return "❌ Підпис не зараховано: панель тимчасово не може перевірити твій профіль. Авторизуйся в панелі та спробуй ще раз. Якщо помилка лишиться — звернись до гільдмайстра." + suffix;
    case "profile-lookup-access-service-auth-missing":
    case "profile-lookup-blocked":
      return "❌ Підпис не зараховано: панель тимчасово не може перевірити профіль через захист доступу. Звернись до гільдмайстра." + suffix;
    case "firebase-not-configured":
      return "❌ Підпис не зараховано: збереження профілів тимчасово недоступне. Звернись до гільдмайстра." + suffix;
    case "invalid-discord-id":
      return "❌ Підпис не зараховано: Discord не передав коректний профіль користувача. Спробуй натиснути кнопку ще раз." + suffix;
    case "profile-not-found":
      return "❌ Підпис не зараховано: профіль для твого Discord не знайдено. Увійди в панель через Discord, додай персонажа Battle.net і вибери main-персонажа." + suffix;
    default:
      return "❌ Підпис не зараховано: не вдалося перевірити профіль або main-персонажа. Увійди в панель через Discord, додай персонажа Battle.net і вибери main-персонажа." + suffix;
  }
}

async function recordRaidRulesSignup(env, guildId, userId, userLabel, profile) {
  const kv = getRulesStatsKv(env);
  const cleanGuildId = snowflake(guildId) || snowflake(env.DISCORD_GUILD_ID) || "global";
  const cleanUserId = snowflake(userId);
  if (!kv || !cleanUserId) return { skipped: true };

  const signedAt = new Date().toISOString();
  const signup = {
    discordId: cleanUserId,
    discordName: limitText(userLabel || profile?.displayName || "Discord user", 120, "Discord user"),
    profileId: profile?.profileId || null,
    mainCharacter: pickMainCharacter(profile?.mainCharacter),
    signedAt,
  };

  await kv.put(raidRulesKey(cleanGuildId, `user:${cleanUserId}`), JSON.stringify(signup));
  await kv.put(raidRulesKey(cleanGuildId, "updated_at"), signedAt);
  await invalidatePublicApiCache(env, { prefixes: ["worker:raid-rules-stats", "worker:raid-rules-signups"] })
    .catch((error) => logWorkerEvent("warn", "public_cache.raid_rules_invalidate_failed", { message: error?.message }));
  return { ok: true, signup };
}

async function getRaidRulesSignups(env, guildId) {
  const kv = getRulesStatsKv(env);
  if (!kv) {
    const hasBinding = hasRulesStatsBinding(env);
    return {
      configured: false,
      rules_type: "raid",
      namespace: "raid-rules",
      total: 0,
      updated_at: null,
      signups: [],
      source: hasBinding ? "invalid-binding" : "missing-kv-binding",
      message: hasBinding ? "RULES_STATS exists, but it is not a KV namespace binding." : "RULES_STATS KV binding is not configured.",
    };
  }

  const cleanGuildId = snowflake(guildId) || snowflake(env.DISCORD_GUILD_ID);
  const guildKey = cleanGuildId || "global";
  const prefix = raidRulesKey(guildKey, "user:");
  const keys = await listAllKvKeys(kv, prefix);
  const values = await Promise.all(keys.map(async (key) => {
    try {
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }));

  const signups = values
    .filter((item) => item && snowflake(item.discordId || item.discord_id))
    .map((item) => ({
      discordId: snowflake(item.discordId || item.discord_id),
      discordName: limitText(item.discordName || item.discord_name || "Discord user", 120, "Discord user"),
      profileId: item.profileId || item.profile_id || null,
      mainCharacter: pickMainCharacter(item.mainCharacter || item.main_character),
      signedAt: String(item.signedAt || item.signed_at || ""),
    }))
    .sort((a, b) => Date.parse(b.signedAt || "") - Date.parse(a.signedAt || ""));

  return {
    configured: true,
    guild_id: cleanGuildId || "global",
    rules_type: "raid",
    namespace: "raid-rules",
    total: signups.length,
    updated_at: await kv.get(raidRulesKey(guildKey, "updated_at")),
    stats: {
      signed: signups.length,
      total: signups.length,
    },
    signups,
    source: "kv",
  };
}

async function getRaidRulesStats(env, guildId) {
  const signups = await getRaidRulesSignups(env, guildId);
  return {
    configured: signups.configured,
    guild_id: signups.guild_id || snowflake(guildId) || snowflake(env.DISCORD_GUILD_ID) || "global",
    scope: "guild",
    rules_type: "raid",
    namespace: "raid-rules",
    signed: signups.total || 0,
    total: signups.total || 0,
    updated_at: signups.updated_at || null,
    source: signups.source,
    error: signups.error,
    message: signups.message,
  };
}

async function handleRaidRulesStats(request, env) {
  const access = await assertWorkerReadAccess(request, env, "raid_rules.stats");
  if (!access.ok) return access.response;
  const origin = access.origin;
  const url = new URL(request.url);
  const guildId = snowflake(url.searchParams.get("guild_id")) || snowflake(env.DISCORD_GUILD_ID);
  try {
    return json(await getRaidRulesStats(env, guildId), 200, origin);
  } catch (error) {
    logWorkerEvent("error", "raid_rules.stats.failed", { message: error?.message, guildId });
    return json({
      configured: hasValidRulesStatsBinding(env),
      guild_id: guildId || "global",
      rules_type: "raid",
      namespace: "raid-rules",
      signed: 0,
      total: 0,
      updated_at: null,
      source: hasRulesStatsBinding(env) ? "error" : "missing-kv-binding",
      error: error instanceof Error ? error.message : "Raid rules stats are unavailable.",
    }, 500, origin);
  }
}

async function handleRaidRulesSignups(request, env) {
  const access = await assertWorkerReadAccess(request, env, "raid_rules.signups");
  if (!access.ok) return access.response;
  const origin = access.origin;
  const url = new URL(request.url);
  const guildId = snowflake(url.searchParams.get("guild_id")) || snowflake(env.DISCORD_GUILD_ID);
  try {
    return json(await getRaidRulesSignups(env, guildId), 200, origin);
  } catch (error) {
    logWorkerEvent("error", "raid_rules.signups.failed", { message: error?.message, guildId });
    return json({
      configured: hasValidRulesStatsBinding(env),
      rules_type: "raid",
      namespace: "raid-rules",
      total: 0,
      updated_at: null,
      signups: [],
      source: hasRulesStatsBinding(env) ? "error" : "missing-kv-binding",
      error: error instanceof Error ? error.message : "Raid rules signups are unavailable.",
    }, 500, origin);
  }
}

async function readKvNumber(kv, key) {
  const value = await kv.get(key);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

async function writeKvNumber(kv, key, value) {
  await kv.put(key, String(Math.max(0, Math.floor(Number(value) || 0))));
}

async function listAllKvKeys(kv, prefix, maxKeys = 5000) {
  const keys = [];
  let cursor;

  do {
    const page = await kv.list({ prefix, cursor });
    for (const item of Array.isArray(page?.keys) ? page.keys : []) {
      if (item?.name) keys.push(String(item.name));
      if (keys.length >= maxKeys) return keys;
    }
    cursor = page?.list_complete ? undefined : page?.cursor;
  } while (cursor);

  return keys;
}

function maxIsoDate(values) {
  let latest = null;
  let latestTime = 0;

  for (const value of values) {
    const text = String(value || "").trim();
    const time = Date.parse(text);
    if (Number.isFinite(time) && time > latestTime) {
      latestTime = time;
      latest = text;
    }
  }

  return latest;
}

async function countRulesDecisionRecords(kv, guildId) {
  const cleanGuildId = snowflake(guildId) || "global";
  const keys = await listAllKvKeys(kv, rulesStatsKey(cleanGuildId, "user:"), 10000);
  const values = await Promise.all(keys.map((key) => kv.get(key).catch(() => null)));
  const accepted = values.filter((value) => value === "accepted").length;
  const declined = values.filter((value) => value === "declined").length;
  return { accepted, declined, total: accepted + declined, countedFromUsers: keys.length > 0 };
}

async function getAggregatedRulesStats(kv) {
  const keys = await listAllKvKeys(kv, "rules:");
  const acceptedKeys = keys.filter((key) => /^rules:(?:\d+|global):accepted$/.test(key));
  const declinedKeys = keys.filter((key) => /^rules:(?:\d+|global):declined$/.test(key));
  const updatedKeys = keys.filter((key) => /^rules:(?:\d+|global):updated_at$/.test(key));

  const [acceptedValues, declinedValues, updatedValues] = await Promise.all([
    Promise.all(acceptedKeys.map((key) => readKvNumber(kv, key))),
    Promise.all(declinedKeys.map((key) => readKvNumber(kv, key))),
    Promise.all(updatedKeys.map((key) => kv.get(key))),
  ]);

  const accepted = acceptedValues.reduce((sum, value) => sum + value, 0);
  const declined = declinedValues.reduce((sum, value) => sum + value, 0);

  return {
    configured: true,
    guild_id: "all",
    scope: "aggregate",
    rules_type: "guild",
    namespace: "rules",
    accepted,
    declined,
    total: accepted + declined,
    updated_at: maxIsoDate(updatedValues),
    source: "kv",
  };
}

async function getRulesStats(env, guildId) {
  const kv = getRulesStatsKv(env);
  if (!kv) {
    const hasBinding = hasRulesStatsBinding(env);
    return {
      configured: false,
      rules_type: "guild",
      namespace: "rules",
      accepted: 0,
      declined: 0,
      total: 0,
      updated_at: null,
      source: hasBinding ? "invalid-binding" : "missing-kv-binding",
      message: hasBinding
        ? "RULES_STATS exists, but it is not a KV namespace binding."
        : "RULES_STATS KV binding is not configured.",
    };
  }

  const cleanGuildId = snowflake(guildId) || snowflake(env.DISCORD_GUILD_ID);
  if (!cleanGuildId) {
    return getAggregatedRulesStats(kv);
  }

  const [recordCounts, counterAccepted, counterDeclined, updatedAt] = await Promise.all([
    countRulesDecisionRecords(kv, cleanGuildId),
    readKvNumber(kv, rulesStatsKey(cleanGuildId, "accepted")),
    readKvNumber(kv, rulesStatsKey(cleanGuildId, "declined")),
    kv.get(rulesStatsKey(cleanGuildId, "updated_at")),
  ]);

  const accepted = recordCounts.countedFromUsers ? recordCounts.accepted : counterAccepted;
  const declined = recordCounts.countedFromUsers ? recordCounts.declined : counterDeclined;

  return {
    configured: true,
    guild_id: cleanGuildId,
    scope: "guild",
    rules_type: "guild",
    namespace: "rules",
    accepted,
    declined,
    total: accepted + declined,
    updated_at: updatedAt || null,
    source: "kv",
    counted_from: recordCounts.countedFromUsers ? "user-records" : "counters",
  };
}

async function getRecordedRulesDecision(env, guildId, userId) {
  const kv = getRulesStatsKv(env);
  const cleanGuildId = snowflake(guildId) || snowflake(env.DISCORD_GUILD_ID);
  const cleanUserId = snowflake(userId);
  if (!kv || !cleanGuildId || !cleanUserId) return null;

  const value = await kv.get(rulesStatsKey(cleanGuildId, `user:${cleanUserId}`));
  return value === "accepted" || value === "declined" ? value : null;
}

async function recordRulesDecision(env, guildId, userId, action) {
  const kv = getRulesStatsKv(env);
  const cleanGuildId = snowflake(guildId) || snowflake(env.DISCORD_GUILD_ID) || "global";
  const cleanUserId = snowflake(userId);
  const normalizedAction = action === "declined" ? "declined" : "accepted";

  if (!kv || !cleanUserId) return { skipped: true };

  const userKey = rulesStatsKey(cleanGuildId, `user:${cleanUserId}`);
  const previous = await kv.get(userKey);

  if (previous === normalizedAction) {
    await kv.put(rulesStatsKey(cleanGuildId, "updated_at"), new Date().toISOString());
    return { ok: true, unchanged: true };
  }

  const targetKey = rulesStatsKey(cleanGuildId, normalizedAction);
  const targetCount = await readKvNumber(kv, targetKey);
  await writeKvNumber(kv, targetKey, targetCount + 1);

  if (previous === "accepted" || previous === "declined") {
    const previousKey = rulesStatsKey(cleanGuildId, previous);
    const previousCount = await readKvNumber(kv, previousKey);
    await writeKvNumber(kv, previousKey, previousCount - 1);
  }

  await kv.put(userKey, normalizedAction);
  await kv.put(rulesStatsKey(cleanGuildId, "updated_at"), new Date().toISOString());
  await invalidatePublicApiCache(env, { prefixes: ["worker:rules-stats"] }).catch((error) => logWorkerEvent("warn", "public_cache.rules_invalidate_failed", { message: error?.message }));

  return { ok: true };
}

async function handleRulesStats(request, env) {
  const access = await assertWorkerReadAccess(request, env, "rules.stats");
  if (!access.ok) return access.response;
  const origin = access.origin;
  const url = new URL(request.url);
  const guildId = snowflake(url.searchParams.get("guild_id")) || snowflake(env.DISCORD_GUILD_ID);
  const requestedType = String(url.searchParams.get("type") || url.searchParams.get("rules_type") || "guild").trim().toLowerCase();

  if (requestedType === "raid" || requestedType === "raid-rules") {
    return handleRaidRulesStats(request, env);
  }

  try {
    return json(await getRulesStats(env, guildId), 200, origin);
  } catch (error) {
    logWorkerEvent("error", "rules.stats.failed", { message: error?.message, guildId });
    return json(
      {
        configured: hasValidRulesStatsBinding(env),
        rules_type: "guild",
        namespace: "rules",
        accepted: 0,
        declined: 0,
        total: 0,
        updated_at: null,
        source: hasRulesStatsBinding(env) ? "error" : "missing-kv-binding",
        error: error instanceof Error ? error.message : "Rules stats are unavailable.",
      },
      500,
      origin
    );
  }
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = defaultAllowedOrigins(env);

  if (!origin) return configured[0] || "https://lihvodruida.pp.ua";
  return configured.includes(origin) ? origin : "";
}

function stripDiscordMarker(value) {
  return String(value || "")
    .replace(/<!--\s*mistblossom:discord[\s\S]*?-->/gi, "")
    .trim();
}

function cleanText(value, maxLength = 200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanMultilineText(value, maxLength = 400) {
  return String(value || "").trim().slice(0, maxLength);
}

function escapeDiscordMarkdown(value) {
  return String(value || "")
    .replace(/@/g, "@​")
    .replace(/([*_`~|>])/g, "\\$1")
    .trim();
}

function formatCopyableValue(value, fallback = "Не вказано") {
  const clean = escapeDiscordMarkdown(String(value || "").trim());
  return `\`${clean || fallback}\``;
}

function limitText(value, maxLength, fallback = "Не вказано") {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, maxLength);
}

function buildCharacterRealmTag(characterName, realm) {
  const character = cleanText(characterName, 60);
  const compactRealm = cleanText(realm, 60).replace(/\s+/g, "");
  return [character, compactRealm].filter(Boolean).join("-");
}

function composeSourceValue(sourceCreator, sourcePlatform, sourceOther, sourceFallback) {
  const creator = cleanText(sourceCreator, 80);
  const platform = cleanText(sourcePlatform, 40);
  const other = cleanText(sourceOther, 120);
  const fallback = cleanText(sourceFallback, 120);

  if (creator === "Інше") {
    return other ? `Інше — ${other}` : "";
  }

  if (creator && platform) {
    return `${creator} — ${platform}`;
  }

  return fallback;
}

function sanitizePayload(payload) {
  return {
    region: "eu",
    characterName: cleanText(payload.characterName, 60),
    faction: cleanText(payload.faction, 24),
    realm: cleanText(payload.realm, 60),
    className: cleanText(payload.className, 60),
    discord: cleanText(payload.discord, 80),
    battleTag: cleanText(payload.battleTag, 80),
    sourceCreator: cleanText(payload.sourceCreator, 80),
    sourcePlatform: cleanText(payload.sourcePlatform, 40),
    sourceOther: cleanText(payload.sourceOther, 120),
    source: composeSourceValue(
      payload.sourceCreator,
      payload.sourcePlatform,
      payload.sourceOther,
      payload.source
    ),
    availability: stripDiscordMarker(cleanMultilineText(stripDiscordMarker(payload.availability)), 400),
  };
}

function validateApplication(payload) {
  if (
    !payload.characterName ||
    !payload.faction ||
    !payload.realm ||
    !payload.availability
  ) {
    return "Будь ласка, заповни всі обов’язкові поля.";
  }

  const hasStructuredSource = !!payload.sourceCreator;

  if (hasStructuredSource) {
    if (payload.sourceCreator === "Інше" && !payload.sourceOther) {
      return "Вкажи, звідки саме ти дізнався про нас.";
    }

    if (payload.sourceCreator !== "Інше" && !payload.sourcePlatform) {
      return "Будь ласка, обери платформу.";
    }
  }

  const battleTagFormat = /^[\p{L}\p{N}_-]{2,32}#\d{3,6}$/u;
  if (payload.faction.toLowerCase() === "horde" && !payload.battleTag) {
    return "Для фракції Horde поле BattleTag є обов’язковим.";
  }

  if (payload.battleTag && !battleTagFormat.test(payload.battleTag)) {
    return "BattleTag має бути у форматі Rebell#2802 або порожнім, якщо це не Horde.";
  }

  return null;
}

function buildIssueBody(payload) {
  return [
    "### Персонаж",
    `- Регіон: ${payload.region}`,
    `- Ім’я персонажа: ${payload.characterName}`,
    `- Фракція: ${payload.faction}`,
    `- Реалм: ${payload.realm}`,
    `- Клас: ${payload.className || "Не вказано"}`,
    "",
    "### Контакти",
    `- Discord: ${payload.discord || "Не вказано"}`,
    `- BattleTag: ${payload.battleTag || "Не вказано"}`,
    `- Звідки дізнався: ${payload.source || "Не вказано"}`,
    "",
    "### Коли зазвичай грає",
    payload.availability,
  ].join("\n");
}

function extractApplicationDetails(body) {
  const text = String(body || "");
  const read = (pattern) => cleanText((text.match(pattern) || [])[1] || "", 120);

  return {
    region: read(/- Регіон: (.+)/),
    faction: read(/- Фракція: (.+)/),
    character: read(/- Ім’я персонажа: (.+)/),
    realm: read(/- Реалм: (.+)/),
    class_name: read(/- Клас: (.+)/),
  };
}

function extractSummary(body) {
  const details = extractApplicationDetails(body);
  return [details.character, details.realm, details.region, details.faction, details.class_name]
    .filter(Boolean)
    .join(" • ");
}

function normalizeLabels(issue) {
  return Array.isArray(issue?.labels)
    ? issue.labels.map((label) => String(typeof label === "string" ? label : label?.name || "").toLowerCase())
    : [];
}

function getIssueStatusKey(issue) {
  const labels = normalizeLabels(issue);

  if (labels.includes("status:accepted") || labels.includes("statusaccepted") || labels.includes("status:approved") || labels.includes("statusapproved")) {
    return STATUS.ACCEPTED.key;
  }
  if (labels.includes("status:declined") || labels.includes("statusdeclined") || labels.includes("status:rejected") || labels.includes("statusrejected")) {
    return STATUS.DECLINED.key;
  }

  return STATUS.REVIEW.key;
}

function getIssueStatus(issue) {
  const key = getIssueStatusKey(issue);
  return Object.values(STATUS).find((status) => status.key === key)?.label || STATUS.REVIEW.label;
}

function resolveDiscordColor(statusText) {
  const status = Object.values(STATUS).find((item) => item.label === statusText);
  return status?.color || STATUS.REVIEW.color;
}

function slugifyRaiderIoValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function hasPositiveScore(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function formatMPlusSection(seasonData) {
  if (!seasonData || typeof seasonData !== "object" || !seasonData.scores) {
    return "Дані відсутні";
  }

  const scores = seasonData.scores;
  const lines = [];

  if (hasPositiveScore(scores.all)) {
    lines.push(`**Raider.IO M+:** ${formatScore(scores.all)}`);
  }
  if (hasPositiveScore(scores.tank)) {
    lines.push(`**Танк:** ${formatScore(scores.tank)}`);
  }
  if (hasPositiveScore(scores.healer)) {
    lines.push(`**Хіл:** ${formatScore(scores.healer)}`);
  }
  if (hasPositiveScore(scores.dps)) {
    lines.push(`**DPS:** ${formatScore(scores.dps)}`);
  }

  return lines.length ? lines.join("\n") : "Дані відсутні";
}

function prettifyRaidKey(key) {
  return String(key || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasRaidProgressData(raid) {
  if (!raid || typeof raid !== "object") return false;
  if (cleanText(raid.summary, 80)) return true;

  return (
    Number(raid.normal_bosses_killed || 0) > 0 ||
    Number(raid.heroic_bosses_killed || 0) > 0 ||
    Number(raid.mythic_bosses_killed || 0) > 0
  );
}

function formatRaidSummary(raid) {
  const summary = cleanText(raid?.summary, 80);
  if (summary) return summary;

  const total = Number(raid?.total_bosses || 0);
  const normal = Number(raid?.normal_bosses_killed || 0);
  const heroic = Number(raid?.heroic_bosses_killed || 0);
  const mythic = Number(raid?.mythic_bosses_killed || 0);

  const parts = [];
  if (mythic > 0) parts.push(`${mythic}/${total || "?"} M`);
  if (heroic > 0) parts.push(`${heroic}/${total || "?"} H`);
  if (normal > 0) parts.push(`${normal}/${total || "?"} N`);

  return parts.join(" • ");
}

function splitRaidProgressionByExpansion(raidProgression) {
  const entries = Object.entries(raidProgression || {}).map(([key, value]) => ({
    key,
    ...(value || {}),
  }));

  const withExpansion = entries.filter((item) => Number.isFinite(Number(item.expansion_id)));
  const withoutExpansion = entries.filter((item) => !Number.isFinite(Number(item.expansion_id)));

  if (!withExpansion.length) {
    return {
      current: entries,
      previous: [],
    };
  }

  const grouped = new Map();

  for (const raid of withExpansion) {
    const expansionId = Number(raid.expansion_id);
    if (!grouped.has(expansionId)) {
      grouped.set(expansionId, []);
    }
    grouped.get(expansionId).push(raid);
  }

  const expansionIds = Array.from(grouped.keys()).sort((a, b) => b - a);
  const current = expansionIds.length ? [...(grouped.get(expansionIds[0]) || []), ...withoutExpansion] : withoutExpansion;

  return {
    current,
    previous: expansionIds.length > 1 ? grouped.get(expansionIds[1]) || [] : [],
  };
}

function formatRaidSection(raids) {
  const usefulRaids = (Array.isArray(raids) ? raids : []).filter(hasRaidProgressData);

  if (!usefulRaids.length) {
    return "Дані відсутні";
  }

  return usefulRaids
    .slice(0, 8)
    .map((raid) => {
      const summary = formatRaidSummary(raid);
      const name = prettifyRaidKey(raid.key);
      return summary ? `• **${name}:** ${summary}` : `• **${name}:** Дані відсутні`;
    })
    .join("\n");
}

async function fetchRaiderIoProfile(payload) {
  const startedAt = nowMs();
  const region = cleanText(payload.region, 8).toLowerCase();
  const realmSlug = slugifyRaiderIoValue(payload.realm);
  const characterSlug = slugifyRaiderIoValue(payload.characterName);

  if (!region || !realmSlug || !characterSlug) {
    logWorkerEvent("warn", "raiderio.profile.invalid_params", { region, realmSlug, characterSlug, ms: elapsedMs(startedAt) });
    return {
      ok: false,
      error: "Не вдалося підготувати параметри Raider.IO.",
    };
  }

  const url = new URL("https://raider.io/api/v1/characters/profile");
  url.searchParams.set("region", region);
  url.searchParams.set("realm", realmSlug);
  url.searchParams.set("name", characterSlug);
  url.searchParams.set(
    "fields",
    "mythic_plus_scores_by_season:current:previous,raid_progression:current-expansion:previous-expansion"
  );

  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
      },
    });

    const raw = await response.text();
    let data = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const apiMessage =
        cleanText(data?.message || data?.error || "", 160) ||
        `HTTP ${response.status}`;
      logWorkerEvent("warn", "raiderio.profile.failed", {
        status: response.status,
        message: apiMessage,
        region,
        realmSlug,
        characterSlug,
        ms: elapsedMs(startedAt),
      });
      return {
        ok: false,
        error: `Не вдалося отримати дані Raider.IO: ${apiMessage}.`,
      };
    }

    logWorkerEvent("info", "raiderio.profile.ok", { region, realmSlug, characterSlug, ms: elapsedMs(startedAt) });
    return { ok: true, data };
  } catch (error) {
    logWorkerEvent("warn", "raiderio.profile.exception", {
      message: error?.message,
      region,
      realmSlug,
      characterSlug,
      ms: elapsedMs(startedAt),
    });
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Не вдалося отримати дані Raider.IO: ${error.message}`
          : "Не вдалося отримати дані Raider.IO.",
    };
  }
}


function battleNetClient(env) {
  const clientId = String(env.BATTLENET_CLIENT_ID || env.BATTLE_NET_CLIENT_ID || env.BLIZZARD_CLIENT_ID || "").trim();
  const clientSecret = String(env.BATTLENET_CLIENT_SECRET || env.BATTLE_NET_CLIENT_SECRET || env.BLIZZARD_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret, ok: Boolean(clientId && clientSecret) };
}

function battleNetSlug(value) {
  return String(value || "")
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

async function getBattleNetAccessToken(env, region = "eu") {
  const { clientId, clientSecret, ok } = battleNetClient(env);
  if (!ok) return { ok: false, error: "Battle.net API не налаштовано." };
  const normalizedRegion = cleanText(region, 8).toLowerCase() || "eu";
  if (battleNetAuthCache.accessToken && battleNetAuthCache.region === normalizedRegion && battleNetAuthCache.expiresAt > Date.now() + 60_000) {
    return { ok: true, accessToken: battleNetAuthCache.accessToken };
  }
  const response = await fetch(`https://${normalizedRegion}.battle.net/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    return { ok: false, error: data?.error_description || data?.error || `Battle.net auth HTTP ${response.status}` };
  }
  battleNetAuthCache = {
    accessToken: data.access_token,
    region: normalizedRegion,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return { ok: true, accessToken: battleNetAuthCache.accessToken };
}

async function fetchBattleNetCharacterProfile(env, payload) {
  const startedAt = nowMs();
  const region = cleanText(payload.region || "eu", 8).toLowerCase() || "eu";
  const realmSlug = battleNetSlug(payload.realm);
  const characterSlug = battleNetSlug(payload.characterName);
  if (!realmSlug || !characterSlug) {
    return { ok: false, error: "Не вистачає імені персонажа або реалму для Battle.net." };
  }
  const token = await getBattleNetAccessToken(env, region);
  if (!token.ok) return token;
  const locale = cleanText(env.BATTLENET_LOCALE || env.BATTLE_NET_LOCALE || env.BLIZZARD_LOCALE || "en_GB", 16) || "en_GB";
  const url = `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(characterSlug)}?namespace=profile-${region}&locale=${encodeURIComponent(locale)}`;
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token.accessToken}`, accept: "application/json" },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = cleanText(data?.detail || data?.message || data?.reason || "", 160) || `HTTP ${response.status}`;
      logWorkerEvent("warn", "battlenet.character.failed", { status: response.status, message, region, realmSlug, characterSlug, ms: elapsedMs(startedAt) });
      return { ok: false, error: `Battle.net: ${message}.` };
    }
    logWorkerEvent("info", "battlenet.character.ok", { region, realmSlug, characterSlug, ms: elapsedMs(startedAt) });
    return { ok: true, data: { id: data?.id || null, name: data?.name || payload.characterName, realm: data?.realm?.slug || realmSlug, level: data?.level || null } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `Battle.net: ${error.message}` : "Battle.net не відповів." };
  }
}

async function verifyApplicationCharacter(env, payload) {
  const [raiderIo, battlenet] = await Promise.all([
    fetchRaiderIoProfile(payload),
    fetchBattleNetCharacterProfile(env, payload),
  ]);
  if (raiderIo.ok || battlenet.ok) {
    return { ok: true, raider_io: raiderIo, battlenet };
  }
  const errors = [raiderIo.error, battlenet.error].filter(Boolean).join(" ");
  return {
    ok: false,
    raider_io: raiderIo,
    battlenet,
    error: `Персонажа ${payload.characterName}-${payload.realm} в EU не підтверджено через Raider.IO або Battle.net. ${errors}`.trim(),
  };
}

function buildRaiderIoEmbedFields(raiderIoResult) {
  if (!raiderIoResult?.ok) {
    const errorText = limitText(
      raiderIoResult?.error || "Не вдалося отримати дані Raider.IO.",
      1024,
      "Не вдалося отримати дані Raider.IO."
    );

    return [
      {
        name: "Raider.IO • Mythic+ (current)",
        value: errorText,
        inline: false,
      },
      {
        name: "Raider.IO • Mythic+ (previous)",
        value: errorText,
        inline: false,
      },
      {
        name: "Raider.IO • Рейди (current expansion)",
        value: errorText,
        inline: false,
      },
      {
        name: "Raider.IO • Рейди (previous expansion)",
        value: errorText,
        inline: false,
      },
    ];
  }

  const data = raiderIoResult.data || {};
  const seasons = Array.isArray(data.mythic_plus_scores_by_season)
    ? data.mythic_plus_scores_by_season
    : [];
  const currentSeason = seasons[0] || null;
  const previousSeason = seasons[1] || null;

  const raidGroups = splitRaidProgressionByExpansion(data.raid_progression);

  return [
    {
      name: "Raider.IO • Mythic+ (current)",
      value: limitText(formatMPlusSection(currentSeason), 1024, "Дані відсутні"),
      inline: false,
    },
    {
      name: "Raider.IO • Mythic+ (previous)",
      value: limitText(formatMPlusSection(previousSeason), 1024, "Дані відсутні"),
      inline: false,
    },
    {
      name: "Raider.IO • Рейди (current expansion)",
      value: limitText(formatRaidSection(raidGroups.current), 1024, "Дані відсутні"),
      inline: false,
    },
    {
      name: "Raider.IO • Рейди (previous expansion)",
      value: limitText(formatRaidSection(raidGroups.previous), 1024, "Дані відсутні"),
      inline: false,
    },
  ];
}

function buildDiscordEmbeds(payload, issue, env, raiderIoResult) {
  const statusText = getIssueStatus(issue);
  const issueUrl = issue?.html_url ? String(issue.html_url) : "";
  const characterTag =
    buildCharacterRealmTag(payload.characterName, payload.realm) || payload.characterName;

  const applicationNumber = issue?.number || issue?.application_number || "";
  const trackingNumber = issue?.tracking_number || "";
  const description = [
    applicationNumber ? `**Заявка:** #${escapeDiscordMarkdown(applicationNumber)}` : "",
    trackingNumber ? `**Номер відстеження:** ${escapeDiscordMarkdown(trackingNumber)}` : "",
    `**Статус:** ${escapeDiscordMarkdown(statusText)}`,
    issueUrl ? `**Заявка:** ${issueUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4096);

  return [
    {
      title: limitText(`Нова заявка #${applicationNumber || "—"} • ${characterTag}`, 256, "Нова заявка до гільдії"),
      description,
      color: resolveDiscordColor(statusText),
      fields: [
        {
          name: "Дані про персонажа",
          value: limitText(
            [
              `**Ім’я персонажа:** ${formatCopyableValue(characterTag)}`,
              `**Регіон:** ${formatCopyableValue(payload.region)}`,
              `**Фракція:** ${escapeDiscordMarkdown(payload.faction || "Не вказано")}`,
              `**Реалм:** ${escapeDiscordMarkdown(payload.realm || "Не вказано")}`,
              `**Клас:** ${escapeDiscordMarkdown(payload.className || "Не вказано")}`,
            ].join("\n"),
            1024
          ),
          inline: false,
        },
        {
          name: "Контакти",
          value: limitText(
            [
              `**Discord:** ${formatCopyableValue(payload.discord)}`,
              `**BattleTag:** ${formatCopyableValue(payload.battleTag)}`,
            ].join("\n"),
            1024
          ),
          inline: false,
        },
        {
          name: "Додатково",
          value: limitText(
            `**Звідки дізнався:** ${escapeDiscordMarkdown(payload.source || "Не вказано")}`,
            1024
          ),
          inline: false,
        },
        {
          name: "Коли зазвичай грає",
          value: limitText(
            escapeDiscordMarkdown(payload.availability || "Не вказано"),
            1024
          ),
          inline: false,
        },
        ...buildRaiderIoEmbedFields(raiderIoResult),
      ],
      footer: {
        text: limitText(env.DISCORD_GUILD_NAME || "Mistblossom Vanguard", 2048),
      },
      timestamp: new Date().toISOString(),
    },
  ];
}


function hexToBytes(hex) {
  const clean = String(hex || "").trim();
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) return new Uint8Array();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

async function verifyDiscordRequest(request, env, rawBody) {
  const publicKey = String(env.DISCORD_PUBLIC_KEY || "").trim();
  if (!publicKey) return false;

  const signature = request.headers.get("X-Signature-Ed25519") || "";
  const timestamp = request.headers.get("X-Signature-Timestamp") || "";
  if (!signature || !timestamp) return false;

  const timestampMs = Number(timestamp) * 1000;
  const skewMs = Math.abs(Date.now() - timestampMs);
  if (!Number.isFinite(timestampMs) || skewMs > 5 * 60 * 1000) {
    logWorkerEvent("warn", "discord.signature.timestamp_rejected", { skewMs });
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );

    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody)
    );
  } catch {
    return false;
  }
}

function discordInteractionResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function buildApplicationButtons(issueNumber) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: "Прийняти",
          custom_id: `guild_application:accepted:${issueNumber}`,
        },
        {
          type: 2,
          style: 4,
          label: "Відхилити",
          custom_id: `guild_application:declined:${issueNumber}`,
        },
      ],
    },
  ];
}

function getDiscordUserLabel(interaction) {
  const user = interaction?.member?.user || interaction?.user || {};
  return user.global_name || user.username || user.id || "Discord moderator";
}


function getStatusByKey(statusKey) {
  return Object.values(STATUS).find((item) => item.key === statusKey) || STATUS.REVIEW;
}

function getStatusIcon(statusKey) {
  if (statusKey === STATUS.ACCEPTED.key) return "🟢";
  if (statusKey === STATUS.DECLINED.key) return "🔴";
  return "🟡";
}

function buildStatusUpdateContent(issueNumber, statusKey, moderator) {
  const status = getStatusByKey(statusKey);
  const icon = getStatusIcon(statusKey);
  const moderatorLabel = escapeDiscordMarkdown(limitText(moderator, 80, "Discord moderator"));

  return [
    `📋 **Заявка #${issueNumber} оновлена**`,
    `> Статус: ${icon} **${status.label}**`,
    `> Модератор: 👤 **${moderatorLabel}**`,
    `> Firebase-заявка: 🔒 **закрито**`,
  ].join("\n");
}

function updateEmbedDescriptionStatus(description, statusKey) {
  const status = getStatusByKey(statusKey);
  const icon = getStatusIcon(statusKey);
  const statusLine = `**Статус:** ${icon} ${status.label}`;
  const text = String(description || "").trim();

  if (!text) return statusLine;

  if (/\*\*Статус:\*\*[^\n]*/.test(text)) {
    return text.replace(/\*\*Статус:\*\*[^\n]*/, statusLine);
  }

  return [statusLine, text].join("\n");
}

function buildUpdatedApplicationEmbeds(interaction, statusKey, issueNumber, moderator, env) {
  const status = getStatusByKey(statusKey);
  const embeds = Array.isArray(interaction?.message?.embeds)
    ? interaction.message.embeds.map((embed) => ({ ...embed }))
    : [];

  const primaryEmbed = embeds[0] || {
    title: `Заявка #${issueNumber}`,
    description: "",
    fields: [],
  };

  primaryEmbed.color = status.color;
  primaryEmbed.description = updateEmbedDescriptionStatus(primaryEmbed.description, statusKey);
  primaryEmbed.footer = {
    text: limitText(
      `${env.DISCORD_GUILD_NAME || "Mistblossom Vanguard"} • Оновив: ${moderator}`,
      2048
    ),
  };
  primaryEmbed.timestamp = new Date().toISOString();

  embeds[0] = primaryEmbed;

  return embeds.slice(0, 10);
}


function discordRouteKey(path, method) {
  return `${String(method || "GET").toUpperCase()}:${String(path || "")}`
    .replace(/\/\d{16,25}/g, "/:id")
    .replace(/[?&](?:limit|before|after|around)=[^&]+/g, "")
    .slice(0, 180);
}

function discordRetryAfterMs(response, json, attempt) {
  const raw = Number(json?.retry_after ?? response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset-after") ?? 0);
  const normalized = Number.isFinite(raw) && raw > 0 ? (raw > 50 ? raw : raw * 1000) : 800 + attempt * 650;
  return Math.max(500, Math.min(20_000, Math.floor(normalized + Math.random() * 300)));
}

function shouldRetryDiscordStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function waitForDiscordRoute(routeKey) {
  const until = discordRouteCooldowns.get(routeKey) || 0;
  const delay = until - Date.now();
  if (delay > 0) await sleep(Math.min(delay, 15_000));
}

async function discordApiFetch(env, path, init = {}) {
  const startedAt = nowMs();
  const method = String(init.method || "GET").toUpperCase();
  const routeKey = discordRouteKey(path, method);
  const maxAttempts = method === "GET" ? 4 : 5;
  const timeout = timeoutMs(env.DISCORD_API_TIMEOUT_MS, method === "GET" ? 10_000 : 14_000, 2_000, 45_000);

  let lastResponse = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForDiscordRoute(routeKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`https://discord.com/api/v10${path}`, {
        ...init,
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8",
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      lastResponse = response;

      if (String(env.DEBUG_LOGS || "").trim() === "1" || !response.ok) {
        logWorkerEvent(response.ok ? "info" : "warn", "discord.fetch", {
          method,
          path: sanitizeApiPathForLog(path),
          status: response.status,
          ok: response.ok,
          attempt: attempt + 1,
          ms: elapsedMs(startedAt),
        });
      }

      if (response.status === 429) {
        const raw = await response.clone().text().catch(() => "");
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        const delay = discordRetryAfterMs(response, json, attempt);
        discordRouteCooldowns.set(routeKey, Date.now() + delay);
        if (attempt < maxAttempts - 1) {
          await sleep(delay);
          continue;
        }
      } else if (shouldRetryDiscordStatus(response.status) && attempt < maxAttempts - 1) {
        await sleep(discordRetryAfterMs(response, null, attempt));
        continue;
      }

      return response;
    } catch (error) {
      if ((error?.name === "AbortError" || /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || error))) && attempt < maxAttempts - 1) {
        await sleep(500 + attempt * 650);
        continue;
      }
      logWorkerEvent("warn", "discord.fetch.exception", { method, path: sanitizeApiPathForLog(path), message: error?.message || String(error), ms: elapsedMs(startedAt) });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return lastResponse || new Response(JSON.stringify({ message: "Discord API failed" }), { status: 503 });
}

function discordRaidMessageTokens(env) {
  return Array.from(new Set([
    env.DISCORD_RULES_STATS_TOKEN,
    env.INTERNAL_PROFILE_LOOKUP_TOKEN,
    env.WORKER_STATS_TOKEN,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

async function verifyAnyBearerOrStatsToken(request, expectedTokens) {
  const tokens = Array.isArray(expectedTokens) ? expectedTokens.filter(Boolean) : [];
  if (!tokens.length) return true;
  for (const token of tokens) {
    if (await verifyBearerOrStatsToken(request, token)) return true;
  }
  return false;
}

function safeDiscordButton(button) {
  if (!button || typeof button !== "object" || Array.isArray(button)) return null;
  const type = Number(button.type);
  const style = Number(button.style);
  if (type !== 2 || ![1, 2, 3, 4, 5].includes(style)) return null;

  const safe = {
    type: 2,
    style,
    label: limitText(button.label, 80, "Дія"),
  };

  if (style === 5) {
    try {
      const parsed = new URL(String(button.url || ""));
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
      safe.url = parsed.toString();
    } catch {
      return null;
    }
  } else {
    const customId = String(button.custom_id || button.customId || "").trim().slice(0, 100);
    if (!customId) return null;
    safe.custom_id = customId;
    if (typeof button.disabled === "boolean") safe.disabled = button.disabled;
  }

  return safe;
}

function safeDiscordStringSelect(select) {
  if (!select || typeof select !== "object" || Array.isArray(select) || Number(select.type) !== 3) return null;
  const customId = String(select.custom_id || select.customId || "").trim().slice(0, 100);
  if (!customId) return null;

  const seenValues = new Set();
  const rawOptions = Array.isArray(select.options) ? select.options : [];
  const options = [];
  for (const option of rawOptions) {
    if (options.length >= 25) break;
    if (!option || typeof option !== "object" || Array.isArray(option)) continue;
    const label = limitText(option.label, 100, "Персонаж");
    const value = String(option.value || "").trim().slice(0, 100);
    if (!value || seenValues.has(value)) continue;
    seenValues.add(value);
    const safe = { label, value };
    const description = String(option.description || "").trim();
    if (description) safe.description = limitText(description, 100, "");
    if (option.default === true) safe.default = true;
    options.push(safe);
  }
  if (!options.length) return null;

  const requestedMin = Number(select.min_values ?? select.minValues ?? 1);
  const requestedMax = Number(select.max_values ?? select.maxValues ?? 1);
  const maxValues = Number.isFinite(requestedMax)
    ? Math.max(1, Math.min(options.length, 25, Math.floor(requestedMax)))
    : 1;
  const minValues = Number.isFinite(requestedMin)
    ? Math.max(0, Math.min(maxValues, Math.floor(requestedMin)))
    : Math.min(1, maxValues);

  let defaults = 0;
  for (const option of options) {
    if (option.default !== true) continue;
    if (defaults < maxValues) defaults += 1;
    else delete option.default;
  }

  const safe = {
    type: 3,
    custom_id: customId,
    options,
    placeholder: limitText(select.placeholder, 100, "Вибери персонажа"),
    min_values: minValues,
    max_values: maxValues,
  };
  if (typeof select.disabled === "boolean") safe.disabled = select.disabled;
  return safe;
}

function safeDiscordMessageComponent(component) {
  return safeDiscordButton(component) || safeDiscordStringSelect(component);
}

function safeDiscordComponents(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 5)
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row) || Number(row.type) !== 1) return null;
      const components = Array.isArray(row.components)
        ? row.components.map(safeDiscordMessageComponent).filter(Boolean).slice(0, 5)
        : [];
      return components.length ? { type: 1, components } : null;
    })
    .filter(Boolean);
}

function relaxedDiscordComponentsForPatch(value) {
  const rows = safeDiscordComponents(value);
  if (!rows.length) return [];

  return rows
    .map((row) => {
      const components = [];
      for (const component of row.components || []) {
        if (!component || typeof component !== "object") continue;

        if (Number(component.type) === 3) {
          const options = Array.isArray(component.options)
            ? component.options
                .map((option) => {
                  if (!option || typeof option !== "object") return null;
                  const cleaned = {
                    label: limitText(option.label, 100, "Варіант"),
                    value: String(option.value || "").trim().slice(0, 100),
                  };
                  if (!cleaned.value) return null;
                  const description = String(option.description || "").trim();
                  if (description) cleaned.description = limitText(description, 100, "");
                  return cleaned;
                })
                .filter(Boolean)
                .slice(0, 25)
            : [];
          if (!options.length) continue;

          components.push({
            type: 3,
            custom_id: String(component.custom_id || "").trim().slice(0, 100),
            placeholder: limitText(component.placeholder, 100, "Зроби вибір"),
            min_values: Math.min(1, options.length),
            max_values: 1,
            options,
          });
          continue;
        }

        if (Number(component.type) === 2) {
          // Link buttons and disabled page-indicators are the least important controls
          // and are the first candidates to trigger Discord validation edge-cases.
          if (Number(component.style) === 5 || component.disabled === true) continue;
          const customId = String(component.custom_id || "").trim().slice(0, 100);
          if (!customId) continue;
          components.push({
            type: 2,
            style: [1, 2, 3, 4].includes(Number(component.style)) ? Number(component.style) : 2,
            label: limitText(component.label, 80, "Дія"),
            custom_id: customId,
          });
        }
      }
      return components.length ? { type: 1, components: components.slice(0, 5) } : null;
    })
    .filter(Boolean)
    .slice(0, 5);
}

function cleanSnowflakeIds(values, max = 50) {
  const list = Array.isArray(values) ? values : [values];
  return Array.from(new Set(list.map(snowflake).filter(Boolean))).slice(0, max);
}

function safeAllowedMentions(body) {
  const roles = cleanSnowflakeIds([
    ...(Array.isArray(body?.mentionRoleIds) ? body.mentionRoleIds : []),
    ...(Array.isArray(body?.mention_role_ids) ? body.mention_role_ids : []),
    ...(Array.isArray(body?.allowed_mentions?.roles) ? body.allowed_mentions.roles : []),
  ], 25);

  return roles.length ? { parse: [], roles } : { parse: [] };
}

function safeDiscordEmbed(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const embed = { ...value };
  if (Array.isArray(embed.fields)) embed.fields = embed.fields.slice(0, 25);
  return embed;
}

async function handleRaidDiscordMessageRelay(request, env) {
  const origin = allowedOrigin(request, env) || "null";
  const expectedTokens = discordRaidMessageTokens(env);
  if (!expectedTokens.length || !(await verifyAnyBearerOrStatsToken(request, expectedTokens))) {
    logWorkerEvent("warn", "raid_message.relay.denied", { hasToken: expectedTokens.length > 0 });
    return json({ ok: false, error: "Forbidden" }, 403, origin);
  }

  if (!env.DISCORD_BOT_TOKEN) {
    logWorkerEvent("error", "raid_message.relay.bot_missing");
    return json({ ok: false, error: "DISCORD_BOT_TOKEN is missing in Worker." }, 500, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400, origin);
  }

  const action = String(body?.action || "create").trim().toLowerCase();
  const channelId = snowflake(body?.channelId || body?.channel_id);
  const messageId = snowflake(body?.messageId || body?.message_id);
  const embed = safeDiscordEmbed(body?.embed);
  if (!channelId) return json({ ok: false, error: "Discord channelId is invalid." }, 400, origin);
  if ((action === "edit" || action === "delete") && !messageId) return json({ ok: false, error: "Discord messageId is invalid." }, 400, origin);

  if (action === "delete") {
    const response = await discordApiFetch(env, `/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
    const raw = await response.text().catch(() => "");
    if (!response.ok && response.status !== 404) {
      logWorkerEvent("warn", "raid_message.relay.discord_failed", { action, channelId, messageId, status: response.status, raw: raw.slice(0, 220) });
      return json({ ok: false, error: raw || `Discord API ${response.status}` }, response.status, origin);
    }
    logWorkerEvent("info", "raid_message.relay.done", { action, channelId, messageId });
    return json({ ok: true, deleted: true, channel_id: channelId, id: messageId }, 200, origin);
  }

  if (!embed) return json({ ok: false, error: "Discord embed is invalid." }, 400, origin);

  const payload = {
    content: limitText(body?.content || "", 2000, ""),
    embeds: [embed],
    components: safeDiscordComponents(body?.components),
    allowed_mentions: safeAllowedMentions(body),
  };

  const path = action === "edit"
    ? `/channels/${channelId}/messages/${messageId}`
    : `/channels/${channelId}/messages`;

  const response = await discordApiFetch(env, path, {
    method: action === "edit" ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });

  const raw = await response.text().catch(() => "");
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

  if (!response.ok || !data) {
    logWorkerEvent("warn", "raid_message.relay.discord_failed", { action, channelId, messageId, status: response.status, raw: raw.slice(0, 220) });
    return json({ ok: false, error: data?.message || raw || `Discord API ${response.status}` }, response.ok ? 500 : response.status, origin);
  }

  logWorkerEvent("info", "raid_message.relay.done", { action, channelId, messageId: data.id || messageId });
  return json(data, 200, origin);
}

async function handleDiscordGuildChannels(request, env) {
  const origin = allowedOrigin(request, env) || "null";
  const expectedTokens = discordRaidMessageTokens(env);
  if (!expectedTokens.length || !(await verifyAnyBearerOrStatsToken(request, expectedTokens))) {
    logWorkerEvent("warn", "discord_channels.denied", { hasToken: expectedTokens.length > 0 });
    return json({ ok: false, error: "Forbidden" }, 403, origin);
  }

  if (!env.DISCORD_BOT_TOKEN) {
    logWorkerEvent("error", "discord_channels.bot_missing");
    return json({ ok: false, error: "DISCORD_BOT_TOKEN is missing in Worker." }, 500, origin);
  }

  const url = new URL(request.url);
  const guildId = snowflake(
    url.searchParams.get("guild_id") ||
    url.searchParams.get("guildId") ||
    env.DISCORD_GUILD_ID ||
    env.DISCORD_SERVER_ID ||
    env.GUILD_ID ||
    ""
  );
  const fallbackChannelId = snowflake(
    env.DISCORD_RAID_CHANNEL_ID ||
    env.RAID_DISCORD_CHANNEL_ID ||
    env.DISCORD_CHANNEL_ID ||
    env.GUILD_APPLICATIONS_DISCORD_CHANNEL_ID ||
    ""
  );
  const fallbackChannels = (warning = "") => ({
    ok: true,
    guild: guildId ? { id: guildId, name: "Discord guild", rules_channel_id: null } : null,
    channels: fallbackChannelId ? [{ id: fallbackChannelId, name: "канал за замовчуванням", type: 0, position: 0, parent_id: null }] : [],
    suggestedChannelId: fallbackChannelId || "",
    suggestedRulesChannelId: fallbackChannelId || "",
    warning: warning || null,
  });

  if (!guildId) {
    logWorkerEvent("error", "discord_channels.guild_missing");
    if (fallbackChannelId) return json(fallbackChannels("DISCORD_GUILD_ID is missing in Worker; returned fallback channel."), 200, origin);
    return json({ ok: false, error: "DISCORD_GUILD_ID is missing in Worker." }, 500, origin);
  }

  const [guildResponse, channelsResponse] = await Promise.all([
    discordApiFetch(env, `/guilds/${guildId}`, { method: "GET" }),
    discordApiFetch(env, `/guilds/${guildId}/channels`, { method: "GET" }),
  ]);

  const guildRaw = await guildResponse.text().catch(() => "");
  const channelsRaw = await channelsResponse.text().catch(() => "");
  let guild = null;
  let channels = null;
  try { guild = guildRaw ? JSON.parse(guildRaw) : null; } catch { guild = null; }
  try { channels = channelsRaw ? JSON.parse(channelsRaw) : null; } catch { channels = null; }

  if (!channelsResponse.ok || !Array.isArray(channels)) {
    logWorkerEvent("warn", "discord_channels.fetch_failed", {
      guildStatus: guildResponse.status,
      channelsStatus: channelsResponse.status,
      guildRaw: guildRaw.slice(0, 160),
      channelsRaw: channelsRaw.slice(0, 160),
      hasFallbackChannel: Boolean(fallbackChannelId),
    });
    if (fallbackChannelId) return json(fallbackChannels("Не вдалося отримати список Discord-каналів; повернуто fallback-канал."), 200, origin);
    return json({ ok: false, error: "Не вдалося отримати список Discord-каналів." }, 500, origin);
  }

  if (!guildResponse.ok) {
    logWorkerEvent("warn", "discord_channels.guild_fetch_failed", {
      guildStatus: guildResponse.status,
      guildRaw: guildRaw.slice(0, 160),
    });
    guild = null;
  }

  const textChannels = channels
    .filter((channel) => channel && (channel.type === 0 || channel.type === 5))
    .map((channel) => ({
      id: String(channel.id || ""),
      name: String(channel.name || "channel"),
      type: Number(channel.type || 0),
      position: Number(channel.position || 0),
      parent_id: channel.parent_id ? String(channel.parent_id) : null,
    }))
    .filter((channel) => snowflake(channel.id))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "uk"));

  if (!textChannels.length && fallbackChannelId) {
    return json(fallbackChannels("Discord API повернув порожній список каналів; повернуто fallback-канал."), 200, origin);
  }

  const fallbackById = fallbackChannelId ? textChannels.find((channel) => channel.id === fallbackChannelId) : null;
  const raidByName = textChannels.find((channel) => {
    const name = channel.name.toLowerCase();
    return name.includes("raid") || name.includes("рейд") || name.includes("анонс") || name.includes("announce") || name.includes("оголош");
  });

  return json({
    ok: true,
    guild: guild ? {
      id: String(guild.id || guildId),
      name: String(guild.name || "Discord guild"),
      rules_channel_id: guild.rules_channel_id ? String(guild.rules_channel_id) : null,
    } : null,
    channels: textChannels,
    suggestedChannelId: raidByName?.id || fallbackById?.id || textChannels[0]?.id || "",
    suggestedRulesChannelId: raidByName?.id || fallbackById?.id || textChannels[0]?.id || "",
    warning: guildResponse.ok ? null : "Список каналів прочитано, але дані guild недоступні.",
  }, 200, origin);
}

const APPLICATION_STATUS_LABELS = [
  "status:review",
  "status:accepted",
  "status:declined",
  "statusreview",
  "statusaccepted",
  "statusdeclined",
  "statusapproved",
  "statusrejected",
];

function getTargetStatusLabel(status) {
  if (status === STATUS.ACCEPTED.key) return "status:accepted";
  if (status === STATUS.DECLINED.key) return "status:declined";
  return "status:review";
}

function getStatusComment(status, moderator) {
  const moderatorLabel = limitText(moderator, 80, "Discord moderator");

  if (status === STATUS.ACCEPTED.key) {
    return `✅ Заявку прийнято через Discord. Модератор: ${moderatorLabel}`;
  }

  if (status === STATUS.DECLINED.key) {
    return `❌ Заявку відхилено через Discord. Модератор: ${moderatorLabel}`;
  }

  return `🔎 Заявку повернуто на розгляд через Discord. Модератор: ${moderatorLabel}`;
}

function firebaseApplicationsCollection(env) {
  return String(env.FIREBASE_APPLICATIONS_COLLECTION || env.GUILD_APPLICATIONS_FIREBASE_COLLECTION || "guildApplications").trim() || "guildApplications";
}

function firebaseProjectId(env) {
  return String(env.FIREBASE_PROJECT_ID || "").trim();
}

function normalizeFirebasePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").replace(/^"|"$/g, "").trim();
}

function requireFirebaseConfig(env) {
  const projectId = firebaseProjectId(env);
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = normalizeFirebasePrivateKey(env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase для заявок не налаштовано.");
  }
  return { projectId, clientEmail, privateKey };
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeString(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function pemToArrayBuffer(pem) {
  const body = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createFirebaseJwt(env) {
  const { clientEmail, privateKey } = requireFirebaseConfig(env);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function getFirebaseAccessToken(env) {
  if (firebaseAuthCache.accessToken && firebaseAuthCache.expiresAt > Date.now() + 60_000) {
    return firebaseAuthCache.accessToken;
  }
  const assertion = await createFirebaseJwt(env);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Firebase auth HTTP ${response.status}`);
  }
  firebaseAuthCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return firebaseAuthCache.accessToken;
}

function firestoreBaseUrl(env) {
  const { projectId } = requireFirebaseConfig(env);
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function firestoreCollectionUrl(env) {
  return `${firestoreBaseUrl(env)}/${encodeURIComponent(firebaseApplicationsCollection(env))}`;
}

function firestoreDocumentUrl(env, docId) {
  return `${firestoreCollectionUrl(env)}/${encodeURIComponent(docId)}`;
}

function firestoreSettingsDocumentUrl(env, docId) {
  return `${firestoreBaseUrl(env)}/${encodeURIComponent("dashboardSettings")}/${encodeURIComponent(docId)}`;
}

function envFlag(env, name, fallback = false) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw || "").trim());
}

const COUNTRY_CODE_ALIASES = {
  RU: "RU",
  RUS: "RU",
  "643": "RU",
  RUSSIA: "RU",
  RUSSIANFEDERATION: "RU",
  "РОСІЯ": "RU",
  "РОССИЯ": "RU",
  "РФ": "RU",
  BY: "BY",
  BLR: "BY",
  "112": "BY",
  BELARUS: "BY",
  BELARUSREPUBLIC: "BY",
  "БІЛОРУСЬ": "BY",
  "БЕЛАРУСЬ": "BY",
  UA: "UA",
  UKR: "UA",
  "804": "UA",
  UKRAINE: "UA",
  "УКРАЇНА": "UA",
  "УКРАИНА": "UA",
};

function splitCountryTokens(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[\s,;|]+/g).map((item) => item.trim()).filter(Boolean);
}

function normalizeCountryCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/[._-]+/g, "").replace(/\s+/g, "");
  if (COUNTRY_CODE_ALIASES[compact]) return COUNTRY_CODE_ALIASES[compact];
  const digits = compact.replace(/\D/g, "");
  if (digits && COUNTRY_CODE_ALIASES[digits]) return COUNTRY_CODE_ALIASES[digits];
  const letters = compact.replace(/[^A-Z]/g, "");
  if (COUNTRY_CODE_ALIASES[letters]) return COUNTRY_CODE_ALIASES[letters];
  if (/^[A-Z]{2}$/.test(letters)) return letters;
  return "";
}

function parseBlockedCountries(value, fallback = ["RU", "BY"]) {
  const hasExplicitValue = Array.isArray(value) || (value !== undefined && value !== null && String(value).trim() !== "");
  const normalized = Array.from(new Set(splitCountryTokens(value).map(normalizeCountryCode).filter(Boolean)));
  if (normalized.length) return normalized.slice(0, 64);
  return hasExplicitValue ? [] : [...fallback];
}

function geoAccessDefaultPolicy(env) {
  return {
    enabled: envFlag(env, "GEO_ACCESS_BLOCK_ENABLED", true),
    blockApplications: envFlag(env, "GEO_ACCESS_BLOCK_APPLICATIONS", true),
    blockAuth: envFlag(env, "GEO_ACCESS_BLOCK_AUTH", true),
    blockUnknownCountries: envFlag(env, "GEO_ACCESS_BLOCK_UNKNOWN_COUNTRIES", false),
    blockedCountries: parseBlockedCountries(env.GEO_ACCESS_BLOCKED_COUNTRIES || env.BLOCKED_COUNTRIES, ["RU", "BY"]),
  };
}

function normalizeGeoAccessPolicy(data, env) {
  const fallback = geoAccessDefaultPolicy(env);
  return {
    enabled: typeof data?.enabled === "boolean" ? data.enabled : fallback.enabled,
    blockApplications: typeof data?.blockApplications === "boolean" ? data.blockApplications : fallback.blockApplications,
    blockAuth: typeof data?.blockAuth === "boolean" ? data.blockAuth : fallback.blockAuth,
    blockUnknownCountries: typeof data?.blockUnknownCountries === "boolean" ? data.blockUnknownCountries : fallback.blockUnknownCountries,
    blockedCountries: parseBlockedCountries(data?.blockedCountries, fallback.blockedCountries),
  };
}

async function getGeoAccessPolicy(env) {
  if (geoAccessPolicyCache.policy && geoAccessPolicyCache.expiresAt > Date.now()) {
    return geoAccessPolicyCache.policy;
  }

  let policy = geoAccessDefaultPolicy(env);
  try {
    const document = await firebaseFetch(env, firestoreSettingsDocumentUrl(env, "geoAccessPolicy"));
    policy = normalizeGeoAccessPolicy(parseFirestoreDocument(document), env);
  } catch (error) {
    if (!/not found|NOT_FOUND|404/i.test(String(error?.message || error || ""))) {
      logWorkerEvent("warn", "geo_access.policy_read_failed", { message: error?.message });
    }
  }

  const ttlSeconds = Math.max(10, Math.min(600, Math.floor(Number(env.GEO_ACCESS_POLICY_CACHE_SECONDS || 60))));
  geoAccessPolicyCache = { policy, expiresAt: Date.now() + ttlSeconds * 1000 };
  return policy;
}

function getRequestCountryCode(request) {
  const cfCountry = request?.cf?.country;
  const headerCountry = request.headers.get("cf-ipcountry") || request.headers.get("x-vercel-ip-country") || request.headers.get("cloudfront-viewer-country") || "";
  const country = normalizeCountryCode(cfCountry || headerCountry);
  if (country && country !== "XX" && country !== "T1") return country;
  return "";
}

function evaluateGeoAccess(policy, country, target) {
  if (!policy.enabled) return { blocked: false, reason: "disabled", country };
  if (target === "applications" && !policy.blockApplications) return { blocked: false, reason: "target_disabled", country };
  if (!country) return { blocked: Boolean(policy.blockUnknownCountries), reason: policy.blockUnknownCountries ? "unknown_country" : "allowed", country: "" };
  const blocked = new Set(policy.blockedCountries.map(normalizeCountryCode).filter(Boolean)).has(normalizeCountryCode(country));
  return { blocked, reason: blocked ? "blocked_country" : "allowed", country };
}

async function checkApplicationGeoAccess(request, env) {
  const policy = await getGeoAccessPolicy(env);
  const country = getRequestCountryCode(request);
  return { ...evaluateGeoAccess(policy, country, "applications"), policy };
}

function firestoreValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(firestoreValue).filter(Boolean) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: firestoreFields(value) } };
  }
  return { stringValue: String(value) };
}

function firestoreFields(object) {
  return Object.fromEntries(
    Object.entries(object || {})
      .map(([key, value]) => [key, firestoreValue(value)])
      .filter(([, value]) => Boolean(value))
  );
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(parseFirestoreValue);
  if ("mapValue" in value) return parseFirestoreFields(value.mapValue.fields || {});
  return null;
}

function parseFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, parseFirestoreValue(value)]));
}

function parseFirestoreDocument(document) {
  const name = String(document?.name || "");
  const id = name.split("/").pop() || "";
  return { id, ...parseFirestoreFields(document?.fields || {}) };
}

async function firebaseFetch(env, url, init = {}) {
  const token = await getFirebaseAccessToken(env);
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await response.text().catch(() => "");
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    throw new Error(data?.error?.message || raw || `Firebase HTTP ${response.status}`);
  }
  return data;
}

function encodeApplicationDateForNumber(date, env) {
  const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const year = safeDate.getUTCFullYear() % 100;
  const month = safeDate.getUTCMonth() + 1;
  const day = safeDate.getUTCDate();
  const ymd = year * 10000 + month * 100 + day;
  const salt = Math.abs(Number(env.APPLICATION_NUMBER_DATE_SALT || env.APPLICATION_TRACKING_DATE_SALT || 730201)) % 1000000;
  return String((ymd * 97 + salt) % 1000000).padStart(6, "0");
}

function generateApplicationTrackingNumber(env, now = new Date()) {
  const safeDate = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const encodedDate = encodeApplicationDateForNumber(safeDate, env);
  const secondsInDay = safeDate.getUTCHours() * 3600 + safeDate.getUTCMinutes() * 60 + safeDate.getUTCSeconds();
  const sequence = String(secondsInDay).padStart(5, "0");
  const millis = String(safeDate.getUTCMilliseconds()).padStart(3, "0");
  const random = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `${encodedDate}${sequence}${millis}${random}`;
}

async function readMaxFirebaseApplicationNumber(env) {
  const queryUrl = `${firestoreBaseUrl(env)}:runQuery`;
  try {
    const rows = await firebaseFetch(env, queryUrl, {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: firebaseApplicationsCollection(env) }],
          orderBy: [{ field: { fieldPath: "number" }, direction: "DESCENDING" }],
          limit: 1,
        },
      }),
    });
    const document = Array.isArray(rows) ? rows.find((row) => row?.document)?.document : null;
    const item = document ? parseFirestoreDocument(document) : null;
    const number = Number(item?.application_number || item?.number || 0);
    if (isSequentialApplicationNumber(number)) return number;
  } catch (error) {
    logWorkerEvent("warn", "applications.sequence.query_failed", { message: error?.message });
  }

  try {
    const items = await listFirebaseApplicationDocuments(env, 1000);
    return items.reduce((max, item) => {
      const number = Number(item.application_number || item.number || 0);
      return isSequentialApplicationNumber(number) && number > max ? number : max;
    }, 0);
  } catch (error) {
    logWorkerEvent("warn", "applications.sequence.fallback_failed", { message: error?.message });
    return 0;
  }
}

async function allocateSequentialApplicationNumber(env) {
  return (await readMaxFirebaseApplicationNumber(env)) + 1;
}

const APPLICATION_SEQUENCE_ATTEMPTS = 12;

function applicationSequenceBackoffMs(attempt) {
  return Math.min(1600, 80 + attempt * 140 + Math.floor(Math.random() * 180));
}

async function createFirestoreApplicationDocument(env, docId, data) {
  const url = new URL(firestoreCollectionUrl(env));
  url.searchParams.set("documentId", docId);
  return firebaseFetch(env, url.toString(), {
    method: "POST",
    body: JSON.stringify({ fields: firestoreFields(data) }),
  });
}

function isFirestoreAlreadyExistsError(error) {
  return /already exists|already_exists|409|ALREADY_EXISTS/i.test(String(error?.message || error || ""));
}

function isSequentialApplicationNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number < 1000000;
}

function labelsForApplicationStatus(status) {
  return [DEFAULT_LABEL, getTargetStatusLabel(status)];
}

function compactRaiderIoScoreBlock(seasonData) {
  const scores = seasonData && typeof seasonData === "object" ? seasonData.scores || {} : {};
  return {
    all: Number.isFinite(Number(scores.all)) ? Number(scores.all) : null,
    dps: Number.isFinite(Number(scores.dps)) ? Number(scores.dps) : null,
    healer: Number.isFinite(Number(scores.healer)) ? Number(scores.healer) : null,
    tank: Number.isFinite(Number(scores.tank)) ? Number(scores.tank) : null,
  };
}

function compactRaiderIoRaid(raid) {
  if (!hasRaidProgressData(raid)) return null;

  const totalBosses = Number(raid.total_bosses || 0);
  const expansionId = Number(raid.expansion_id);

  return {
    key: cleanText(raid.key, 80),
    name: cleanText(raid.name || prettifyRaidKey(raid.key), 120),
    summary: cleanText(raid.summary, 120),
    total_bosses: Number.isFinite(totalBosses) && totalBosses > 0 ? totalBosses : null,
    normal_bosses_killed: Number(raid.normal_bosses_killed || 0) || 0,
    heroic_bosses_killed: Number(raid.heroic_bosses_killed || 0) || 0,
    mythic_bosses_killed: Number(raid.mythic_bosses_killed || 0) || 0,
    expansion_id: Number.isFinite(expansionId) ? expansionId : null,
  };
}

function normalizeRaiderIoForApplicationStorage(rawData) {
  if (!rawData || typeof rawData !== "object") return null;
  if (rawData.mythic_plus || rawData.raids) return rawData;

  const seasons = Array.isArray(rawData.mythic_plus_scores_by_season) ? rawData.mythic_plus_scores_by_season : [];
  const raidGroups = splitRaidProgressionByExpansion(rawData.raid_progression);

  return {
    profile_url: cleanText(rawData.profile_url, 300, ""),
    thumbnail_url: cleanText(rawData.thumbnail_url, 300, ""),
    profile_banner: cleanText(rawData.profile_banner, 300, ""),
    mythic_plus: {
      current: compactRaiderIoScoreBlock(seasons[0]),
      previous: compactRaiderIoScoreBlock(seasons[1]),
    },
    raids: {
      current: (raidGroups.current || []).map(compactRaiderIoRaid).filter(Boolean).slice(0, 8),
      previous: (raidGroups.previous || []).map(compactRaiderIoRaid).filter(Boolean).slice(0, 8),
    },
    raid_progression: rawData.raid_progression || null,
  };
}

async function createFirebaseApplication(env, payload, verification) {
  const createdAtDate = new Date();
  const trackingNumber = generateApplicationTrackingNumber(env, createdAtDate);
  const now = createdAtDate.toISOString();
  const createdAtMs = createdAtDate.getTime();
  const rioRawData = verification?.raider_io?.ok ? verification.raider_io.data : null;
  const rioData = normalizeRaiderIoForApplicationStorage(rioRawData);
  let lastError = null;

  for (let attempt = 0; attempt < APPLICATION_SEQUENCE_ATTEMPTS; attempt += 1) {
    const number = await allocateSequentialApplicationNumber(env);
    const docId = `application-${number}`;
    const data = {
      id: docId,
      number,
      application_number: number,
      tracking_number: trackingNumber,
      title: `Заявка #${number} до гільдії: ${payload.characterName}`,
      status: STATUS.REVIEW.key,
      status_key: STATUS.REVIEW.key,
      status_text: STATUS.REVIEW.label,
      state: "open",
      labels: labelsForApplicationStatus(STATUS.REVIEW.key),
      region: "eu",
      character_name: payload.characterName,
      realm: payload.realm,
      faction: payload.faction,
      class_name: payload.className || "",
      discord: payload.discord || "",
      battle_tag: payload.battleTag || "",
      source: payload.source || "",
      availability: payload.availability || "",
      avatar_url: rioData?.thumbnail_url || "",
      profile_url: rioData?.profile_url || "",
      raider_io: rioData || null,
      raider_io_raw: rioRawData || null,
      raid_progression: rioRawData?.raid_progression || rioData?.raid_progression || null,
      raider_io_error: verification?.raider_io?.ok ? null : verification?.raider_io?.error || null,
      verification: {
        raider_io: verification?.raider_io || null,
        battlenet: verification?.battlenet || null,
      },
      created_at: now,
      updated_at: now,
      closed_at: null,
      createdAtMs,
      updatedAtMs: createdAtMs,
    };

    try {
      const document = await createFirestoreApplicationDocument(env, docId, data);
      return {
        id: docId,
        ...data,
        body: buildIssueBody(payload),
        html_url: "",
        created_at: now,
        updated_at: now,
        closed_at: null,
        number,
        application_number: number,
        labels: data.labels.map((name) => ({ name })),
        tracking_number: trackingNumber,
        firestore: parseFirestoreDocument(document),
      };
    } catch (error) {
      lastError = error;
      if (isFirestoreAlreadyExistsError(error)) {
        logWorkerEvent("warn", "application.sequence.conflict", { number, attempt: attempt + 1 });
        if (attempt + 1 < APPLICATION_SEQUENCE_ATTEMPTS) {
          await sleep(applicationSequenceBackoffMs(attempt));
        }
        continue;
      }
      throw error;
    }
  }

  throw new Error(lastError?.message || "Не вдалося виділити порядковий номер заявки.");
}


async function getFirebaseApplication(env, applicationNumber) {
  const cleanNumber = Number(applicationNumber);
  if (!Number.isInteger(cleanNumber) || cleanNumber <= 0) throw new Error("Некоректний номер заявки.");
  try {
    const document = await firebaseFetch(env, firestoreDocumentUrl(env, `application-${cleanNumber}`));
    return parseFirestoreDocument(document);
  } catch (error) {
    throw new Error("Заявку не знайдено у Firebase.");
  }
}

async function patchFirebaseApplication(env, applicationNumber, patch) {
  const cleanNumber = Number(applicationNumber);
  if (!Number.isInteger(cleanNumber) || cleanNumber <= 0) throw new Error("Некоректний номер заявки.");
  const url = new URL(firestoreDocumentUrl(env, `application-${cleanNumber}`));
  for (const field of Object.keys(patch)) url.searchParams.append("updateMask.fieldPaths", field);
  return firebaseFetch(env, url.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields: firestoreFields(patch) }),
  });
}

async function storeFirebaseDiscordMessageRef(env, issue, discord) {
  const channelId = cleanText(discord?.channel_id, 80);
  const messageId = cleanText(discord?.message_id, 80);
  const number = Number(issue?.number);
  if (!channelId || !messageId || !Number.isInteger(number)) return { skipped: true };
  await patchFirebaseApplication(env, number, {
    discord_message_ref: { channel_id: channelId, message_id: messageId },
    updated_at: new Date().toISOString(),
    updatedAtMs: Date.now(),
  });
  return { ok: true };
}

async function updateApplicationIssueStatus(env, issueNumber, status, moderator) {
  const startedAt = nowMs();
  const cleanIssueNumber = Number(issueNumber);
  if (!Number.isInteger(cleanIssueNumber) || cleanIssueNumber <= 0) {
    throw new Error("Некоректний номер заявки.");
  }
  const current = await getFirebaseApplication(env, cleanIssueNumber);
  const currentStatus = resolveStatusFilter(current.status_key || current.status || "review") || STATUS.REVIEW.key;
  const targetStatus = resolveStatusFilter(status);
  if (!targetStatus || targetStatus === "all") throw new Error("Некоректний статус заявки.");
  const now = new Date().toISOString();
  const patch = {
    status: targetStatus,
    status_key: targetStatus,
    status_text: getStatusByKey(targetStatus).label,
    state: targetStatus === STATUS.REVIEW.key ? "open" : "closed",
    closed_at: targetStatus === STATUS.REVIEW.key ? null : now,
    updated_at: now,
    updatedAtMs: Date.now(),
    labels: labelsForApplicationStatus(targetStatus),
    last_moderation_comment: getStatusComment(targetStatus, moderator),
  };
  await patchFirebaseApplication(env, cleanIssueNumber, patch);
  logWorkerEvent("info", "application.status.updated", {
    issueNumber: cleanIssueNumber,
    currentStatus,
    status: targetStatus,
    label: getTargetStatusLabel(targetStatus),
    ms: elapsedMs(startedAt),
  });
  return { ok: true, label: getTargetStatusLabel(targetStatus), closed: targetStatus !== STATUS.REVIEW.key };
}

function ephemeral(content, components = []) {
  const safeComponents = safeDiscordComponents(components);
  return discordInteractionResponse({
    type: 4,
    data: {
      content: limitText(content, 1900, "Дію виконано."),
      flags: 64,
      components: safeComponents,
      allowed_mentions: { parse: [] },
    },
  });
}

function isEphemeralMessageInteraction(interaction) {
  return Boolean(Number(interaction?.message?.flags || 0) & 64);
}

function updateInteractionMessage(content, components = []) {
  return discordInteractionResponse({
    type: 7,
    data: {
      content: limitText(content, 1900, "Дію виконано."),
      components: safeDiscordComponents(components),
      allowed_mentions: { parse: [] },
    },
  });
}

function finishRulesDecision(interaction, content, components = []) {
  return isEphemeralMessageInteraction(interaction) ? updateInteractionMessage(content, components) : ephemeral(content, components);
}

function deferredEphemeral() {
  // Для Discord interaction type 5 найнадійніше віддавати тільки flags.
  // Будь-яку фактичну відповідь/компоненти патчимо окремо через @original.
  return discordInteractionResponse({
    type: 5,
    data: {
      flags: 64,
    },
  });
}

function deferredMessageUpdate() {
  return discordInteractionResponse({ type: 6 });
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function discordInteractionImmediateWindowMs(env) {
  const raw = Number(env?.DISCORD_INTERACTION_SYNC_REPLY_MS);
  if (Number.isFinite(raw) && raw >= 500 && raw <= 2800) return Math.floor(raw);
  return 2400;
}

function interactionResultResponse(interaction, result, componentsFallback = []) {
  const content = result?.content || "Дію виконано.";
  const components = Array.isArray(result?.components) ? result.components : componentsFallback;
  return isEphemeralMessageInteraction(interaction)
    ? updateInteractionMessage(content, components)
    : ephemeral(content, components);
}

async function patchOriginalInteractionResponse(interaction, payload) {
  const applicationId = snowflake(interaction?.application_id);
  const token = String(interaction?.token || "").trim();
  if (!applicationId || !token) return { ok: false, status: 0, raw: "missing application/token" };

  const response = await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const raw = response.ok ? "" : await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, raw };
}

async function editOriginalInteractionResponse(interaction, content, components = []) {
  const safeComponents = safeDiscordComponents(components);
  const payload = {
    content: limitText(content, 1900, "Дію виконано."),
    components: safeComponents,
    allowed_mentions: { parse: [] },
  };

  let result = await patchOriginalInteractionResponse(interaction, payload);

  // Якщо Discord відхилив повний набір components, не здаємося одразу.
  // Спершу пробуємо спрощений payload без default/options edge-cases, link-кнопок
  // і disabled індикаторів сторінки. Саме через це користувач бачив текст
  // приватного пульта, але без можливості натиснути "Проголосувати".
  if (!result.ok && result.status === 400 && safeComponents.length) {
    const relaxedComponents = relaxedDiscordComponentsForPatch(safeComponents);
    logWorkerEvent("warn", "discord.interaction.followup_components_rejected", {
      status: result.status,
      raw: String(result.raw || "").slice(0, 220),
      componentRows: safeComponents.length,
      relaxedRows: relaxedComponents.length,
    });

    if (relaxedComponents.length) {
      result = await patchOriginalInteractionResponse(interaction, {
        ...payload,
        components: relaxedComponents,
      });
    }
  }

  // Останній fallback: краще показати зрозумілий текст, ніж лишити Discord thinking.
  if (!result.ok && result.status === 400 && safeComponents.length) {
    result = await patchOriginalInteractionResponse(interaction, {
      ...payload,
      content: limitText(`${payload.content}

⚠️ Discord відхилив кнопки/меню. Натисни публічну кнопку голосування ще раз або відкрий деталі на сайті.`, 1900, payload.content),
      components: [],
    });
  }

  if (!result.ok) {
    logWorkerEvent("warn", "discord.interaction.followup_failed", { status: result.status, raw: String(result.raw || "").slice(0, 220) });
  }
  return result.ok;
}

async function waitForFastInteractionResult(task, env) {
  const timeoutMs = Math.max(500, Math.min(discordInteractionImmediateWindowMs(env), 2200));
  const timeout = sleepMs(timeoutMs).then(() => ({ ready: false }));
  return Promise.race([
    task.then((result) => ({ ready: true, result })).catch((error) => ({ ready: true, error })),
    timeout,
  ]);
}

function normalizeInteractionTaskError(error, fallbackContent) {
  return {
    ok: false,
    content: limitText(error?.message || fallbackContent || "❌ Не вдалося обробити дію.", 1800, fallbackContent || "❌ Не вдалося обробити дію."),
    components: [],
  };
}

function deferAndPatchInteraction(interaction, task, ctx, meta, fallbackContent) {
  ctx.waitUntil((async () => {
    try {
      const result = await task;
      const patched = await editOriginalInteractionResponse(interaction, result.content, result.components || []);
      logWorkerEvent(patched ? "info" : "warn", meta.patchEvent, { ...meta.details, patched });
    } catch (error) {
      logWorkerEvent("error", meta.failedEvent, { ...meta.details, message: error?.message });
      await editOriginalInteractionResponse(interaction, fallbackContent, []).catch(() => false);
    }
  })());
}

function snowflakeToBase36(id) {
  return BigInt(id).toString(36);
}

function buildRulesDirectAcceptCustomId(roleIds) {
  const cleaned = Array.from(new Set((roleIds || []).map(snowflake).filter(Boolean)));
  if (!cleaned.length) return "";
  return `${RULES_CUSTOM_ID_PREFIX}:a:${cleaned.map(snowflakeToBase36).join(".")}`;
}

function buildRulesDirectDecisionComponents(roleIds) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: "Прийняти правила",
          custom_id: buildRulesDirectAcceptCustomId(roleIds),
        },
        {
          type: 2,
          style: 4,
          label: "Відмовитися",
          custom_id: `${RULES_CUSTOM_ID_PREFIX}:c:d`,
        },
      ],
    },
  ];
}

function rulesConfirmationResponse(rulesAction) {
  const isDecline = rulesAction.action === "confirm_decline";
  const isRaidSignup = rulesAction.action === "confirm_raid_signup";
  const components = isRaidSignup
    ? [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Підтвердити підпис",
              custom_id: `${RULES_CUSTOM_ID_PREFIX}:r:s`,
            },
          ],
        },
      ]
    : isDecline
      ? [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 4,
                label: "Підтвердити відмову",
                custom_id: `${RULES_CUSTOM_ID_PREFIX}:d`,
              },
            ],
          },
        ]
      : buildRulesDirectDecisionComponents(rulesAction.roleIds);

  return discordInteractionResponse({
    type: 4,
    data: {
      flags: 64,
      allowed_mentions: { parse: [] },
      content: isRaidSignup
        ? "🐉 Підтверди підпис на правила рейду. Бот перевірить твою авторизацію в панелі та main-персонажа."
        : isDecline
          ? "⚠️ Підтверди відмову від правил. Після підтвердження бот видалить тебе із сервера."
          : "🌸 Натисни “Прийняти правила” ще раз. Discord підтвердить твою особу й дасть персональне посилання на сайт без OAuth.",
      components,
    },
  });
}

async function addGuildMemberRoles(env, guildId, userId, roleIds, reason) {
  const cleanGuildId = snowflake(guildId);
  const cleanUserId = snowflake(userId);
  const cleanRoleIds = Array.from(new Set((roleIds || []).map(snowflake).filter(Boolean)));

  if (!cleanGuildId || !cleanUserId || !cleanRoleIds.length) {
    throw new Error("Не вистачає guild/user/role ID для видачі ролі.");
  }

  await Promise.all(
    cleanRoleIds.map(async (roleId) => {
      const response = await discordApiFetch(
        env,
        `/guilds/${cleanGuildId}/members/${cleanUserId}/roles/${roleId}`,
        {
          method: "PUT",
          headers: reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason.slice(0, 512)) } : {},
        }
      );

      if (!response.ok && response.status !== 204) {
        const raw = await response.text().catch(() => "");
        throw new Error(raw || `Discord role error ${response.status}`);
      }

      return roleId;
    })
  );
}

async function kickGuildMember(env, guildId, userId, reason) {
  const cleanGuildId = snowflake(guildId);
  const cleanUserId = snowflake(userId);

  if (!cleanGuildId || !cleanUserId) {
    throw new Error("Не вистачає guild/user ID для кіку.");
  }

  const response = await discordApiFetch(env, `/guilds/${cleanGuildId}/members/${cleanUserId}`, {
    method: "DELETE",
    headers: reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason.slice(0, 512)) } : {},
  });

  if (!response.ok && response.status !== 204) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw || `Discord kick error ${response.status}`);
  }
}

function memberHasAllRoles(interaction, roleIds) {
  const wanted = Array.from(new Set((roleIds || []).map(snowflake).filter(Boolean)));
  if (!wanted.length) return false;

  const memberRoles = Array.isArray(interaction?.member?.roles)
    ? interaction.member.roles.map(String)
    : [];

  return wanted.every((roleId) => memberRoles.includes(roleId));
}

async function handleRulesInteraction(interaction, env, rulesAction) {
  const guildId = getInteractionGuildId(interaction, env);
  const userId = getDiscordUserId(interaction);
  const userLabel = getDiscordUserLabel(interaction);

  const effectiveRulesAction = rulesAction.action === "confirm_accept"
    ? { ...rulesAction, action: "accept" }
    : rulesAction;

  if (effectiveRulesAction.action === "confirm_decline" || effectiveRulesAction.action === "confirm_raid_signup") {
    logWorkerEvent("info", "rules.confirmation.requested", { action: effectiveRulesAction.action, guildId, userId, roles: effectiveRulesAction.roleIds?.length || 0 });

    if (effectiveRulesAction.action !== "confirm_raid_signup") {
      const recordedDecision = await getRecordedRulesDecision(env, guildId, userId).catch(() => null);

      if (recordedDecision === "accepted") {
        await recordRulesDecision(env, guildId, userId, "accepted").catch(() => null);
        return finishRulesDecision(interaction, "✅ Ти вже прийняв правила. Кнопки для тебе більше не потрібні.");
      }

      if (recordedDecision === "declined") {
        return finishRulesDecision(interaction, "🚪 Ти вже відмовився від правил. Дія для тебе завершена.");
      }
    }

    return rulesConfirmationResponse(effectiveRulesAction);
  }

  if (isInteractionRateLimited(interaction, "rules")) {
    return finishRulesDecision(interaction, "⏳ Зачекай кілька секунд перед наступною дією.");
  }

  if (effectiveRulesAction.action === "raid_signup") {
    const profileResult = await lookupDashboardProfileByDiscord(env, userId);
    if (!profileResult.ok || !hasUsableMainCharacter(profileResult.mainCharacter)) {
      logWorkerEvent("warn", "raid_rules.signup.profile_missing", { guildId, userId, reason: profileResult.reason, status: profileResult.status });
      return finishRulesDecision(interaction, raidRulesSignupProfileErrorMessage(env, profileResult), raidActionHelpComponents(env));
    }

    const stored = await recordRaidRulesSignup(env, guildId, userId, userLabel, {
      ...profileResult.profile,
      mainCharacter: profileResult.mainCharacter,
    }).catch((error) => {
      logWorkerEvent("warn", "raid_rules.signup.record_failed", { guildId, userId, message: error?.message });
      return { ok: false, error };
    });

    if (!stored?.ok) {
      return finishRulesDecision(interaction, "❌ Підпис не збережено: список підписантів тимчасово недоступний. Звернись до гільдмайстра.", raidActionHelpComponents(env));
    }

    logWorkerEvent("info", "raid_rules.signup.accepted", { guildId, userId, character: stored.signup?.mainCharacter?.name });
    return finishRulesDecision(interaction, `✅ Підпис на правила рейду зараховано. Main: ${formatMainCharacterForMessage(stored.signup?.mainCharacter)}.`);
  }

  try {
    if (effectiveRulesAction.action === "accept") {
      if (!snowflake(userId)) {
        logWorkerEvent("warn", "rules.accept.user_missing", { guildId, roles: rulesAction.roleIds?.length || 0 });
        return finishRulesDecision(interaction, "❌ Discord не передав userId. Натисни актуальну кнопку правил ще раз або звернись до офіцера.");
      }

      const acceptUrl = await rulesAcceptUrlForInteraction(env, interaction, rulesAction.roleIds);
      const alreadyAccepted = memberHasAllRoles(interaction, rulesAction.roleIds);
      logWorkerEvent("info", "rules.accept.site_link_created", {
        guildId,
        userId,
        roles: rulesAction.roleIds.length,
        alreadyAccepted,
      });

      return finishRulesDecision(
        interaction,
        alreadyAccepted
          ? "✅ Discord підтвердив твою особу. Роль уже є, але сторінку правил можна відкрити для тесту й перевірки без повторної авторизації."
          : "✅ Discord підтвердив твою особу. Відкрий сайт через кнопку нижче — він отримає підписані дані з Discord і видасть роль без OAuth.",
        rulesSiteLinkComponents(acceptUrl)
      );
    }

    await kickGuildMember(env, guildId, userId, `Rules declined by ${userLabel}`);
    await recordRulesDecision(env, guildId, userId, "declined").catch((error) => logWorkerEvent("warn", "rules.stats.record_failed", { action: "declined", guildId, userId, message: error?.message }));
    logWorkerEvent("info", "rules.declined", { guildId, userId });
    return finishRulesDecision(interaction, "🚪 Ти відмовився від правил, тому бот видалив тебе із сервера.");
  } catch (error) {
    logWorkerEvent("error", "rules.action.failed", { action: effectiveRulesAction.action, guildId, userId, message: error?.message });
    return finishRulesDecision(
      interaction,
      `❌ Не вдалося виконати дію правил: ${limitText(error?.message, 180, "невідома помилка")}`
    );
  }
}

async function handleApplicationInteraction(interaction, env, customId) {
  const match = customId.match(/^guild_application:(accepted|declined):(\d+)$/);
  if (!match) return null;

  const status = match[1];
  const issueNumber = match[2];
  const moderator = getDiscordUserLabel(interaction);

  if (!hasAllowedDiscordRole(interaction, env)) {
    return ephemeral("⛔ У вас немає прав для зміни статусу заявки.");
  }

  if (isInteractionRateLimited(interaction, "application")) {
    return ephemeral("⏳ Зачекай кілька секунд перед наступною дією.");
  }

  try {
    await updateApplicationIssueStatus(env, issueNumber, status, moderator);
    await invalidateApplicationCaches(env, null);
  } catch (error) {
    return ephemeral(
      `Не вдалося змінити статус заявки: ${limitText(error?.message, 160, "невідома помилка")}`
    );
  }

  const updatedEmbeds = buildUpdatedApplicationEmbeds(
    interaction,
    status,
    issueNumber,
    moderator,
    env
  );

  return discordInteractionResponse({
    type: 7,
    data: {
      content: buildStatusUpdateContent(issueNumber, status, moderator),
      embeds: updatedEmbeds,
      components: [],
      allowed_mentions: { parse: [] },
    },
  });
}


function decodeRaidAttendanceCustomId(customId) {
  const value = String(customId || "").trim();
  const match = value.match(/^mbv1:raid:([A-Za-z0-9_-]{8,80}):(going|tentative|late|skipped)$/);
  if (!match) return null;
  return { raidId: match[1], action: match[2], characterKey: "" };
}

function decodeRaidCharacterSelectCustomId(customId, values) {
  const value = String(customId || "").trim();
  const legacyMatch = value.match(/^mbv1:rc:([A-Za-z0-9_-]{8,80}):(going|tentative|late|skipped)$/);
  const panelMatch = value.match(/^mbv1:rsc:([A-Za-z0-9_-]{8,80}):(going|tentative|late):(tank|healer|dps)$/);
  const match = legacyMatch || panelMatch;
  if (!match) return null;
  const selected = Array.isArray(values) ? String(values[0] || "").trim() : "";
  if (!selected) return null;
  return {
    raidId: match[1],
    action: match[2],
    characterKey: selected,
    signupRole: panelMatch ? cleanRaidSignupRole(match[3]) : "",
    commit: false,
  };
}

function cleanRaidSignupRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "tank") return "tank";
  if (role === "healer" || role === "heal") return "healer";
  if (role === "dps" || role === "dd") return "dps";
  return "";
}

function decodeRaidRoleSelectCustomId(customId, values) {
  const value = String(customId || "").trim();
  const panelMatch = value.match(/^mbv1:rsr:([A-Za-z0-9_-]{8,80}):(going|tentative|late):([A-Za-z0-9._-]{1,64})$/);
  const legacyMatch = value.match(/^mbv1:rr:([A-Za-z0-9_-]{8,80}):(going|tentative|late):([A-Za-z0-9._-]{1,64})$/);
  const match = panelMatch || legacyMatch;
  if (!match) return null;
  const selected = Array.isArray(values) ? cleanRaidSignupRole(values[0]) : "";
  if (!selected) return null;
  return {
    raidId: match[1],
    action: match[2],
    characterKey: match[3],
    signupRole: selected,
    commit: false,
  };
}

function decodeRaidSignupSubmitCustomId(customId) {
  const value = String(customId || "").trim();
  const match = value.match(/^mbv1:rss:([A-Za-z0-9_-]{8,80}):(going|tentative|late):([A-Za-z0-9._-]{1,64}):(tank|healer|dps)$/);
  if (!match) return null;
  return {
    raidId: match[1],
    action: match[2],
    characterKey: match[3],
    signupRole: cleanRaidSignupRole(match[4]),
    commit: true,
  };
}

function decodeRaidPollCustomId(customId, values) {
  const value = String(customId || "").trim();
  const legacyMatch = value.match(/^mbv1:poll_(days|time):([A-Za-z0-9_-]{8,80})$/);
  const smartMatch = value.match(/^mbv1:poll_(schedule_(?:[abc]|mon|tue|wed|thu|fri|sat|sun)|schedule_page_\d{1,2}|character|character_prompt|role|submit):([A-Za-z0-9_-]{8,80})$/);
  const match = legacyMatch || smartMatch;
  if (!match) return null;
  const rawKind = match[1];
  const selected = Array.isArray(values) ? values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 25) : [];
  if (!selected.length && rawKind !== "character_prompt" && rawKind !== "submit" && !rawKind.startsWith("schedule_page_")) return null;
  const kind = rawKind.startsWith("schedule_page_") ? "schedule_page" : rawKind.startsWith("schedule_") ? "schedule" : rawKind;
  const group = rawKind.startsWith("schedule_page_")
    ? rawKind.replace("schedule_page_", "page_")
    : rawKind.startsWith("schedule_")
      ? rawKind.slice("schedule_".length)
      : "";
  return { pollId: match[2], kind, group, values: selected };
}

function dashboardRaidPollVoteEndpoint(env, pollId) {
  const explicit = String(env.DASHBOARD_RAID_POLL_VOTE_ENDPOINT || env.DASHBOARD_POLL_VOTE_ENDPOINT || "").trim();
  if (explicit) return explicit.replace("{pollId}", encodeURIComponent(pollId));
  try {
    return new URL("/api/polls/" + encodeURIComponent(pollId) + "/vote", dashboardAuthUrl(env)).toString();
  } catch {
    return "https://admin.lihvodruida.pp.ua/api/polls/" + encodeURIComponent(pollId) + "/vote";
  }
}

function normalizeRaidPollProxyResult(data) {
  const content = String(data?.content || "Голос оброблено.").trim();
  return {
    ok: Boolean(data?.ok),
    closed: Boolean(data?.closed),
    content: limitText(content, 1800, "Голос оброблено."),
    components: safeDiscordComponents(data?.components),
  };
}

async function raidPollProxyContent(interaction, env, pollAction) {
  const token = String(env.INTERNAL_PROFILE_LOOKUP_TOKEN || env.DISCORD_RULES_STATS_TOKEN || env.WORKER_STATS_TOKEN || "").trim();
  if (!token) {
    logWorkerEvent("warn", "raid_poll.proxy.missing_token", { pollId: pollAction.pollId });
    return {
      ok: false,
      content: "❌ Голосування тимчасово недоступне: серверний зв’язок із панеллю не налаштований. Звернись до гільдмайстра.",
    };
  }

  try {
    const idempotencyKey = `discord-raid-poll:${pollAction.pollId}:${getDiscordUserId(interaction)}:${pollAction.kind}:${pollAction.values.join(".")}:${interaction?.id || Date.now()}`;
    const { response, raw } = await fetchDashboardText(env, dashboardRaidPollVoteEndpoint(env, pollAction.pollId), token, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-worker-stats-token": token,
        "x-idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        kind: pollAction.kind,
        group: pollAction.group || "",
        values: pollAction.values,
        userId: getDiscordUserId(interaction),
        userName: getDiscordUserLabel(interaction),
        guildId: getInteractionGuildId(interaction, env),
        guildName: env.DISCORD_GUILD_NAME || env.GUILD_NAME || "Discord server",
        channelId: getRaidInteractionMessageRef(interaction).channelId,
        messageId: getRaidInteractionMessageRef(interaction).messageId,
        source: "discord-interaction-worker",
      }),
    }, { timeoutMs: 9000, retries: 1 });

    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok || !data) {
      logWorkerEvent("warn", "raid_poll.proxy.bad_response", { pollId: pollAction.pollId, status: response.status, raw: raw.slice(0, 180) });
      return { ok: false, content: "❌ Не вдалося зберегти голос. Спробуй пізніше або звернись до офіцера." };
    }

    const result = normalizeRaidPollProxyResult(data);
    logWorkerEvent(result.ok ? "info" : "warn", "raid_poll.proxy.done", {
      pollId: pollAction.pollId,
      kind: pollAction.kind,
      ok: result.ok,
      closed: result.closed,
      values: pollAction.values.length,
    });
    return result;
  } catch (error) {
    logWorkerEvent("error", "raid_poll.proxy.failed", { pollId: pollAction.pollId, kind: pollAction.kind, message: error?.message });
    return { ok: false, content: "❌ Не вдалося зберегти голос. Спробуй пізніше або звернись до офіцера." };
  }
}

async function handleRaidPollInteraction(interaction, env, pollAction, ctx) {
  // Select-и, кнопка submit і пагінація існують тільки всередині приватного пульта.
  // У деяких Discord component payload flags ephemeral-повідомлення не приходить,
  // тому не можна покладатися лише на message.flags. Інакше кожен клік створює
  // нове приватне повідомлення замість оновлення поточного, а старий пульт стає
  // схожим на "непрацюючий".
  const updatePrivatePanel = isEphemeralMessageInteraction(interaction) || pollAction.kind !== "character_prompt";
  const fallbackContent = "❌ Не вдалося обробити голос. Спробуй ще раз або звернись до офіцера.";
  const task = raidPollProxyContent(interaction, env, pollAction);

  if (ctx && typeof ctx.waitUntil === "function") {
    // Discord показує «Дія не вдалася», якщо interaction не ACK-нуто дуже швидко.
    // Тому для рейд-пулів більше не чекаємо dashboard навіть 0.5–2 с:
    // 1) одразу ACK;
    // 2) у waitUntil зберігаємо/читаємо стан;
    // 3) PATCH-имо original response з приватним пультом або оновленим пультом.
    deferAndPatchInteraction(interaction, task, ctx, {
      patchEvent: "raid_poll.deferred.patch",
      failedEvent: "raid_poll.deferred.failed",
      details: { pollId: pollAction.pollId, kind: pollAction.kind, updatePrivatePanel },
    }, fallbackContent);

    return updatePrivatePanel ? deferredMessageUpdate() : deferredEphemeral();
  }

  const fallback = await task.catch((error) => {
    logWorkerEvent("error", "raid_poll.fallback.failed", {
      pollId: pollAction.pollId,
      kind: pollAction.kind,
      message: error?.message,
    });
    return { ok: false, content: fallbackContent, components: [] };
  });
  return interactionResultResponse(interaction, fallback);
}

function dashboardRaidActionEndpoint(env, raidId) {
  const explicit = String(env.DASHBOARD_RAID_ACTION_ENDPOINT || "").trim();
  if (explicit) return explicit.replace("{raidId}", encodeURIComponent(raidId));
  try {
    return new URL("/api/raids/" + encodeURIComponent(raidId) + "/discord-action", dashboardAuthUrl(env)).toString();
  } catch {
    return "https://admin.lihvodruida.pp.ua/api/raids/" + encodeURIComponent(raidId) + "/discord-action";
  }
}

function isEphemeralInteractionMessage(interaction) {
  return Boolean(Number(interaction?.message?.flags || 0) & 64);
}

function getRaidInteractionMessageRef(interaction) {
  // Component interactions inside private select menus point to ephemeral messages.
  // Those must never be used as the public raid announcement target.
  if (isEphemeralInteractionMessage(interaction)) return { channelId: "", messageId: "" };
  const channelId = snowflake(interaction?.channel_id || interaction?.message?.channel_id);
  const messageId = snowflake(interaction?.message?.id);
  return { channelId, messageId };
}

function raidAnnouncementProxyFallback(env, raidId, reason = "later") {
  if (reason === "profile") {
    return {
      content: raidActionHelpText(env, "login", raidId),
      components: raidActionHelpComponents(env, raidId),
    };
  }

  return {
    content: "❌ Не вдалося оновити запис на рейд. Спробуй пізніше або звернись до офіцера.",
    components: raidActionHelpComponents(env, raidId),
  };
}

function normalizeRaidAnnouncementProxyResult(env, raidAction, data) {
  const warning = typeof data?.warning === "string" ? data.warning.trim() : "";
  let content = String(data?.content || "Дію оброблено.").trim();
  if (warning && !content.includes(warning)) content = `${content}

${warning}`;

  const shouldAttachHelp = Boolean(data?.blockedByProfile || data?.needsProfile || data?.requiresProfile || data?.requiresMainCharacter);
  const components = safeDiscordComponents(
    Array.isArray(data?.components) && data.components.length
      ? data.components
      : shouldAttachHelp
        ? raidActionHelpComponents(env, raidAction.raidId)
        : []
  );

  return {
    ok: Boolean(data?.ok),
    content: limitText(content, 1800, "Дію оброблено."),
    components,
    warning,
    blockedByMinItemLevel: Boolean(data?.blockedByMinItemLevel || String(content).includes("Запис заблоковано")),
    blockedByMaxPlayers: Boolean(data?.blockedByMaxPlayers),
    blockedByRegistrationLock: Boolean(data?.blockedByRegistrationLock),
    blockedByProfile: shouldAttachHelp,
  };
}

async function raidAnnouncementProxyContent(interaction, env, raidAction) {
  const token = String(env.INTERNAL_PROFILE_LOOKUP_TOKEN || env.DISCORD_RULES_STATS_TOKEN || env.WORKER_STATS_TOKEN || "").trim();
  if (!token) {
    logWorkerEvent("warn", "raid_announcement.proxy.missing_token", { raidId: raidAction.raidId });
    return {
      content: "❌ Запис на рейд тимчасово недоступний: серверний зв’язок із панеллю не налаштований. Звернись до гільдмайстра.",
      components: raidActionHelpComponents(env, raidAction.raidId),
    };
  }

  try {
    const idempotencyKey = `discord-raid:${raidAction.raidId}:${getDiscordUserId(interaction)}:${raidAction.action}:${raidAction.characterKey || "main"}:${raidAction.signupRole || "auto"}:${interaction?.id || Date.now()}`;
    const { response, raw } = await fetchDashboardText(env, dashboardRaidActionEndpoint(env, raidAction.raidId), token, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-worker-stats-token": token,
        "x-idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        action: raidAction.action,
        characterKey: raidAction.characterKey || "",
        signupRole: raidAction.signupRole || "",
        commit: Boolean(raidAction.commit),
        userId: getDiscordUserId(interaction),
        userName: getDiscordUserLabel(interaction),
        guildId: getInteractionGuildId(interaction, env),
        channelId: getRaidInteractionMessageRef(interaction).channelId,
        messageId: getRaidInteractionMessageRef(interaction).messageId,
        source: "discord-interaction-worker",
      }),
    }, { timeoutMs: 9000, retries: 1 });
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

    if (!response.ok || !data) {
      logWorkerEvent("warn", "raid_announcement.proxy.bad_response", { raidId: raidAction.raidId, status: response.status, raw: raw.slice(0, 180) });
      if (response.status === 401 || response.status === 403) {
        return {
          content: "❌ Запис на рейд тимчасово недоступний: панель не прийняла серверний запит. Звернись до гільдмайстра.",
          components: raidActionHelpComponents(env, raidAction.raidId),
        };
      }
      return raidAnnouncementProxyFallback(env, raidAction.raidId);
    }

    const result = normalizeRaidAnnouncementProxyResult(env, raidAction, data);
    logWorkerEvent(result.ok ? "info" : "warn", "raid_announcement.proxy.done", {
      raidId: raidAction.raidId,
      action: raidAction.action,
      ok: result.ok,
      has_item_level_warning: Boolean(result.warning),
      blocked_by_min_item_level: result.blockedByMinItemLevel,
      blocked_by_max_players: result.blockedByMaxPlayers,
      blocked_by_registration_lock: result.blockedByRegistrationLock,
      blocked_by_profile: result.blockedByProfile,
      has_components: result.components.length > 0,
    });

    if (result.blockedByMinItemLevel) {
      logWorkerEvent("warn", "raid_announcement.proxy.item_level_blocked", {
        raidId: raidAction.raidId,
        action: raidAction.action,
        characterKey: raidAction.characterKey || "",
        signupRole: raidAction.signupRole || "",
        userId: getDiscordUserId(interaction),
      });
    } else if (result.warning) {
      logWorkerEvent("warn", "raid_announcement.proxy.item_level_warning", {
        raidId: raidAction.raidId,
        action: raidAction.action,
        characterKey: raidAction.characterKey || "",
        signupRole: raidAction.signupRole || "",
        userId: getDiscordUserId(interaction),
      });
    }

    return result;
  } catch (error) {
    logWorkerEvent("error", "raid_announcement.proxy.failed", { raidId: raidAction.raidId, action: raidAction.action, message: error?.message });
    return raidAnnouncementProxyFallback(env, raidAction.raidId);
  }
}

async function handleRaidAnnouncementInteraction(interaction, env, raidAction, ctx) {
  const updatePrivatePanel = isEphemeralMessageInteraction(interaction);
  const fallbackResult = raidAnnouncementProxyFallback(env, raidAction.raidId);
  const task = raidAnnouncementProxyContent(interaction, env, raidAction);

  if (ctx && typeof ctx.waitUntil === "function") {
    // Та сама логіка, що й у рейд-пулах: спочатку ACK, потім PATCH.
    // Це прибирає Discord "Дія не вдалася" навіть під час cold start або повільного dashboard.
    deferAndPatchInteraction(interaction, task, ctx, {
      patchEvent: "raid_announcement.deferred.patch",
      failedEvent: "raid_announcement.deferred.failed",
      details: { raidId: raidAction.raidId, action: raidAction.action, updatePrivatePanel },
    }, fallbackResult.content);

    return updatePrivatePanel ? deferredMessageUpdate() : deferredEphemeral();
  }

  const fallback = await task.catch((error) => {
    logWorkerEvent("error", "raid_announcement.fallback.failed", {
      raidId: raidAction.raidId,
      action: raidAction.action,
      message: error?.message,
    });
    return fallbackResult;
  });
  return interactionResultResponse(interaction, fallback);
}

async function handleDiscordInteraction(request, env, ctx) {
  const rawBody = await request.text();
  const verified = await verifyDiscordRequest(request, env, rawBody);

  if (!verified) {
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody || "{}");
  } catch {
    return new Response("invalid interaction payload", { status: 400 });
  }

  if (interaction.type === 1) {
    return discordInteractionResponse({ type: 1 });
  }

  if (interaction.type !== 3) {
    return ephemeral("Цей тип взаємодії не підтримується.");
  }

  const customId = String(interaction?.data?.custom_id || "");

  const applicationResult = await handleApplicationInteraction(interaction, env, customId);
  if (applicationResult) return applicationResult;

  const raidPollAction = decodeRaidPollCustomId(customId, interaction?.data?.values);
  if (raidPollAction) return handleRaidPollInteraction(interaction, env, raidPollAction, ctx);

  const raidSubmitAction = decodeRaidSignupSubmitCustomId(customId);
  if (raidSubmitAction) return handleRaidAnnouncementInteraction(interaction, env, raidSubmitAction, ctx);

  const raidRoleSelectAction = decodeRaidRoleSelectCustomId(customId, interaction?.data?.values);
  if (raidRoleSelectAction) return handleRaidAnnouncementInteraction(interaction, env, raidRoleSelectAction, ctx);

  const raidCharacterSelectAction = decodeRaidCharacterSelectCustomId(customId, interaction?.data?.values);
  if (raidCharacterSelectAction) return handleRaidAnnouncementInteraction(interaction, env, raidCharacterSelectAction, ctx);

  const raidAnnouncementAction = decodeRaidAttendanceCustomId(customId);
  if (raidAnnouncementAction) return handleRaidAnnouncementInteraction(interaction, env, raidAnnouncementAction, ctx);

  const rulesAction = decodeRulesCustomId(customId);
  if (rulesAction) return handleRulesInteraction(interaction, env, rulesAction);

  return ephemeral("Невідома або застаріла кнопка Mistblossom Vanguard.");
}

async function listFirebaseApplicationDocuments(env, limit) {
  const baseUrl = `${firestoreBaseUrl(env)}/${encodeURIComponent(firebaseApplicationsCollection(env))}`;
  const url = new URL(baseUrl);
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("orderBy", "createdAtMs desc");

  try {
    const data = await firebaseFetch(env, url.toString());
    return Array.isArray(data?.documents) ? data.documents.map(parseFirestoreDocument) : [];
  } catch (error) {
    const fallbackUrl = new URL(baseUrl);
    fallbackUrl.searchParams.set("pageSize", String(limit));
    const data = await firebaseFetch(env, fallbackUrl.toString());
    const items = Array.isArray(data?.documents) ? data.documents.map(parseFirestoreDocument) : [];
    return items.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  }
}

function mapFirebaseListItem(item) {
  const statusKey = resolveStatusFilter(item.status_key || item.status || "review") || STATUS.REVIEW.key;
  const rawNumber = Number(item.application_number || item.number) || 0;
  const number = isSequentialApplicationNumber(rawNumber) ? rawNumber : 0;
  const trackingNumber = String(item.tracking_number || item.trackingNumber || "");
  return {
    number,
    application_number: number,
    tracking_number: trackingNumber,
    title: String(item.title || `Заявка #${number || "—"} до гільдії: ${item.character_name || item.characterName || "Персонаж"}`),
    state: String(item.state || (statusKey === STATUS.REVIEW.key ? "open" : "closed")),
    status_key: statusKey,
    status_text: getStatusByKey(statusKey).label,
    html_url: "",
    created_at: String(item.created_at || item.createdAt || ""),
    updated_at: String(item.updated_at || item.updatedAt || item.created_at || ""),
    closed_at: item.closed_at || null,
    summary: [`Заявка #${number || "—"}`, trackingNumber ? `відстеження ${trackingNumber}` : "", item.character_name || item.characterName, item.realm, item.region || "eu", item.faction, item.class_name || item.className].filter(Boolean).join(" • "),
    character_name: String(item.character_name || item.characterName || ""),
    realm: String(item.realm || ""),
    region: String(item.region || "eu"),
    faction: String(item.faction || ""),
    class_name: String(item.class_name || item.className || ""),
    avatar_url: String(item.avatar_url || item.avatarUrl || item.raider_io?.thumbnail_url || item.raiderIo?.thumbnail_url || ""),
    profile_url: String(item.profile_url || item.profileUrl || item.raider_io?.profile_url || item.raiderIo?.profile_url || ""),
    labels: Array.isArray(item.labels) ? item.labels : labelsForApplicationStatus(statusKey),
  };
}

async function listApplications(request, env) {
  const startedAt = nowMs();
  const origin = allowedOrigin(request, env) || "null";
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || String(DEFAULT_LIST_LIMIT), 10), 1),
    MAX_LIST_LIMIT
  );
  const rawStatus = cleanText(url.searchParams.get("status"), 24).toLowerCase();
  const status = resolveStatusFilter(rawStatus);
  const className = cleanText(url.searchParams.get("class"), 60).toLowerCase();
  const query = cleanText(url.searchParams.get("q"), 120).toLowerCase();
  const debug = isDebugResponseEnabled(request, env);

  if (rawStatus && rawStatus !== "all" && !status) {
    return json(
      {
        error: "Некоректний фільтр статусу.",
        allowed_statuses: ["all", ...Array.from(STATUS_KEYS)],
        diagnostics: debug ? { rawStatus, env: envDiagnostics(env) } : undefined,
      },
      400,
      origin
    );
  }

  logWorkerEvent("info", "applications.list.start", {
    storage: "firebase",
    collection: firebaseApplicationsCollection(env),
    limit,
    status: status || "all",
    className: className || "all",
    hasQuery: Boolean(query),
  });

  let mappedItems;
  try {
    mappedItems = (await listFirebaseApplicationDocuments(env, limit)).map(mapFirebaseListItem);
  } catch (error) {
    logWorkerEvent("error", "applications.list.firebase_failed", { message: error?.message, ms: elapsedMs(startedAt) });
    return json(
      {
        error: "Список заявок тимчасово недоступний.",
        diagnostics: debug ? { env: envDiagnostics(env), message: error?.message } : undefined,
      },
      502,
      origin
    );
  }

  let items = mappedItems;
  if (status && status !== "all") items = items.filter((item) => item.status_key === status);
  if (className && className !== "all") items = items.filter((item) => String(item.class_name || "").toLowerCase() === className);
  if (query) {
    items = items.filter((item) =>
      [item.number, item.application_number, item.tracking_number, item.title, item.summary, item.character_name, item.realm, item.region, item.faction, item.class_name]
        .some((value) => String(value || "").toLowerCase().includes(query))
    );
  }

  const afterFilterSummary = summarizeApplicationItems(items);
  const diagnostics = {
    storage: "firebase",
    collection: firebaseApplicationsCollection(env),
    limit,
    filters: { status: status || null, raw_status: rawStatus || "all", class: className || "all", query: query || null },
    before_filters: summarizeApplicationItems(mappedItems),
    after_filters: afterFilterSummary,
    env: envDiagnostics(env),
    ms: elapsedMs(startedAt),
  };
  logWorkerEvent("info", "applications.list.done", diagnostics);

  return json(
    {
      items,
      total: items.length,
      meta: {
        total_before_filters: mappedItems.length,
        total_after_filters: items.length,
        status_counts: afterFilterSummary.statuses,
        state_counts: afterFilterSummary.states,
      },
      diagnostics: debug ? diagnostics : undefined,
    },
    200,
    origin
  );
}

async function sendDiscordNotification(env, cleanPayload, issue) {
  const channelId = snowflake(env.DISCORD_CHANNEL_ID || env.GUILD_APPLICATIONS_DISCORD_CHANNEL_ID || env.DISCORD_APPLICATIONS_CHANNEL_ID);
  if (!env.DISCORD_BOT_TOKEN) return { skipped: true, reason: "DISCORD_BOT_TOKEN is missing" };
  if (!channelId) return { skipped: true, reason: "DISCORD_CHANNEL_ID is missing" };

  const verification = cleanPayload?._verification || {};
  const issueNumber = issue?.number || issue?.application_number || "";
  const trackingNumber = issue?.tracking_number || "";
  const content = issueNumber
    ? `📨 **Нова заявка #${issueNumber}**${trackingNumber ? ` • відстеження ${trackingNumber}` : ""}`
    : "📨 **Нова заявка до гільдії**";

  const response = await discordApiFetch(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      embeds: buildDiscordEmbeds(cleanPayload, issue, env, verification.raider_io).slice(0, 10),
      components: issue?.number ? buildApplicationButtons(issue.number) : [],
      allowed_mentions: { parse: [] },
    }),
  });

  const raw = await response.text().catch(() => "");
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

  if (!response.ok || !data?.id) {
    throw new Error(data?.message || raw || `Discord API ${response.status}`);
  }

  return {
    ok: true,
    channel_id: channelId,
    message_id: String(data.id),
    raider_io: Boolean(verification.raider_io?.ok),
    battlenet: Boolean(verification.battlenet?.ok),
  };
}

async function completeDiscordNotification(env, cleanPayload, issue) {
  const startedAt = nowMs();

  try {
    const discord = await sendDiscordNotification(env, cleanPayload, issue);

    if (discord?.ok) {
      discord.issue_ref = await storeFirebaseDiscordMessageRef(env, issue, discord);
    }

    logWorkerEvent("info", "application.discord.done", {
      issueNumber: issue?.number,
      queued: false,
      ok: Boolean(discord?.ok),
      skipped: Boolean(discord?.skipped),
      reason: discord?.reason,
      message_id: discord?.message_id,
      channel_id: discord?.channel_id,
      raider_io: discord?.raider_io,
      issue_ref: discord?.issue_ref,
      ms: elapsedMs(startedAt),
    });

    return discord;
  } catch (error) {
    const discord = {
      ok: false,
      error: error instanceof Error ? error.message : "Discord notification failed.",
    };

    logWorkerEvent("error", "application.discord.failed", {
      issueNumber: issue?.number,
      message: discord.error,
      ms: elapsedMs(startedAt),
    });

    return discord;
  }
}

async function readJsonBody(request, maxBytes = 96 * 1024) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, status: 413, error: "Заявка завелика." };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) {
    return { ok: false, status: 413, error: "Заявка завелика." };
  }
  try {
    return { ok: true, data: raw ? JSON.parse(raw) : null };
  } catch {
    return { ok: false, status: 400, error: "Не вдалося обробити заявку. Спробуй ще раз." };
  }
}

async function createApplication(request, env, ctx) {
  const startedAt = nowMs();
  const origin = allowedOrigin(request, env);

  if (!origin) {
    logWorkerEvent("warn", "application.create.origin_denied", {
      origin: request.headers.get("Origin") || "",
      allowed_origins_configured: Boolean(String(env.ALLOWED_ORIGINS || "").trim()),
    });
    return json({ error: "Надсилання заявок зараз недоступне." }, 403, "null");
  }

  const geoDecision = await checkApplicationGeoAccess(request, env);
  if (geoDecision.blocked) {
    logWorkerEvent("warn", "application.create.geo_blocked", {
      country: geoDecision.country || null,
      reason: geoDecision.reason,
      blockedCountries: geoDecision.policy.blockedCountries,
      ms: elapsedMs(startedAt),
    });
    return json({ error: "Подання заявки з цієї країни зараз недоступне." }, 403, origin);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    logWorkerEvent("warn", body.status === 413 ? "application.create.body_too_large" : "application.create.invalid_json", { ms: elapsedMs(startedAt) });
    return json({ error: body.error }, body.status, origin);
  }

  const payload = body.data;
  if (!payload || typeof payload !== "object") {
    logWorkerEvent("warn", "application.create.invalid_payload", { ms: elapsedMs(startedAt) });
    return json({ error: "Не вдалося обробити заявку. Спробуй ще раз." }, 400, origin);
  }

  if (cleanText(payload.website, 200)) {
    logWorkerEvent("warn", "application.create.honeypot", { ms: elapsedMs(startedAt) });
    return json({ error: "Не вдалося надіслати заявку. Спробуй ще раз." }, 400, origin);
  }

  const cleanPayload = sanitizePayload(payload);
  const validationError = validateApplication(cleanPayload);

  if (validationError) {
    logWorkerEvent("warn", "application.create.validation_failed", {
      message: validationError,
      region: cleanPayload.region,
      faction: cleanPayload.faction,
      realm: cleanPayload.realm,
      characterName: cleanPayload.characterName,
      hasAvailability: Boolean(cleanPayload.availability),
      hasBattleTag: Boolean(cleanPayload.battleTag),
      ms: elapsedMs(startedAt),
    });
    return json({ error: validationError }, 400, origin);
  }

  try {
    const verification = await runMeasured(
      "application.character.verify",
      { characterName: cleanPayload.characterName, realm: cleanPayload.realm, region: cleanPayload.region },
      () => verifyApplicationCharacter(env, cleanPayload)
    );

    if (!verification.ok) {
      logWorkerEvent("warn", "application.create.character_invalid", {
        characterName: cleanPayload.characterName,
        realm: cleanPayload.realm,
        region: cleanPayload.region,
        raider_io: verification.raider_io?.ok || false,
        battlenet: verification.battlenet?.ok || false,
        ms: elapsedMs(startedAt),
      });
      return json({ error: verification.error || "Невірно введені дані персонажа." }, 400, origin);
    }

    cleanPayload._verification = verification;

    const issue = await runMeasured(
      "application.firebase.create",
      { characterName: cleanPayload.characterName, realm: cleanPayload.realm, region: cleanPayload.region },
      () => createFirebaseApplication(env, cleanPayload, verification)
    );

    const useAsyncDiscord =
      ctx &&
      typeof ctx.waitUntil === "function" &&
      String(env.APPLICATION_DISCORD_ASYNC || "1").trim() !== "0";

    let discord = { queued: true, async: true };

    if (useAsyncDiscord) {
      ctx.waitUntil(completeDiscordNotification(env, cleanPayload, issue));
      logWorkerEvent("info", "application.discord.queued", { issueNumber: issue.number });
    } else {
      discord = await completeDiscordNotification(env, cleanPayload, issue);
    }

    await invalidateApplicationCaches(env, ctx);

    logWorkerEvent("info", "application.create.done", {
      storage: "firebase",
      issueNumber: issue.number,
      discord_async: useAsyncDiscord,
      ms: elapsedMs(startedAt),
    });

    return json(
      {
        ok: true,
        number: issue.number,
        application_number: issue.application_number || issue.number,
        tracking_number: issue.tracking_number || "",
        state: issue.state,
        status_text: STATUS.REVIEW.label,
        title: issue.title,
        verification: {
          raider_io: Boolean(verification.raider_io?.ok),
          battlenet: Boolean(verification.battlenet?.ok),
        },
        discord,
      },
      201,
      origin
    );
  } catch (error) {
    logWorkerEvent("error", "application.create.failed", {
      message: error?.message,
      characterName: cleanPayload.characterName,
      realm: cleanPayload.realm,
      region: cleanPayload.region,
      ms: elapsedMs(startedAt),
    });

    return json(
      {
        error: error instanceof Error ? error.message : "Невідома помилка.",
      },
      500,
      origin
    );
  }
}

function raidLifecycleCronMinIntervalMs(env) {
  return readDurationMs(env, ["WORKER_RAID_LIFECYCLE_MIN_INTERVAL_MS", "RAID_LIFECYCLE_CRON_MIN_INTERVAL_MS"], 9 * 60_000, 60_000, 60 * 60_000);
}

function raidPollCloseDueCronMinIntervalMs(env) {
  return readDurationMs(env, ["WORKER_RAID_POLL_CLOSE_DUE_MIN_INTERVAL_MS", "RAID_POLL_CLOSE_DUE_CRON_MIN_INTERVAL_MS"], 9 * 60_000, 60_000, 60 * 60_000);
}

function dashboardRaidLifecycleEndpoint(env) {
  const explicit = String(env.DASHBOARD_RAID_LIFECYCLE_ENDPOINT || "").trim();
  if (explicit) return explicit;
  try {
    return new URL("/api/raids/lifecycle?limit=20", dashboardAuthUrl(env)).toString();
  } catch {
    return "https://admin.lihvodruida.pp.ua/api/raids/lifecycle?limit=20";
  }
}

function dashboardRaidLifecycleToken(env) {
  return String(
    env.RAID_LIFECYCLE_SECRET ||
    env.CRON_SECRET ||
    env.INTERNAL_PROFILE_LOOKUP_TOKEN ||
    env.DISCORD_RULES_STATS_TOKEN ||
    env.WORKER_STATS_TOKEN ||
    ""
  ).trim();
}

async function runRaidLifecycleCronUnsafe(env, reason = "scheduled") {
  const token = dashboardRaidLifecycleToken(env);
  if (!token) {
    logWorkerEvent("warn", "raid_lifecycle.missing_token", { reason });
    return { ok: false, error: "missing lifecycle token" };
  }

  const endpoint = dashboardRaidLifecycleEndpoint(env);
  try {
    const { response, raw } = await fetchDashboardText(env, endpoint, token, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-worker-stats-token": token,
      },
    }, { timeoutMs: 14000, retries: 1 });
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok || !data?.ok) {
      logWorkerEvent("warn", "raid_lifecycle.bad_response", { status: response.status, raw: raw.slice(0, 180), reason });
      return { ok: false, status: response.status };
    }
    logWorkerEvent("info", "raid_lifecycle.done", {
      reason,
      checked: data.checked,
      total: data.total,
      autoClosed: data.autoClosed || 0,
      discordDeleted: data.discordDeleted || 0,
      failed: data.failed || 0,
    });
    return data;
  } catch (error) {
    logWorkerEvent("error", "raid_lifecycle.failed", { reason, message: error?.message });
    return { ok: false, error: error?.message || "unknown" };
  }
}

async function runRaidLifecycleCron(env, reason = "scheduled") {
  return runWorkerCronGuarded(
    env,
    "raid_lifecycle",
    reason,
    raidLifecycleCronMinIntervalMs(env),
    () => runRaidLifecycleCronUnsafe(env, reason),
  );
}

function dashboardRaidPollCloseDueEndpoint(env) {
  const explicit = String(env.DASHBOARD_RAID_POLL_CLOSE_DUE_ENDPOINT || env.DASHBOARD_POLL_CLOSE_DUE_ENDPOINT || "").trim();
  if (explicit) return explicit;
  try {
    return new URL("/api/polls/close-due", dashboardAuthUrl(env)).toString();
  } catch {
    return "https://admin.lihvodruida.pp.ua/api/polls/close-due";
  }
}

function dashboardRaidPollCloseDueToken(env) {
  return String(
    env.RAID_LIFECYCLE_SECRET ||
    env.CRON_SECRET ||
    env.INTERNAL_PROFILE_LOOKUP_TOKEN ||
    env.DISCORD_RULES_STATS_TOKEN ||
    env.WORKER_STATS_TOKEN ||
    ""
  ).trim();
}

async function runRaidPollCloseDueCronUnsafe(env, reason = "scheduled") {
  const token = dashboardRaidPollCloseDueToken(env);
  if (!token) {
    logWorkerEvent("warn", "raid_poll_close_due.missing_token", { reason });
    return { ok: false, error: "missing poll close-due token" };
  }

  const endpoint = dashboardRaidPollCloseDueEndpoint(env);
  try {
    const { response, raw } = await fetchDashboardText(env, endpoint, token, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-worker-stats-token": token,
      },
    }, { timeoutMs: 12000, retries: 0 });
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok || !data?.ok) {
      logWorkerEvent("warn", "raid_poll_close_due.bad_response", { status: response.status, raw: raw.slice(0, 180), reason });
      return { ok: false, status: response.status };
    }
    logWorkerEvent("info", "raid_poll_close_due.done", {
      reason,
      checked: data.checked || 0,
      closed: data.closed || 0,
      repeatedChecked: data.repeatedChecked || 0,
      repeated: data.repeated || 0,
      deleted: data.deleted || 0,
      failed: data.failed || 0,
    });
    return data;
  } catch (error) {
    logWorkerEvent("error", "raid_poll_close_due.failed", { reason, message: error?.message });
    return { ok: false, error: error?.message || "unknown" };
  }
}

async function runRaidPollCloseDueCron(env, reason = "scheduled") {
  return runWorkerCronGuarded(
    env,
    "raid_poll_close_due",
    reason,
    raidPollCloseDueCronMinIntervalMs(env),
    () => runRaidPollCloseDueCronUnsafe(env, reason),
  );
}

export default {
  async fetch(request, env, ctx) {
    const startedAt = nowMs();
    const requestId = requestIdFromRequest(request);
    const url = new URL(request.url);

    if (String(env.DEBUG_LOGS || "").trim() === "1") {
      logWorkerEvent("info", "request.start", {
        requestId,
        method: request.method,
        path: url.pathname,
        query: url.search ? url.search.slice(0, 500) : "",
        origin: request.headers.get("Origin") || "",
      });
    }

    let response;

    try {
      if (request.method === "OPTIONS") {
        response = new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": allowedOrigin(request, env) || "null",
            "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Worker-Stats-Token",
            "Cache-Control": "no-store",
            "Vary": "Origin",
          },
        });
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/discord-rules-stats" && request.method === "GET") {
        response = await withPublicApiHttpCache(request, env, ctx, { namespace: "rules-stats", ttlEnv: "PUBLIC_API_RULES_STATS_CACHE_SECONDS", ttlSeconds: 60, tags: ["rules"] }, () => handleRulesStats(request, env));
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/discord-raid-rules-stats" && request.method === "GET") {
        response = await withPublicApiHttpCache(request, env, ctx, { namespace: "raid-rules-stats", ttlEnv: "PUBLIC_API_RULES_STATS_CACHE_SECONDS", ttlSeconds: 60, tags: ["rules", "raid-rules"] }, () => handleRaidRulesStats(request, env));
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/discord-raid-rules-signups" && request.method === "GET") {
        response = await withPublicApiHttpCache(request, env, ctx, { namespace: "raid-rules-signups", ttlEnv: "PUBLIC_API_SIGNUPS_CACHE_SECONDS", ttlSeconds: 45, tags: ["rules", "raid-rules"] }, () => handleRaidRulesSignups(request, env));
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/discord-raid-message" && request.method === "POST") {
        response = await handleRaidDiscordMessageRelay(request, env);
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/discord-guild-channels" && request.method === "GET") {
        response = await withPublicApiHttpCache(request, env, ctx, { namespace: "discord-channels", ttlEnv: "PUBLIC_API_DISCORD_CHANNELS_CACHE_SECONDS", ttlSeconds: 900, tags: ["discord"] }, () => handleDiscordGuildChannels(request, env));
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/public-cache") {
        response = await handlePublicApiCache(request, env);
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/raids/lifecycle" && (request.method === "GET" || request.method === "POST")) {
        const result = await runRaidLifecycleCron(env, "manual-worker-endpoint");
        response = json(result, result?.ok ? 200 : 500, allowedOrigin(request, env) || "null");
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/polls/close-due" && (request.method === "GET" || request.method === "POST")) {
        const result = await runRaidPollCloseDueCron(env, "manual-worker-endpoint");
        response = json(result, result?.ok ? 200 : 500, allowedOrigin(request, env) || "null");
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (url.pathname === "/api/discord-interactions" && request.method === "POST") {
        response = await handleDiscordInteraction(request, env, ctx);
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (!PATHS.has(url.pathname)) {
        response = json(
          { error: "Сторінку не знайдено." },
          404,
          allowedOrigin(request, env) || "null"
        );
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      try {
        requireFirebaseConfig(env);
      } catch (error) {
        logWorkerEvent("error", "request.env_missing", {
          requestId,
          path: url.pathname,
          message: error?.message,
          env: envDiagnostics(env),
        });
        response = json({ error: "Прийом заявок тимчасово недоступний.", diagnostics: isDebugResponseEnabled(request, env) ? envDiagnostics(env) : undefined }, 500, allowedOrigin(request, env) || "null");
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (request.method === "GET") {
        response = await withPublicApiHttpCache(request, env, ctx, { namespace: "applications", ttlEnv: "PUBLIC_API_APPLICATIONS_CACHE_SECONDS", ttlSeconds: 90, tags: ["applications"] }, () => listApplications(request, env));
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      if (request.method === "POST") {
        response = await createApplication(request, env, ctx);
        return withTelemetryHeaders(response, requestId, startedAt);
      }

      response = json(
        { error: "Ця дія зараз недоступна." },
        405,
        allowedOrigin(request, env) || "null"
      );
      return withTelemetryHeaders(response, requestId, startedAt);
    } catch (error) {
      logWorkerEvent("error", "request.unhandled", {
        requestId,
        method: request.method,
        path: url.pathname,
        message: error?.message,
        stack: String(error?.stack || "").slice(0, 1200),
        ms: elapsedMs(startedAt),
      });

      response = json(
        {
          error: "Внутрішня помилка сервера.",
          request_id: requestId,
          diagnostics: isDebugResponseEnabled(request, env)
            ? { message: error?.message, env: envDiagnostics(env) }
            : undefined,
        },
        500,
        allowedOrigin(request, env) || "null"
      );
      return withTelemetryHeaders(response, requestId, startedAt);
    } finally {
      logWorkerEvent("info", "request.end", {
        requestId,
        method: request.method,
        path: url.pathname,
        status: response?.status,
        ms: elapsedMs(startedAt),
      });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await runRaidLifecycleCron(env, "cloudflare-cron");
      await runRaidPollCloseDueCron(env, "cloudflare-cron");
    })());
  },
};
