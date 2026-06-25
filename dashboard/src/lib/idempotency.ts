import "server-only";

type StoredAction<T> = {
  status: "pending" | "done";
  value?: T;
  expiresAt: number;
};

type IdempotentActionStatus =
  | "SKIP"
  | "LOCAL_MISS"
  | "LOCAL_HIT"
  | "LOCAL_PENDING";

type IdempotentActionOptions<T> = {
  namespace: string;
  key?: string | null;
  ttlMs?: number;
  pendingValue: T;
  action: () => Promise<T>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomIdempotentActions:
    | Map<string, StoredAction<unknown>>
    | undefined;
}

const DEFAULT_TTL_MS = 90_000;
const MAX_LOCAL_ITEMS = 1000;

function localStore() {
  const map = globalThis.__mistblossomIdempotentActions || new Map<string, StoredAction<unknown>>();
  globalThis.__mistblossomIdempotentActions = map;
  const now = Date.now();
  if (map.size > MAX_LOCAL_ITEMS) {
    for (const [key, item] of map) {
      if (item.expiresAt <= now) map.delete(key);
    }
    if (map.size > MAX_LOCAL_ITEMS) {
      const overflow = map.size - MAX_LOCAL_ITEMS;
      let removed = 0;
      for (const key of map.keys()) {
        map.delete(key);
        removed += 1;
        if (removed >= overflow) break;
      }
    }
  }
  return map;
}

function cleanNamespace(value: string) {
  return String(value || "action").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 80) || "action";
}

export function cleanIdempotencyKey(value: unknown) {
  const key = String(value || "").trim();
  return /^[A-Za-z0-9:._-]{12,220}$/.test(key) ? key : "";
}

function localKey(namespace: string, key: string) {
  return `${cleanNamespace(namespace)}:${key}`;
}

async function runLocalIdempotent<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  pendingValue: T,
  action: () => Promise<T>,
): Promise<{ value: T; status: IdempotentActionStatus }> {
  const store = localStore();
  const itemKey = localKey(namespace, key);
  const now = Date.now();
  const existing = store.get(itemKey) as StoredAction<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return {
      value: existing.status === "done" && existing.value !== undefined ? existing.value : pendingValue,
      status: existing.status === "done" ? "LOCAL_HIT" : "LOCAL_PENDING",
    };
  }

  store.set(itemKey, { status: "pending", expiresAt: now + ttlMs });
  try {
    const value = await action();
    store.set(itemKey, { status: "done", value, expiresAt: Date.now() + ttlMs });
    return { value, status: "LOCAL_MISS" };
  } catch (error) {
    store.delete(itemKey);
    throw error;
  }
}

export async function runIdempotentAction<T>({
  namespace,
  key,
  ttlMs = DEFAULT_TTL_MS,
  pendingValue,
  action,
}: IdempotentActionOptions<T>): Promise<{ value: T; status: IdempotentActionStatus }> {
  const cleanKey = cleanIdempotencyKey(key);
  const safeTtlMs = Math.max(10_000, Math.min(10 * 60_000, Math.floor(ttlMs)));
  if (!cleanKey) return { value: await action(), status: "SKIP" };

  return runLocalIdempotent(namespace, cleanKey, safeTtlMs, pendingValue, action);
}

export function idempotencyHeader(status: IdempotentActionStatus) {
  return status === "SKIP" ? undefined : status;
}
