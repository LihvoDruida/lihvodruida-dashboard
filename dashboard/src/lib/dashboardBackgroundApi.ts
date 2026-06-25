"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import type { DashboardDataScope } from "@/lib/dashboardLiveRefresh";

export const DASHBOARD_BACKGROUND_REFRESH_MIN_MS = 10 * 60 * 1000;
const DASHBOARD_BACKGROUND_RESOURCE_FLOOR_MS = 60 * 1000;
const DASHBOARD_BACKGROUND_RESOURCE_CONCURRENCY = 2;
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
  lastStartedAt: number;
  inFlight: Promise<DashboardApiResourceState<T>> | null;
};

const records = new Map<string, ResourceRecord>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function cleanKey(key: string) {
  return String(key || "").trim().slice(0, 220) || "unknown";
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
    return Number.isFinite(value) && value > 0 ? value : null;
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

async function settleInSmallBatches<T>(items: T[], worker: (item: T) => Promise<unknown>) {
  const results: PromiseSettledResult<unknown>[] = [];
  for (let index = 0; index < items.length; index += DASHBOARD_BACKGROUND_RESOURCE_CONCURRENCY) {
    const batch = items.slice(index, index + DASHBOARD_BACKGROUND_RESOURCE_CONCURRENCY);
    results.push(...await Promise.allSettled(batch.map(worker)));
  }
  return results;
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
  emit();
}

function ensureRecord<T>(keyInput: string, initialData: T, getOptions: () => DashboardApiResourceOptions<T>): ResourceRecord<T> {
  const key = cleanKey(keyInput);
  const existing = records.get(key) as ResourceRecord<T> | undefined;
  if (existing) {
    existing.getOptions = getOptions;
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
    lastStartedAt: checkedAt || 0,
    inFlight: null,
  };
  records.set(key, record as ResourceRecord);
  return record;
}

function stateFor<T>(keyInput: string, initialData: T, getOptions: () => DashboardApiResourceOptions<T>) {
  return ensureRecord(keyInput, initialData, getOptions).state;
}

function broadcastResourceUpdated<T>(record: ResourceRecord<T>, reason: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_BACKGROUND_API_REFRESHED_EVENT, {
    detail: {
      key: record.key,
      scope: record.getOptions().scope,
      reason,
      checkedAt: record.state.checkedAt,
      updatedAt: record.state.updatedAt,
    },
  }));
}

export async function refreshDashboardApiResource<T = unknown>(keyInput: string, options: RefreshOptions = {}) {
  const key = cleanKey(keyInput);
  const record = records.get(key) as ResourceRecord<T> | undefined;
  if (!record) return null;

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

  if (record.inFlight) return record.inFlight;

  const request = resourceOptions.request();
  if (!request) {
    updateRecord(record, { status: "skipped", checkedAt: now });
    return record.state;
  }

  record.lastStartedAt = now;
  updateRecord(record, { status: "checking", error: "", checkedAt: now });

  const promise = dashboardApiJson<unknown>(request.url, {
    method: request.method || "GET",
    headers: request.headers,
    json: request.json,
    body: request.body,
    label: `Dashboard background API ${record.key}`,
    retries: 1,
    retryMethods: ["GET", "HEAD"],
  }).then((payload) => {
    const data = request.select ? request.select(payload) : payload as T;
    const checkedAt = Date.now();
    writeStoredCheckedAt(record.key, checkedAt);
    updateRecord(record, {
      data,
      status: "updated",
      error: "",
      checkedAt,
      updatedAt: checkedAt,
    });
    broadcastResourceUpdated(record, options.reason || "background");
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
  });

  record.inFlight = promise;
  return promise;
}

export async function refreshDashboardApiResources(options: RefreshOptions = {}) {
  const selected = Array.from(records.values()).filter(
    (record) => scopeMatches(record, options.scope) && resourceMatchesId(record, options.resourceId),
  );
  const results = await settleInSmallBatches(selected, (record) =>
    refreshDashboardApiResource(record.key, options),
  );
  return results;
}

export function dashboardBackgroundApiVersion() {
  return version;
}

export function useDashboardApiResource<T>(options: DashboardApiResourceOptions<T>) {
  const key = cleanKey(options.key);
  const optionsRef = useRef(options);
  const initialStateRef = useRef(initialState(options.initialData));

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const getOptions = useCallback(() => optionsRef.current, []);
  const getSnapshot = useCallback(() => {
    void version;
    return stateFor(key, optionsRef.current.initialData, getOptions);
  }, [getOptions, key]);
  const getServerSnapshot = useCallback(() => initialStateRef.current, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const record = ensureRecord(key, optionsRef.current.initialData, getOptions);
    record.refs += 1;
    if (optionsRef.current.refreshOnMount !== false) {
      const windowWithIdle = window as typeof window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      const idleHandle = windowWithIdle.requestIdleCallback
        ? windowWithIdle.requestIdleCallback(() => void refreshDashboardApiResource(key, { reason: "mount" }), { timeout: 2500 })
        : window.setTimeout(() => void refreshDashboardApiResource(key, { reason: "mount" }), 900);

      return () => {
        if (windowWithIdle.cancelIdleCallback && typeof idleHandle === "number") windowWithIdle.cancelIdleCallback(idleHandle);
        else window.clearTimeout(idleHandle);
        record.refs = Math.max(0, record.refs - 1);
        if (record.refs === 0) records.delete(key);
      };
    }

    return () => {
      record.refs = Math.max(0, record.refs - 1);
      if (record.refs === 0) records.delete(key);
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
