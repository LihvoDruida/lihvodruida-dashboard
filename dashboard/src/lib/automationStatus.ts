import type { AccountCleanupAutomationSettings } from "@/lib/accountCleanupAutomation";
import type { NicknameWarningAutomationState } from "@/lib/discordNicknameWarnings";
import type { GuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { timestampToIso } from "@/lib/values";
import { isCleanupPeriod } from "@/lib/discordCleanupPolicy";

export type AutomationStatus = {
  id: "members" | "nicknames" | "accounts";
  title: string;
  state: "running" | "waiting" | "paused" | "attention" | "unavailable";
  label: string;
  reason: string;
  lastAt: string | null;
  lastResult: string;
  nextAt: string | null;
  nextNote: string;
  action: { href: string; label: string };
};
export type AutomationOverview = { checkedAt: string; cards: AutomationStatus[] };
type Data = Record<string, unknown>;
export function statusDate(value: unknown) {
  const iso = timestampToIso(value);
  return iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}
function count(value: unknown) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function text(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 500) : ""; }
function due(last: unknown, hours: number, now: number) {
  const at = statusDate(last);
  return new Date(at ? Date.parse(at) + hours * 3_600_000 : now).toISOString();
}
function activeLease(lease: Data | undefined, now: number) {
  return Boolean(lease && text(lease.owner) && statusDate(lease.startedAt) && Number(lease.expiresAtMs) > now);
}
const links = {
  members: { href: "/dashboard/discord/cleanup", label: "Переглянути очищення" },
  nicknames: { href: "/dashboard/discord#nickname-automation", label: "Перевірити попередження" },
  accounts: { href: "/dashboard/discord#account-automation", label: "Переглянути профілі" },
};
function base(id: AutomationStatus["id"], title: string): AutomationStatus {
  return { id, title, state: "waiting", label: "Очікує", reason: "", lastAt: null,
    lastResult: "Завершених перевірок ще немає.", nextAt: null,
    nextNote: "Час наступного запуску не відомий.", action: links[id] };
}
function running(card: AutomationStatus, lease: Data | undefined, now: number) {
  if (!activeLease(lease, now)) return false;
  card.state = "running";
  const saving = text(lease?.source).startsWith("settings:");
  card.label = saving ? "Збереження" : "Виконується";
  card.reason = saving ? "Налаштування зараз зберігаються." : "Виконавець утримує чинний захист операції. Підсумок з’явиться після завершення.";
  card.nextNote = "Поточна операція ще не завершена.";
  return true;
}
export function unavailableAutomationStatuses(reason = "Не вдалося прочитати стан зі сховища. Онови сторінку після відновлення доступу.") {
  return ([base("members", "Очищення Discord"), base("nicknames", "Попередження про ніки"), base("accounts", "Неактуальні профілі")]).map(card => ({ ...card,
    state: "unavailable" as const, label: "Дані недоступні", reason,
    lastResult: "Результат не вдалося прочитати.", nextNote: "Розклад не вдалося прочитати." }));
}
export function memberCleanupStatus(settings: Data = {}, state: Data = {}, execution: Data = {}, lease: Data = {}, now = Date.now()): AutomationStatus {
  const card = base("members", "Очищення Discord");
  const enabled = settings.enabled === true && execution.paused !== true;
  const inflight = Boolean(execution.inFlight && typeof execution.inFlight === "object");
  card.lastAt = statusDate(state.lastRunAt);
  const recent = Array.isArray(state.recentRuns) ? state.recentRuns[0] as Data | undefined : undefined;
  card.lastResult = card.lastAt ? statusDate(recent?.at) === card.lastAt ? text(recent?.summary) || "Підсумок є в історії очищення." : "Деталі останньої спроби є в історії очищення." : card.lastResult;
  const uncertain = count(state.uncertainTotal);
  const error = text(state.lastError);
  if (error && card.lastAt) card.lastResult = "Остання спроба записала помилку; переглянь деталі очищення.";
  if ((settings.enabled !== undefined && typeof settings.enabled !== "boolean") ||
      (execution.paused !== undefined && typeof execution.paused !== "boolean")) {
    card.state = "attention"; card.label = "Перевірити правило";
    card.reason = "Збережені параметри мають некоректний формат. Стан автоматичного виключення не підтверджено.";
    return card;
  }
  if (running(card, lease, now)) {
    if (!enabled && inflight) { card.label = "Зупинка"; card.reason = "Пауза збережена. Уже відправлений запит ще потребує результату; нові виключення зупинено."; }
    return card;
  }
  if (inflight || uncertain) {
    card.state = "attention"; card.label = "Потрібна звірка";
    card.reason = inflight ? "Збережено незавершену спробу без чинного виконавця. Її результат потрібно звірити." : `Спроб із непевним результатом: ${uncertain}. Переглянь окремий список перед подальшими діями.`;
    card.nextNote = "Час повторної звірки не підтверджено.";
    card.action = { href: "/dashboard/discord/cleanup?tab=uncertain#cleanup-members-title", label: "Переглянути непевні спроби" };
  } else if (error) {
    card.state = "attention"; card.label = "Є помилка"; card.reason = error;
  } else if (!enabled) {
    card.state = "paused"; card.label = "На паузі"; card.reason = "Автоматичне виключення вимкнено. Список та історія залишаються доступними.";
    card.nextNote = "Автоматичне виключення не заплановано.";
  } else if (!/^\d{16,25}$/.test(text(settings.roleId))) {
    card.state = "attention"; card.label = "Потрібна роль"; card.reason = "Вибери одну роль та збережи налаштування очищення.";
  } else if (!isCleanupPeriod(settings.period === undefined ? "month" : settings.period)) {
    card.state = "attention"; card.label = "Потрібен строк"; card.reason = "Збережений строк очищення некоректний. Вибери строк та явно збережи правило.";
  } else {
    const automaticAt = statusDate(state.lastAutomaticRunAt);
    const firstExpectedFrom = automaticAt || statusDate(settings.updatedAt);
    const late = firstExpectedFrom && now - Date.parse(firstExpectedFrom) > 180_000;
    card.state = late ? "attention" : "waiting";
    card.label = late ? "Перевірити планувальник" : automaticAt ? "Очікує виклику" : "Очікує першого виклику";
    card.reason = late ? "Понад 3 хвилини немає збереженого автоматичного виклику. Перевір підключення планувальника та помилки очищення." : "Увімкнено в налаштуваннях. Це не підтверджує запуск планувальника.";
    if (automaticAt) card.nextAt = new Date(Date.parse(automaticAt) + (state.scan ? 10_000 : 60_000)).toISOString();
    card.nextNote = "Орієнтир за останнім викликом; черга, помилки та пауза можуть змінити час.";
  }
  if (!enabled && card.state === "attention") card.reason += " Автоматичне виключення на паузі.";
  return card;
}
export function nicknameWarningStatus(policy: GuildNicknamePolicy, state: NicknameWarningAutomationState, lease: Data = {}, now = Date.now()): AutomationStatus {
  const card = base("nicknames", "Попередження про ніки");
  card.lastAt = statusDate(state.lastRunAt);
  card.lastResult = card.lastAt ? `${state.lastRunStatus === "error" ? "Помилка" : state.lastRunStatus === "warning" ? "З попередженням" : "Перевірено"}: ${state.lastChecked}; сповіщено: ${state.lastNotified}; невдалих: ${state.lastFailed}.` : card.lastResult;
  if (running(card, lease, now)) return card;
  if (state.lastError || state.lastRunStatus === "error" || state.lastRunStatus === "warning") {
    card.state = "attention"; card.label = "Перевірити результат";
    card.reason = text(state.lastError) || "Остання перевірка завершилась із попередженням. Деталі є в історії запусків.";
  } else if (!policy.nicknameReminderEnabled) {
    card.state = "paused"; card.label = "На паузі";
    card.reason = "Автоматичні попередження вимкнено. Ручна перевірка доступна окремо.";
  } else {
    card.label = card.lastAt ? "Очікує перевірки" : "Очікує першої перевірки";
    card.reason = `Відстежуваних невалідних ніків: ${state.trackedInvalid}. Повторні сповіщення обмежені налаштуваннями розсилки.`;
  }
  if (policy.nicknameReminderEnabled) {
    const full = state.lastFullScanTemplate !== policy.template ? new Date(now).toISOString() : due(state.lastFullScanAt, policy.nicknameValidRecheckHours, now);
    const priority = statusDate(state.nextInvalidCheckAt);
    card.nextAt = priority && priority < full ? priority : full;
    card.nextNote = "Орієнтир найближчої перевірки за збереженою чергою та інтервалом повного сканування.";
  } else card.nextNote = "Автоматична розсилка вимкнена.";
  return card;
}
export function accountCleanupStatus(settings: AccountCleanupAutomationSettings, lease: Data = {}, now = Date.now()): AutomationStatus {
  const card = base("accounts", "Неактуальні профілі");
  const checkAt = statusDate(settings.lastCheckAt), cleanupAt = statusDate(settings.lastCleanupAt);
  const cleanupLatest = cleanupAt && (!checkAt || cleanupAt > checkAt);
  card.lastAt = cleanupLatest ? cleanupAt : checkAt;
  card.lastResult = card.lastAt ? cleanupLatest ? `Видалено профілів: ${settings.lastCleanupDeletedProfiles}.` : `Перевірено: ${settings.lastCheckCheckedProfiles}; кандидатів: ${settings.lastCheckCandidates}.` : card.lastResult;
  if (running(card, lease, now)) return card;
  const latestStatus = cleanupLatest ? settings.lastCleanupStatus : settings.lastCheckStatus;
  if (settings.lastError || latestStatus === "error" || latestStatus === "warning") {
    card.state = "attention"; card.label = "Перевірити результат";
    card.reason = text(settings.lastError) || "Останній запуск завершився з помилкою або попередженням. Переглянь історію.";
  } else if (settings.lastCheckCandidates > 0 && !settings.autoCleanupEnabled) {
    card.state = "attention"; card.label = "Є кандидати";
    card.reason = `Кандидатів за останньою перевіркою: ${settings.lastCheckCandidates}. Автовидалення вимкнено; результат можна переглянути перед явною дією.`;
  } else if (!settings.autoCheckEnabled && !settings.autoCleanupEnabled) {
    card.state = "paused"; card.label = "На паузі"; card.reason = "Автоматична перевірка та видалення вимкнені.";
  } else {
    card.label = card.lastAt ? "Очікує перевірки" : "Очікує першої перевірки";
    card.reason = settings.autoCleanupEnabled ? "Автоматична перевірка та очищення увімкнені." : "Увімкнена перевірка без видалення профілів.";
  }
  const times = [settings.autoCheckEnabled ? due(checkAt, settings.checkIntervalHours, now) : null,
    settings.autoCleanupEnabled ? due(cleanupAt, settings.cleanupIntervalHours, now) : null].filter((at): at is string => Boolean(at)).sort();
  card.nextAt = times[0] || null;
  card.nextNote = times.length ? "Орієнтир за інтервалами; фактичний запуск залежить від планувальника." : "Автоматичні запуски вимкнені.";
  return card;
}
