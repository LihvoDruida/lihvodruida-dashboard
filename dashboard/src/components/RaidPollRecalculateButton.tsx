"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast } from "@/lib/clientToasts";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";

function errorFromPayload(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  const message = record.error || record.message || record.warning;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

export default function RaidPollRecalculateButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function recalculate() {
    if (pending) return;
    setPending(true);
    dispatchDashboardToast({
      tone: "info",
      title: "Перераховуємо дні",
      message: "Оновлюю рекомендації для всіх рейд-пулів, які вже опубліковані в Discord.",
      ttl: 3600,
    });

    try {
      const response = await fetch("/api/polls/recalculate-recommendations", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Dashboard-Action": "recalculate-raid-poll-recommendations",
        },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ error: "Сервер повернув неочікувану відповідь." }));
      if (!response.ok || data?.ok === false) {
        throw new Error(errorFromPayload(data, "Не вдалося перерахувати Discord-рекомендації."));
      }

      const updated = typeof data?.updated === "number" ? data.updated : 0;
      const failed = typeof data?.failed === "number" ? data.failed : 0;
      dispatchDashboardToast({
        tone: failed ? "warning" : "success",
        title: failed ? "Перерахунок частковий" : "Дні перераховано",
        message: failed
          ? `Оновлено ${updated}, з помилкою ${failed}. Перевір логи Discord/Firebase.`
          : `Оновлено ${updated} Discord-повідомлень без перетину рекомендованих днів.`,
        ttl: 7200,
      });
      notifyDashboardDataChanged({
        scope: "raids",
        kind: "raid-poll",
        source: "site-recalculate",
        action: "recalculate-raid-poll-recommendations",
      });
      router.refresh();
    } catch (error) {
      dispatchDashboardToast({
        tone: "error",
        title: "Перерахунок не виконано",
        message: dashboardErrorMessage(error, "Не вдалося перерахувати Discord-рекомендації."),
        ttl: 8200,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="btn subtle raid-poll-recalculate-button" type="button" onClick={recalculate} disabled={pending} aria-busy={pending ? "true" : "false"}>
      {pending ? "Рахуємо..." : "Перерахувати дні Discord"}
    </button>
  );
}
