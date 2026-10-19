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
  totalTimeoutMs?: number;
  maxRetryWaitMs?: number;
};

export class ApiHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  readonly retryAfterMs: number | null;
  readonly retryAt: number | null;

  constructor(message: string, options: { status: number; url: string; body?: unknown; retryAfterMs?: number | null; retryAt?: number | null }) {
    super(message);
    this.name = "ApiHttpError";
    this.status = options.status;
    this.url = options.url;
    this.body = options.body ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryAt = options.retryAt ?? (this.retryAfterMs === null ? null : Date.now() + this.retryAfterMs);
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

export function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function retryDelayMs(attempt: number, retryAfterMs: number | null) {
  if (retryAfterMs !== null) return retryAfterMs;
  const base = 350 * Math.pow(2, Math.max(0, attempt));
  const jitter = Math.floor(Math.random() * 180);
  return Math.min(10_000, base + jitter);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.max(0, ms));
    signal?.addEventListener("abort", abort, { once: true });
  });
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
  // HTTP failures have already been considered by shouldRetryResponse.
  // Treating a rejected 403/404 as a network failure repeats it needlessly.
  if (error instanceof ApiHttpError) return false;
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
  const totalTimeoutMs = Math.max(500, Math.min(120_000, Number(options.totalTimeoutMs ?? timeoutMs * (retries + 1))));
  const deadlineAt = Date.now() + totalTimeoutMs;
  const maxWait = Math.max(0, Math.min(20_000, Number(options.maxRetryWaitMs ?? 5_000)));
  const headers = new Headers(options.headers || {});

  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.userAgent && typeof window === "undefined" && !headers.has("User-Agent")) {
    headers.set("User-Agent", options.userAgent);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    options.signal?.throwIfAborted();
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw lastError instanceof Error ? lastError : new Error(`${label} timeout after ${totalTimeoutMs}ms`);
    const abort = composeAbortSignal(Math.min(timeoutMs, remaining), options.signal);
    try {
      const response = await fetch(input, {
        ...options,
        method,
        headers,
        cache: options.cache ?? "no-store",
        signal: abort.signal,
      });
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const retryAt = retryAfterMs === null ? null : Date.now() + retryAfterMs;
      const body = await parseResponseBody(response);
      if (response.ok) return body as T;

      const error = new ApiHttpError(errorMessage(label, response.status, body), {
        status: response.status,
        url: safeUrl(input),
        body,
        retryAfterMs,
        retryAt,
      });
      lastError = error;

      if (attempt < retries && shouldRetryResponse(response.status, method, options)) {
        const delay = retryAt === null ? retryDelayMs(attempt, null) : Math.max(0, retryAt - Date.now());
        if (delay > maxWait || delay >= deadlineAt - Date.now()) throw error;
        abort.cleanup();
        await sleep(delay, options.signal);
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw options.signal.reason;
      if (attempt < retries && shouldRetryNetworkError(error, method, options)) {
        const delay = retryDelayMs(attempt, null);
        if (delay > maxWait || delay >= deadlineAt - Date.now()) throw error;
        abort.cleanup();
        await sleep(delay, options.signal);
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
