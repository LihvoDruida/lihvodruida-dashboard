"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { settleWithConcurrency } from "@/lib/settleWithConcurrency";
import type { DashboardDataScope } from "@/lib/dashboardLiveRefresh";

export const DASHBOARD_BACKGROUND_REFRESH_MIN_MS = 10 * 60 * 1000;
const DASHBOARD_BACKGROUND_RESOURCE_FLOOR_MS = 60 * 1000;
const DASHBOARD_BACKGROUND_RESOURCE_CONCURRENCY = 2;
const DASHBOARD_BACKGROUND_RESOURCE_RETAIN_MS = 5 * 60_000;
export const DASHBOARD_BACKGROUND_API_REFRESHED_EVENT = "dashboard:background-api-refreshed";

export type DashboardBackgroundStatus = "idle" | "checking" | "updated" | "skipped" | "offline" | "error";

export type DashboardApiResourceState<T> = {
  data: T;
  status: DashboardBackgroundStatus;
  error: string;
  updatedAt: number | null;
  checkedAt: number | null;
  revision?: string | null;
};

export type DashboardApiResourceRequest<T> = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: HeadersInit;
  json?: unknown;
  body?: BodyInit | null;
  select?: (payload: unknown) => T;
};

export type DashboardApiResourceOptions<T> = {
  key: string;
  scope?: DashboardDataScope | DashboardDataScope[];
  enabled?: boolean;
  initialData: T;
  minIntervalMs?: number;
  refreshOnMount?: boolean;
  request: () => DashboardApiResourceRequest<T> | null;
};

type RefreshOptions = {
  reason?: string;
  force?: boolean;
  scope?: DashboardDataScope;
  resourceId?: string;
};

type ResourceRecord<T = unknown> = {
  key: string;
  refs: number;
  getOptions: () => DashboardApiResourceOptions<T>;
  state: DashboardApiResourceState<T>;
  fingerprint: string | null;
  lastStartedAt: number;
  needsRefresh: boolean;
  inFlight: Promise<DashboardApiResourceState<T>> | null;
  disposeTimer: number | null;
  listeners: Set<() => void>;
};

const records = new Map<string, ResourceRecord>();

function emitRecord(record: ResourceRecord) {
  for (const listener of record.listeners) listener();
}

function cleanKey(key: string) {
  return String(key || "").trim().slice(0, 220) || "unknown";
}

function dataFingerprint(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_key, item) => {
      // Selectors may return non-JSON containers. Their serialized form (e.g.
      // Map -> {}) cannot prove equality, so retain no fingerprint for them.
      if (item && typeof item === "object" && !Array.isArray(item) && Object.prototype.toString.call(item) !== "[object Object]") {
        throw new TypeError("Non-JSON resource data");
      }
      return item;
    }) ?? null;
  } catch {
    return null;
  }
}

function initialState<T>(data: T): DashboardApiResourceState<T> {
  return {
    data,
    status: "idle",
    error: "",
    updatedAt: null,
    checkedAt: null,
    revision: null,
  };
}

function storageKey(key: string) {
  return `mistblossom.dashboard.backgroundApi:${encodeURIComponent(key)}`;
}

function readStoredCheckedAt(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { checkedAt?: unknown } | null;
    const value = Number(parsed?.checkedAt);
    return Number.isFinite(value) && value > 0 && value <= Date.now() ? value : null;
  } catch {
    return null;
  }
}

function writeStoredCheckedAt(key: string, checkedAt: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify({ checkedAt }));
  } catch {
    // Storage may be blocked; server-side throttles still protect external APIs.
  }
}

function minIntervalMs(value?: number) {
  const number = Number(value);
  const clean = Number.isFinite(number) ? Math.floor(number) : DASHBOARD_BACKGROUND_REFRESH_MIN_MS;
  return Math.max(DASHBOARD_BACKGROUND_RESOURCE_FLOOR_MS, clean);
}

function cleanResourceId(value: unknown) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

function resourceMatchesId(record: ResourceRecord, resourceId?: string) {
  const id = cleanResourceId(resourceId);
  if (!id) return true;
  return record.key.toLowerCase().includes(id);
}

function optionScopes(scope?: DashboardDataScope | DashboardDataScope[]) {
  if (!scope) return [];
  return Array.isArray(scope) ? scope : [scope];
}

function scopeMatches(record: ResourceRecord, scope?: DashboardDataScope) {
  if (!scope) return true;
  const scopes = optionScopes(record.getOptions().scope);
  if (!scopes.length) return true;
  if (scopes.includes(scope)) return true;
  if (scope === "profile" && scopes.includes("profiles")) return true;
  if (scope === "profiles" && scopes.includes("profile")) return true;
  if (scope === "guild" && (scopes.includes("profile") || scopes.includes("profiles"))) return true;
  return false;
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function updateRecord<T>(record: ResourceRecord<T>, patch: Partial<DashboardApiResourceState<T>>) {
  record.state = { ...record.state, ...patch };
  // Notify only consumers of this resource. The old global subscriber set made
  // every live widget re-render whenever any unrelated resource changed.
  emitRecord(record);
}

function ensureRecord<T>(keyInput: string, initialData: T, getOptions: () => DashboardApiResourceOptions<T>): ResourceRecord<T> {
  const key = cleanKey(keyInput);
  const existing = records.get(key) as ResourceRecord<T> | undefined;
  if (existing) {
    existing.getOptions = getOptions;
    if (existing.disposeTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    return existing;
  }

  const checkedAt = readStoredCheckedAt(key);
  const record: ResourceRecord<T> = {
    key,
    refs: 0,
    getOptions,
    state: {
      ...initialState(initialData),
      checkedAt,
    },
    fingerprint: dataFingerprint(initialData),
    lastStartedAt: checkedAt || 0,
    needsRefresh: false,
    inFlight: null,
    disposeTimer: null,
    listeners: new Set(),
  };
  records.set(key, record as ResourceRecord);
  return record;
}

function stateFor<T>(keyInput: string, initialData: T, getOptions: () => DashboardApiResourceOptions<T>) {
  return ensureRecord(keyInput, initialData, getOptions).state;
}

function scheduleRecordDisposal(record: ResourceRecord) {
  if (record.refs > 0 || typeof window === "undefined" || record.disposeTimer !== null) return;
  record.disposeTimer = window.setTimeout(() => {
    record.disposeTimer = null;
    if (record.refs === 0 && !record.inFlight && records.get(record.key) === record) {
      records.delete(record.key);
    }
    // A pending request schedules disposal again when it settles.
  }, DASHBOARD_BACKGROUND_RESOURCE_RETAIN_MS);
}

function releaseRecord(record: ResourceRecord) {
  record.refs = Math.max(0, record.refs - 1);
  scheduleRecordDisposal(record);
}

function broadcastResourceUpdated<T>(record: ResourceRecord<T>, reason: string, changed: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_BACKGROUND_API_REFRESHED_EVENT, {
    detail: {
      key: record.key,
      scope: record.getOptions().scope,
      reason,
      checkedAt: record.state.checkedAt,
      updatedAt: record.state.updatedAt,
      changed,
    },
  }));
}

export async function refreshDashboardApiResource<T = unknown>(keyInput: string, options: RefreshOptions = {}) {
  const key = cleanKey(keyInput);
  const record = records.get(key) as ResourceRecord<T> | undefined;
  if (!record) return null;
  // Join before cooldown/status changes; force must never start a second request.
  if (record.inFlight) return record.inFlight;
  if (record.refs === 0) {
    if (options.force) record.needsRefresh = true;
    return record.state;
  }

  const resourceOptions = record.getOptions();
  if (resourceOptions.enabled === false) {
    updateRecord(record, { status: "skipped" });
    return record.state;
  }

  if (!isOnline()) {
    updateRecord(record, { status: "offline", checkedAt: Date.now() });
    return record.state;
  }

  const now = Date.now();
  const interval = minIntervalMs(resourceOptions.minIntervalMs);
  const lastKnown = Math.max(record.lastStartedAt || 0, readStoredCheckedAt(record.key) || 0);
  if (!options.force && lastKnown > 0 && now - lastKnown < interval) {
    updateRecord(record, { status: "skipped", checkedAt: now });
    return record.state;
  }

  // Dispatch on the next microtask so subscribers can re-enter safely: the
  // shared promise is installed before the checking notification is emitted.
  const promise = Promise.resolve().then(async () => {
    if (record.refs === 0) {
      if (options.force) record.needsRefresh = true;
      updateRecord(record, { status: "skipped" });
      return record.state;
    }
    const request = resourceOptions.request();
    if (!request) {
      updateRecord(record, { status: "skipped", checkedAt: now });
      return record.state;
    }
    record.lastStartedAt = now;
    record.needsRefresh = false;
    const payload = await dashboardApiJson<unknown>(request.url, {
      method: request.method || "GET",
      headers: request.headers,
      json: request.json,
      body: request.body,
      label: `Dashboard background API ${record.key}`,
      retries: 1,
      retryMethods: ["GET", "HEAD"],
    });
    const data = request.select ? request.select(payload) : payload as T;
    const checkedAt = Date.now();
    const fingerprint = dataFingerprint(data);
    const changed = fingerprint === null || fingerprint !== record.fingerprint;
    record.fingerprint = fingerprint;
    writeStoredCheckedAt(record.key, checkedAt);
    updateRecord(record, {
      data: changed ? data : record.state.data,
      status: "updated",
      error: "",
      checkedAt,
      updatedAt: changed ? checkedAt : record.state.updatedAt,
    });
    broadcastResourceUpdated(record, options.reason || "background", changed);
    return record.state;
  }).catch((error) => {
    const checkedAt = Date.now();
    writeStoredCheckedAt(record.key, checkedAt);
    updateRecord(record, {
      status: (error as Error)?.name === "AbortError" ? "offline" : "error",
      error: error instanceof Error ? error.message : "Не вдалося оновити дані.",
      checkedAt,
    });
    return record.state;
  }).finally(() => {
    record.inFlight = null;
    scheduleRecordDisposal(record);
  });

  record.inFlight = promise;
  updateRecord(record, { status: "checking", error: "", checkedAt: now });
  return promise;
}

export async function refreshDashboardApiResources(options: RefreshOptions = {}) {
  const matching = Array.from(records.values()).filter(
    (record) => scopeMatches(record, options.scope) && resourceMatchesId(record, options.resourceId),
  );
  // Retained data is invalidated without polling an unmounted widget. Its next
  // mount performs one fresh read even when normal SSR-backed mount refresh is off.
  if (options.force) for (const record of matching) if (record.refs === 0) record.needsRefresh = true;
  const selected = matching.filter(record => record.refs > 0);
  const results = await settleWithConcurrency(selected, (record) =>
    refreshDashboardApiResource(record.key, options),
    DASHBOARD_BACKGROUND_RESOURCE_CONCURRENCY,
  );
  return results;
}

export function useDashboardApiResource<T>(options: DashboardApiResourceOptions<T>) {
  const key = cleanKey(options.key);
  const optionsRef = useRef(options);
  const serverState = useMemo(() => initialState(options.initialData), [options.initialData]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const getOptions = useCallback(() => optionsRef.current, []);
  const getSnapshot = useCallback(() => {
    return stateFor(key, options.initialData, getOptions);
  }, [getOptions, key, options.initialData]);
  const getServerSnapshot = useCallback(() => serverState, [serverState]);
  const subscribeToResource = useCallback((listener: () => void) => {
    const record = ensureRecord(key, options.initialData, getOptions);
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }, [getOptions, key, options.initialData]);

  const state = useSyncExternalStore(subscribeToResource, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const record = ensureRecord(key, optionsRef.current.initialData, getOptions);
    record.refs += 1;
    if (optionsRef.current.refreshOnMount !== false || record.needsRefresh) {
      const refreshOnMount = () => {
        const invalidated = record.needsRefresh;
        if (invalidated || optionsRef.current.refreshOnMount !== false) {
          void refreshDashboardApiResource(key, { reason: invalidated ? "mount:invalidated" : "mount", force: invalidated });
        }
      };
      const onOnline = () => { if (record.needsRefresh) refreshOnMount(); };
      window.addEventListener("online", onOnline);
      const windowWithIdle = window as typeof window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      const idleHandle = windowWithIdle.requestIdleCallback
        ? windowWithIdle.requestIdleCallback(refreshOnMount, { timeout: 2500 })
        : window.setTimeout(refreshOnMount, 900);

      return () => {
        window.removeEventListener("online", onOnline);
        if (windowWithIdle.cancelIdleCallback && typeof idleHandle === "number") windowWithIdle.cancelIdleCallback(idleHandle);
        else window.clearTimeout(idleHandle);
        releaseRecord(record);
      };
    }

    return () => {
      releaseRecord(record);
    };
  }, [getOptions, key]);

  const refresh = useCallback((reason = "manual", refreshOptions: { force?: boolean; scope?: DashboardDataScope } = {}) => {
    return refreshDashboardApiResource<T>(key, {
      reason,
      force: refreshOptions.force,
      scope: refreshOptions.scope,
    });
  }, [key]);

  return { ...state, refresh };
}
