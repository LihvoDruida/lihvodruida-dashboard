export type RaidPollStatus = "scheduled" | "open" | "paused" | "closed";
export type RaidPollPublishMode = "now" | "scheduled";
export type RaidPollDifficulty = "normal" | "heroic" | "mythic";
export type RaidPollDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * Час старту рейду. Раніші за 20:00 слоти прибрані: гільдія фізично не
 * починає рейд до 20:00, а зайві опції лише роздували Discord-меню.
 * Легасі-голоси з 19:00/19:30 нормалізуються у 20:00 (див. RAID_POLL_LEGACY_TIMES).
 */
export type RaidPollTime = "20:00" | "20:30" | "21:00";

export const RAID_POLL_REPEAT_TIMES = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"] as const;
export type RaidPollRepeatTime = typeof RAID_POLL_REPEAT_TIMES[number];
export type RaidPollAvailability = RaidPollTime | "absent";
export type RaidPollScheduleValue = RaidPollAvailability | RaidPollTime[];
export type RaidPollSchedule = Partial<Record<RaidPollDay, RaidPollScheduleValue>>;
export type RaidPollRole = "tank" | "healer" | "dps";

/**
 * Голос у рейд-пулі.
 *
 * Свідомо БЕЗ персонажа Battle.net. Пул відповідає на питання «коли зручно
 * і в якій ролі», а не «яким чаром». Ідентичність — гільдійний нік Discord
 * (interaction.member.nick), рівно як у записах на рейд. Це прибирає
 * залежність від Battle.net-привʼязки, guild roster і Raider.IO:
 * проголосувати може будь-хто, хто бачить повідомлення в Discord гільдії.
 */
export type RaidPollVote = {
  discordId: string;
  /** Гільдійний нік на сервері (member.nick), а не глобальне імʼя Discord. */
  discordName: string;
  guildId: string;
  guildName: string;
  /** Роль у рейді, вибрана вручну: танк / хіл / дд. */
  role: RaidPollRole | null;
  /** Legacy-поля для старих документів і повідомлень Discord. */
  selectedDays: RaidPollDay[];
  selectedTime: RaidPollTime | null;
  /** Один найраніший доступний час на день або явна відсутність. */
  schedule: RaidPollSchedule;
  createdAt: string;
  updatedAt: string;
};

export type RaidPollItem = {
  id: string;
  title: string;
  difficulty: RaidPollDifficulty;
  description: string;
  status: RaidPollStatus;
  /** Початкова публікація може бути відкладена до заданого дня/часу. */
  scheduledPublishAt?: string | null;
  scheduledPublishAtMs?: number | null;
  /** Фактичний момент першої успішної публікації у Discord. */
  publishedAt?: string | null;
  /** Остання помилка автоматичної публікації; зберігається для діагностики і повторної спроби. */
  scheduledPublishLastError?: string | null;
  scheduledPublishLastErrorAt?: string | null;
  closeAfterMinutes: number;
  closesAt: string;
  closesAtMs: number;
  closedAt?: string | null;
  closedReason?: "manual" | "auto" | null;
  /** Пауза заморожує дедлайн: closesAtMs не тікає, поки пул призупинено. */
  pausedAt?: string | null;
  pausedByName?: string | null;
  pausedNote?: string | null;
  /** Скільки мілісекунд лишалося до закриття на момент паузи. */
  pausedRemainingMs?: number | null;
  resumedAt?: string | null;
  createdByDiscordId: string;
  createdByName: string;
  channelId?: string | null;
  messageId?: string | null;
  messageUrl?: string | null;
  mentionRoleIds: string[];
  /** Якщо увімкнено, cron у вибраний день і час створює новий ідентичний пул і прибирає попередній. */
  autoRepeatWeekly: boolean;
  repeatWeeklyDay?: RaidPollDay | null;
  repeatWeeklyTime?: RaidPollRepeatTime | null;
  repeatNextAt?: string | null;
  repeatNextAtMs?: number | null;
  repeatSeriesId?: string | null;
  repeatedFromPollId?: string | null;
  days: RaidPollDay[];
  votes: RaidPollVote[];
  createdAt: string;
  updatedAt: string;
};

export type RaidPollVoteResult = {
  ok: boolean;
  content: string;
  poll?: RaidPollItem;
  closed?: boolean;
  components?: unknown[];
};

export type RaidPollCreateInput = {
  title?: unknown;
  difficulty?: unknown;
  description?: unknown;
  channelId?: unknown;
  closeAfterMinutes?: unknown;
  days?: unknown;
  mentionRoleIds?: unknown;
  /** Публікувати одразу або зберегти як запланований пул. */
  publishMode?: unknown;
  autoRepeatWeekly?: unknown;
  repeatWeeklyDay?: unknown;
  repeatWeeklyTime?: unknown;
};

export type RaidPollUpdateInput = RaidPollCreateInput;

export const RAID_POLL_DESCRIPTION = "Оберіть роль у рейді та для кожного дня — найраніший час, з якого ви готові бути в рейді, або позначте «Не можу». Якщо вказано 20:00, система рахує вас доступним/доступною і на всі пізніші слоти цього дня. Персонаж не потрібен: у списку буде ваш нік із сервера.";

export const RAID_POLL_DAYS: Array<{ value: RaidPollDay; label: string; fullLabel: string; emoji: string }> = [
  { value: "mon", label: "Пн", fullLabel: "Понеділок", emoji: "1️⃣" },
  { value: "tue", label: "Вт", fullLabel: "Вівторок", emoji: "2️⃣" },
  { value: "wed", label: "Ср", fullLabel: "Середа", emoji: "3️⃣" },
  { value: "thu", label: "Чт", fullLabel: "Четвер", emoji: "4️⃣" },
  { value: "fri", label: "Пт", fullLabel: "Пʼятниця", emoji: "5️⃣" },
  { value: "sat", label: "Сб", fullLabel: "Субота", emoji: "6️⃣" },
  { value: "sun", label: "Нд", fullLabel: "Неділя", emoji: "7️⃣" },
];

export const RAID_POLL_TIMES: RaidPollTime[] = ["20:00", "20:30", "21:00"];

/**
 * Старі слоти, які більше не пропонуються, але зустрічаються в уже
 * збережених голосах. Мапимо на найраніший актуальний час, бо «готовий з
 * 19:00» логічно включає «готовий з 20:00» — сенс голосу не втрачається.
 */
export const RAID_POLL_LEGACY_TIMES: Record<string, RaidPollTime> = {
  "18:00": "20:00",
  "18:30": "20:00",
  "19:00": "20:00",
  "19:30": "20:00",
  "21:30": "21:00",
  "22:00": "21:00",
};

export const RAID_POLL_AVAILABILITY_OPTIONS: RaidPollAvailability[] = [...RAID_POLL_TIMES, "absent"];

export const RAID_POLL_ROLE_OPTIONS: Array<{ value: RaidPollRole; label: string; description: string; emoji: string }> = [
  { value: "tank", label: "Танк", description: "Йду як танк", emoji: "🛡️" },
  { value: "healer", label: "Хіл", description: "Йду як цілитель", emoji: "💚" },
  { value: "dps", label: "ДД", description: "Йду як боєць шкоди", emoji: "⚔️" },
];

export const RAID_POLL_CLOSE_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 120, label: "2 години" },
  { minutes: 720, label: "12 годин" },
  { minutes: 1440, label: "24 години" },
  { minutes: 2880, label: "48 годин" },
];

/**
 * Швидкий вибір: одна дія замість семи. Заповнює весь тиждень пулу одним
 * значенням, далі людина за потреби править окремі дні.
 */
export const RAID_POLL_QUICK_FILL_OPTIONS: Array<{ value: RaidPollAvailability; label: string; description: string; emoji: string }> = [
  { value: "20:00", label: "Усі дні — з 20:00", description: "Можу щодня від 20:00 і пізніше", emoji: "🟢" },
  { value: "20:30", label: "Усі дні — з 20:30", description: "Можу щодня від 20:30 і пізніше", emoji: "🟡" },
  { value: "21:00", label: "Усі дні — з 21:00", description: "Можу щодня тільки з 21:00", emoji: "🟠" },
  { value: "absent", label: "Не можу цього тижня", description: "Позначити всі дні як «Не можу»", emoji: "⛔" },
];

export function raidPollDescription() {
  return RAID_POLL_DESCRIPTION;
}

export type RaidPollStateLike = Pick<RaidPollItem, "status" | "closesAtMs" | "scheduledPublishAtMs">;

/** Запланований пул уже збережений, але ще не опублікований у Discord. */
export function raidPollIsScheduled(poll: Pick<RaidPollItem, "status">) {
  return poll.status === "scheduled";
}

/** Пул на паузі: голоси не приймаються, але дедлайн заморожений і пул не архівується. */
export function raidPollIsPaused(poll: Pick<RaidPollItem, "status">) {
  return poll.status === "paused";
}

export function raidPollIsClosed(poll: RaidPollStateLike) {
  return poll.status === "closed" || (poll.status === "open" && poll.closesAtMs <= Date.now());
}

/** Єдина точка правди: чи приймає пул нові голоси прямо зараз. */
export function raidPollAcceptsVotes(poll: RaidPollStateLike) {
  return poll.status === "open" && poll.closesAtMs > Date.now();
}

/** Чи треба вимикати Discord-кнопки. Пауза теж вимикає, але з іншим підписом. */
export function raidPollVotingLocked(poll: RaidPollStateLike) {
  return !raidPollAcceptsVotes(poll);
}

export function raidPollStateKey(poll: RaidPollStateLike): "scheduled" | "open" | "paused" | "closed" {
  if (poll.status === "scheduled") return "scheduled";
  if (poll.status === "paused") return "paused";
  return raidPollIsClosed(poll) ? "closed" : "open";
}

export function raidPollStateTone(poll: RaidPollStateLike): "success" | "warning" | "muted" {
  const key = raidPollStateKey(poll);
  if (key === "open") return "success";
  if (key === "scheduled" || key === "paused") return "warning";
  return "muted";
}

export function raidPollAvailabilityLabel(value: RaidPollScheduleValue | null | undefined) {
  if (!value) return "—";
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return "—";
  return first === "absent" ? "Не можу" : `з ${first}`;
}

export function raidPollRoleLabel(role: RaidPollRole | null | undefined) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Цілитель";
  if (role === "dps") return "ДД";
  return "Роль не вибрана";
}

/** Компактний підпис для чипів і Discord-рядків. */
export function raidPollRoleShortLabel(role: RaidPollRole | null | undefined) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  if (role === "dps") return "ДД";
  return "—";
}

export function raidPollRoleEmoji(role: RaidPollRole | null | undefined) {
  return RAID_POLL_ROLE_OPTIONS.find((option) => option.value === role)?.emoji || "❔";
}
