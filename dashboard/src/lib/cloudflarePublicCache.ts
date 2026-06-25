import "server-only";

import { logDashboardEvent } from "@/lib/security";

export type PublicCacheReadResult<T> = {
  hit: boolean;
  value: T | null;
  cachedAt: string | null;
  source: "cloudflare-kv" | "disabled" | "miss" | "error";
  error?: string;
};

type PublicCacheWriteOptions = {
  ttlSeconds?: number;
  tags?: string[];
};

const DEFAULT_TIMEOUT_MS = 1800;
const DEFAULT_TTL_SECONDS = 300;

function cleanText(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function isAbortLikeError(error: unknown) {
  const asRecord = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const name = String(asRecord.name || "");
  const code = String(asRecord.code || "");
  const message = error instanceof Error ? error.message : String(error || "");
  const cause = asRecord.cause ? String(asRecord.cause) : "";
  const text = `${name} ${code} ${message} ${cause}`;
  return /AbortError|ABORT_ERR|aborted|abort|operation was aborted|signal is aborted/i.test(text);
}

function positiveInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function workerApiEndpoint(path: string) {
  const explicit = cleanText(
    process.env.PUBLIC_API_CACHE_ENDPOINT ||
    process.env.CLOUDFLARE_PUBLIC_CACHE_ENDPOINT ||
    process.env.CF_PUBLIC_CACHE_ENDPOINT ||
    "",
    500,
  );
  if (explicit) return explicit;

  const base = cleanText(
    process.env.DISCORD_INTERACTIONS_ENDPOINT ||
    process.env.GUILD_APPLICATIONS_WORKER_URL ||
    process.env.NEXT_PUBLIC_GUILD_APPLICATIONS_WORKER_URL ||
    "https://guild-applications.melles-android.workers.dev/api/discord-interactions",
    500,
  );
  if (!base) return "";

  try {
    const url = new URL(base);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function publicCacheEndpoint() {
  return workerApiEndpoint("/api/public-cache");
}

function publicCacheToken() {
  const explicit = cleanText(process.env.PUBLIC_API_CACHE_TOKEN || "", 500);
  if (explicit) return explicit;
  if (String(process.env.PUBLIC_API_CACHE_ALLOW_SHARED_TOKEN || "").trim() === "1") {
    return cleanText(
      process.env.DISCORD_RULES_STATS_TOKEN ||
      process.env.WORKER_STATS_TOKEN ||
      process.env.INTERNAL_PROFILE_LOOKUP_TOKEN ||
      "",
      500,
    );
  }
  return "";
}

export function cloudflarePublicCacheConfigured() {
  return Boolean(publicCacheEndpoint() && publicCacheToken());
}

function publicCacheHeaders(): HeadersInit {
  const token = publicCacheToken();
  return {
    accept: "application/json",
    "content-type": "application/json; charset=utf-8",
    ...(token
      ? {
          authorization: `Bearer ${token}`,
          "x-worker-stats-token": token,
        }
      : {}),
  };
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function cacheDisabled<T>(reason = "Cloudflare KV cache endpoint is not configured."): PublicCacheReadResult<T> {
  return { hit: false, value: null, cachedAt: null, source: "disabled", error: reason };
}

export function publicCacheKey(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => cleanText(part, 120).replace(/\s+/g, "-").replace(/[^A-Za-z0-9:._/-]/g, "_"))
    .filter(Boolean)
    .join(":")
    .slice(0, 220);
}

export async function readPublicCache<T>(key: string, options: { timeoutMs?: number } = {}): Promise<PublicCacheReadResult<T>> {
  const endpoint = publicCacheEndpoint();
  if (!endpoint || !publicCacheToken()) return cacheDisabled<T>();

  try {
    const url = new URL(endpoint);
    url.searchParams.set("key", cleanText(key, 240));
    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: publicCacheHeaders(),
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const data = await response.json().catch(() => null) as { ok?: boolean; hit?: boolean; value?: unknown; cachedAt?: string; error?: string } | null;
    if (!response.ok || !data?.ok) {
      return { hit: false, value: null, cachedAt: null, source: "error", error: data?.error || `Cloudflare cache HTTP ${response.status}` };
    }
    if (!data.hit) return { hit: false, value: null, cachedAt: null, source: "miss" };
    return { hit: true, value: data.value as T, cachedAt: typeof data.cachedAt === "string" ? data.cachedAt : null, source: "cloudflare-kv" };
  } catch (error) {
    return { hit: false, value: null, cachedAt: null, source: "error", error: error instanceof Error ? error.message : String(error || "Cloudflare cache read failed") };
  }
}

export async function writePublicCache(key: string, value: unknown, options: PublicCacheWriteOptions = {}) {
  const endpoint = publicCacheEndpoint();
  if (!endpoint || !publicCacheToken()) return { ok: false, skipped: true, reason: "unconfigured" };

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "PUT",
      headers: publicCacheHeaders(),
      body: JSON.stringify({
        key: cleanText(key, 240),
        value,
        ttlSeconds: positiveInt(options.ttlSeconds, DEFAULT_TTL_SECONDS, 60, 86_400),
        tags: Array.isArray(options.tags) ? options.tags.slice(0, 20) : [],
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: data?.error || `Cloudflare cache HTTP ${response.status}` };
    return data || { ok: true };
  } catch (error) {
    const aborted = isAbortLikeError(error);
    logDashboardEvent(aborted ? "debug" : "warn", aborted ? "cloudflare_public_cache.write_aborted" : "cloudflare_public_cache.write_failed", undefined, {
      key: cleanText(key, 120),
      message: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error || "Cloudflare cache write failed") };
  }
}


export async function invalidatePublicCacheBatch(options: { key?: string | null; prefix?: string | null; keys?: Array<string | null | undefined>; prefixes?: Array<string | null | undefined> }) {
  const endpoint = publicCacheEndpoint();
  if (!endpoint || !publicCacheToken()) return { ok: false, skipped: true, reason: "unconfigured" };

  const body = {
    key: options.key ? cleanText(options.key, 240) : undefined,
    prefix: options.prefix ? cleanText(options.prefix, 240) : undefined,
    keys: Array.isArray(options.keys) ? options.keys.map((key) => cleanText(key, 240)).filter(Boolean).slice(0, 50) : undefined,
    prefixes: Array.isArray(options.prefixes) ? options.prefixes.map((prefix) => cleanText(prefix, 240)).filter(Boolean).slice(0, 20) : undefined,
  };

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "DELETE",
      headers: publicCacheHeaders(),
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: data?.error || `Cloudflare cache HTTP ${response.status}` };
    return data || { ok: true };
  } catch (error) {
    logDashboardEvent("warn", "cloudflare_public_cache.invalidate_batch_failed", undefined, {
      message: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error || "Cloudflare cache batch invalidate failed") };
  }
}
export async function invalidatePublicCachePrefix(prefix: string) {
  const endpoint = publicCacheEndpoint();
  if (!endpoint || !publicCacheToken()) return { ok: false, skipped: true, reason: "unconfigured" };

  try {
    const url = new URL(endpoint);
    url.searchParams.set("prefix", cleanText(prefix, 240));
    const response = await fetchWithTimeout(url.toString(), {
      method: "DELETE",
      headers: publicCacheHeaders(),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: data?.error || `Cloudflare cache HTTP ${response.status}` };
    return data || { ok: true };
  } catch (error) {
    logDashboardEvent("warn", "cloudflare_public_cache.invalidate_failed", undefined, {
      prefix: cleanText(prefix, 120),
      message: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error || "Cloudflare cache invalidate failed") };
  }
}

export async function invalidatePublicCacheKey(key: string) {
  const endpoint = publicCacheEndpoint();
  if (!endpoint || !publicCacheToken()) return { ok: false, skipped: true, reason: "unconfigured" };

  try {
    const url = new URL(endpoint);
    url.searchParams.set("key", cleanText(key, 240));
    const response = await fetchWithTimeout(url.toString(), {
      method: "DELETE",
      headers: publicCacheHeaders(),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: data?.error || `Cloudflare cache HTTP ${response.status}` };
    return data || { ok: true };
  } catch (error) {
    logDashboardEvent("warn", "cloudflare_public_cache.invalidate_key_failed", undefined, {
      key: cleanText(key, 120),
      message: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error || "Cloudflare cache invalidate failed") };
  }
}
