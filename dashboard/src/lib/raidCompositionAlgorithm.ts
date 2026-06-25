export type RaidAlgorithmRole = "tank" | "healer" | "dps";
export type RaidAlgorithmDifficulty = "normal" | "heroic" | "mythic";
export type RaidAlgorithmDpsRange = "melee" | "ranged";

export type RaidAlgorithmComposition = {
  tanks: number;
  healers: number;
  dps: number;
};

export type RaidAlgorithmMember = {
  role?: RaidAlgorithmRole | null;
  characterRole?: RaidAlgorithmRole | null;
  className?: string | null;
  characterClass?: string | null;
  activeSpecName?: string | null;
  characterSpecName?: string | null;
  activeSpecId?: number | string | null;
  characterSpecId?: number | string | null;
  status?: string | null;
};

export type RaidUtilityCategory =
  | "raid-buff"
  | "bloodlust"
  | "battle-res"
  | "defensive"
  | "dispels"
  | "immunity"
  | "mobility"
  | "support";

export type RaidUtilityRule = {
  key: string;
  label: string;
  category: RaidUtilityCategory;
  required: boolean;
  weight: number;
  selectionPriority: number;
  match: (member: RaidAlgorithmMember) => boolean;
};

export type RaidUtilityChecklist = {
  present: string[];
  missingRequired: string[];
  missingPreferred: string[];
  score: number;
  requiredScore: number;
  preferredScore: number;
  categories: Partial<Record<RaidUtilityCategory, { present: string[]; missing: string[] }>>;
};

export type RaidAlgorithmPollSlotAnalysis = {
  parties: number;
  desiredTanks: number;
  requiredTanks: number;
  desiredHealers: number;
  requiredHealers: number;
  minimumDps: number;
  effectiveDps: number;
  effectiveRaidSize: number;
  coreReady: boolean;
  melee: number;
  ranged: number;
  rangeBalanceScore: number;
  utilityScore: number;
  missingUtility: string[];
  score: number;
};

export type RaidAlgorithmPollSlotInput<T extends RaidAlgorithmMember = RaidAlgorithmMember> = {
  total: number;
  tanks: number;
  healers: number;
  dps: number;
  unknown?: number;
  difficulty?: RaidAlgorithmDifficulty | null;
  members?: T[];
};

export const RAID_ALGORITHM_PARTY_SIZE = 5;
export const RAID_ALGORITHM_MAX_RAID_PLAYERS = 80;
export const RAID_ALGORITHM_MAX_RAID_PARTIES = 40;
export const RAID_ALGORITHM_MAX_HEALERS = 6;

const CLASS_TOKEN_BY_SPEC_ID: Record<number, string> = {
  62: "mage",
  63: "mage",
  64: "mage",
  65: "paladin",
  66: "paladin",
  70: "paladin",
  71: "warrior",
  72: "warrior",
  73: "warrior",
  102: "druid",
  103: "druid",
  104: "druid",
  105: "druid",
  250: "deathknight",
  251: "deathknight",
  252: "deathknight",
  253: "hunter",
  254: "hunter",
  255: "hunter",
  256: "priest",
  257: "priest",
  258: "priest",
  259: "rogue",
  260: "rogue",
  261: "rogue",
  262: "shaman",
  263: "shaman",
  264: "shaman",
  265: "warlock",
  266: "warlock",
  267: "warlock",
  268: "monk",
  269: "monk",
  270: "monk",
  577: "demonhunter",
  581: "demonhunter",
  1467: "evoker",
  1468: "evoker",
  1473: "evoker",
};

const SPEC_TOKEN_BY_SPEC_ID: Record<number, string> = {
  62: "arcane",
  63: "fire",
  64: "frost",
  65: "holy",
  66: "protection",
  70: "retribution",
  71: "arms",
  72: "fury",
  73: "protection",
  102: "balance",
  103: "feral",
  104: "guardian",
  105: "restoration",
  250: "blood",
  251: "frost",
  252: "unholy",
  253: "beastmastery",
  254: "marksmanship",
  255: "survival",
  256: "discipline",
  257: "holy",
  258: "shadow",
  259: "assassination",
  260: "outlaw",
  261: "subtlety",
  262: "elemental",
  263: "enhancement",
  264: "restoration",
  265: "affliction",
  266: "demonology",
  267: "destruction",
  268: "brewmaster",
  269: "windwalker",
  270: "mistweaver",
  577: "havoc",
  581: "vengeance",
  1467: "devastation",
  1468: "preservation",
  1473: "augmentation",
};

const CLASS_ALIASES: Record<string, string> = {
  dk: "deathknight",
  deathknight: "deathknight",
  demonhunter: "demonhunter",
  dh: "demonhunter",
  druid: "druid",
  evoker: "evoker",
  hunter: "hunter",
  mage: "mage",
  monk: "monk",
  paladin: "paladin",
  priest: "priest",
  rogue: "rogue",
  shaman: "shaman",
  warlock: "warlock",
  warrior: "warrior",
};

const SPEC_ALIASES: Record<string, string> = {
  beastmastery: "beastmastery",
  bm: "beastmastery",
  disc: "discipline",
  discipline: "discipline",
  resto: "restoration",
  restoration: "restoration",
  aug: "augmentation",
  augmentation: "augmentation",
  prot: "protection",
  protection: "protection",
  mw: "mistweaver",
  mistweaver: "mistweaver",
  ww: "windwalker",
  windwalker: "windwalker",
};

export function raidAlgorithmNormalizeWowKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function readSpecId(member?: RaidAlgorithmMember | null) {
  const raw = member?.activeSpecId ?? member?.characterSpecId ?? 0;
  const specId = Number(raw || 0);
  return Number.isFinite(specId) && specId > 0 ? Math.floor(specId) : null;
}

export function raidAlgorithmClassToken(member?: RaidAlgorithmMember | null) {
  const specId = readSpecId(member);
  if (specId && CLASS_TOKEN_BY_SPEC_ID[specId]) return CLASS_TOKEN_BY_SPEC_ID[specId];
  const raw = raidAlgorithmNormalizeWowKey(member?.className || member?.characterClass);
  return CLASS_ALIASES[raw] || raw || "unknown";
}

export function raidAlgorithmSpecToken(member?: RaidAlgorithmMember | null) {
  const specId = readSpecId(member);
  if (specId && SPEC_TOKEN_BY_SPEC_ID[specId]) return SPEC_TOKEN_BY_SPEC_ID[specId];
  const raw = raidAlgorithmNormalizeWowKey(member?.activeSpecName || member?.characterSpecName);
  return SPEC_ALIASES[raw] || raw || "unknown";
}

export function raidAlgorithmRole(member?: RaidAlgorithmMember | null): RaidAlgorithmRole | null {
  const role = member?.role || member?.characterRole;
  return role === "tank" || role === "healer" || role === "dps" ? role : null;
}

export function raidAlgorithmMatches(member: RaidAlgorithmMember, classToken: string, specs?: string[]) {
  if (raidAlgorithmClassToken(member) !== classToken) return false;
  if (!specs?.length) return true;
  const spec = raidAlgorithmSpecToken(member);
  return specs.some((value) => raidAlgorithmNormalizeWowKey(value) === spec);
}

export function raidAlgorithmDpsRangeType(member: RaidAlgorithmMember): RaidAlgorithmDpsRange {
  const classToken = raidAlgorithmClassToken(member);
  const specToken = raidAlgorithmSpecToken(member);

  if (classToken === "hunter") return specToken === "survival" ? "melee" : "ranged";
  if (classToken === "druid") return specToken === "feral" ? "melee" : "ranged";
  if (classToken === "shaman") return specToken === "enhancement" ? "melee" : "ranged";
  if (classToken === "priest") return "ranged";
  if (["mage", "warlock", "evoker"].includes(classToken)) return "ranged";
  if (["warrior", "rogue", "deathknight", "demonhunter", "monk", "paladin"].includes(classToken)) return "melee";
  return "ranged";
}

export function raidAlgorithmDpsSecondaryScore(member: RaidAlgorithmMember) {
  const classToken = raidAlgorithmClassToken(member);
  const specToken = raidAlgorithmSpecToken(member);
  if (classToken === "evoker" && specToken === "augmentation") return -2;
  if (["mage", "warlock", "hunter", "priest"].includes(classToken)) return 0;
  if ((classToken === "druid" && specToken === "balance") || (classToken === "shaman" && specToken === "elemental")) return 0;
  if (["rogue", "deathknight", "demonhunter", "warrior"].includes(classToken)) return 1;
  if ((classToken === "paladin" && specToken === "retribution") || (classToken === "monk" && specToken === "windwalker")) return 1;
  return 2;
}

function classIs(...tokens: string[]) {
  return (member: RaidAlgorithmMember) => tokens.includes(raidAlgorithmClassToken(member));
}

function specIs(classToken: string, ...specs: string[]) {
  return (member: RaidAlgorithmMember) => raidAlgorithmMatches(member, classToken, specs);
}

export const RAID_ALGORITHM_UTILITY_RULES: RaidUtilityRule[] = [
  { key: "bloodlust", label: "Bloodlust/Heroism", category: "bloodlust", required: true, weight: 16, selectionPriority: 10, match: classIs("shaman", "mage", "hunter", "evoker") },
  { key: "battle-res", label: "Battle Res", category: "battle-res", required: true, weight: 16, selectionPriority: 20, match: classIs("druid", "deathknight", "warlock", "paladin") },
  { key: "fortitude", label: "Power Word: Fortitude", category: "raid-buff", required: true, weight: 12, selectionPriority: 30, match: classIs("priest") },
  { key: "arcane-intellect", label: "Arcane Intellect", category: "raid-buff", required: true, weight: 10, selectionPriority: 40, match: classIs("mage") },
  { key: "battle-shout", label: "Battle Shout", category: "raid-buff", required: true, weight: 10, selectionPriority: 50, match: classIs("warrior") },
  { key: "mark-of-the-wild", label: "Mark of the Wild", category: "raid-buff", required: true, weight: 12, selectionPriority: 60, match: classIs("druid") },
  { key: "chaos-brand", label: "Chaos Brand", category: "raid-buff", required: true, weight: 10, selectionPriority: 70, match: classIs("demonhunter") },
  { key: "mystic-touch", label: "Mystic Touch", category: "raid-buff", required: true, weight: 10, selectionPriority: 80, match: classIs("monk") },
  { key: "warlock-core", label: "Warlock utility", category: "support", required: true, weight: 10, selectionPriority: 90, match: classIs("warlock") },
  { key: "augmentation", label: "Augmentation Evoker", category: "support", required: false, weight: 9, selectionPriority: 100, match: specIs("evoker", "augmentation") },
  { key: "skyfury", label: "Skyfury / Shaman raid value", category: "raid-buff", required: false, weight: 8, selectionPriority: 110, match: classIs("shaman") },
  { key: "raid-defensives", label: "Raid defensives", category: "defensive", required: false, weight: 8, selectionPriority: 120, match: classIs("warrior", "deathknight", "priest", "shaman", "paladin", "monk") },
  { key: "dispels", label: "Dispel coverage", category: "dispels", required: false, weight: 7, selectionPriority: 130, match: classIs("priest", "shaman", "mage", "druid", "paladin", "monk", "evoker") },
  { key: "immunities", label: "Immunities", category: "immunity", required: false, weight: 7, selectionPriority: 140, match: classIs("rogue", "mage", "paladin", "hunter", "demonhunter") },
  { key: "mobility-soak", label: "Mobility/soak", category: "mobility", required: false, weight: 6, selectionPriority: 150, match: classIs("hunter", "druid", "demonhunter", "rogue", "mage", "evoker") },
];

export function raidAlgorithmRuleMatches(rule: RaidUtilityRule, member: RaidAlgorithmMember) {
  return rule.match(member);
}

export function raidAlgorithmUtilityChecklist(members: RaidAlgorithmMember[]): RaidUtilityChecklist {
  const present: string[] = [];
  const missingRequired: string[] = [];
  const missingPreferred: string[] = [];
  const categories: RaidUtilityChecklist["categories"] = {};
  let requiredScore = 0;
  let preferredScore = 0;

  for (const rule of RAID_ALGORITHM_UTILITY_RULES) {
    const matched = members.some((member) => rule.match(member));
    const bucket = categories[rule.category] || { present: [], missing: [] };
    if (matched) {
      present.push(rule.label);
      bucket.present.push(rule.label);
      if (rule.required) requiredScore += rule.weight;
      else preferredScore += rule.weight;
    } else {
      bucket.missing.push(rule.label);
      if (rule.required) missingRequired.push(rule.label);
      else missingPreferred.push(rule.label);
    }
    categories[rule.category] = bucket;
  }

  return {
    present,
    missingRequired,
    missingPreferred,
    score: requiredScore + preferredScore,
    requiredScore,
    preferredScore,
    categories,
  };
}

export function raidAlgorithmMemberUtilityWeight(member: RaidAlgorithmMember, selected: RaidAlgorithmMember[] = []) {
  let score = 0;
  for (const rule of RAID_ALGORITHM_UTILITY_RULES) {
    if (!rule.match(member)) continue;
    if (selected.some((item) => rule.match(item))) continue;
    score += rule.weight * 100 + Math.max(0, 200 - rule.selectionPriority);
  }
  return score;
}

export function clampRaidAlgorithmTargetSize(size: number) {
  const targetSize = Math.floor(Number.isFinite(size) ? size : 0);
  return Math.max(0, Math.min(RAID_ALGORITHM_MAX_RAID_PLAYERS, targetSize));
}

export function raidAlgorithmTankSlotsForSize(size: number, allowThirdTank = false) {
  const targetSize = clampRaidAlgorithmTargetSize(size);
  if (targetSize <= 0) return 0;
  if (targetSize < 10) return 1;
  if (allowThirdTank && targetSize >= 25) return 3;
  return 2;
}

export function raidAlgorithmHealerSlotsForSize(targetSizeInput: number, tanksInput: number, damageProfile: "normal" | "high" | "low" = "normal") {
  const targetSize = clampRaidAlgorithmTargetSize(targetSizeInput);
  const tanks = Math.max(0, Math.floor(tanksInput || 0));
  if (targetSize <= tanks) return 0;
  if (targetSize < RAID_ALGORITHM_PARTY_SIZE) return targetSize - tanks >= 2 ? 1 : 0;

  const dpsLikeSlots = Math.max(0, targetSize - tanks);
  const base = Math.ceil(dpsLikeSlots / (damageProfile === "high" ? 4 : 5));
  const adjusted = damageProfile === "low" ? Math.max(1, base - 1) : base;
  const minimum = targetSize >= 10 ? 2 : 1;
  return Math.max(0, Math.min(targetSize - tanks, RAID_ALGORITHM_MAX_HEALERS, Math.max(minimum, adjusted)));
}

export function raidAlgorithmAutoCompositionForSize(
  size: number,
  difficulty: RaidAlgorithmDifficulty,
  roleDemand?: Partial<RaidAlgorithmComposition> | null,
): RaidAlgorithmComposition {
  const targetSize = clampRaidAlgorithmTargetSize(size);
  if (targetSize <= 0) return { tanks: 0, healers: 0, dps: 0 };

  const demandTanks = Math.max(0, Math.floor(Number(roleDemand?.tanks || 0)));
  const allowThirdTank = difficulty === "mythic" && demandTanks >= 3;
  const tanks = Math.min(targetSize, raidAlgorithmTankSlotsForSize(targetSize, allowThirdTank));
  const healers = raidAlgorithmHealerSlotsForSize(targetSize, tanks, "normal");
  return { tanks, healers, dps: Math.max(0, targetSize - tanks - healers) };
}

function majorityRequired(value: number) {
  const target = Math.max(0, Math.floor(value));
  if (target <= 1) return target;
  return Math.floor(target / 2) + 1;
}

function rangeBalanceScore(members: RaidAlgorithmMember[]) {
  const dpsMembers = members.filter((member) => raidAlgorithmRole(member) === "dps");
  const melee = dpsMembers.filter((member) => raidAlgorithmDpsRangeType(member) === "melee").length;
  const ranged = dpsMembers.filter((member) => raidAlgorithmDpsRangeType(member) === "ranged").length;
  const total = melee + ranged;
  if (!total) return { melee, ranged, score: 0 };
  const targetMelee = Math.round(total * 0.4);
  const diff = Math.abs(melee - targetMelee);
  return { melee, ranged, score: Math.max(0, 100 - diff * 20) };
}

export function raidAlgorithmAnalyzePollSlot<T extends RaidAlgorithmMember>(input: RaidAlgorithmPollSlotInput<T>): RaidAlgorithmPollSlotAnalysis {
  const tanks = Math.max(0, Math.floor(input.tanks || 0));
  const healers = Math.max(0, Math.floor(input.healers || 0));
  const dps = Math.max(0, Math.floor(input.dps || 0));
  const unknown = Math.max(0, Math.floor(input.unknown || 0));
  const total = Math.max(0, Math.floor(input.total || 0));
  const members = input.members || [];
  const knownTotal = Math.max(0, tanks + healers + dps);
  const slotSize = Math.max(knownTotal, total);
  const parties = Math.max(1, Math.ceil(Math.max(1, slotSize) / RAID_ALGORITHM_PARTY_SIZE));
  const desiredTanks = slotSize >= 10 ? 2 : 1;
  const requiredTanks = 1;
  const desiredHealers = Math.max(1, Math.min(RAID_ALGORITHM_MAX_HEALERS, Math.ceil(Math.max(1, slotSize - desiredTanks) / 5)));
  const requiredHealers = majorityRequired(desiredHealers);
  const minimumDps = slotSize >= RAID_ALGORITHM_PARTY_SIZE ? 3 : 1;
  const utility = raidAlgorithmUtilityChecklist(members);
  const range = rangeBalanceScore(members);
  const effectiveDps = dps;
  const effectiveRaidSize = Math.min(tanks, desiredTanks) + Math.min(healers, desiredHealers) + effectiveDps;
  const coreReady = tanks >= requiredTanks && healers >= requiredHealers && dps >= minimumDps;
  const utilityScore = utility.score;
  const rangeScore = range.score;

  const score = (coreReady ? 100_000_000 : 0)
    + Math.min(tanks, requiredTanks) * 20_000_000
    + Math.min(healers, requiredHealers) * 5_000_000
    + Math.min(tanks, desiredTanks) * 800_000
    + Math.min(healers, desiredHealers) * 500_000
    + Math.min(utilityScore, 120) * 20_000
    + rangeScore * 2_000
    + effectiveDps * 12_000
    + effectiveRaidSize * 1_000
    + total * 10
    - unknown * 500;

  return {
    parties,
    desiredTanks,
    requiredTanks,
    desiredHealers,
    requiredHealers,
    minimumDps,
    effectiveDps,
    effectiveRaidSize,
    coreReady,
    melee: range.melee,
    ranged: range.ranged,
    rangeBalanceScore: rangeScore,
    utilityScore,
    missingUtility: utility.missingRequired,
    score,
  };
}
