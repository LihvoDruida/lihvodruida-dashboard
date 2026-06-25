"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast } from "@/lib/clientToasts";

function errorFromPayload(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  const message = record.error || record.message || record.warning;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

export default function RaidPollDeleteButton({ pollId, pollTitle }: { pollId: string; pollTitle: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function deletePoll() {
    if (pending) return;
    const confirmed = window.confirm(`Видалити рейд-пул “${pollTitle}”?\n\nЦе видалить запис із Firebase і спробує прибрати Discord-повідомлення. Дію не можна скасувати.`);
    if (!confirmed) return;

    setPending(true);
    dispatchDashboardToast({
      tone: "warning",
      title: "Видаляємо рейд-пул",
      message: "Видаляю запис із Firebase і синхронізую Discord-повідомлення.",
      ttl: 3600,
    });

    try {
      const response = await fetch(`/api/polls/${encodeURIComponent(pollId)}`, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          "X-Dashboard-Action": "delete-raid-poll",
        },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ error: "Сервер повернув неочікувану відповідь." }));
      if (!response.ok || data?.ok === false) {
        throw new Error(errorFromPayload(data, "Не вдалося видалити рейд-пул."));
      }

      dispatchDashboardToast({
        tone: data?.discordDeleteFailed ? "warning" : "success",
        title: data?.discordDeleteFailed ? "Рейд-пул видалено частково" : "Рейд-пул видалено",
        message: data?.warning || "Запис видалено, список рейд-пулів оновлено.",
        ttl: 6200,
      });
      router.push(typeof data?.redirectTo === "string" ? data.redirectTo : "/polls");
      router.refresh();
    } catch (error) {
      dispatchDashboardToast({
        tone: "error",
        title: "Видалення не виконано",
        message: dashboardErrorMessage(error, "Не вдалося видалити рейд-пул."),
        ttl: 8200,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="btn danger" type="button" onClick={deletePoll} disabled={pending} aria-busy={pending ? "true" : "false"}>
      {pending ? "Видаляємо..." : "Видалити пул"}
    </button>
  );
}
