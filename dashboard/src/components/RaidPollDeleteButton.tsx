"use client";

import { useRouter } from "next/navigation";
import { useRaidPollMutation } from "@/lib/useRaidPollMutation";
import RaidPollActionResult from "@/components/RaidPollActionResult";

export default function RaidPollDeleteButton({ pollId, pollTitle }: { pollId: string; pollTitle: string }) {
  const router = useRouter();
  const operation = useRaidPollMutation();
  function deletePoll(trigger: HTMLElement) {
    if (operation.pending || !window.confirm(`Видалити рейд-пул “${pollTitle}”?\n\nЦе видалить запис із бази даних і спробує прибрати Discord-повідомлення. Дію не можна скасувати.`)) return;
    void operation.run(`/api/polls/${encodeURIComponent(pollId)}`, { method: "DELETE", action: "delete-raid-poll" }, trigger, data => {
      router.push(data.redirectTo || "/polls"); router.refresh();
      return { tone: data.discordDeleteFailed ? "warning" : "success", title: data.discordDeleteFailed ? "Рейд-пул видалено частково" : "Рейд-пул видалено", message: data.warning || "Запис видалено, список рейд-пулів оновлено.", ttl: 6200 };
    });
  }
  return <div ref={operation.scopeRef} className="raid-poll-action" aria-busy={operation.pending}>
    <RaidPollActionResult message={operation.message} unconfirmed={operation.unconfirmed} href={`/polls/${encodeURIComponent(pollId)}`} />
    <button className="btn danger" type="button" onClick={event => deletePoll(event.currentTarget)} disabled={operation.pending} aria-busy={operation.pending}>{operation.pending ? "Видаляємо..." : "Видалити пул"}</button>
  </div>;
}
