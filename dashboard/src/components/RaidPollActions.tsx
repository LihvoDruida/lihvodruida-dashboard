"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { useRaidPollMutation } from "@/lib/useRaidPollMutation";
import RaidPollPauseButton from "@/components/RaidPollPauseButton";
import RaidPollActionResult from "@/components/RaidPollActionResult";

export type RaidPollActionState = "scheduled" | "open" | "paused" | "closed";

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
  disabled = false,
}: {
  pollId: string;
  pollTitle: string;
  state: RaidPollActionState;
  canManage?: boolean;
  editHref?: string;
  messageUrl?: string | null;
  redirectAfterDelete?: string | null;
  showView?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const operation = useRaidPollMutation();
  const [kind, setKind] = useState<Kind | null>(null);
  const [pausePending, setPausePending] = useState(false);
  const locked = disabled || operation.pending || pausePending;
  const href = `/polls/${encodeURIComponent(pollId)}`;
  function run(nextKind: Kind, trigger: HTMLElement) {
    if (locked || !canManage) return;
    if (nextKind === "close") {
      const question = state === "scheduled"
        ? `Скасувати заплановану публікацію «${pollTitle}»?\n\nDiscord-повідомлення не буде створено, а автоповтор для цього плану буде вимкнено.`
        : `Закрити рейд-пул «${pollTitle}»?\n\nКнопки голосування в Discord стануть неактивними. Пул можна буде відкрити знову.`;
      if (!window.confirm(question)) return;
    }
    if (nextKind === "delete" && !window.confirm(`Видалити рейд-пул «${pollTitle}»?\n\nЗапис зникне з бази даних, Discord-повідомлення буде прибрано. Дію не можна скасувати.`)) return;
    setKind(nextKind);
    const endpoint = nextKind === "delete" ? `/api/polls/${encodeURIComponent(pollId)}`
      : nextKind === "sync" ? `/api/polls/${encodeURIComponent(pollId)}/discord-sync` : `/api/polls/${encodeURIComponent(pollId)}/close`;
    void operation.run(endpoint, { method: nextKind === "delete" ? "DELETE" : "POST", action: `${nextKind}-raid-poll`, json: nextKind === "close" || nextKind === "reopen" ? { action: nextKind } : undefined }, trigger, data => {
      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", pollId, source: "poll-actions", action: `${nextKind}-raid-poll` });
      if (nextKind === "delete" && redirectAfterDelete) router.push(redirectAfterDelete);
      router.refresh();
      return {
        tone: data.discordDeleteFailed || data.warning ? "warning" : "success",
        title: nextKind === "close" ? (state === "scheduled" ? "План публікації скасовано" : "Рейд-пул закрито")
          : nextKind === "reopen" ? "Рейд-пул відкрито" : nextKind === "sync" ? (data.republished ? "Повідомлення опубліковано заново" : "Discord синхронізовано") : "Рейд-пул видалено",
        message: data.warning || (nextKind === "close" ? (state === "scheduled" ? "Пул не буде автоматично опубліковано в Discord." : "Кнопки голосування в Discord вимкнено, фінальний результат оновлено.")
          : nextKind === "reopen" ? "Голосування знову приймає голоси." : nextKind === "sync" ? (data.republished ? "Привʼязку повідомлення збережено. Онови стан публікації для подробиць." : "Embed і кнопки приведено у відповідність до стану на сайті.") : "Запис і Discord-повідомлення прибрано."),
        ttl: 6200,
      };
    });
  }
  const pending = operation.pending ? kind : null;
  return <div ref={operation.scopeRef} className="raid-poll-action" aria-busy={operation.pending || pausePending}>
    <RaidPollActionResult message={operation.message} unconfirmed={operation.unconfirmed} href={href} />
    {showView ? <a className="btn subtle poll-card__primary" href={href}>Результати</a> : null}
    {messageUrl ? <a className="btn subtle" href={messageUrl} target="_blank" rel="noreferrer">Discord</a> : null}
    {canManage && editHref ? <a className="btn subtle" href={editHref}>Редагувати</a> : null}
    {canManage && state !== "closed" && state !== "scheduled" ? <RaidPollPauseButton pollId={pollId} paused={state === "paused"} disabled={disabled || operation.pending} onPendingChange={setPausePending} /> : null}
    {canManage && state !== "scheduled" ? <button className="btn subtle" type="button" onClick={event => run("sync", event.currentTarget)} disabled={locked} aria-busy={pending === "sync"}>{pending === "sync" ? "Синхронізуємо…" : "Синхронізувати Discord"}</button> : null}
    {canManage && state !== "closed" ? <button className="btn danger" type="button" onClick={event => run("close", event.currentTarget)} disabled={locked} aria-busy={pending === "close"}>{pending === "close" ? (state === "scheduled" ? "Скасовуємо…" : "Закриваємо…") : (state === "scheduled" ? "Скасувати план" : "Закрити")}</button> : null}
    {canManage && state === "closed" ? <button className="btn subtle" type="button" onClick={event => run("reopen", event.currentTarget)} disabled={locked} aria-busy={pending === "reopen"}>{pending === "reopen" ? "Відкриваємо…" : "Відкрити знову"}</button> : null}
    {canManage ? <button className="btn danger" type="button" onClick={event => run("delete", event.currentTarget)} disabled={locked} aria-busy={pending === "delete"}>{pending === "delete" ? "Видаляємо…" : "Видалити"}</button> : null}
  </div>;
}
