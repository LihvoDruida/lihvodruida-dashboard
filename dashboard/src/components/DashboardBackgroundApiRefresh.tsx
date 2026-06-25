"use client";

import { useEffect, useRef, useState } from "react";
import {
  DASHBOARD_BACKGROUND_REFRESH_MIN_MS,
  refreshDashboardApiResources,
} from "@/lib/dashboardBackgroundApi";
import {
  DASHBOARD_DATA_MUTATED_EVENT,
  DASHBOARD_LAST_MUTATION_STORAGE_KEY,
  DASHBOARD_MUTATION_BROADCAST_CHANNEL,
  type DashboardDataMutationDetail,
} from "@/lib/dashboardLiveRefresh";

type RefreshState = "idle" | "checking" | "paused" | "offline";

const BACKGROUND_VISIBLE_REFRESH_MIN_MS = 10 * 60_000;
const BACKGROUND_MUTATION_REFRESH_MIN_MS = 2_500;
let lastBackgroundRefreshAt = 0;
let activeBackgroundRefresh: Promise<void> | null = null;
type DataMutationEvent = CustomEvent<DashboardDataMutationDetail>;

function isTextEditingElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function hasActiveEditor() {
  if (typeof document === "undefined") return false;
  if (isTextEditingElement(document.activeElement)) return true;
  return Boolean(document.querySelector('form[data-submitting="true"], [aria-busy="true"]'));
}

function isIgnorableExtensionMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason || "");
  return /Could not establish connection\. Receiving end does not exist|Extension context invalidated/i.test(message);
}

type Props = {
  refreshMinMs?: number;
};

function normalizeRefreshMinMs(value?: number) {
  const number = Number(value);
  const clean = Number.isFinite(number) ? Math.floor(number) : DASHBOARD_BACKGROUND_REFRESH_MIN_MS;
  return Math.max(DASHBOARD_BACKGROUND_REFRESH_MIN_MS, clean);
}

export default function DashboardBackgroundApiRefresh({ refreshMinMs: refreshMinMsInput }: Props) {
  const [state, setState] = useState<RefreshState>("idle");
  const [refreshMinMs, setRefreshMinMs] = useState(() => normalizeRefreshMinMs(refreshMinMsInput));
  const inFlightRef = useRef(false);

  useEffect(() => {
    setRefreshMinMs(normalizeRefreshMinMs(refreshMinMsInput));
  }, [refreshMinMsInput]);

  useEffect(() => {
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isIgnorableExtensionMessage(event.reason)) event.preventDefault();
    }

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    function clearTimer() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function schedule(delay = refreshMinMs, reason = "interval") {
      clearTimer();
      if (cancelled) return;
      timer = window.setTimeout(() => void refresh(reason), Math.max(reason.startsWith("mutation") || reason.includes("raid") ? 750 : 5_000, delay));
    }

    async function refresh(reason: string, options: { force?: boolean; scope?: DashboardDataMutationDetail["scope"]; resourceId?: string } = {}) {
      if (cancelled) return;

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setState("offline");
        schedule(refreshMinMs, reason);
        return;
      }

      if (!options.force && document.visibilityState === "hidden") {
        setState("paused");
        schedule(refreshMinMs, reason);
        return;
      }

      if (!options.force && hasActiveEditor()) {
        setState("paused");
        schedule(30_000, reason);
        return;
      }

      const now = Date.now();
      const minSpacing = options.force ? BACKGROUND_MUTATION_REFRESH_MIN_MS : Math.max(BACKGROUND_VISIBLE_REFRESH_MIN_MS, refreshMinMs);
      if (inFlightRef.current || activeBackgroundRefresh) {
        setState("paused");
        schedule(minSpacing, reason);
        return;
      }
      if (now - lastBackgroundRefreshAt < minSpacing) {
        schedule(minSpacing - (now - lastBackgroundRefreshAt), reason);
        return;
      }

      setState("checking");
      inFlightRef.current = true;
      activeBackgroundRefresh = refreshDashboardApiResources({ reason, force: options.force, scope: options.scope, resourceId: options.resourceId })
        .catch(() => undefined)
        .then(() => undefined);
      await activeBackgroundRefresh;
      activeBackgroundRefresh = null;
      lastBackgroundRefreshAt = Date.now();
      inFlightRef.current = false;
      if (!cancelled) setState("idle");
      schedule(refreshMinMs, "interval");
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refresh("visible");
    }

    function onFocus() {
      void refresh("focus");
    }

    function onOnline() {
      void refresh("online", { force: false });
    }

    function onDataMutated(event: Event) {
      const detail = (event as DataMutationEvent).detail || {};
      void refresh(detail.scope ? `mutation:${detail.scope}` : "mutation", { force: true, scope: detail.scope, resourceId: detail.resourceId });
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== DASHBOARD_LAST_MUTATION_STORAGE_KEY || !event.newValue) return;
      try {
        const detail = JSON.parse(event.newValue) as DashboardDataMutationDetail;
        void refresh("cross-tab-mutation", { force: true, scope: detail.scope, resourceId: detail.resourceId });
      } catch {
        void refresh("cross-tab-mutation", { force: true });
      }
    }

    let mutationBroadcast: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      mutationBroadcast = new BroadcastChannel(DASHBOARD_MUTATION_BROADCAST_CHANNEL);
      mutationBroadcast.onmessage = (event) => {
        const detail = (event.data || {}) as DashboardDataMutationDetail;
        void refresh("broadcast-mutation", { force: true, scope: detail.scope, resourceId: detail.resourceId });
      };
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener(DASHBOARD_DATA_MUTATED_EVENT, onDataMutated);
    window.addEventListener("storage", onStorage);
    schedule(refreshMinMs, "interval");

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(DASHBOARD_DATA_MUTATED_EVENT, onDataMutated);
      window.removeEventListener("storage", onStorage);
      mutationBroadcast?.close();
    };
  }, [refreshMinMs]);

  return (
    <span className="live-data-refresh-status sr-only" aria-live="polite" data-state={state}>
      {state === "checking" ? "Фоново оновлюємо API-дані." : "Фонове API-оновлення активне."}
    </span>
  );
}
