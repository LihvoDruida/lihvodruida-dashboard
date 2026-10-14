import type { PublicationOperation } from "@/lib/discordPublication";

export type PublicationReceipt = Pick<PublicationOperation, "state" | "target" | "previousId" | "cleanupDone" | "context">;
export type PublicationStep = { state: string; label: string; description: string; pending: boolean; manual: boolean };
export type PublicationStatus = {
  message: PublicationStep; event?: PublicationStep; checkedAt: string;
  actionLabel: string; canAct: boolean; manualAllowed: boolean; channelMove: boolean; scheduled: boolean;
};
export function describePublication(operation?: PublicationReceipt | null, hasReference = false): PublicationStep {
  const base = { pending: false, manual: false };
  switch (operation?.state) {
    case "prepared": return { ...base, state: "prepared", pending: true, label: "Надсилання підготовлено", description: "Надсилання ще не почалося. Можна продовжити збережену операцію." };
    case "sending":
    case "uncertain": return { ...base, state: operation.state, pending: true, manual: true, label: "Потрібна звірка з Discord", description: "Повідомлення могло бути створене. Перевірка шукає попередній результат і не повторює непідтверджене надсилання." };
    case "confirmed": return { ...base, state: "confirmed", pending: true, label: "Discord повернув підтвердження", description: "ID обʼєкта збережено. Потрібно завершити привʼязку до запису без повторного створення." };
    case "rejected": return { ...base, state: "rejected", label: "Надсилання відхилено", description: "Discord відхилив запит. Перевір канал і права бота перед повторною спробою." };
    case "complete":
      if (!operation.cleanupDone && operation.previousId && operation.context.previousChannelId && operation.context.previousChannelId !== operation.target)
        return { ...base, state: "cleanup", pending: true, label: "Старе повідомлення потребує очищення", description: "Нове повідомлення привʼязано. Наступна дія спочатку повторить прибирання старого." };
  }
  return hasReference
    ? { ...base, state: "linked", label: "Посилання збережено", description: "Запис має посилання на Discord. Це не перевірка доступності повідомлення чи актуальності його вмісту." }
    : { ...base, state: "unpublished", label: "Немає збереженого посилання", description: "Завершена привʼязка до Discord відсутня." };
}
export function unknownPublicationStatus(): PublicationStatus {
  return { message: { state: "unknown", label: "Стан не вдалося прочитати", description: "Онови стан перед наступною дією. Відсутність відповіді не означає відсутність публікації.", pending: false, manual: false }, checkedAt: new Date().toISOString(), actionLabel: "", canAct: false, manualAllowed: false, channelMove: false, scheduled: false };
}
export function buildPublicationStatus(kind: "raid" | "poll", resource: Record<string, unknown>, message?: PublicationReceipt, event?: PublicationReceipt, now = Date.now()): PublicationStatus {
  const step = describePublication(message, Boolean(resource.messageId));
  let eventStep = event || resource.discordEventId || resource.discordEventLastError ? describePublication(event, Boolean(resource.discordEventId)) : undefined;
  if (resource.discordEventLastError && !eventStep?.pending) eventStep = { state: "attention", label: "Подія потребує уваги", description: "Останню синхронізацію події не підтверджено. Спробуй оновити Discord після перевірки прав бота.", pending: false, manual: false };
  const scheduled = kind === "poll" && resource.status === "scheduled";
  const due = Number(resource.scheduledPublishAtMs) > 0 && Number(resource.scheduledPublishAtMs) <= now;
  const linkedChannel = resource.discordMessageChannelId || String(resource.messageUrl || "").match(/\/channels\/\d+\/(\d+)\/\d+/)?.[1];
  const channelMove = Boolean(resource.messageId && linkedChannel && resource.channelId && linkedChannel !== resource.channelId && !step.pending);
  const pending = step.pending || Boolean(eventStep?.pending);
  const canAct = Boolean(resource.channelId || pending) && (!scheduled || due) && !(kind === "raid" && resource.status === "closed" && !resource.messageId && !pending);
  return { message: step, event: eventStep, checkedAt: new Date(now).toISOString(), scheduled, channelMove, canAct,
    manualAllowed: step.manual,
    actionLabel: scheduled ? "Виконати заплановану публікацію" : pending ? "Перевірити й завершити Discord" : channelMove ? "Перенести й оновити Discord" : step.state === "rejected" ? "Повторити після виправлення" : resource.messageId ? "Оновити Discord" : "Опублікувати в Discord" };
}
