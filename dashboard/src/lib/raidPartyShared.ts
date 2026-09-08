import {
  RAID_ALGORITHM_MAX_RAID_PLAYERS,
  RAID_ALGORITHM_PARTY_SIZE,
  raidAlgorithmAutoCompositionForSize,
  raidAlgorithmClassToken,
  raidAlgorithmDpsRangeType,
  raidAlgorithmDpsSecondaryScore,
  raidAlgorithmUtilityChecklist,
} from "@/lib/raidCompositionAlgorithm";
import type { RaidComposition, RaidCharacterRole, RaidDifficulty, RaidItem, RaidParty, RaidSignup } from "@/lib/raids";

/**
 * Чисті помічники для роботи зі складом рейду.
 *
 * `raids.ts` імпортує `firebase-admin/firestore`, тому клієнтські компоненти
 * не можуть його імпортувати — і `RaidEditorLivePreview` тримав власні копії
 * тринадцяти функцій. Копії вже почали розходитись, а це логіка, від якої
 * залежить, що людина бачить у прев'ю проти того, що потім піде в Discord.
 *
 * Модуль навмисно без побічних ефектів і без серверних імпортів: типи з
 * `@/lib/raids` беруться як `import type`, тож у бандл нічого не тягне.
 */

export const RAID_PARTY_SIZE = RAID_ALGORITHM_PARTY_SIZE;
export const MAX_RAID_PLAYERS = RAID_ALGORITHM_MAX_RAID_PLAYERS;

/** Порядок ролей у списках: танк → хіл → ДД. */
export function roleSortWeight(item: RaidSignup) {
  if (item.role === "tank") return 0;
  if (item.role === "healer") return 1;
  return 2;
}

export function signupClassKey(item?: RaidSignup | null) {
  return raidAlgorithmClassToken(item);
}

export type DpsRangeType = "melee" | "ranged";

export function dpsRangeType(item: RaidSignup): DpsRangeType {
  return raidAlgorithmDpsRangeType(item);
}

export function dpsTierTwoScore(item: RaidSignup) {
  return raidAlgorithmDpsSecondaryScore(item);
}

export function missingCriticalBuffs(members: RaidSignup[]) {
  return raidAlgorithmUtilityChecklist(members).missingRequired;
}

export function partyMembersCount(party: RaidParty) {
  return (party.tank ? 1 : 0) + (party.healer ? 1 : 0) + party.dps.length;
}

export function partyCapacity(party: RaidParty) {
  return RAID_PARTY_SIZE - partyMembersCount(party);
}

export function partyFlexRoleCount(party: RaidParty, role: RaidCharacterRole) {
  return party.dps.filter((item) => item.role === role).length;
}

/** Найменш заповнена група серед тих, що підходять під умову. */
export function pickParty(parties: RaidParty[], predicate: (party: RaidParty) => boolean) {
  const candidates = parties.filter((party) => partyCapacity(party) > 0 && predicate(party));
  return (
    candidates.sort(
      (a, b) => partyMembersCount(a) - partyMembersCount(b) || a.index - b.index,
    )[0] || null
  );
}

export function raidRegistrationLimit(raid: Pick<RaidItem, "maxPlayers">) {
  const limit = Number(raid.maxPlayers || 0);
  return Number.isFinite(limit) && limit > 0
    ? Math.max(1, Math.min(MAX_RAID_PLAYERS, Math.floor(limit)))
    : null;
}

export function raidMinimumItemLevel(raid: Pick<RaidItem, "minItemLevel">) {
  const minimum = Number(raid.minItemLevel || 0);
  return Number.isFinite(minimum) && minimum > 0 ? Math.floor(minimum) : 0;
}

/** Чи рахується підпис у складі: «йду», «запізнююсь», «можливо». */
export function isActiveSignupStatus(status?: string | null) {
  return status === "going" || status === "late" || status === "tentative";
}

export function raidActiveRosterSize(raid: Pick<RaidItem, "signups">) {
  let size = 0;
  for (const item of raid.signups) {
    if (isActiveSignupStatus(item.status)) size += 1;
  }
  return size;
}

/** Скільки ролей уже заявлено серед активних підписів. */
export function activeRoleDemand(signups: RaidSignup[]): RaidComposition {
  const demand: RaidComposition = { tanks: 0, healers: 0, dps: 0 };
  for (const item of signups) {
    if (!isActiveSignupStatus(item.status)) continue;
    if (item.role === "tank") demand.tanks += 1;
    else if (item.role === "healer") demand.healers += 1;
    else if (item.role === "dps") demand.dps += 1;
  }
  return demand;
}

export function autoRaidCompositionForSize(
  size: number,
  difficulty: RaidDifficulty,
  roleDemand?: Partial<RaidComposition> | null,
): RaidComposition {
  return raidAlgorithmAutoCompositionForSize(size, difficulty, roleDemand);
}

export function raidAutoComposition(
  raid: Pick<RaidItem, "maxPlayers" | "signups" | "difficulty">,
): RaidComposition {
  const limit = raidRegistrationLimit(raid);
  const targetSize = limit ?? raidActiveRosterSize(raid);
  return autoRaidCompositionForSize(targetSize, raid.difficulty, activeRoleDemand(raid.signups));
}

export function raidAutoCompositionLabel(
  raid: Pick<RaidItem, "maxPlayers" | "signups" | "difficulty">,
) {
  const composition = raidAutoComposition(raid);
  return `${composition.tanks} / ${composition.healers} / ${composition.dps}`;
}
