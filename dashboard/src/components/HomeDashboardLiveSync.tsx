"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DASHBOARD_DATA_MUTATED_EVENT,
  DASHBOARD_LAST_MUTATION_STORAGE_KEY,
  DASHBOARD_MUTATION_BROADCAST_CHANNEL,
  type DashboardDataMutationDetail,
} from "@/lib/dashboardLiveRefresh";

const VISIBLE_REFRESH_MS = 60_000;
const HIDDEN_REFRESH_MS = 5 * 60_000;
const MIN_MANUAL_REFRESH_MS = 8_000;
const MIN_FORCED_REFRESH_MS = 1_200;

type HomeLiveSyncProps = {
  initialRevision: string;
};

function liveLabel(state: "idle" | "syncing" | "updated") {
  if (state === "syncing") return "Оновлюємо";
  if (state === "updated") return "Оновлено";
  return "Live sync";
}

function parseMutationPayload(value: string | null): DashboardDataMutationDetail | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as DashboardDataMutationDetail;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export default function HomeDashboardLiveSync({ initialRevision }: HomeLiveSyncProps) {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);
  const lastRefreshRef = useRef(0);
  const lastMutationRef = useRef("");
  const [state, setState] = useState<"idle" | "syncing" | "updated">("idle");

  useEffect(() => {
    let cancelled = false;
    let mutationChannel: BroadcastChannel | null = null;

    function clearTimer() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function schedule(delay = document.visibilityState === "visible" ? VISIBLE_REFRESH_MS : HIDDEN_REFRESH_MS) {
      clearTimer();
      if (cancelled) return;
      timerRef.current = window.setTimeout(() => refresh("interval"), delay);
    }

    function shouldSkipDuplicateMutation(detail: DashboardDataMutationDetail | null) {
      if (!detail) return false;
      const key = `${detail.scope || "unknown"}:${detail.kind || "unknown"}:${detail.resourceId || detail.raidId || detail.pollId || "all"}:${detail.revision || detail.timestamp || ""}`;
      if (key === lastMutationRef.current) return true;
      lastMutationRef.current = key;
      return false;
    }

    function refresh(_reason: string, force = false) {
      if (cancelled) return;
      const now = Date.now();
      const minDelay = force ? MIN_FORCED_REFRESH_MS : MIN_MANUAL_REFRESH_MS;
      if (now - lastRefreshRef.current < minDelay) {
        schedule();
        return;
      }
      lastRefreshRef.current = now;
      setState("syncing");
      router.refresh();
      window.setTimeout(() => {
        if (cancelled) return;
        setState("updated");
        window.setTimeout(() => {
          if (!cancelled) setState("idle");
        }, 1800);
      }, 380);
      schedule();
    }

    function refreshFromMutation(detail: DashboardDataMutationDetail | null, reason: string) {
      if (shouldSkipDuplicateMutation(detail)) return;
      refresh(reason, true);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh("visible", true);
      else schedule(HIDDEN_REFRESH_MS);
    }

    function onDataMutated(event: Event) {
      refreshFromMutation((event as CustomEvent<DashboardDataMutationDetail>).detail || null, "data-mutated");
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== DASHBOARD_LAST_MUTATION_STORAGE_KEY) return;
      refreshFromMutation(parseMutationPayload(event.newValue), "storage-mutated");
    }

    function onBroadcast(event: MessageEvent<DashboardDataMutationDetail>) {
      const detail = event.data && typeof event.data === "object" ? event.data : null;
      refreshFromMutation(detail, "broadcast-mutated");
    }

    function onRaidUpdated(event: Event) {
      refreshFromMutation((event as CustomEvent<DashboardDataMutationDetail>).detail || null, "raid-updated");
    }

    function onPollUpdated(event: Event) {
      refreshFromMutation((event as CustomEvent<DashboardDataMutationDetail>).detail || null, "poll-updated");
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(DASHBOARD_DATA_MUTATED_EVENT, onDataMutated);
    window.addEventListener("storage", onStorage);
    window.addEventListener("dashboard:raid-updated", onRaidUpdated);
    window.addEventListener("dashboard:raid-poll-updated", onPollUpdated);

    try {
      if ("BroadcastChannel" in window) {
        mutationChannel = new BroadcastChannel(DASHBOARD_MUTATION_BROADCAST_CHANNEL);
        mutationChannel.addEventListener("message", onBroadcast);
      }
    } catch {
      mutationChannel = null;
    }

    schedule(25_000);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(DASHBOARD_DATA_MUTATED_EVENT, onDataMutated);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("dashboard:raid-updated", onRaidUpdated);
      window.removeEventListener("dashboard:raid-poll-updated", onPollUpdated);
      if (mutationChannel) {
        mutationChannel.removeEventListener("message", onBroadcast);
        mutationChannel.close();
      }
    };
  }, [router]);

  return (
    <div className={`home-live-sync home-live-sync--${state}`} role="status" aria-live="polite" data-revision={initialRevision.slice(0, 48)}>
      <span aria-hidden="true" />
      {liveLabel(state)}
    </div>
  );
}
