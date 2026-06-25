import "server-only";

import { logDashboardEvent } from "@/lib/security";

export type RuntimeCircuitState = {
  openedAt: number;
  until: number;
  reason: string;
  failures: number;
};

type CacheEntry<T> = {
  value: T;
  cachedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRuntimeCircuitBreakers: Map<string, RuntimeCircuitState> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomRuntimeSingleFlights: Map<string, Promise<unknown>> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomRuntimeValueCache: Map<string, CacheEntry<unknown>> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomRuntimeLogThrottle: Map<string, number> | undefined;
}

function circuitMap() {
  const map = globalThis.__mistblossomRuntimeCircuitBreakers || new Map<string, RuntimeCircuitState>();
  globalThis.__mistblossomRuntimeCircuitBreakers = map;
  return map;
}

function singleFlightMap() {
  const map = globalThis.__mistblossomRuntimeSingleFlights || new Map<string, Promise<unknown>>();
  globalThis.__mistblossomRuntimeSingleFlights = map;
  return map;
}

function valueCache() {
  const map = globalThis.__mistblossomRuntimeValueCache || new Map<string, CacheEntry<unknown>>();
  globalThis.__mistblossomRuntimeValueCache = map;
  return map;
}

function throttleMap() {
  const map = globalThis.__mistblossomRuntimeLogThrottle || new Map<string, number>();
  globalThis.__mistblossomRuntimeLogThrottle = map;
  return map;
}

export function safeErrorText(error: unknown, fallback = "unknown") {
  if (error instanceof Error) return error.message || error.name || fallback;
  return String(error || fallback);
}

export function isQuotaOrResourceError(error: unknown) {
  const anyError = error as { code?: unknown; details?: unknown; message?: unknown } | null;
  const text = [anyError?.code, anyError?.details, anyError?.message, safeErrorText(error)]
    .filter(Boolean)
    .join(" ");
  return /RESOURCE_EXHAUSTED|Quota exceeded|code\s*[:=]\s*8|resource-exhausted/i.test(text);
}

export function isTimeoutLikeError(error: unknown) {
  return /AbortError|timed out|timeout|deadline|ETIMEDOUT|ECONNRESET|socket hang up/i.test(safeErrorText(error));
}

export function isPermissionLikeError(error: unknown) {
  const anyError = error as { code?: unknown; details?: unknown; message?: unknown } | null;
  const text = [anyError?.code, anyError?.details, anyError?.message, safeErrorText(error)]
    .filter(Boolean)
    .join(" ");
  return /PERMISSION_DENIED|permission-denied|unauthorized|unauthenticated|Missing or insufficient permissions|7\s+PERMISSION/i.test(text);
}

export function isUnavailableLikeError(error: unknown) {
  const anyError = error as { code?: unknown; details?: unknown; message?: unknown } | null;
  const text = [anyError?.code, anyError?.details, anyError?.message, safeErrorText(error)]
    .filter(Boolean)
    .join(" ");
  return /UNAVAILABLE|unavailable|Service Unavailable|503|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(text);
}

export function isConfigurationLikeError(error: unknown) {
  return /credential|private key|client_email|project_id|Firebase.*not configured|Profile storage is not configured|invalid.*key|parse.*key/i.test(safeErrorText(error));
}

export function isRecoverableRuntimeError(error: unknown) {
  return isQuotaOrResourceError(error) || isTimeoutLikeError(error) || isPermissionLikeError(error) || isUnavailableLikeError(error) || isConfigurationLikeError(error);
}

function circuitKey(key: string) {
  return String(key || "global").trim().slice(0, 160) || "global";
}

export function getRuntimeCircuit(key: string) {
  const state = circuitMap().get(circuitKey(key));
  if (!state) return null;
  if (state.until <= Date.now()) {
    circuitMap().delete(circuitKey(key));
    return null;
  }
  return state;
}

export function runtimeCircuitOpen(key: string) {
  return Boolean(getRuntimeCircuit(key));
}

export function openRuntimeCircuit(key: string, reason: unknown, ttlMs = 60_000) {
  const cleanKey = circuitKey(key);
  const previous = circuitMap().get(cleanKey);
  const failures = (previous?.failures || 0) + 1;
  const backoff = Math.max(15_000, Math.min(ttlMs * Math.max(1, failures), 10 * 60_000));
  const now = Date.now();
  const state: RuntimeCircuitState = {
    openedAt: now,
    until: now + backoff,
    reason: safeErrorText(reason),
    failures,
  };
  circuitMap().set(cleanKey, state);
  return state;
}

export function clearRuntimeCircuit(key: string) {
  circuitMap().delete(circuitKey(key));
}

export function logThrottled(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {},
  ttlMs = 60_000,
) {
  const key = `${level}:${event}:${JSON.stringify(details).slice(0, 240)}`;
  const now = Date.now();
  const last = throttleMap().get(key) || 0;
  if (now - last < ttlMs) return false;
  throttleMap().set(key, now);
  logDashboardEvent(level, event, undefined, details);
  return true;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = "operation"): Promise<T> {
  const safeTimeout = Math.max(100, Math.floor(Number(timeoutMs) || 0));
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${safeTimeout}ms`)), safeTimeout);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cleanKey = circuitKey(key);
  const flights = singleFlightMap();
  const existing = flights.get(cleanKey) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = loader().finally(() => flights.delete(cleanKey));
  flights.set(cleanKey, promise as Promise<unknown>);
  return promise;
}

export function getRuntimeCachedValue<T>(key: string, ttlMs: number) {
  const entry = valueCache().get(circuitKey(key)) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > Math.max(0, ttlMs)) return null;
  return entry.value;
}

export function getRuntimeStaleValue<T>(key: string) {
  const entry = valueCache().get(circuitKey(key)) as CacheEntry<T> | undefined;
  return entry?.value ?? null;
}

export function setRuntimeCachedValue<T>(key: string, value: T) {
  valueCache().set(circuitKey(key), { value, cachedAt: Date.now() });
  return value;
}

export function clearRuntimeCachedValue(key: string) {
  valueCache().delete(circuitKey(key));
}

export function clearRuntimeCachedValuesByPrefix(prefix: string) {
  const cleanPrefix = circuitKey(prefix);
  for (const key of valueCache().keys()) {
    if (key.startsWith(cleanPrefix)) valueCache().delete(key);
  }
}

export async function resilientRead<T>(
  key: string,
  loader: () => Promise<T>,
  options: {
    ttlMs: number;
    timeoutMs?: number;
    fallback: () => T;
    circuitKey?: string;
    circuitTtlMs?: number;
    logEvent?: string;
    bypassCache?: boolean;
  },
): Promise<T> {
  const valueKey = circuitKey(key);
  const breakerKey = options.circuitKey || "firebase-read";
  if (!options.bypassCache) {
    const cached = getRuntimeCachedValue<T>(valueKey, options.ttlMs);
    if (cached !== null) return cached;
  }

  const circuit = getRuntimeCircuit(breakerKey);
  if (circuit) {
    const stale = getRuntimeStaleValue<T>(valueKey);
    return stale !== null ? stale : options.fallback();
  }

  try {
    const loaded = await singleFlight(`read:${valueKey}`, async () => {
      const operation = loader();
      return options.timeoutMs ? withTimeout(operation, options.timeoutMs, valueKey) : operation;
    });
    clearRuntimeCircuit(breakerKey);
    return setRuntimeCachedValue(valueKey, loaded);
  } catch (error) {
    if (isRecoverableRuntimeError(error)) {
      openRuntimeCircuit(breakerKey, error, options.circuitTtlMs || 60_000);
    }
    if (options.logEvent) {
      logThrottled("warn", options.logEvent, { message: safeErrorText(error) }, 5 * 60_000);
    }
    const stale = getRuntimeStaleValue<T>(valueKey);
    return stale !== null ? stale : options.fallback();
  }
}

export async function resilientWrite<T>(
  key: string,
  writer: () => Promise<T>,
  options: {
    circuitKey?: string;
    circuitTtlMs?: number;
    timeoutMs?: number;
    fallback: () => T | Promise<T>;
    logEvent?: string;
  },
): Promise<T> {
  const breakerKey = options.circuitKey || "firebase-write";
  const circuit = getRuntimeCircuit(breakerKey);
  if (circuit) return options.fallback();
  try {
    const operation = writer();
    const result = await (options.timeoutMs ? withTimeout(operation, options.timeoutMs, key) : operation);
    clearRuntimeCircuit(breakerKey);
    return result;
  } catch (error) {
    if (isRecoverableRuntimeError(error)) {
      openRuntimeCircuit(breakerKey, error, options.circuitTtlMs || 60_000);
    }
    if (options.logEvent) {
      logThrottled("warn", options.logEvent, { message: safeErrorText(error) }, 5 * 60_000);
    }
    return options.fallback();
  }
}
