export type RaidPollStatus = "open" | "closed";
export type RaidPollDifficulty = "normal" | "heroic" | "mythic";
export type RaidPollDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type RaidPollTime = "19:00" | "19:30" | "20:00" | "20:30" | "21:00";
export const RAID_POLL_REPEAT_TIMES = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"] as const;
export type RaidPollRepeatTime = typeof RAID_POLL_REPEAT_TIMES[number];
export type RaidPollAvailability = RaidPollTime | "absent";
export type RaidPollScheduleValue = RaidPollAvailability | RaidPollTime[];
export type RaidPollSchedule = Partial<Record<RaidPollDay, RaidPollScheduleValue>>;
export type RaidPollRole = "tank" | "healer" | "dps";

export type RaidPollVote = {
  discordId: string;
  discordName: string;
  guildId: string;
  guildName: string;
  /** Legacy fields kept for old Discord messages and already-saved documents. */
  selectedDays: RaidPollDay[];
  selectedTime: RaidPollTime | null;
  /** Smart per-day schedule. Each day stores one earliest available time or explicit absence. Arrays are accepted only as legacy data and normalized. */
  schedule: RaidPollSchedule;
  characterKey?: string | null;
  characterName?: string | null;
  characterClass?: string | null;
  characterSpecName?: string | null;
  characterSpecId?: number | null;
  characterRole?: RaidPollRole | null;
  characterRealm?: string | null;
  characterRegion?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RaidPollItem = {
  id: string;
  title: string;
  difficulty: RaidPollDifficulty;
  description: string;
  status: RaidPollStatus;
  closeAfterMinutes: number;
  closesAt: string;
  closesAtMs: number;
  closedAt?: string | null;
  closedReason?: "manual" | "auto" | null;
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
  autoRepeatWeekly?: unknown;
  repeatWeeklyDay?: unknown;
  repeatWeeklyTime?: unknown;
};

export type RaidPollUpdateInput = RaidPollCreateInput;

export const RAID_POLL_DESCRIPTION = "Будь ласка, оберіть для кожного дня найраніший час, з якого ви готові бути в рейді, або позначте «Не можу». Якщо вказано 19:00, система рахує вас доступним/доступною і на всі пізніші слоти цього дня.";

export const RAID_POLL_DAYS: Array<{ value: RaidPollDay; label: string; fullLabel: string; emoji: string }> = [
  { value: "mon", label: "Пн", fullLabel: "Понеділок", emoji: "1️⃣" },
  { value: "tue", label: "Вт", fullLabel: "Вівторок", emoji: "2️⃣" },
  { value: "wed", label: "Ср", fullLabel: "Середа", emoji: "3️⃣" },
  { value: "thu", label: "Чт", fullLabel: "Четвер", emoji: "4️⃣" },
  { value: "fri", label: "Пт", fullLabel: "Пʼятниця", emoji: "5️⃣" },
  { value: "sat", label: "Сб", fullLabel: "Субота", emoji: "6️⃣" },
  { value: "sun", label: "Нд", fullLabel: "Неділя", emoji: "7️⃣" },
];

export const RAID_POLL_TIMES: RaidPollTime[] = ["19:00", "19:30", "20:00", "20:30", "21:00"];

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

export const RAID_POLL_SCHEDULE_GROUPS: Array<{ key: "a" | "b" | "c"; label: string; days: RaidPollDay[] }> = [
  { key: "a", label: "Пн-Ср", days: ["mon", "tue", "wed"] },
  { key: "b", label: "Чт-Пт", days: ["thu", "fri"] },
  { key: "c", label: "Сб-Нд", days: ["sat", "sun"] },
];

export const RAID_POLL_CHARACTER_SELECTOR_OPTIONS = [
  { value: "main", label: "Основний персонаж профілю", description: "Бере головного персонажа з dashboard-профілю" },
  { value: "alt_1", label: "Альт #1 з профілю", description: "Перший персонаж після основного" },
  { value: "alt_2", label: "Альт #2 з профілю", description: "Другий персонаж після основного" },
  { value: "alt_3", label: "Альт #3 з профілю", description: "Третій персонаж після основного" },
  { value: "alt_4", label: "Альт #4 з профілю", description: "Четвертий персонаж після основного" },
];

export const RAID_POLL_CLASS_COLORS: Record<string, string> = {
  deathknight: "#C41E3A",
  demonhunter: "#A330C9",
  druid: "#FF7C0A",
  evoker: "#33937F",
  hunter: "#AAD372",
  mage: "#3FC7EB",
  monk: "#00FF98",
  paladin: "#F48CBA",
  priest: "#FFFFFF",
  rogue: "#FFF468",
  shaman: "#0070DE",
  warlock: "#8788EE",
  warrior: "#C69B6D",
};

export function raidPollDescription() {
  return RAID_POLL_DESCRIPTION;
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
  return "Роль не визначена";
}

export function raidPollClassColor(className: string | null | undefined) {
  const key = String(className || "").toLowerCase().replace(/[^a-z]/g, "");
  return RAID_POLL_CLASS_COLORS[key] || "#94a3b8";
}
