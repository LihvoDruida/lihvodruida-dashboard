import { NextRequest, NextResponse } from "next/server";
import { getDashboardUrl } from "@/lib/oauth";

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const inMemoryBuckets = new Map<string, { count: number; resetAt: number }>();

type LogLevel = "debug" | "info" | "warn" | "error";

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export function bearerTokenFromRequest(request: Request | NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || request.headers.get("x-worker-stats-token")?.trim() || "";
}

function configuredSecretsFromEnv(names: string[], minLength: number) {
  return names
    .map((name) => ({ name, value: String(process.env[name] || "").trim() }))
    .filter((secret) => secret.value.length >= minLength);
}

export async function verifyInternalBearerToken(
  request: Request | NextRequest,
  envNames: string[],
  options: { minLength?: number } = {},
) {
  const minLength = options.minLength ?? 24;
  const expectedSecrets = configuredSecretsFromEnv(envNames, minLength);
  if (!expectedSecrets.length) {
    return { ok: false, reason: "server_token_not_configured" as const };
  }

  const provided = bearerTokenFromRequest(request);
  if (!provided || provided.length < minLength) {
    return { ok: false, reason: "missing_or_short_token" as const };
  }

  const providedHash = await sha256Hex(provided);
  const expectedHashes = await Promise.all(
    expectedSecrets.map(async (secret) => ({ name: secret.name, hash: await sha256Hex(secret.value) })),
  );
  const matched = expectedHashes.find((secret) => constantTimeEqual(providedHash, secret.hash));

  return {
    ok: Boolean(matched),
    reason: matched ? "ok" as const : "token_mismatch" as const,
    envName: matched?.name || expectedSecrets.map((secret) => secret.name).join(","),
  };
}

function redactLogValue(value: unknown, depth = 0): unknown {
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

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactLogValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).slice(0, 40).map(([key, item]) => {
        if (/token|secret|password|authorization|cookie|signature/i.test(key)) {
          return [key, "[redacted]"];
        }
        return [key, redactLogValue(item, depth + 1)];
      })
    );
  }

  return String(value).slice(0, 240);
}

export function splitCsv(value?: string | null) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function envFlag(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

export function getAllowedDashboardHosts() {
  const configured = splitCsv(process.env.DASHBOARD_ALLOWED_HOSTS);
  const explicitDashboardUrl = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.NEXTAUTH_URL;

  if (!explicitDashboardUrl) {
    return configured;
  }

  try {
    const host = new URL(explicitDashboardUrl).host;
    return Array.from(new Set([...configured, host]));
  } catch {
    return configured;
  }
}

export function getCanonicalDashboardOrigin() {
  return new URL(getDashboardUrl()).origin;
}

export function normalizeHost(value?: string | null) {
  const host = String(value || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  if (host.endsWith(":443")) return host.slice(0, -4);
  if (host.endsWith(":80")) return host.slice(0, -3);
  return host;
}

export function getRequestHost(request: Request | NextRequest) {
  // Prefer the public Host header. On Vercel behind Cloudflare, x-forwarded-host can
  // sometimes contain an internal deployment host, which breaks same-origin checks.
  return normalizeHost(request.headers.get("host") || request.headers.get("x-forwarded-host") || "");
}

export function getForwardedHost(request: Request | NextRequest) {
  return normalizeHost(request.headers.get("x-forwarded-host"));
}

export function isLocalHost(host: string) {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

export function isAllowedHost(host: string) {
  if (!host) return false;
  const normalized = normalizeHost(host);
  if (isLocalHost(normalized)) return process.env.NODE_ENV !== "production";

  const allowed = getAllowedDashboardHosts().map((item) => normalizeHost(item));
  if (allowed.length === 0) return true;

  return allowed.some((allowedHost) => {
    if (!allowedHost) return false;
    if (allowedHost.startsWith("*.")) {
      const suffix = allowedHost.slice(1);
      return normalized.endsWith(suffix) && normalized !== suffix.slice(1);
    }
    return normalized === allowedHost;
  });
}

export function getClientIp(request: Request | NextRequest) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";

  return request.headers.get("x-real-ip") || "unknown";
}

export function requestContext(request: Request | NextRequest) {
  let path = "unknown";
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = "unknown";
  }

  return {
    method: String(request.method || "GET").toUpperCase(),
    path,
    host: getRequestHost(request),
    ip: getClientIp(request),
    origin: request.headers.get("origin") || null,
    refererHost: (() => {
      const referer = request.headers.get("referer");
      if (!referer) return null;
      try {
        return normalizeHost(new URL(referer).host);
      } catch {
        return "invalid";
      }
    })(),
    secFetchSite: request.headers.get("sec-fetch-site") || null,
    cfRay: request.headers.get("cf-ray") || null,
    userAgent: (request.headers.get("user-agent") || "unknown").slice(0, 180),
  };
}

export function logDashboardEvent(
  level: LogLevel,
  event: string,
  request?: Request | NextRequest,
  details: Record<string, unknown> = {}
) {
  if (level === "debug" && !envFlag("DASHBOARD_DEBUG_LOGS") && !envFlag("SECURITY_DEBUG_LOGS")) {
    return;
  }

  const payload = redactLogValue({
    event,
    requestId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined,
    time: new Date().toISOString(),
    ...(request ? requestContext(request) : {}),
    ...details,
  }) as Record<string, unknown>;

  const line = `[dashboard:${level}] ${JSON.stringify(payload)}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = inMemoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    inMemoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: now + windowMs };
  }

  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

export function rateLimitResponse(resetAt: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Забагато запитів. Спробуй трохи пізніше." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    }
  );
}

export function assertRequestBodySize(request: Request | NextRequest, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const raw = request.headers.get("content-length");
  if (!raw) return null;

  const size = Number(raw);
  if (Number.isFinite(size) && size > maxBytes) {
    logDashboardEvent("warn", "request_body_too_large", request, { size, maxBytes });

    return NextResponse.json(
      { error: "Запит завеликий." },
      { status: 413, headers: { "Cache-Control": "no-store" } }
    );
  }

  return null;
}

function trustedHeaderUrl(value: string | null) {
  if (!value) return { trusted: false, host: null as string | null, reason: "missing" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { trusted: false, host: null as string | null, reason: "invalid_url" };
  }

  const urlHost = normalizeHost(url.host);
  const safeProtocol = url.protocol === "https:" || (process.env.NODE_ENV !== "production" && isLocalHost(urlHost));

  if (!safeProtocol) {
    return { trusted: false, host: urlHost, reason: "bad_protocol" };
  }

  if (!isAllowedHost(urlHost)) {
    return { trusted: false, host: urlHost, reason: "host_not_allowed" };
  }

  return { trusted: true, host: urlHost, reason: "trusted" };
}

function strictOriginChecksEnabled() {
  return envFlag("SECURITY_STRICT_ORIGIN_CHECKS", false);
}

export function verifyTrustedOrigin(request: Request | NextRequest) {
  const method = String(request.method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;

  const host = getRequestHost(request);
  const reject = (reason: string, details: Record<string, unknown> = {}) => {
    logDashboardEvent("warn", "trusted_origin_rejected", request, { reason, ...details });
    return false;
  };

  if (!isAllowedHost(host)) return reject("host_not_allowed", { host });

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const fetchSite = String(request.headers.get("sec-fetch-site") || "").toLowerCase();
  const dashboardAction = request.headers.get("x-dashboard-action");

  const origin = trustedHeaderUrl(originHeader);
  const referer = trustedHeaderUrl(refererHeader);

  // Explicitly bad Origin/Referer headers are blocked. Missing browser metadata is
  // handled below, because Cloudflare/Vercel/privacy tools may strip some headers.
  if (originHeader && !origin.trusted) {
    return reject(`origin_${origin.reason}`, { originHost: origin.host, host, fetchSite });
  }

  if (refererHeader && !referer.trusted) {
    return reject(`referer_${referer.reason}`, { refererHost: referer.host, host, fetchSite });
  }

  // Browser Fetch Metadata is the strongest CSRF signal when available.
  if (fetchSite === "cross-site") {
    return reject("cross_site_fetch", { host, originHost: origin.host, refererHost: referer.host });
  }

  if (fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none") {
    return true;
  }

  if (origin.trusted || referer.trusted) return true;

  // A custom dashboard header cannot be sent by a normal cross-site form, and a
  // browser cross-site fetch with this header would require a CORS preflight.
  if (dashboardAction) return true;

  // Do not break real same-origin form submits if a proxy/browser strips metadata.
  // Session cookies are SameSite=Lax, so cross-site POSTs do not carry the admin
  // session in modern browsers. Enable SECURITY_STRICT_ORIGIN_CHECKS=true only if
  // your edge stack reliably preserves Origin/Referer/Sec-Fetch-*.
  if (!strictOriginChecksEnabled()) {
    logDashboardEvent("warn", "trusted_origin_metadata_missing_allowed", request, { host });
    return true;
  }

  return reject(fetchSite ? `missing_trusted_metadata_${fetchSite}` : "missing_trusted_metadata", { host });
}

export function forbiddenResponse(message = "Запит заблоковано політикою безпеки.") {
  return NextResponse.json(
    { error: message },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}

export function unauthorizedResponse(message = "Потрібна авторизація.") {
  return NextResponse.json(
    { error: message },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

function userFriendlyErrorMessage(message: string, fallback: string) {
  const text = message.trim();
  if (!text) return fallback;

  if (/firebase|profile storage|firestore/i.test(text)) {
    return "Збереження тимчасово недоступне. Спробуй пізніше або звернись до гільдмайстра.";
  }

  if (/режим тільки читання|дані можна переглядати|read.?only|write.*unavailable/i.test(text)) {
    return "Панель зараз у режимі тільки читання: перегляд працює, але зміни тимчасово не зберігаються.";
  }

  if (/channel_id|message id|unknown message|10008|discord.*404|invalid form body/i.test(text)) {
    return "Discord не підтвердив повідомлення. Перевір канал і повтори дію.";
  }

  if (/fetch failed|network|econn|etimedout|timeout/i.test(text)) {
    return "Не вдалося зв’язатися із зовнішнім сервісом. Повтори спробу трохи пізніше.";
  }

  if (/token|credential|private key|client secret|authorization/i.test(text)) {
    return "Авторизація тимчасово недоступна. Спробуй пізніше або звернись до гільдмайстра.";
  }

  return text;
}

export function safeErrorMessage(error: unknown, fallback = "Операція не виконана.") {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!message) return fallback;

  const redacted = message
    .replace(/ghp_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/Bot\s+[A-Za-z0-9._-]+/g, "Bot [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 240);

  return userFriendlyErrorMessage(redacted, fallback).slice(0, 240);
}

export function noStoreHeaders(extra?: HeadersInit) {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    ...extra,
  };
}
