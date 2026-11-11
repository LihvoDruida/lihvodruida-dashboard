export const AUTOMATION_TASKS = {
  "guild-sync": { title: "Синхронізація складу", intervalSeconds: 120, href: "/guild", action: "Переглянути склад", note: "Виклик може продовжити частину синхронізації, не завершуючи весь склад." },
  "raid-lifecycle": { title: "Рейди та нагадування", intervalSeconds: 60, href: "/raids", action: "Переглянути рейди", note: "Підсумок стосується готових задач рейдів; окремі публікації можуть потребувати звірки." },
  polls: { title: "Автоматизація рейд-пулів", intervalSeconds: 300, href: "/polls", action: "Переглянути рейд-пули", note: "Виклик перевіряє розклад, закриття та повтор; він не означає нову публікацію." },
  onboarding: { title: "Нові учасники Discord", intervalSeconds: 60, href: "/dashboard/discord#discord-settings", action: "Перевірити onboarding", note: "Вимоги явного прийняття правил зберігаються." },
  "application-deliveries": { title: "Доставка заявок у Discord", intervalSeconds: 60, href: "/applications", action: "Перевірити заявки", note: "Збережені заявки доставляються з черги; неоднозначний результат потребує звірки без нового повідомлення." },
  "profile-nicknames": { title: "Черга змін ніків", intervalSeconds: 60, href: "/profiles", action: "Переглянути профілі", note: "Обробка черги не підтверджує кожну зміну ніку; окремий результат зберігається у профілі." },
  "log-maintenance": { title: "Журнал і службові записи", intervalSeconds: 1800, href: "/dashboard/logs", action: "Переглянути журнал", note: "Очищення службових і захисних записів має окремий підсумок помилок." },
} as const;
export type AutomationTaskId = keyof typeof AUTOMATION_TASKS;
export const AUTOMATION_TASK_IDS = Object.keys(AUTOMATION_TASKS) as AutomationTaskId[];
export const AUTOMATION_TASK_RUN_COLLECTION = "automationTaskRuns";

const COUNTERS = ["processed", "found", "checked", "scanned", "failed", "sent", "newcomers", "deferred", "defaultRoleAssigned", "defaultRoleFailed", "channelSent", "channelFailed", "persistenceFailed", "scheduledPublished", "closed", "repeated", "deleted", "autoClosed", "remindersSent", "discordDeleted", "raidMenusDeleted", "replayDeleted", "sessionsDeleted", "challengeQuotasDeleted", "ingressDeleted"] as const;
type Data = Record<string, unknown>;
function object(value: unknown): Data { return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {}; }
export function automationRunResult(value: unknown) {
  const data = object(value);
  const retention = object(data.securityRetention);
  const counters: Record<string, number> = {};
  for (const key of COUNTERS) {
    const raw = data[key] ?? retention[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) counters[key] = Math.min(1_000_000_000, Math.floor(raw));
  }
  const skipped = data.skipped === true || data.skippedReason === "distributed_lease";
  const reason = ["disabled", "in_flight", "cooldown", "distributed_lease"].includes(String(data.reason || data.skippedReason)) ? String(data.reason || data.skippedReason) : null;
  const failed = data.ok === false || object(data.sync).status === "failed";
  const warning = data.degraded === true || Number(retention.failed || 0) > 0 ||
    [data.errors, object(data.sync).errors].some(value => Array.isArray(value) && value.length > 0) ||
    ["failed", "defaultRoleFailed", "channelFailed", "persistenceFailed"].some(key => Number(counters[key] || 0) > 0);
  if (Number(retention.failed || 0) > 0) counters.retentionFailed = Math.min(100, Math.floor(Number(retention.failed)));
  return { status: failed ? "error" as const : warning ? "warning" as const : skipped ? "skipped" as const : "ok" as const, reason, counters };
}
