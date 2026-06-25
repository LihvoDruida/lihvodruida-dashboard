"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";

type LiveState = "idle" | "checking" | "updated" | "offline" | "error" | "skipped";

type PollSnapshot = {
  ok?: boolean;
  id?: string;
  status?: string;
  revision?: string;
  updatedAt?: string | null;
  closesAtMs?: number | null;
  votes?: number;
};

type PollUpdatedEvent = CustomEvent<{ pollId?: string; revision?: string; source?: "site" | "discord" | string }>;

const RAID_POLL_VISIBLE_REFRESH_MS = 2 * 60 * 1000;
const RAID_POLL_HIDDEN_REFRESH_MS = 10 * 60 * 1000;

export default function RaidPollLiveSync({ pollId, initialRevision }: { pollId: string; initialRevision: string }) {
  const router = useRouter();
  const revisionRef = useRef(initialRevision);
  const toastRevisionRef = useRef(initialRevision);
  const errorBackoffRef = useRef(RAID_POLL_VISIBLE_REFRESH_MS);

  const resource = useDashboardApiResource<PollSnapshot | null>({
    key: `raid-poll:${pollId}:snapshot`,
    scope: "raids",
    initialData: null,
    minIntervalMs: RAID_POLL_VISIBLE_REFRESH_MS,
    refreshOnMount: true,
    request: () => ({
      url: "/api/background/refresh",
      method: "POST",
      headers: { "X-Dashboard-Action": "background-raid-poll-snapshot" },
      json: { resources: [{ key: `raid-poll:${pollId}:snapshot`, kind: "raid-poll-snapshot", id: pollId }] },
      select: (payload) => {
        const first = payload && typeof payload === "object" && "resources" in payload
          ? (payload as { resources?: Array<{ ok?: boolean; data?: PollSnapshot; error?: string }> }).resources?.[0]
          : null;
        if (!first?.ok || !first.data?.ok) throw new Error(first?.error || "poll_snapshot_failed");
        return first.data;
      },
    }),
  });

  useEffect(() => {
    revisionRef.current = initialRevision;
    toastRevisionRef.current = initialRevision;
  }, [initialRevision]);

  useEffect(() => {
    const data = resource.data;
    if (!data?.ok) return;

    errorBackoffRef.current = RAID_POLL_VISIBLE_REFRESH_MS;
    if (data.revision && data.revision !== revisionRef.current) {
      revisionRef.current = data.revision;
      if (toastRevisionRef.current !== data.revision) {
        toastRevisionRef.current = data.revision;
        dispatchDashboardToast({
          tone: "info",
          title: "Рейд-пул оновлено",
          message: "Нові голоси з Discord синхронізовано з сайтом.",
          ttl: 3200,
        });
      }
      router.refresh();
    }
  }, [resource.data, router]);

  useEffect(() => {
    if (resource.status !== "error") return;
    errorBackoffRef.current = Math.min(errorBackoffRef.current * 2, RAID_POLL_HIDDEN_REFRESH_MS);
  }, [resource.status]);

  const refreshPoll = resource.refresh;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    function clearTimer() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function nextDelay() {
      if (document.visibilityState !== "visible") return RAID_POLL_HIDDEN_REFRESH_MS;
      return resource.status === "error" ? errorBackoffRef.current : RAID_POLL_VISIBLE_REFRESH_MS;
    }

    function schedule(delay = nextDelay()) {
      clearTimer();
      if (cancelled) return;
      timer = window.setTimeout(() => void tick("interval"), delay);
    }

    async function tick(reason: string, force = false) {
      if (cancelled) return;
      await refreshPoll(reason, { force, scope: "raids" }).catch(() => null);
      if (!cancelled) schedule();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void tick("visible", false);
      else schedule(RAID_POLL_HIDDEN_REFRESH_MS);
    }

    function onPollUpdated(event: Event) {
      const detail = (event as PollUpdatedEvent).detail || {};
      if (detail.pollId && detail.pollId !== pollId) return;
      void tick("raid-poll-updated", true);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("dashboard:raid-poll-updated", onPollUpdated);
    schedule(RAID_POLL_VISIBLE_REFRESH_MS);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("dashboard:raid-poll-updated", onPollUpdated);
    };
  }, [pollId, refreshPoll, resource.status]);

  const state = resource.status as LiveState;
  const label = state === "checking"
    ? "Синхронізація"
    : state === "updated"
      ? "Оновлено"
      : state === "offline"
        ? "Офлайн"
        : state === "error"
          ? "Повтор синхронізації"
          : state === "skipped"
            ? "Очікує"
            : "Live sync";
  return (
    <div className={`raid-poll-live-sync raid-poll-live-sync--${state}`} role="status" aria-live="polite">
      <span aria-hidden="true" />
      {label}
      {typeof resource.data?.votes === "number" ? <strong>{resource.data.votes}</strong> : null}
    </div>
  );
}
