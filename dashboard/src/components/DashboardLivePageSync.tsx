"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DASHBOARD_BACKGROUND_API_REFRESHED_EVENT } from "@/lib/dashboardBackgroundApi";
import {
  DASHBOARD_DATA_MUTATED_EVENT,
  DASHBOARD_DATA_REFRESHED_EVENT,
  DASHBOARD_LAST_MUTATION_STORAGE_KEY,
  DASHBOARD_MUTATION_BROADCAST_CHANNEL,
} from "@/lib/dashboardLiveRefresh";

const VISIBLE_REFRESH_MS = 60_000;
const HIDDEN_RECHECK_MS = 5 * 60_000;
const MIN_REFRESH_SPACING_MS = 5_000;
const EDITOR_RETRY_MS = 15_000;
const MUTATION_DEBOUNCE_MS = 650;

type BackgroundRefreshEvent = CustomEvent<{ changed?: boolean; reason?: string; key?: string }>;

function isEditingElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function hasUnsafeEditorState() {
  if (typeof document === "undefined") return false;
  if (isEditingElement(document.activeElement)) return true;
  return Boolean(document.querySelector(
    'form[data-submitting="true"], form[data-dirty="true"], form.is-dirty, [aria-busy="true"]',
  ));
}

function shouldSkipPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/api/");
}

export default function DashboardLivePageSync() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [, startTransition] = useTransition();
  const lastRefreshRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const mutationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (shouldSkipPath(pathname)) return;
    let cancelled = false;

    function clearRefreshTimer() {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    }

    function clearMutationTimer() {
      if (mutationTimerRef.current !== null) {
        window.clearTimeout(mutationTimerRef.current);
        mutationTimerRef.current = null;
      }
    }

    function schedule(delay: number, reason = "interval") {
      clearRefreshTimer();
      if (cancelled) return;
      refreshTimerRef.current = window.setTimeout(() => requestRefresh(reason), Math.max(750, delay));
    }

    function requestRefresh(reason: string, force = false) {
      if (cancelled) return;
      if (navigator.onLine === false) {
        schedule(VISIBLE_REFRESH_MS, "offline-retry");
        return;
      }
      if (document.visibilityState === "hidden") {
        schedule(HIDDEN_RECHECK_MS, "hidden-retry");
        return;
      }
      if (hasUnsafeEditorState()) {
        schedule(EDITOR_RETRY_MS, "editor-retry");
        return;
      }

      const now = Date.now();
      const elapsed = now - lastRefreshRef.current;
      if (!force && elapsed < MIN_REFRESH_SPACING_MS) {
        schedule(MIN_REFRESH_SPACING_MS - elapsed, reason);
        return;
      }

      lastRefreshRef.current = now;
      startTransition(() => router.refresh());
      window.dispatchEvent(new CustomEvent(DASHBOARD_DATA_REFRESHED_EVENT, {
        detail: { reason, path: pathname, timestamp: now },
      }));
      schedule(VISIBLE_REFRESH_MS, "interval");
    }

    function refreshAfterMutation(reason: string) {
      clearMutationTimer();
      mutationTimerRef.current = window.setTimeout(() => requestRefresh(reason, true), MUTATION_DEBOUNCE_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshRef.current >= MIN_REFRESH_SPACING_MS) {
        requestRefresh("visible");
      }
    }

    function onFocus() {
      if (Date.now() - lastRefreshRef.current >= MIN_REFRESH_SPACING_MS) requestRefresh("focus");
    }

    function onOnline() {
      requestRefresh("online", true);
    }

    function onDataMutated() {
      refreshAfterMutation("mutation");
    }

    function onBackgroundApiRefreshed(event: Event) {
      const detail = (event as BackgroundRefreshEvent).detail || {};
      if (detail.changed) refreshAfterMutation(`background:${detail.key || detail.reason || "resource"}`);
    }

    function onStorage(event: StorageEvent) {
      if (event.key === DASHBOARD_LAST_MUTATION_STORAGE_KEY && event.newValue) refreshAfterMutation("cross-tab");
    }

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(DASHBOARD_MUTATION_BROADCAST_CHANNEL);
      channel.onmessage = () => refreshAfterMutation("broadcast");
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener(DASHBOARD_DATA_MUTATED_EVENT, onDataMutated);
    window.addEventListener(DASHBOARD_BACKGROUND_API_REFRESHED_EVENT, onBackgroundApiRefreshed);
    window.addEventListener("storage", onStorage);
    schedule(VISIBLE_REFRESH_MS, "interval");

    return () => {
      cancelled = true;
      clearRefreshTimer();
      clearMutationTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(DASHBOARD_DATA_MUTATED_EVENT, onDataMutated);
      window.removeEventListener(DASHBOARD_BACKGROUND_API_REFRESHED_EVENT, onBackgroundApiRefreshed);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [pathname, router, startTransition]);

  return null;
}
