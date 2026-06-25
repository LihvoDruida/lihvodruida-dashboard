import { availableParallelism } from "node:os";

export type ConcurrencyProfile = "io" | "external-api" | "write" | "cpu" | "batch";

export type ConcurrentMapOptions = {
  concurrency?: number;
  envKey?: string;
  maxEnvKey?: string;
  min?: number;
  max?: number;
  profile?: ConcurrencyProfile;
  failFast?: boolean;
};

export type ConcurrentMapMeta = {
  total: number;
  concurrency: number;
  durationMs: number;
  failed: number;
};

export type ConcurrentMapSettledItem<T> = {
  index: number;
  item: T;
  ok: boolean;
  value?: T;
  error?: unknown;
};

const DEFAULT_MAX_BY_PROFILE: Record<ConcurrencyProfile, number> = {
  io: 16,
  "external-api": 8,
  write: 4,
  cpu: 2,
  batch: 12,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function readIntegerEnv(name: string, fallback: number, min = 1, max = 256) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return clamp(Math.floor(value), min, max);
}

export function runtimeParallelism() {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return 2;
  }
}

export function getAdaptiveConcurrency(total: number, options: ConcurrentMapOptions = {}) {
  const profile = options.profile || "io";
  const safeTotal = Math.max(1, Math.floor(total || 1));
  const min = Math.max(1, Math.floor(options.min || 1));
  const defaultMax = DEFAULT_MAX_BY_PROFILE[profile] || DEFAULT_MAX_BY_PROFILE.io;
  const globalMax = readIntegerEnv("DASHBOARD_MAX_CONCURRENCY", defaultMax, 1, 128);
  const profileMax = options.maxEnvKey
    ? readIntegerEnv(options.maxEnvKey, Math.min(defaultMax, globalMax), 1, globalMax)
    : defaultMax;
  const max = Math.max(min, Math.min(options.max || profileMax, profileMax, globalMax, safeTotal));

  if (options.concurrency && Number.isFinite(options.concurrency)) {
    return clamp(Math.floor(options.concurrency), min, max);
  }

  if (options.envKey) {
    const configured = Number(process.env[options.envKey]);
    if (Number.isFinite(configured) && configured > 0) {
      return clamp(Math.floor(configured), min, max);
    }
  }

  const cpu = runtimeParallelism();
  const adaptive = profile === "cpu"
    ? Math.max(1, Math.floor(cpu / 2))
    : profile === "write"
      ? Math.max(2, Math.ceil(cpu / 2))
      : profile === "external-api"
        ? Math.max(2, Math.ceil(cpu * 1.25))
        : Math.max(2, Math.ceil(cpu * 1.5));

  return clamp(adaptive, min, max);
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: ConcurrentMapOptions = {},
): Promise<{ results: R[]; meta: ConcurrentMapMeta }> {
  const startedAt = Date.now();
  const total = items.length;
  if (!total) {
    return { results: [], meta: { total: 0, concurrency: 0, durationMs: 0, failed: 0 } };
  }

  const concurrency = getAdaptiveConcurrency(total, options);
  const results = new Array<R>(total);
  let cursor = 0;
  let failed = 0;
  let firstError: unknown = null;

  async function worker() {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;

      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        failed += 1;
        if (options.failFast !== false && !firstError) firstError = error;
        if (options.failFast !== false) throw error;
        results[index] = undefined as R;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  if (firstError && options.failFast !== false) throw firstError;

  return {
    results,
    meta: {
      total,
      concurrency,
      durationMs: Date.now() - startedAt,
      failed,
    },
  };
}

export async function mapConcurrentSettled<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: ConcurrentMapOptions = {},
): Promise<{ results: Array<{ index: number; item: T; ok: true; value: R } | { index: number; item: T; ok: false; error: unknown }>; meta: ConcurrentMapMeta }> {
  const mapped = await mapConcurrent(
    items,
    async (item, index) => {
      try {
        return { index, item, ok: true as const, value: await mapper(item, index) };
      } catch (error) {
        return { index, item, ok: false as const, error };
      }
    },
    { ...options, failFast: false },
  );

  return {
    results: mapped.results,
    meta: {
      ...mapped.meta,
      failed: mapped.results.filter((item) => !item.ok).length,
    },
  };
}

export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  options: ConcurrentMapOptions = {},
): Promise<{ results: T[]; meta: ConcurrentMapMeta }> {
  return mapConcurrent(tasks, (task) => task(), { profile: "batch", ...options });
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = "operation"): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
