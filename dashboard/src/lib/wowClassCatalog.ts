import type { WowCharacterRole } from "@/lib/wowRoles";

/**
 * Єдине джерело правди по класах і спеціалізаціях World of Warcraft для
 * системи «Формування складу». І Discord-меню вибору, і таблиця вільних
 * ролей на сайті беруть дані звідси, тож вони не можуть розійтися.
 *
 * Роль зберігається на рівні спеки явно, а не через спільний ключ: frost —
 * це dps і в мага, і в DK; protection — це tank і в паладина, і у воїна.
 * Плаский ключ→роль (як у wowRoles.ts) такі випадки не розрізняє, тому тут
 * роль зашита в кожен запис спеки окремо.
 *
 * Кольори класів узгоджені з RAID_POLL_CLASS_COLORS, щоб embed складу
 * виглядав так само, як рейдові повідомлення.
 */

export type WowSpecDefinition = {
  /** Стабільний ключ для custom_id Discord-інтеракції (лише [a-z0-9_]). */
  key: string;
  /** Назва спеки українською для меню й ембеду. */
  label: string;
  role: WowCharacterRole;
};

export type WowClassDefinition = {
  /** Стабільний ключ для custom_id (лише [a-z0-9_]). */
  key: string;
  /** Назва класу українською. */
  label: string;
  /** Колір класу (#RRGGBB) — узгоджений з рейдовими ембедами. */
  color: string;
  emoji: string;
  specs: WowSpecDefinition[];
};

export const WOW_CLASS_CATALOG: WowClassDefinition[] = [
  {
    key: "deathknight",
    label: "Лицар смерті",
    color: "#C41E3A",
    emoji: "🩸",
    specs: [
      { key: "blood", label: "Кров", role: "tank" },
      { key: "frost", label: "Лід", role: "dps" },
      { key: "unholy", label: "Нечестивість", role: "dps" },
    ],
  },
  {
    key: "demonhunter",
    label: "Мисливець на демонів",
    color: "#A330C9",
    emoji: "😈",
    specs: [
      { key: "havoc", label: "Хаос", role: "dps" },
      { key: "vengeance", label: "Помста", role: "tank" },
    ],
  },
  {
    key: "druid",
    label: "Друїд",
    color: "#FF7C0A",
    emoji: "🐻",
    specs: [
      { key: "balance", label: "Баланс", role: "dps" },
      { key: "feral", label: "Хижак", role: "dps" },
      { key: "guardian", label: "Страж", role: "tank" },
      { key: "restoration", label: "Відновлення", role: "healer" },
    ],
  },
  {
    key: "evoker",
    label: "Викликач",
    color: "#33937F",
    emoji: "🐲",
    specs: [
      { key: "devastation", label: "Спустошення", role: "dps" },
      { key: "preservation", label: "Збереження", role: "healer" },
      { key: "augmentation", label: "Підсилення", role: "dps" },
    ],
  },
  {
    key: "hunter",
    label: "Мисливець",
    color: "#AAD372",
    emoji: "🏹",
    specs: [
      { key: "beastmastery", label: "Повелитель звірів", role: "dps" },
      { key: "marksmanship", label: "Влучність", role: "dps" },
      { key: "survival", label: "Виживання", role: "dps" },
    ],
  },
  {
    key: "mage",
    label: "Маг",
    color: "#3FC7EB",
    emoji: "🔮",
    specs: [
      { key: "arcane", label: "Тайна магія", role: "dps" },
      { key: "fire", label: "Вогонь", role: "dps" },
      { key: "frost", label: "Лід", role: "dps" },
    ],
  },
  {
    key: "monk",
    label: "Монах",
    color: "#00FF98",
    emoji: "🐉",
    specs: [
      { key: "brewmaster", label: "Пивовар", role: "tank" },
      { key: "mistweaver", label: "Ткач туманів", role: "healer" },
      { key: "windwalker", label: "Мандрівник вітрів", role: "dps" },
    ],
  },
  {
    key: "paladin",
    label: "Паладин",
    color: "#F48CBA",
    emoji: "🔨",
    specs: [
      { key: "holy", label: "Світло", role: "healer" },
      { key: "protection", label: "Захист", role: "tank" },
      { key: "retribution", label: "Відплата", role: "dps" },
    ],
  },
  {
    key: "priest",
    label: "Жрець",
    color: "#FFFFFF",
    emoji: "✨",
    specs: [
      { key: "discipline", label: "Послух", role: "healer" },
      { key: "holy", label: "Святість", role: "healer" },
      { key: "shadow", label: "Тінь", role: "dps" },
    ],
  },
  {
    key: "rogue",
    label: "Розбійник",
    color: "#FFF468",
    emoji: "🗡️",
    specs: [
      { key: "assassination", label: "Вбивство", role: "dps" },
      { key: "outlaw", label: "Головоріз", role: "dps" },
      { key: "subtlety", label: "Підступність", role: "dps" },
    ],
  },
  {
    key: "shaman",
    label: "Шаман",
    color: "#0070DE",
    emoji: "⚡",
    specs: [
      { key: "elemental", label: "Стихія", role: "dps" },
      { key: "enhancement", label: "Підсилення", role: "dps" },
      { key: "restoration", label: "Відновлення", role: "healer" },
    ],
  },
  {
    key: "warlock",
    label: "Чорнокнижник",
    color: "#8788EE",
    emoji: "💜",
    specs: [
      { key: "affliction", label: "Страждання", role: "dps" },
      { key: "demonology", label: "Демонологія", role: "dps" },
      { key: "destruction", label: "Руйнування", role: "dps" },
    ],
  },
  {
    key: "warrior",
    label: "Воїн",
    color: "#C69B6D",
    emoji: "⚔️",
    specs: [
      { key: "arms", label: "Зброя", role: "dps" },
      { key: "fury", label: "Лють", role: "dps" },
      { key: "protection", label: "Захист", role: "tank" },
    ],
  },
];

const CLASS_BY_KEY = new Map(WOW_CLASS_CATALOG.map((cls) => [cls.key, cls]));

export function wowClassCount() {
  return WOW_CLASS_CATALOG.length;
}

export function findWowClass(classKey: unknown): WowClassDefinition | null {
  return CLASS_BY_KEY.get(String(classKey || "").trim().toLowerCase()) || null;
}

export function findWowSpec(
  classKey: unknown,
  specKey: unknown,
): { cls: WowClassDefinition; spec: WowSpecDefinition } | null {
  const cls = findWowClass(classKey);
  if (!cls) return null;
  const key = String(specKey || "").trim().toLowerCase();
  const spec = cls.specs.find((item) => item.key === key);
  return spec ? { cls, spec } : null;
}

export function wowClassColorInt(classKey: unknown): number {
  const cls = findWowClass(classKey);
  const hex = (cls?.color || "#94a3b8").replace("#", "");
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : 0x94a3b8;
}

export function roleLabelShort(role: WowCharacterRole): string {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  return "ДД";
}

export function roleEmoji(role: WowCharacterRole): string {
  if (role === "tank") return "🛡️";
  if (role === "healer") return "💚";
  return "⚔️";
}
