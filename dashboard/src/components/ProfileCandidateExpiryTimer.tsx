"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";

type Props = {
  expiresAt: string;
};

function remainingMs(expiresAt: string) {
  const target = new Date(expiresAt).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, target - Date.now());
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ProfileCandidateExpiryTimer({ expiresAt }: Props) {
  const cleanupStartedRef = useRef(false);
  const refreshStartedRef = useRef(false);
  const [leftMs, setLeftMs] = useState<number | null>(null);
  const expired = leftMs !== null && leftMs <= 0;
  const label = useMemo(() => {
    if (leftMs === null) return "—:—";
    return expired ? "час вийшов" : formatRemaining(leftMs);
  }, [expired, leftMs]);

  useEffect(() => {
    cleanupStartedRef.current = false;
    refreshStartedRef.current = false;
    let cancelled = false;
    let intervalId: number | null = null;

    function hideCandidateUi() {
      const roots = document.querySelectorAll<HTMLElement>('[data-profile-candidates-box="true"]');
      roots.forEach((root) => {
        root.dataset.expired = "true";
        root.hidden = true;
        root.style.display = "none";
        root.setAttribute("aria-hidden", "true");
      });

      document.querySelectorAll<HTMLElement>('[data-profile-candidate-count="true"]').forEach((item) => {
        item.textContent = "0";
      });

      document.querySelectorAll<HTMLButtonElement>('[data-profile-candidates-box="true"] button').forEach((button) => {
        button.disabled = true;
      });
      document.querySelectorAll<HTMLInputElement>('[data-profile-candidates-box="true"] input').forEach((input) => {
        input.disabled = true;
      });
    }

    async function expireCandidates() {
      if (cleanupStartedRef.current) return;
      cleanupStartedRef.current = true;
      setLeftMs(0);
      hideCandidateUi();
      if (intervalId !== null) window.clearInterval(intervalId);

      try {
        await fetch("/api/profile/battlenet/candidates/expire", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expiresAt }),
          cache: "no-store",
          credentials: "same-origin",
          keepalive: true,
        });
      } catch {
        // The next server render also prunes expired candidates, so a network error is non-fatal.
      } finally {
        if (!cancelled && !refreshStartedRef.current) {
          refreshStartedRef.current = true;
          window.setTimeout(() => notifyDashboardDataChanged({ scope: "profile", source: "candidate-expiry", action: "expire" }), 120);
        }
      }
    }

    const tick = () => {
      if (cancelled) return;
      const next = remainingMs(expiresAt);
      setLeftMs(next);
      if (next <= 0) void expireCandidates();
    };

    tick();
    intervalId = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [expiresAt]);

  return (
    <span className={`profile-candidate-expiry${expired ? " is-expired" : ""}`} title="Час доступності тимчасового списку Battle.net">
      <span aria-hidden="true">⏳</span>
      <span suppressHydrationWarning>{label}</span>
    </span>
  );
}
