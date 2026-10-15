"use client";

import { useRouter } from "next/navigation";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { useRaidPollMutation } from "@/lib/useRaidPollMutation";
import RaidPollActionResult from "@/components/RaidPollActionResult";

export default function RaidPollRecalculateButton() {
  const router = useRouter();
  const operation = useRaidPollMutation();
  function recalculate(trigger: HTMLElement) {
    void operation.run("/api/polls/recalculate-recommendations", { method: "POST", action: "recalculate-raid-poll-recommendations" }, trigger, data => {
      const updated = data.updated ?? 0, failed = data.failed ?? 0;
      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", source: "site-recalculate", action: "recalculate-raid-poll-recommendations" });
      router.refresh();
      return { tone: failed ? "warning" : "success", title: failed ? "Перерахунок частковий" : "Дні перераховано", message: failed ? `Оновлено ${updated}, з помилкою ${failed}. Перевір логи Discord/бази даних.` : `Оновлено ${updated} Discord-повідомлень без перетину рекомендованих днів.`, ttl: 7200 };
    });
  }
  return <div ref={operation.scopeRef} className="raid-poll-action" aria-busy={operation.pending}>
    <RaidPollActionResult message={operation.message} unconfirmed={operation.unconfirmed} href="/polls" />
    <button className="btn subtle raid-poll-recalculate-button" type="button" onClick={event => recalculate(event.currentTarget)} disabled={operation.pending} aria-busy={operation.pending}>{operation.pending ? "Рахуємо..." : "Перерахувати дні Discord"}</button>
  </div>;
}
