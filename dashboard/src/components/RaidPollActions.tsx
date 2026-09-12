"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast, errorFromPayload } from "@/lib/clientToasts";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import RaidPollPauseButton from "@/components/RaidPollPauseButton";

export type RaidPollActionState = "open" | "paused" | "closed";

type Kind = "close" | "reopen" | "sync" | "delete";

/**
 * Раніше закриття йшло звичайною формою. DashboardFormEnhancer шле
 * Accept: application/json, тож роут відповідав JSON замість редіректу,
 * і сторінка списку не оновлювалась — картка лишалась «Активний».
 * Тепер усі дії роблять fetch + router.refresh().
 */
export default function RaidPollActions({
  pollId,
  pollTitle,
  state,
  canManage = false,
  editHref,
  messageUrl,
  redirectAfterDelete,
  showView = false,
}: {
  pollId: string;
  pollTitle: string;
  state: RaidPollActionState;
  canManage?: boolean;
  editHref?: string;
  messageUrl?: string | null;
  redirectAfterDelete?: string | null;
  showView?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Kind | null>(null);
  const href = `/polls/${encodeURIComponent(pollId)}`;

  async function run(kind: Kind) {
    if (pending) return;

    if (kind === "close" && !window.confirm(`Закрити рейд-пул «${pollTitle}»?\n\nКнопки голосування в Discord стануть неактивними. Пул можна буде відкрити знову.`)) return;
    if (kind === "delete" && !window.confirm(`Видалити рейд-пул «${pollTitle}»?\n\nЗапис зникне з бази даних, Discord-повідомлення буде прибрано. Дію не можна скасувати.`)) return;

    setPending(kind);

    const endpoint =
      kind === "delete"
        ? `/api/polls/${encodeURIComponent(pollId)}`
        : kind === "sync"
          ? `/api/polls/${encodeURIComponent(pollId)}/discord-sync`
          : `/api/polls/${encodeURIComponent(pollId)}/close`;

    try {
      const response = await fetch(endpoint, {
        method: kind === "delete" ? "DELETE" : "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Dashboard-Action": `${kind}-raid-poll`,
        },
        credentials: "same-origin",
        cache: "no-store",
        body: kind === "close" || kind === "reopen" ? JSON.stringify({ action: kind }) : undefined,
      });
      const data = await response.json().catch(() => ({ error: "Сервер повернув неочікувану відповідь." }));
      if (!response.ok || data?.ok === false) throw new Error(errorFromPayload(data, "Дію не виконано."));

      dispatchDashboardToast({
        tone: data?.discordDeleteFailed ? "warning" : "success",
        title:
          kind === "close" ? "Рейд-пул закрито"
            : kind === "reopen" ? "Рейд-пул відкрито"
              : kind === "sync" ? (data?.republished ? "Повідомлення опубліковано заново" : "Discord синхронізовано")
                : "Рейд-пул видалено",
        message:
          kind === "close" ? "Кнопки голосування в Discord вимкнено, фінальний результат оновлено."
            : kind === "reopen" ? "Голосування знову приймає голоси."
              : kind === "sync" ? (data?.republished ? "Старе повідомлення не знайдено, тому створено нове." : "Embed і кнопки приведено у відповідність до стану на сайті.")
                : data?.warning || "Запис і Discord-повідомлення прибрано.",
        ttl: 6200,
      });

      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", pollId, source: "poll-actions", action: `${kind}-raid-poll` });

      if (kind === "delete" && redirectAfterDelete) {
        router.push(redirectAfterDelete);
      }
      router.refresh();
    } catch (error) {
      dispatchDashboardToast({
        tone: "error",
        title: "Дію не виконано",
        message: dashboardErrorMessage(error, "Спробуй ще раз або перевір звʼязок з Discord."),
        ttl: 8200,
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {showView ? <a className="btn subtle poll-card__primary" href={href}>Результати</a> : null}
      {messageUrl ? <a className="btn subtle" href={messageUrl} target="_blank" rel="noreferrer">Discord</a> : null}
      {canManage && editHref ? <a className="btn subtle" href={editHref}>Редагувати</a> : null}

      {canManage && state !== "closed" ? <RaidPollPauseButton pollId={pollId} paused={state === "paused"} /> : null}

      {canManage ? (
        <button className="btn subtle" type="button" onClick={() => run("sync")} disabled={pending !== null} aria-busy={pending === "sync"}>
          {pending === "sync" ? "Синхронізуємо…" : "Синхронізувати Discord"}
        </button>
      ) : null}

      {canManage && state !== "closed" ? (
        <button className="btn danger" type="button" onClick={() => run("close")} disabled={pending !== null} aria-busy={pending === "close"}>
          {pending === "close" ? "Закриваємо…" : "Закрити"}
        </button>
      ) : null}

      {canManage && state === "closed" ? (
        <button className="btn subtle" type="button" onClick={() => run("reopen")} disabled={pending !== null} aria-busy={pending === "reopen"}>
          {pending === "reopen" ? "Відкриваємо…" : "Відкрити знову"}
        </button>
      ) : null}

      {canManage ? (
        <button className="btn danger" type="button" onClick={() => run("delete")} disabled={pending !== null} aria-busy={pending === "delete"}>
          {pending === "delete" ? "Видаляємо…" : "Видалити"}
        </button>
      ) : null}
    </>
  );
}
