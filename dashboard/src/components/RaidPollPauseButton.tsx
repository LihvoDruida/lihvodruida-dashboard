"use client";

import { useRouter } from "next/navigation";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { useRaidPollMutation } from "@/lib/useRaidPollMutation";
import RaidPollActionResult from "@/components/RaidPollActionResult";

export default function RaidPollPauseButton({ pollId, paused, compact = false, disabled = false, onPendingChange }: {
  pollId: string; paused: boolean; compact?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const operation = useRaidPollMutation(onPendingChange);
  const action = paused ? "resume" : "pause";
  function toggle(trigger: HTMLElement) {
    if (disabled) return;
    void operation.run(`/api/polls/${encodeURIComponent(pollId)}/pause`, { method: "POST", action: `${action}-raid-poll`, json: { action } }, trigger, () => {
      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", source: "site-pause", pollId, action: `${action}-raid-poll` });
      router.refresh();
      return { tone: "success", title: paused ? "Рейд-пул відновлено" : "Рейд-пул на паузі", message: paused ? "Голоси знову приймаються, залишок часу повернено без втрат." : "Час до закриття заморожено, Discord-кнопки вимкнено.", ttl: 6200 };
    });
  }
  const label = operation.pending ? (paused ? "Відновлюємо…" : "Ставимо на паузу…") : (paused ? "Відновити" : "Пауза");
  return <div ref={operation.scopeRef} className="raid-poll-action" aria-busy={operation.pending}>
    <RaidPollActionResult message={operation.message} unconfirmed={operation.unconfirmed} href={`/polls/${encodeURIComponent(pollId)}`} />
    <button className={`btn subtle raid-poll-pause-button${paused ? " is-paused" : ""}`} type="button" onClick={event => toggle(event.currentTarget)} disabled={disabled || operation.pending} aria-busy={operation.pending} aria-label={compact ? label : undefined} title={paused ? "Відновити голосування і повернути заморожений час" : "Призупинити голосування без втрати часу та голосів"}>
      <span aria-hidden="true">{paused ? "▶" : "⏸"}</span>{compact ? null : <span>{label}</span>}
    </button>
  </div>;
}
