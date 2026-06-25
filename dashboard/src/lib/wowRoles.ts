export type WowCharacterRole = "tank" | "healer" | "dps";

const ROLE_BY_SPEC_ID: Record<number, WowCharacterRole> = {
  62: "dps", // Mage — Arcane
  63: "dps", // Mage — Fire
  64: "dps", // Mage — Frost
  65: "healer", // Paladin — Holy
  66: "tank", // Paladin — Protection
  70: "dps", // Paladin — Retribution
  71: "dps", // Warrior — Arms
  72: "dps", // Warrior — Fury
  73: "tank", // Warrior — Protection
  102: "dps", // Druid — Balance
  103: "dps", // Druid — Feral
  104: "tank", // Druid — Guardian
  105: "healer", // Druid — Restoration
  250: "tank", // Death Knight — Blood
  251: "dps", // Death Knight — Frost
  252: "dps", // Death Knight — Unholy
  253: "dps", // Hunter — Beast Mastery
  254: "dps", // Hunter — Marksmanship
  255: "dps", // Hunter — Survival
  256: "healer", // Priest — Discipline
  257: "healer", // Priest — Holy
  258: "dps", // Priest — Shadow
  259: "dps", // Rogue — Assassination
  260: "dps", // Rogue — Outlaw
  261: "dps", // Rogue — Subtlety
  262: "dps", // Shaman — Elemental
  263: "dps", // Shaman — Enhancement
  264: "healer", // Shaman — Restoration
  265: "dps", // Warlock — Affliction
  266: "dps", // Warlock — Demonology
  267: "dps", // Warlock — Destruction
  268: "tank", // Monk — Brewmaster
  269: "dps", // Monk — Windwalker
  270: "healer", // Monk — Mistweaver
  577: "dps", // Demon Hunter — Havoc
  581: "tank", // Demon Hunter — Vengeance
  1467: "dps", // Evoker — Devastation
  1468: "healer", // Evoker — Preservation
  1473: "dps", // Evoker — Augmentation
};

const ROLE_BY_SPEC_KEY: Record<string, WowCharacterRole> = {
  blood: "tank",
  protection: "tank",
  guardian: "tank",
  brewmaster: "tank",
  vengeance: "tank",

  restoration: "healer",
  holy: "healer",
  discipline: "healer",
  світло: "healer",
  свет: "healer",
  святость: "healer",
  послушание: "healer",
  відновлення: "healer",
  восстановление: "healer",
  restorationdruid: "healer",
  restorationshaman: "healer",
  mistweaver: "healer",
  preservation: "healer",

  balance: "dps",
  feral: "dps",
  frost: "dps",
  unholy: "dps",
  beastmastery: "dps",
  marksmanship: "dps",
  survival: "dps",
  arcane: "dps",
  fire: "dps",
  frostmage: "dps",
  shadow: "dps",
  assassination: "dps",
  outlaw: "dps",
  subtlety: "dps",
  elemental: "dps",
  enhancement: "dps",
  affliction: "dps",
  demonology: "dps",
  destruction: "dps",
  windwalker: "dps",
  havoc: "dps",
  arms: "dps",
  fury: "dps",
  retribution: "dps",
  devastation: "dps",
  augmentation: "dps",
};

function normalizeKey(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9]+/gi, "")
    .trim();
}

export function normalizeWowRole(value: unknown): WowCharacterRole | null {
  const key = normalizeKey(value);
  if (!key) return null;
  if (["tank", "tanks", "танк", "танки"].includes(key)) return "tank";
  if (["healer", "healers", "healing", "heal", "хіл", "хили", "хілер", "лікар"].includes(key)) return "healer";
  if (["dps", "dd", "damage", "damagedealer", "дд"].includes(key)) return "dps";
  return null;
}

export function wowSpecRoleById(value: unknown): WowCharacterRole | null {
  const id = Number(value);
  return Number.isFinite(id) ? ROLE_BY_SPEC_ID[Math.floor(id)] || null : null;
}

export function wowSpecRoleByName(value: unknown): WowCharacterRole | null {
  const key = normalizeKey(value);
  if (!key) return null;
  return ROLE_BY_SPEC_KEY[key] || null;
}

export function resolveWowSpecRole(input: {
  activeSpecId?: unknown;
  activeSpecName?: unknown;
  className?: unknown;
}): WowCharacterRole | null {
  const roleById = wowSpecRoleById(input.activeSpecId);
  if (roleById) return roleById;

  const specKey = normalizeKey(input.activeSpecName);
  const classKey = normalizeKey(input.className);
  if (!specKey) return null;

  // Blizzard can return localized names. Keep a defensive keyword pass for
  // Ukrainian/Russian clients and for names that arrive with class suffixes.
  if (["blood", "кров", "кровь", "guardian", "страж", "brewmaster", "хмелевар", "vengeance", "месть"].some((key) => specKey.includes(key))) {
    return "tank";
  }
  if (specKey.includes("protection") || specKey.includes("защита") || specKey.includes("захист")) {
    return "tank";
  }
  if (["restoration", "відновлення", "восстановление", "holy", "світло", "свет", "discipline", "послушание", "mistweaver", "ткачтуманов", "preservation", "сохранение"].some((key) => specKey.includes(key))) {
    return "healer";
  }

  const roleByName = wowSpecRoleByName(input.activeSpecName);
  if (roleByName) return roleByName;

  if ((classKey.includes("paladin") || classKey.includes("warrior") || classKey.includes("палад") || classKey.includes("воин") || classKey.includes("воїн"))
    && (specKey.includes("protection") || specKey.includes("защита") || specKey.includes("захист"))) {
    return "tank";
  }

  return null;
}

export function resolveWowCharacterRole(input: {
  activeSpecRole?: unknown;
  activeSpecId?: unknown;
  activeSpecName?: unknown;
  className?: unknown;
}): WowCharacterRole {
  const roleBySpec = resolveWowSpecRole(input);
  if (roleBySpec) return roleBySpec;

  const explicitRole = normalizeWowRole(input.activeSpecRole);
  if (explicitRole) return explicitRole;

  return "dps";
}

export function wowRoleLabel(role: WowCharacterRole | null | undefined) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  return "ДД";
}

export function wowSpecRoleLabel(input: {
  activeSpecRole?: unknown;
  activeSpecId?: unknown;
  activeSpecName?: unknown;
  className?: unknown;
}) {
  return wowRoleLabel(resolveWowCharacterRole(input));
}
