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
  /** Назва спеки англійською (як у грі), напр. "Restoration". */
  label: string;
  role: WowCharacterRole;
};

export type WowClassDefinition = {
  /** Стабільний ключ для custom_id (лише [a-z0-9_]). */
  key: string;
  /** Назва класу англійською (як у грі), напр. "Druid". */
  label: string;
  /** Колір класу (#RRGGBB) — узгоджений з рейдовими ембедами. */
  color: string;
  emoji: string;
  specs: WowSpecDefinition[];
};

export const WOW_CLASS_CATALOG: WowClassDefinition[] = [
  {
    key: "deathknight",
    label: "Death Knight",
    color: "#C41E3A",
    emoji: "🩸",
    specs: [
      { key: "blood", label: "Blood", role: "tank" },
      { key: "frost", label: "Frost", role: "dps" },
      { key: "unholy", label: "Unholy", role: "dps" },
    ],
  },
  {
    key: "demonhunter",
    label: "Demon Hunter",
    color: "#A330C9",
    emoji: "😈",
    specs: [
      { key: "havoc", label: "Havoc", role: "dps" },
      { key: "vengeance", label: "Vengeance", role: "tank" },
      // Третій спек ДХ із Midnight: далекобійний ДД на Інтелекті.
      { key: "devourer", label: "Devourer", role: "dps" },
    ],
  },
  {
    key: "druid",
    label: "Druid",
    color: "#FF7C0A",
    emoji: "🐻",
    specs: [
      { key: "balance", label: "Balance", role: "dps" },
      { key: "feral", label: "Feral", role: "dps" },
      { key: "guardian", label: "Guardian", role: "tank" },
      { key: "restoration", label: "Restoration", role: "healer" },
    ],
  },
  {
    key: "evoker",
    label: "Evoker",
    color: "#33937F",
    emoji: "🐲",
    specs: [
      { key: "devastation", label: "Devastation", role: "dps" },
      { key: "preservation", label: "Preservation", role: "healer" },
      { key: "augmentation", label: "Augmentation", role: "dps" },
    ],
  },
  {
    key: "hunter",
    label: "Hunter",
    color: "#AAD372",
    emoji: "🏹",
    specs: [
      { key: "beastmastery", label: "Beast Mastery", role: "dps" },
      { key: "marksmanship", label: "Marksmanship", role: "dps" },
      { key: "survival", label: "Survival", role: "dps" },
    ],
  },
  {
    key: "mage",
    label: "Mage",
    color: "#3FC7EB",
    emoji: "🔮",
    specs: [
      { key: "arcane", label: "Arcane", role: "dps" },
      { key: "fire", label: "Fire", role: "dps" },
      { key: "frost", label: "Frost", role: "dps" },
    ],
  },
  {
    key: "monk",
    label: "Monk",
    color: "#00FF98",
    emoji: "🐉",
    specs: [
      { key: "brewmaster", label: "Brewmaster", role: "tank" },
      { key: "mistweaver", label: "Mistweaver", role: "healer" },
      { key: "windwalker", label: "Windwalker", role: "dps" },
    ],
  },
  {
    key: "paladin",
    label: "Paladin",
    color: "#F48CBA",
    emoji: "🔨",
    specs: [
      { key: "holy", label: "Holy", role: "healer" },
      { key: "protection", label: "Protection", role: "tank" },
      { key: "retribution", label: "Retribution", role: "dps" },
    ],
  },
  {
    key: "priest",
    label: "Priest",
    color: "#FFFFFF",
    emoji: "✨",
    specs: [
      { key: "discipline", label: "Discipline", role: "healer" },
      { key: "holy", label: "Holy", role: "healer" },
      { key: "shadow", label: "Shadow", role: "dps" },
    ],
  },
  {
    key: "rogue",
    label: "Rogue",
    color: "#FFF468",
    emoji: "🗡️",
    specs: [
      { key: "assassination", label: "Assassination", role: "dps" },
      { key: "outlaw", label: "Outlaw", role: "dps" },
      { key: "subtlety", label: "Subtlety", role: "dps" },
    ],
  },
  {
    key: "shaman",
    label: "Shaman",
    color: "#0070DE",
    emoji: "⚡",
    specs: [
      { key: "elemental", label: "Elemental", role: "dps" },
      { key: "enhancement", label: "Enhancement", role: "dps" },
      { key: "restoration", label: "Restoration", role: "healer" },
    ],
  },
  {
    key: "warlock",
    label: "Warlock",
    color: "#8788EE",
    emoji: "💜",
    specs: [
      { key: "affliction", label: "Affliction", role: "dps" },
      { key: "demonology", label: "Demonology", role: "dps" },
      { key: "destruction", label: "Destruction", role: "dps" },
    ],
  },
  {
    key: "warrior",
    label: "Warrior",
    color: "#C69B6D",
    emoji: "⚔️",
    specs: [
      { key: "arms", label: "Arms", role: "dps" },
      { key: "fury", label: "Fury", role: "dps" },
      { key: "protection", label: "Protection", role: "tank" },
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

/**
 * Повна назва спеки у форматі «спека + клас», як прийнято в англомовному
 * ком'юніті WoW: "Restoration Druid", "Frost Death Knight", "Beast Mastery Hunter".
 * Приймає або обидва обʼєкти, або пару ключів.
 */
export function wowSpecFullName(
  cls: WowClassDefinition | string | null | undefined,
  spec: WowSpecDefinition | string | null | undefined,
): string {
  const resolvedCls = typeof cls === "string" || cls == null ? findWowClass(cls) : cls;
  if (!resolvedCls) return "";
  const resolvedSpec =
    typeof spec === "string" || spec == null
      ? resolvedCls.specs.find((item) => item.key === String(spec || "").trim().toLowerCase()) || null
      : spec;
  return resolvedSpec ? `${resolvedSpec.label} ${resolvedCls.label}` : resolvedCls.label;
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
