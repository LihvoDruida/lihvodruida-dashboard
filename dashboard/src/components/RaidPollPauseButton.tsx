"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast, errorFromPayload } from "@/lib/clientToasts";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";

export default function RaidPollPauseButton({
  pollId,
  paused,
  compact = false,
}: {
  pollId: string;
  paused: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const action = paused ? "resume" : "pause";

  async function toggle() {
    if (pending) return;
    setPending(true);

    try {
      const response = await fetch(`/api/polls/${encodeURIComponent(pollId)}/pause`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": `${action}-raid-poll`,
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({ error: "Сервер повернув неочікувану відповідь." }));
      if (!response.ok || data?.ok === false) {
        throw new Error(errorFromPayload(data, paused ? "Не вдалося відновити рейд-пул." : "Не вдалося поставити рейд-пул на паузу."));
      }

      dispatchDashboardToast({
        tone: "success",
        title: paused ? "Рейд-пул відновлено" : "Рейд-пул на паузі",
        message: paused
          ? "Голоси знову приймаються, залишок часу повернено без втрат."
          : "Час до закриття заморожено, Discord-кнопки вимкнено.",
        ttl: 6200,
      });
      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", source: "site-pause", action: `${action}-raid-poll` });
      router.refresh();
    } catch (error) {
      dispatchDashboardToast({
        tone: "error",
        title: paused ? "Відновлення не виконано" : "Паузу не встановлено",
        message: dashboardErrorMessage(error, "Спробуй ще раз або перевір Discord-звʼязок."),
        ttl: 8200,
      });
    } finally {
      setPending(false);
    }
  }

  const label = pending
    ? (paused ? "Відновлюємо…" : "Ставимо на паузу…")
    : (paused ? "Відновити" : "Пауза");

  return (
    <button
      className={`btn subtle raid-poll-pause-button${paused ? " is-paused" : ""}`}
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-busy={pending ? "true" : "false"}
      title={paused ? "Відновити голосування і повернути заморожений час" : "Призупинити голосування без втрати часу та голосів"}
    >
      <span aria-hidden="true">{paused ? "▶" : "⏸"}</span>
      {compact ? null : <span>{label}</span>}
    </button>
  );
}
