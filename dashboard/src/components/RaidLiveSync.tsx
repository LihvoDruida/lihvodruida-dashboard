"use client";

import { useEffect, useRef, useState } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";

type LiveState = "idle" | "checking" | "updated" | "offline" | "error" | "skipped";

type RaidSnapshot = {
  ok?: boolean;
  id?: string;
  title?: string;
  status?: string;
  closed?: boolean;
  revision?: string;
  updatedAt?: string | null;
  roster?: number;
  capacity?: number;
  late?: number;
  skipped?: number;
};

type RaidUpdatedEvent = CustomEvent<{ raidId?: string; revision?: string; source?: "site" | "discord" | string }>;

export default function RaidLiveSync({ raidId, initialRevision }: { raidId: string; initialRevision: string }) {
  const revisionRef = useRef(initialRevision);
  const toastRevisionRef = useRef(initialRevision);
  const [rosterLabel, setRosterLabel] = useState("");

  const resource = useDashboardApiResource<RaidSnapshot | null>({
    key: `raid:${raidId}:snapshot`,
    scope: "raids",
    initialData: null,
    refreshOnMount: false,
    request: () => ({
      url: `/api/raids/${encodeURIComponent(raidId)}/snapshot`,
      method: "GET",
      // Read-only public snapshot: works without a website session.
      select: (payload) => {
        const snapshot = payload as RaidSnapshot | null;
        if (!snapshot?.ok) throw new Error("snapshot_unavailable");
        return snapshot;
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

    if (typeof data.roster === "number" && typeof data.capacity === "number") {
      setRosterLabel(`${data.roster}/${data.capacity}`);
    }

    if (data.revision && data.revision !== revisionRef.current) {
      revisionRef.current = data.revision;
      if (toastRevisionRef.current !== data.revision) {
        toastRevisionRef.current = data.revision;
        dispatchDashboardToast({
          tone: "info",
          title: "Рейд оновлено",
          message: "Склад або статус рейду оновлено у фоні без перезавантаження сторінки.",
          ttl: 3600,
        });
      }
    }
  }, [resource.data]);

  const refreshRaid = resource.refresh;

  useEffect(() => {
    function onRaidUpdated(event: Event) {
      const detail = (event as RaidUpdatedEvent).detail || {};
      if (detail.raidId && detail.raidId !== raidId) return;
      void refreshRaid("raid-updated", { force: true });
    }

    function onVisible() {
      if (document.visibilityState === "visible") void refreshRaid("visible");
    }

    window.addEventListener("dashboard:raid-updated", onRaidUpdated);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("dashboard:raid-updated", onRaidUpdated);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [raidId, refreshRaid]);

  const state = resource.status as LiveState;
  const label = state === "checking"
    ? "Перевіряємо зміни"
    : state === "updated"
      ? "Оновлено"
      : state === "offline"
        ? "Автооновлення призупинено"
        : state === "error"
          ? "Оновлення не вдалося"
          : "Автооновлення активне";

  return (
    <div className={`raid-live-sync raid-live-sync--${state}`} role="status" aria-live="polite">
      <span className="raid-live-sync__dot" aria-hidden="true" />
      <span>{label}</span>
      {rosterLabel ? <strong>{rosterLabel}</strong> : null}
    </div>
  );
}
