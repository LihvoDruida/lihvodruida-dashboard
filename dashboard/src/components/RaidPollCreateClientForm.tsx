"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast } from "@/lib/clientToasts";
import { RolePicker, type DiscordRoleOption } from "@/components/DiscordEmbedEditor";
import {
  RAID_POLL_CLOSE_OPTIONS,
  RAID_POLL_DAYS,
  RAID_POLL_REPEAT_TIMES,
  raidPollDescription,
  type RaidPollDay,
  type RaidPollDifficulty,
  type RaidPollItem,
  type RaidPollRepeatTime,
} from "@/lib/raidPollShared";

export type RaidPollCreateChannel = {
  id: string;
  name: string;
};

type RaidPollCreateClientFormProps = {
  channels: RaidPollCreateChannel[];
  roles?: DiscordRoleOption[];
  defaultChannelId?: string;
  disabled?: boolean;
  poll?: RaidPollItem | null;
};

const POPULAR_RAIDS = [
  "Палац Неруб'ар",
  "Визволення Хрому",
  "Гробниця",
  "Амірдрассіл",
  "The Voidspire",
  "The Dreamrift",
];

const DIFFICULTIES: Array<{ value: RaidPollDifficulty; label: string; hint: string }> = [
  { value: "normal", label: "Звичайна", hint: "Для спокійного збору складу" },
  { value: "heroic", label: "Героїчна", hint: "Основний формат рейду" },
  { value: "mythic", label: "Міфічна", hint: "Прогрес / основний склад" },
];

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeDiscordChannelId(value: string) {
  return /^\d{16,25}$/.test(value.trim());
}

function errorFromPayload(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const message = (data as Record<string, unknown>).error || (data as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

export default function RaidPollCreateClientForm({ channels, roles = [], defaultChannelId = "", disabled = false, poll = null }: RaidPollCreateClientFormProps) {
  const router = useRouter();
  const channelOptions = poll?.channelId && !channels.some((channel) => channel.id === poll.channelId)
    ? [{ id: poll.channelId, name: "поточний канал" }, ...channels]
    : channels;
  const initialChannelId = poll?.channelId || defaultChannelId || channelOptions[0]?.id || "";
  const defaultDescription = raidPollDescription();
  const isEdit = Boolean(poll?.id);

  const [title, setTitle] = useState(poll?.title || "");
  const [difficulty, setDifficulty] = useState<RaidPollDifficulty>(poll?.difficulty || "heroic");
  const [channelId, setChannelId] = useState(initialChannelId);
  const [closeAfterMinutes, setCloseAfterMinutes] = useState(poll?.closeAfterMinutes || 720);
  const [description, setDescription] = useState(poll?.description || defaultDescription);
  const [selectedDays, setSelectedDays] = useState<RaidPollDay[]>(poll?.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value));
  const [mentionRoleIds, setMentionRoleIds] = useState<string[]>(poll?.mentionRoleIds || []);
  const [autoRepeatWeekly, setAutoRepeatWeekly] = useState(Boolean(poll?.autoRepeatWeekly));
  const [repeatWeeklyDay, setRepeatWeeklyDay] = useState<RaidPollDay>(poll?.repeatWeeklyDay || "mon");
  const [repeatWeeklyTime, setRepeatWeeklyTime] = useState<RaidPollRepeatTime>(poll?.repeatWeeklyTime || "12:00");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState("");

  const channelLabel = useMemo(() => {
    const found = channelOptions.find((channel) => channel.id === channelId);
    return found ? `#${found.name}` : channelId ? "Ручний Channel ID" : "Канал не вибрано";
  }, [channelOptions, channelId]);

  const closeLabel = useMemo(
    () => RAID_POLL_CLOSE_OPTIONS.find((option) => option.minutes === closeAfterMinutes)?.label || `${closeAfterMinutes} хв`,
    [closeAfterMinutes],
  );

  function resetForm() {
    setTitle(poll?.title || "");
    setDifficulty(poll?.difficulty || "heroic");
    setChannelId(initialChannelId);
    setCloseAfterMinutes(poll?.closeAfterMinutes || 720);
    setDescription(poll?.description || defaultDescription);
    setSelectedDays(poll?.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value));
    setMentionRoleIds(poll?.mentionRoleIds || []);
    setAutoRepeatWeekly(Boolean(poll?.autoRepeatWeekly));
    setRepeatWeeklyDay(poll?.repeatWeeklyDay || "mon");
    setRepeatWeeklyTime(poll?.repeatWeeklyTime || "12:00");
    setFieldError("");
  }

  function validate() {
    const normalizedTitle = clean(title);
    const normalizedChannelId = clean(channelId);
    const normalizedDescription = description.trim();

    if (normalizedTitle.length < 3) return "Вкажи назву рейду мінімум з 3 символів.";
    if (!DIFFICULTIES.some((option) => option.value === difficulty)) return "Вибери коректну складність рейду.";
    if (!looksLikeDiscordChannelId(normalizedChannelId)) return "Вибери коректний Discord-канал.";
    if (!RAID_POLL_CLOSE_OPTIONS.some((option) => option.minutes === closeAfterMinutes)) return "Вибери коректний таймер закриття голосування.";
    if (!selectedDays.length) return "Вибери хоча б один день рейд-тижня.";
    if (normalizedDescription.length < 20) return "Опис занадто короткий. Залиши зрозумілий текст для учасників.";
    if (normalizedDescription.length > 900) return "Опис занадто довгий. Максимум — 900 символів.";
    return "";
  }


  function toggleDay(day: RaidPollDay) {
    setSelectedDays((current) => {
      if (current.includes(day)) return current.filter((item) => item !== day);
      return RAID_POLL_DAYS.map((item) => item.value).filter((item) => item === day || current.includes(item));
    });
  }

  const selectedDayLabel = selectedDays.length === RAID_POLL_DAYS.length
    ? "Пн • Вт • Ср • Чт • Пт • Сб • Нд"
    : RAID_POLL_DAYS.filter((day) => selectedDays.includes(day.value)).map((day) => day.label).join(" • ") || "Дні не вибрано";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;

    const validationMessage = validate();
    if (validationMessage) {
      setFieldError(validationMessage);
      dispatchDashboardToast({ tone: "warning", title: "Перевір форму рейд-пулу", message: validationMessage });
      return;
    }

    setPending(true);
    setFieldError("");
    dispatchDashboardToast({
      tone: "info",
      title: isEdit ? "Оновлюємо рейд-пул" : "Створюємо рейд-пул",
      message: isEdit ? "Зберігаємо зміни у Firebase і синхронізуємо Discord-повідомлення." : "Зберігаємо голосування у Firebase і публікуємо Discord-повідомлення.",
      ttl: 3600,
    });

    try {
      const response = await fetch(isEdit && poll?.id ? `/api/polls/${encodeURIComponent(poll.id)}` : "/api/polls", {
        method: isEdit ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Dashboard-Action": isEdit ? "update-raid-poll" : "create-raid-poll",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          title: clean(title),
          difficulty,
          description: description.trim(),
          channelId: clean(channelId),
          closeAfterMinutes,
          days: selectedDays,
          mentionRoleIds,
          autoRepeatWeekly,
          repeatWeeklyDay,
          repeatWeeklyTime,
        }),
      });

      const data = await response.json().catch(() => ({ error: "Сервер повернув неочікувану відповідь." }));
      if (!response.ok || data?.error || data?.ok === false) {
        throw new Error(errorFromPayload(data, isEdit ? "Не вдалося оновити рейд-пул." : "Не вдалося створити рейд-пул."));
      }

      const pollId = typeof data?.pollId === "string" ? data.pollId : typeof data?.poll?.id === "string" ? data.poll.id : "";
      const redirectTo = typeof data?.redirectTo === "string" && data.redirectTo ? data.redirectTo : pollId ? `/polls/${encodeURIComponent(pollId)}` : "/polls";

      dispatchDashboardToast({
        tone: "success",
        title: isEdit ? "Рейд-пул оновлено" : "Рейд-пул створено",
        message: isEdit ? "Зміни збережено, Discord-повідомлення синхронізовано." : "Пул опубліковано в Discord. Учасники вже можуть голосувати.",
        ttl: 6200,
      });
      if (!isEdit) resetForm();
      router.push(redirectTo);
      router.refresh();
    } catch (error) {
      const message = dashboardErrorMessage(error, isEdit ? "Не вдалося оновити рейд-пул." : "Не вдалося створити рейд-пул.");
      setFieldError(message);
      dispatchDashboardToast({ tone: "error", title: isEdit ? "Рейд-пул не оновлено" : "Рейд-пул не створено", message, ttl: 8200 });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel raid-poll-create-panel" onSubmit={submit} noValidate>
      <div className="raid-poll-create-head">
        <div>
          <span className="eyebrow">{isEdit ? "Редагування рейд-пулу" : "Новий рейд-пул"}</span>
          <h2>{isEdit ? "Редагувати голосування" : "Створити голосування"}</h2>
          <p>{isEdit ? "Зміни зберігаються у Firebase і одразу оновлюють або переносять Discord embed у вибраний канал." : "Сайт є джерелом правди: він створює запис у Firebase, публікує Discord embed і відкриває голосування через select-menu."}</p>
        </div>
        <span className="raid-status-pill published">{isEdit ? "Firebase ↔ Discord" : "Site → Discord"}</span>
      </div>

      {fieldError ? <div className="notice error-note raid-poll-create-alert">{fieldError}</div> : null}
      {disabled ? <div className="notice warning-note raid-poll-create-alert">Створення тимчасово недоступне: перевір Firebase або Discord API конфігурацію.</div> : null}

      <div className="raid-poll-form-grid">
        <label className="raid-poll-field raid-poll-field--wide" htmlFor="raid-poll-title">
          <span>Назва рейду</span>
          <input
            id="raid-poll-title"
            list="raid-poll-popular-raids"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={3}
            maxLength={160}
            placeholder="Наприклад: Палац Неруб'ар"
            required
            disabled={pending || disabled}
          />
          <datalist id="raid-poll-popular-raids">
            {POPULAR_RAIDS.map((raid) => <option key={raid} value={raid} />)}
          </datalist>
        </label>

        <label className="raid-poll-field" htmlFor="raid-poll-difficulty">
          <span>Складність</span>
          <select id="raid-poll-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as RaidPollDifficulty)} disabled={pending || disabled} required>
            {DIFFICULTIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <small>{DIFFICULTIES.find((option) => option.value === difficulty)?.hint}</small>
        </label>

        <label className="raid-poll-field" htmlFor="raid-poll-close-after">
          <span>Таймер закриття</span>
          <select id="raid-poll-close-after" value={closeAfterMinutes} onChange={(event) => setCloseAfterMinutes(Number(event.target.value))} disabled={pending || disabled} required>
            {RAID_POLL_CLOSE_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
          </select>
          <small>Після дедлайну Discord-компоненти вимикаються.</small>
        </label>

        <label className="raid-poll-field raid-poll-field--wide" htmlFor="raid-poll-channel-id">
          <span>Discord-канал публікації</span>
          {channelOptions.length ? (
            <select
              id="raid-poll-channel-id"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              required
              disabled={pending || disabled}
            >
              {channelOptions.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          ) : (
            <input
              id="raid-poll-channel-id"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              inputMode="numeric"
              pattern="\d{16,25}"
              placeholder="ID текстового каналу Discord"
              required
              disabled={pending || disabled}
            />
          )}
          <small>{channelOptions.length ? `Поточний вибір: ${channelLabel}. Список каналів підтягнуто з Discord так само, як у рейдах та embed-редакторі.` : "Список каналів не прочитався автоматично. Встав ID каналу вручну або перевір DISCORD_GUILD_CHANNELS_ENDPOINT."}</small>
        </label>

        <fieldset className="raid-poll-field raid-poll-field--wide raid-poll-days-field">
          <legend>Дні рейд-тижня</legend>
          <div className="raid-poll-day-toggle-grid">
            {RAID_POLL_DAYS.map((day) => (
              <button
                key={day.value}
                className={`raid-poll-day-toggle ${selectedDays.includes(day.value) ? "is-selected" : ""}`}
                type="button"
                onClick={() => toggleDay(day.value)}
                disabled={pending || disabled}
                aria-pressed={selectedDays.includes(day.value)}
              >
                <strong>{day.label}</strong>
                <span>{day.fullLabel}</span>
              </button>
            ))}
          </div>
          <small>У Discord для кожного вибраного дня дозволено тільки один варіант: найраніший зручний час або «Не можу».</small>
        </fieldset>

        {roles.length ? (
          <fieldset className="raid-poll-field raid-poll-field--wide raid-poll-roles-field">
            <legend>Тег ролей у Discord</legend>
            <RolePicker
              roles={roles}
              selectedRoleIds={mentionRoleIds}
              onChange={setMentionRoleIds}
              fieldName="mentionRoleIds"
              ariaLabel="Ролі, які будуть згадані у рейд-пулі"
              emptyLabel="Ролі ще не вибрані"
              helperText="Вибрані ролі будуть тегнуті над Discord embed рейд-пулу так само, як у рейдах та звичайних embed."
            />
          </fieldset>
        ) : (
          <div className="raid-poll-field raid-poll-field--wide raid-poll-muted-box">
            <strong>Тег ролей у Discord</strong>
            <small>Список ролей не завантажився. Пул можна створити без тегів або перевірити Discord API / worker relay.</small>
          </div>
        )}

        <fieldset className="raid-poll-field raid-poll-field--wide raid-poll-repeat-card">
          <legend>Автоповтор голосування</legend>
          <label className="raid-checkbox-line raid-poll-repeat-toggle">
            <input
              type="checkbox"
              checked={autoRepeatWeekly}
              onChange={(event) => setAutoRepeatWeekly(event.target.checked)}
              disabled={pending || disabled}
            />
            <span>Щотижня створювати новий ідентичний пул, а попередній Discord-пул автоматично прибирати.</span>
          </label>
          <div className="raid-poll-repeat-grid" aria-disabled={!autoRepeatWeekly}>
            <label className="raid-poll-field" htmlFor="raid-poll-repeat-day">
              <span>День повтору</span>
              <select
                id="raid-poll-repeat-day"
                value={repeatWeeklyDay}
                onChange={(event) => setRepeatWeeklyDay(event.target.value as RaidPollDay)}
                disabled={pending || disabled || !autoRepeatWeekly}
              >
                {RAID_POLL_DAYS.map((day) => <option key={day.value} value={day.value}>{day.fullLabel}</option>)}
              </select>
            </label>
            <label className="raid-poll-field" htmlFor="raid-poll-repeat-time">
              <span>Час повтору</span>
              <select
                id="raid-poll-repeat-time"
                value={repeatWeeklyTime}
                onChange={(event) => setRepeatWeeklyTime(event.target.value as RaidPollRepeatTime)}
                disabled={pending || disabled || !autoRepeatWeekly}
              >
                {RAID_POLL_REPEAT_TIMES.map((time) => <option key={time} value={time}>{time}</option>)}
              </select>
            </label>
          </div>
          <small>Час рахується у часовій зоні рейдів: Europe/Kyiv. Для старих пулів лишається fallback: понеділок 12:00.</small>
        </fieldset>

        <label className="raid-poll-field raid-poll-field--wide" htmlFor="raid-poll-description">
          <span>Опис у Discord</span>
          <textarea
            id="raid-poll-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={900}
            required
            disabled={pending || disabled}
          />
          <small>{description.trim().length}/900 символів. Текст буде в embed-повідомленні.</small>
        </label>
      </div>

      <div className="raid-poll-create-preview" aria-label="Налаштування голосування">
        <div>
          <strong>Дні голосування</strong>
          <span>{selectedDayLabel}</span>
        </div>
        <div>
          <strong>Час рейду</strong>
          <span>Один вибір на день: з 19:00 / з 19:30 / з 20:00 / з 20:30 / з 21:00 / Не можу</span>
        </div>
        <div>
          <strong>Теги ролей</strong>
          <span>{mentionRoleIds.length ? `${mentionRoleIds.length} рол.` : "Без тегів"}</span>
        </div>
        <div>
          <strong>Автоповтор</strong>
          <span>{autoRepeatWeekly ? `${RAID_POLL_DAYS.find((day) => day.value === repeatWeeklyDay)?.fullLabel || "Понеділок"} о ${repeatWeeklyTime}` : "Вимкнено"}</span>
        </div>
        <div>
          <strong>Закриття</strong>
          <span>{closeLabel}</span>
        </div>
      </div>

      <div className="raid-form-actions raid-poll-create-actions">
        <a className="btn subtle" href={isEdit && poll?.id ? `/polls/${encodeURIComponent(poll.id)}` : "/polls"}>{isEdit ? "Скасувати" : "До списку"}</a>
        <button className="btn primary" type="submit" disabled={pending || disabled} aria-busy={pending ? "true" : "false"}>
          {pending ? (isEdit ? "Оновлюємо..." : "Створюємо...") : (isEdit ? "Зберегти й оновити Discord" : "Створити й опублікувати")}
        </button>
      </div>
    </form>
  );
}
