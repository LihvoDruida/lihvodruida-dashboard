export type ApiRetryDecision = {
  retry: boolean;
  delayMs: number;
};

export type ApiFetchJsonOptions = Omit<RequestInit, "cache" | "signal"> & {
  label?: string;
  timeoutMs?: number;
  retries?: number;
  retryMethods?: string[];
  retryStatuses?: number[];
  cache?: RequestCache;
  signal?: AbortSignal;
  userAgent?: string;
};

export class ApiHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  readonly retryAfterMs: number | null;

  constructor(message: string, options: { status: number; url: string; body?: unknown; retryAfterMs?: number | null }) {
    super(message);
    this.name = "ApiHttpError";
    this.status = options.status;
    this.url = options.url;
    this.body = options.body ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];
const DEFAULT_RETRY_METHODS = ["GET", "HEAD", "OPTIONS"];

function safeUrl(value: RequestInfo | URL) {
  try {
    if (typeof value === "string") return value;
    if (value instanceof URL) return value.toString();
    if (value instanceof Request) return value.url;
  } catch {
    // Ignore malformed Request-like objects.
  }
  return "unknown-url";
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(60_000, Math.max(250, seconds * 1000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(60_000, Math.max(250, date - Date.now()));
  return null;
}

function retryDelayMs(attempt: number, retryAfterMs: number | null) {
  if (retryAfterMs !== null) return retryAfterMs;
  const base = 350 * Math.pow(2, Math.max(0, attempt));
  const jitter = Math.floor(Math.random() * 180);
  return Math.min(10_000, base + jitter);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function normalizeMethod(method?: string) {
  return String(method || "GET").trim().toUpperCase() || "GET";
}

function shouldRetryResponse(status: number, method: string, options: ApiFetchJsonOptions) {
  const statuses = options.retryStatuses || DEFAULT_RETRY_STATUSES;
  const methods = options.retryMethods || DEFAULT_RETRY_METHODS;
  return statuses.includes(status) && methods.map((item) => item.toUpperCase()).includes(method);
}

function shouldRetryNetworkError(error: unknown, method: string, options: ApiFetchJsonOptions) {
  const methods = options.retryMethods || DEFAULT_RETRY_METHODS;
  if (!methods.map((item) => item.toUpperCase()).includes(method)) return false;
  const name = (error as Error | null)?.name || "";
  return name !== "AbortError";
}

function composeAbortSignal(timeoutMs: number, upstream?: AbortSignal) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  function abort() {
    if (!controller.signal.aborted) controller.abort();
  }

  if (upstream?.aborted) abort();
  if (upstream) upstream.addEventListener("abort", abort, { once: true });
  if (timeoutMs > 0) timeout = setTimeout(abort, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      if (timeout) clearTimeout(timeout);
      if (upstream) upstream.removeEventListener("abort", abort);
    },
  };
}

async function parseResponseBody(response: Response) {
  const raw = await response.text();
  if (!raw) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function errorMessage(label: string, status: number, body: unknown) {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message || record.error_description || record.error || record.detail;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 500);
  return `${label} returned ${status}`;
}

export async function apiFetchJson<T = unknown>(input: RequestInfo | URL, options: ApiFetchJsonOptions = {}): Promise<T> {
  const label = options.label || "API request";
  const method = normalizeMethod(options.method);
  const retries = Math.max(0, Math.min(5, Math.floor(Number(options.retries ?? 0))));
  const timeoutMs = Math.max(500, Math.min(120_000, Math.floor(Number(options.timeoutMs ?? 15_000))));
  const headers = new Headers(options.headers || {});

  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.userAgent && typeof window === "undefined" && !headers.has("User-Agent")) {
    headers.set("User-Agent", options.userAgent);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const abort = composeAbortSignal(timeoutMs, options.signal);
    try {
      const response = await fetch(input, {
        ...options,
        method,
        headers,
        cache: options.cache ?? "no-store",
        signal: abort.signal,
      });
      const body = await parseResponseBody(response);
      if (response.ok) return body as T;

      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const error = new ApiHttpError(errorMessage(label, response.status, body), {
        status: response.status,
        url: safeUrl(input),
        body,
        retryAfterMs,
      });
      lastError = error;

      if (attempt < retries && shouldRetryResponse(response.status, method, options)) {
        await sleep(retryDelayMs(attempt, retryAfterMs));
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error;
      if (attempt < retries && shouldRetryNetworkError(error, method, options)) {
        await sleep(retryDelayMs(attempt, null));
        continue;
      }
      if ((error as Error)?.name === "AbortError") {
        throw new Error(`${label} timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      abort.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}
