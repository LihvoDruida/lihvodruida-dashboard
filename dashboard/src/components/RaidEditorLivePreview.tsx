"use client";

import { useEffect, useMemo, useState } from "react";
import { DiscordMarkdown } from "@/components/DiscordMarkdown";
import type {
  RaidCharacterRole,
  RaidComposition,
  RaidConsumables,
  RaidDifficulty,
  RaidItem,
  RaidLootMode,
  RaidParty,
  RaidSignup,
} from "@/lib/raids";
import {
  RAID_ALGORITHM_MAX_RAID_PARTIES,
  RAID_ALGORITHM_PARTY_SIZE,
  RAID_ALGORITHM_UTILITY_RULES,
  raidAlgorithmAutoCompositionForSize,
  raidAlgorithmClassToken,
  raidAlgorithmDpsRangeType,
  raidAlgorithmDpsSecondaryScore,
  raidAlgorithmMemberUtilityWeight,
  raidAlgorithmRuleMatches,
  raidAlgorithmUtilityChecklist,
} from "@/lib/raidCompositionAlgorithm";

const DEFAULT_RAID_TITLE = "Войдспайр";
const DEFAULT_RAID_TIME = "20:00";
const DEFAULT_RAID_DESCRIPTION =
  "Глибоко в серці темної цитаделі нас чекають давні таємниці та смертельні вороги.\n\nБудьте готові до суворого випробування!";
const RAID_PARTY_SIZE = RAID_ALGORITHM_PARTY_SIZE;
const MAX_RAID_PLAYERS = 80;
const MAX_RAID_PARTIES = RAID_ALGORITHM_MAX_RAID_PARTIES;

const DIFFICULTY_LABELS: Record<RaidDifficulty, string> = {
  normal: "Нормал",
  heroic: "Героїк",
  mythic: "Міфік",
};

const CONSUMABLE_LABELS: Record<RaidConsumables, string> = {
  own: "Власні",
  guild: "Гільдійні",
};

const LOOT_LABELS: Record<RaidLootMode, string> = {
  "ms-os": "MS > OS",
  "free-roll": "Вільний рол",
  "soft-reserve": "Soft Reserve",
  "loot-council": "Loot Council",
};


type RaidEditorLivePreviewProps = {
  initialRaid: RaidItem;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(
  value: FormDataEntryValue | null | undefined,
  fallback = "",
) {
  return String(value || "").trim() || fallback;
}

function cleanDifficulty(
  value: FormDataEntryValue | null | undefined,
): RaidDifficulty {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (key === "normal" || key === "нормал") return "normal";
  if (key === "mythic" || key === "міфік") return "mythic";
  return "heroic";
}

function cleanConsumables(
  value: FormDataEntryValue | null | undefined,
): RaidConsumables {
  return String(value || "")
    .trim()
    .toLowerCase() === "guild"
    ? "guild"
    : "own";
}

function cleanLootMode(
  value: FormDataEntryValue | null | undefined,
): RaidLootMode {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (key === "free-roll" || key === "soft-reserve" || key === "loot-council")
    return key;
  return "ms-os";
}

function cleanPositiveNumber(
  value: FormDataEntryValue | null | undefined,
  max = 9999,
) {
  const numberValue = Number(String(value || "").trim());
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.min(max, Math.floor(numberValue));
}

function cleanUrl(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.startsWith("/")) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function defaultRaidThumbnailPath(difficulty: RaidDifficulty) {
  return `/assets/raid-thumbnails/${difficulty}.png`;
}

function resolvePreviewThumbnailUrl(
  raid: Pick<RaidItem, "difficulty" | "thumbnailUrl" | "imageUrl">,
) {
  return (
    cleanUrl(raid.thumbnailUrl) ||
    cleanUrl(raid.imageUrl) ||
    defaultRaidThumbnailPath(raid.difficulty)
  );
}

function raidTitle(raid: Pick<RaidItem, "title" | "difficulty">) {
  return `${raid.title || DEFAULT_RAID_TITLE} — ${DIFFICULTY_LABELS[raid.difficulty]}`;
}

function formatRaidDateTime(date?: string | null, time?: string | null) {
  if (!date && !time) return "Дата уточнюється";
  return [date || "Дата уточнюється", time || ""].filter(Boolean).join(", ");
}

function raidStatusLabel(raid: Pick<RaidItem, "status">) {
  if (raid.status === "closed") return "Закрито";
  return raid.status === "published" ? "Опубліковано" : "Чернетка";
}

function activeSignups(raid: Pick<RaidItem, "signups">) {
  return raid.signups.filter(
    (item) => item.status === "going" || item.status === "late" || item.status === "tentative",
  );
}

function activeRoleDemand(signups: RaidSignup[]): RaidComposition {
  const active = signups.filter(
    (item) => item.status === "going" || item.status === "late" || item.status === "tentative",
  );
  return {
    tanks: active.filter((item) => item.role === "tank").length,
    healers: active.filter((item) => item.role === "healer").length,
    dps: active.filter((item) => item.role === "dps").length,
  };
}

function compositionCapacity(composition: RaidComposition) {
  return composition.tanks + composition.healers + composition.dps;
}

function autoRaidCompositionForSize(
  size: number,
  difficulty: RaidDifficulty,
  roleDemand?: RaidComposition | null,
): RaidComposition {
  return raidAlgorithmAutoCompositionForSize(size, difficulty, roleDemand);
}

function raidRegistrationLimit(raid: Pick<RaidItem, "maxPlayers">) {
  const limit = Number(raid.maxPlayers || 0);
  return Number.isFinite(limit) && limit > 0
    ? Math.max(1, Math.min(MAX_RAID_PLAYERS, Math.floor(limit)))
    : null;
}

function raidCompositionTargetSize(
  raid: Pick<RaidItem, "maxPlayers" | "signups">,
) {
  return raidRegistrationLimit(raid) ?? activeSignups(raid).length;
}

function raidAutoComposition(
  raid: Pick<RaidItem, "difficulty" | "maxPlayers" | "signups">,
) {
  return autoRaidCompositionForSize(
    raidCompositionTargetSize(raid),
    raid.difficulty,
    activeRoleDemand(raid.signups),
  );
}

function raidAutoCompositionLabel(
  raid: Pick<RaidItem, "difficulty" | "maxPlayers" | "signups">,
) {
  const composition = raidAutoComposition(raid);
  return `${composition.tanks} / ${composition.healers} / ${composition.dps}`;
}

function raidDisplayCapacity(
  raid: Pick<RaidItem, "difficulty" | "maxPlayers" | "signups">,
) {
  const limit = raidRegistrationLimit(raid);
  if (limit !== null) return limit;
  return compositionCapacity(raidAutoComposition(raid));
}

function isRaidRegistrationFull(
  raid: Pick<RaidItem, "maxPlayers" | "signups">,
) {
  const limit = raidRegistrationLimit(raid);
  return limit !== null && activeSignups(raid).length >= limit;
}

function cleanRegistrationLockMinutes(
  value: FormDataEntryValue | number | null | undefined,
) {
  const parsed = Number(
    String(value || "60")
      .replace(",", ".")
      .trim(),
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  return Math.max(1, Math.min(7 * 24 * 60, Math.floor(parsed)));
}

function raidRegistrationLockDurationLabel(minutes: number | null | undefined) {
  const safeMinutes = cleanRegistrationLockMinutes(minutes);
  if (safeMinutes % (24 * 60) === 0) {
    const days = safeMinutes / (24 * 60);
    return `${days} ${days === 1 ? "день" : days >= 2 && days <= 4 ? "дні" : "днів"}`;
  }
  if (safeMinutes % 60 === 0) {
    const hours = safeMinutes / 60;
    return `${hours} ${hours === 1 ? "годину" : hours >= 2 && hours <= 4 ? "години" : "годин"}`;
  }
  return `${safeMinutes} хв`;
}

function previewRegistrationLockSummary(
  raid: Pick<
    RaidItem,
    | "date"
    | "time"
    | "registrationLockEnabled"
    | "registrationLockMinutesBefore"
  >,
) {
  if (!raid.registrationLockEnabled)
    return { enabled: false, locked: false, label: "Вимкнено", detail: "" };
  const minutesBefore = cleanRegistrationLockMinutes(
    raid.registrationLockMinutesBefore,
  );
  const duration = raidRegistrationLockDurationLabel(minutesBefore);
  const startsAt = new Date(
    `${raid.date || todayIso()}T${raid.time || DEFAULT_RAID_TIME}:00`,
  ).getTime();
  if (!Number.isFinite(startsAt))
    return {
      enabled: true,
      locked: false,
      label: `За ${duration} до старту`,
      detail: "Дедлайн буде розраховано після коректної дати та часу.",
    };
  const deadlineMs = startsAt - minutesBefore * 60 * 1000;
  const locked = Date.now() >= deadlineMs;
  const deadlineLabel = new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(deadlineMs));
  return {
    enabled: true,
    locked,
    label: locked
      ? `Закрито з ${deadlineLabel}`
      : `Закриється ${deadlineLabel}`,
    detail: `Автоблокування за ${duration} до старту рейду.`,
  };
}

function raidRosterCounts(raid: Pick<RaidItem, "signups">) {
  const going = raid.signups.filter((item) => item.status === "going");
  const tentative = raid.signups.filter((item) => item.status === "tentative");
  const late = raid.signups.filter((item) => item.status === "late");
  const active = [...going, ...tentative, ...late];
  return {
    going: going.length,
    tentative: tentative.length,
    late: late.length,
    skipped: raid.signups.filter((item) => item.status === "skipped").length,
    roster: active.length,
    tanks: active.filter((item) => item.role === "tank").length,
    healers: active.filter((item) => item.role === "healer").length,
    dps: active.filter((item) => item.role === "dps").length,
  };
}

function raidAverageItemLevel(raid: Pick<RaidItem, "signups">) {
  const values = activeSignups(raid)
    .map((item) => Number(item.itemLevel || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) return null;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function raidConsumablesLabel(value: RaidConsumables) {
  return CONSUMABLE_LABELS[value] || CONSUMABLE_LABELS.own;
}

function raidLootLabel(value: RaidLootMode) {
  return LOOT_LABELS[value] || LOOT_LABELS["ms-os"];
}

function signupMarkers(item?: RaidSignup | null, hasItemLevelIssue = false) {
  if (!item) return "";
  return [
    hasItemLevelIssue ? "⚠️" : null,
    item.status === "tentative" ? "❓" : null,
    item.status === "late" ? "🕒" : null,
    item.verifiedGuild === false ? "🤝" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function signupDisplayName(
  item?: RaidSignup | null,
  options?: { showItemLevel?: boolean; hasItemLevelIssue?: boolean },
) {
  if (!item) return "—";
  const name = item.characterName || item.discordName || "Гравець";
  const showItemLevel = options?.showItemLevel !== false;
  const markers = signupMarkers(item, Boolean(options?.hasItemLevelIssue));
  const value =
    showItemLevel && item.itemLevel ? `${name} • ${item.itemLevel}` : name;
  return markers ? `${markers} ${value}` : value;
}

function signupSpecLabel(item?: RaidSignup | null) {
  if (!item) return "";
  const spec = item.activeSpecName
    ? `${item.activeSpecName}${item.className ? ` • ${item.className}` : ""}`
    : item.className || "";
  const guildLabel = item.verifiedGuild === false ? "Інший персонаж" : "";
  return [spec, guildLabel].filter(Boolean).join(" • ");
}

function signupExtraLabel(item?: RaidSignup | null) {
  if (!item) return "";
  return [
    typeof item.level === "number" ? `Lvl ${item.level}` : null,
    item.raceName || null,
    item.faction || null,
    item.guildName || null,
  ]
    .filter(Boolean)
    .join(" • ");
}

function signupAvatarUrl(item?: RaidSignup | null) {
  return item?.avatarUrl || item?.renderUrl || item?.mediaUrl || null;
}

function SignupAvatar({ item }: { item?: RaidSignup | null }) {
  if (!item)
    return (
      <span
        className="raid-signup-avatar raid-signup-avatar--empty"
        aria-hidden="true"
      >
        —
      </span>
    );
  const image = signupAvatarUrl(item);
  if (image)
    return (
      <img
        className="raid-signup-avatar"
        src={image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  return (
    <span
      className="raid-signup-avatar raid-signup-avatar--empty"
      aria-hidden="true"
    >
      {(item.characterName || item.discordName || "A").charAt(0)}
    </span>
  );
}

function SignupNumberBadge({
  item,
}: {
  item?: Pick<RaidSignup, "signupNumber"> | null;
}) {
  const number = Number(item?.signupNumber || 0);
  const hasNumber = Number.isFinite(number) && number > 0;
  const label = hasNumber ? `${Math.floor(number)}` : "";
  const title = hasNumber
    ? `Порядковий номер запису: ${Math.floor(number)}`
    : "Місце ще не зайняте";
  return (
    <span
      className={`raid-signup-order${label ? "" : " raid-signup-order--empty"}`}
      title={title}
    >
      {label}
    </span>
  );
}

function RoleMarkerStack({
  item,
  role,
  iconClassName = "raid-role-icon",
}: {
  item?: Pick<RaidSignup, "signupNumber"> | null;
  role: RaidCharacterRole;
  iconClassName?: string;
}) {
  return (
    <span className="raid-signup-side" aria-hidden="true">
      <SignupNumberBadge item={item} />
      <span className={iconClassName}>
        {role === "tank" ? "🛡" : role === "healer" ? "✚" : "⚔"}
      </span>
    </span>
  );
}

function raidPartyRoleLabel(role: RaidCharacterRole) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  return "ДД";
}

function raidMinimumItemLevel(raid: Pick<RaidItem, "minItemLevel">) {
  const minimum = Number(raid.minItemLevel || 0);
  return Number.isFinite(minimum) && minimum > 0 ? Math.floor(minimum) : 0;
}

function signupItemLevelIssue(
  raid: Pick<RaidItem, "minItemLevel" | "minItemLevelRequired">,
  item?: RaidSignup | null,
) {
  if (!item || item.status === "skipped") return null;
  const minimum = raidMinimumItemLevel(raid);
  if (!minimum) return null;
  const current = Number(item.itemLevel || 0);
  if (!Number.isFinite(current) || current <= 0) {
    return raid.minItemLevelRequired
      ? `⛔ ilvl не визначено, мінімум ${minimum}`
      : null;
  }
  if (current >= minimum) return null;
  return raid.minItemLevelRequired
    ? `⛔ ${Math.floor(current)} ilvl нижче мінімуму ${minimum}`
    : `⚠️ ${Math.floor(current)} ilvl нижче мінімуму ${minimum}`;
}

function roleSortWeight(item: RaidSignup) {
  if (item.role === "tank") return 0;
  if (item.role === "healer") return 1;
  return 2;
}

function cleanSignupNumber(value?: number | null) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function signupSort(a: RaidSignup, b: RaidSignup) {
  const aNumber = cleanSignupNumber(a.signupNumber) || Number.MAX_SAFE_INTEGER;
  const bNumber = cleanSignupNumber(b.signupNumber) || Number.MAX_SAFE_INTEGER;
  return (
    roleSortWeight(a) - roleSortWeight(b) ||
    aNumber - bNumber ||
    String(a.characterName || a.discordName).localeCompare(
      String(b.characterName || b.discordName),
      "uk",
    )
  );
}

function signupStatusBenchWeight(signup: RaidSignup) {
  return signup.status === "tentative" ? 1 : 0;
}

function signupRosterOrder(a: RaidSignup, b: RaidSignup) {
  const aNumber = cleanSignupNumber(a.signupNumber) || Number.MAX_SAFE_INTEGER;
  const bNumber = cleanSignupNumber(b.signupNumber) || Number.MAX_SAFE_INTEGER;
  const aPriority = a.verifiedGuild === false ? 1 : 0;
  const bPriority = b.verifiedGuild === false ? 1 : 0;
  const aSigned = Date.parse(a.signedAt || a.updatedAt || "");
  const bSigned = Date.parse(b.signedAt || b.updatedAt || "");
  const signedDelta =
    (Number.isFinite(aSigned) ? aSigned : Number.MAX_SAFE_INTEGER) -
    (Number.isFinite(bSigned) ? bSigned : Number.MAX_SAFE_INTEGER);
  return (
    signupStatusBenchWeight(a) - signupStatusBenchWeight(b) ||
    aPriority - bPriority ||
    aNumber - bNumber ||
    signedDelta ||
    String(a.characterName || a.discordName).localeCompare(
      String(b.characterName || b.discordName),
      "uk",
    )
  );
}

function signupClassKey(item?: RaidSignup | null) {
  return raidAlgorithmClassToken(item);
}

function selectTanksForComposition(tanks: RaidSignup[], limit: number) {
  return takeClassBalanced(tanks, limit);
}

function selectHealersForComposition(healers: RaidSignup[], limit: number) {
  return takeClassBalanced(healers, limit);
}

type DpsRangeType = "melee" | "ranged";

function dpsRangeType(item: RaidSignup): DpsRangeType {
  return raidAlgorithmDpsRangeType(item);
}


function dpsTierTwoScore(item: RaidSignup) {
  return raidAlgorithmDpsSecondaryScore(item);
}


const RAID_CRITICAL_BUFFS: Array<{
  label: string;
  match: (item: RaidSignup) => boolean;
}> = RAID_ALGORITHM_UTILITY_RULES
  .filter((rule) => rule.required || rule.key === "augmentation")
  .sort((a, b) => a.selectionPriority - b.selectionPriority)
  .map((rule) => ({
    label: rule.label,
    match: (item) => raidAlgorithmRuleMatches(rule, item),
  }));

function pickBuffProvider(
  pool: RaidSignup[],
  match: (item: RaidSignup) => boolean,
) {
  const matchingWeights = pool
    .filter(match)
    .map((item) => signupStatusBenchWeight(item));
  if (!matchingWeights.length) return null;
  const bestWeight = Math.min(...matchingWeights);
  const index = pool.findIndex(
    (item) => match(item) && signupStatusBenchWeight(item) === bestWeight,
  );
  if (index < 0) return null;
  const [picked] = pool.splice(index, 1);
  return picked || null;
}

function selectDpsForComposition(dps: RaidSignup[], limit: number) {
  const pool = [...dps].sort(signupRosterOrder);
  const selected: RaidSignup[] = [];

  for (const buff of RAID_CRITICAL_BUFFS) {
    if (selected.length >= limit) break;
    const picked = pickBuffProvider(pool, buff.match);
    if (picked) selected.push(picked);
  }

  const targetMelee = Math.round(limit * (6 / 14));
  const classCounts = new Map<string, number>();
  for (const member of selected) {
    const key = signupClassKey(member);
    classCounts.set(key, (classCounts.get(key) || 0) + 1);
  }

  while (selected.length < limit && pool.length) {
    const currentMelee = selected.filter(
      (item) => dpsRangeType(item) === "melee",
    ).length;
    const preferredRange: DpsRangeType =
      currentMelee < targetMelee ? "melee" : "ranged";
    pool.sort((a, b) => {
      const aRangePenalty = dpsRangeType(a) === preferredRange ? 0 : 1;
      const bRangePenalty = dpsRangeType(b) === preferredRange ? 0 : 1;
      return (
        aRangePenalty - bRangePenalty ||
        raidAlgorithmMemberUtilityWeight(b, selected) - raidAlgorithmMemberUtilityWeight(a, selected) ||
        (classCounts.get(signupClassKey(a)) || 0) -
          (classCounts.get(signupClassKey(b)) || 0) ||
        dpsTierTwoScore(a) - dpsTierTwoScore(b) ||
        signupRosterOrder(a, b)
      );
    });
    const member = pool.shift();
    if (!member) break;
    selected.push(member);
    const key = signupClassKey(member);
    classCounts.set(key, (classCounts.get(key) || 0) + 1);
  }

  return selected.slice(0, limit);
}

function missingCriticalBuffs(members: RaidSignup[]) {
  return raidAlgorithmUtilityChecklist(members).missingRequired;
}

function takeClassBalanced(candidates: RaidSignup[], limit: number) {
  const pool = [...candidates].sort(signupRosterOrder);
  const selected: RaidSignup[] = [];
  const classCounts = new Map<string, number>();

  while (selected.length < limit && pool.length) {
    pool.sort(
      (a, b) =>
        (classCounts.get(signupClassKey(a)) || 0) -
          (classCounts.get(signupClassKey(b)) || 0) || signupRosterOrder(a, b),
    );
    const member = pool.shift();
    if (!member) break;
    selected.push(member);
    const key = signupClassKey(member);
    classCounts.set(key, (classCounts.get(key) || 0) + 1);
  }

  return selected;
}

function partyMembersCount(party: RaidParty) {
  return (party.tank ? 1 : 0) + (party.healer ? 1 : 0) + party.dps.length;
}

function partyCapacity(party: RaidParty) {
  return RAID_PARTY_SIZE - partyMembersCount(party);
}

function pickParty(
  parties: RaidParty[],
  predicate: (party: RaidParty) => boolean,
) {
  const candidates = parties.filter(
    (party) => partyCapacity(party) > 0 && predicate(party),
  );
  return (
    candidates.sort(
      (a, b) =>
        partyMembersCount(a) - partyMembersCount(b) || a.index - b.index,
    )[0] || null
  );
}

function partyFlexRoleCount(party: RaidParty, role: RaidCharacterRole) {
  return party.dps.filter((item) => item.role === role).length;
}

function placeFlexMember(parties: RaidParty[], member: RaidSignup) {
  const preferences: Array<(party: RaidParty) => boolean> =
    member.role === "dps"
      ? [
          (party) =>
            Boolean(party.tank && party.healer) &&
            partyFlexRoleCount(party, "dps") < 3,
          (party) =>
            Boolean(party.tank || party.healer) &&
            partyFlexRoleCount(party, "dps") < 4,
          () => true,
        ]
      : [
          (party) =>
            Boolean(party.tank && party.healer) &&
            partyMembersCount(party) < RAID_PARTY_SIZE,
          (party) =>
            Boolean(party.tank || party.healer) &&
            partyMembersCount(party) < RAID_PARTY_SIZE,
          () => true,
        ];

  for (const predicate of preferences) {
    const party = pickParty(parties, predicate);
    if (party) {
      party.dps.push(member);
      return;
    }
  }
}

function assignTankToParty(parties: RaidParty[], tank: RaidSignup) {
  const number = cleanSignupNumber(tank.signupNumber);
  const preferredIndexes = number
    ? number % 2 === 0
      ? [2, 1]
      : [1, 2]
    : [1, 2];
  const preferred = preferredIndexes
    .map((index) => parties.find((party) => party.index === index))
    .filter(Boolean) as RaidParty[];
  const target = [...preferred, ...parties].find(
    (party) => !party.tank && partyCapacity(party) > 0,
  );
  if (target) target.tank = tank;
  else placeFlexMember(parties, tank);
}

function assignHealersToParties(parties: RaidParty[], healers: RaidSignup[]) {
  const pool = [...healers].sort(signupRosterOrder);
  const usedByParity = new Map<"odd" | "even", Set<string>>([
    ["odd", new Set<string>()],
    ["even", new Set<string>()],
  ]);

  for (const party of parties) {
    if (!pool.length) break;
    if (party.healer || partyCapacity(party) <= 0) continue;
    const parity = party.index % 2 === 0 ? "even" : "odd";
    const used = usedByParity.get(parity) || new Set<string>();
    const distinctIndex = pool.findIndex(
      (member) => !used.has(signupClassKey(member)),
    );
    const [healer] = pool.splice(distinctIndex >= 0 ? distinctIndex : 0, 1);
    if (!healer) continue;
    party.healer = healer;
    used.add(signupClassKey(healer));
    usedByParity.set(parity, used);
  }

  return pool;
}

function assignDpsToParties(parties: RaidParty[], dps: RaidSignup[]) {
  for (const member of [...dps].sort(signupRosterOrder)) {
    const memberClass = signupClassKey(member);
    const target = parties
      .filter((party) => partyCapacity(party) > 0)
      .sort((a, b) => {
        const aHasClass =
          a.dps.some((item) => signupClassKey(item) === memberClass) ||
          signupClassKey(a.tank) === memberClass ||
          signupClassKey(a.healer) === memberClass;
        const bHasClass =
          b.dps.some((item) => signupClassKey(item) === memberClass) ||
          signupClassKey(b.tank) === memberClass ||
          signupClassKey(b.healer) === memberClass;
        return (
          Number(aHasClass) - Number(bHasClass) ||
          partyFlexRoleCount(a, "dps") - partyFlexRoleCount(b, "dps") ||
          partyMembersCount(a) - partyMembersCount(b) ||
          a.index - b.index
        );
      })[0];
    if (target) target.dps.push(member);
  }
}

function finalizePreviewParties(parties: RaidParty[]) {
  for (const party of parties) {
    party.members = [party.tank, party.healer, ...party.dps].filter(
      Boolean,
    ) as RaidSignup[];
    party.late = party.members.filter((item) => item.status === "late");
  }
  return parties;
}

function previewSlotCounts(parties: RaidParty[]) {
  const tanks = parties.filter((party) => Boolean(party.tank)).length;
  const healers = parties.filter((party) => Boolean(party.healer)).length;
  const dps = parties.reduce((sum, party) => sum + party.dps.length, 0);
  return { roster: tanks + healers + dps, tanks, healers, dps };
}

function buildPreviewLayout(
  raid: Pick<RaidItem, "difficulty" | "composition" | "signups" | "maxPlayers">,
): { parties: RaidParty[]; bench: RaidSignup[]; warnings: string[]; targetSize: number } {
  const active = activeSignups(raid).sort(signupRosterOrder);
  const composition = raidAutoComposition(raid);
  const targetSize = raidCompositionTargetSize(raid);
  const benchEnabled = raidRegistrationLimit(raid) !== null;
  const groupCount = Math.max(
    1,
    Math.min(
      MAX_RAID_PARTIES,
      Math.ceil(Math.max(1, targetSize) / RAID_PARTY_SIZE),
    ),
  );
  const parties: RaidParty[] = Array.from(
    { length: groupCount },
    (_, index) => ({ index: index + 1, dps: [], late: [], members: [] }),
  );

  const tanks = active
    .filter((item) => item.role === "tank")
    .sort(signupRosterOrder);
  const healers = active
    .filter((item) => item.role === "healer")
    .sort(signupRosterOrder);
  const dps = active
    .filter((item) => item.role === "dps")
    .sort(signupRosterOrder);

  const selectedTanks = selectTanksForComposition(
    tanks,
    benchEnabled ? composition.tanks : Math.max(composition.tanks, Math.min(2, tanks.length)),
  );
  const surplusTanks = tanks.filter((item) => !selectedTanks.includes(item));
  const selectedHealers = selectHealersForComposition(
    healers,
    benchEnabled ? composition.healers : Math.max(composition.healers, healers.length),
  );
  const surplusHealers = healers.filter(
    (item) => !selectedHealers.includes(item),
  );
  const selectedDps = benchEnabled
    ? selectDpsForComposition(dps, composition.dps)
    : selectDpsForComposition(dps, dps.length);
  const surplusDps = dps.filter((item) => !selectedDps.includes(item));

  const selectedMembers = [
    ...selectedTanks,
    ...selectedHealers,
    ...selectedDps,
  ];

  selectedTanks.forEach((tank) => assignTankToParty(parties, tank));
  assignHealersToParties(parties, selectedHealers).forEach((healer) =>
    placeFlexMember(parties, healer),
  );
  assignDpsToParties(parties, selectedDps);

  if (!benchEnabled)
    [...surplusTanks, ...surplusHealers].forEach((member) =>
      placeFlexMember(parties, member),
    );
  const bench = benchEnabled
    ? [...surplusTanks, ...surplusHealers, ...surplusDps].sort(
        (a, b) => signupStatusBenchWeight(b) - signupStatusBenchWeight(a) || signupSort(a, b),
      )
    : [];
  const dpsSlotsFilled = selectedDps.length;
  const missingBuffs = missingCriticalBuffs(selectedMembers);
  const safeDpsCapacity = Math.max(
    0,
    Math.min(dps.length, healers.length * 5),
  );
  const warnings = [
    selectedTanks.length < composition.tanks
      ? `Не вистачає танків: ${selectedTanks.length}/${composition.tanks}`
      : null,
    selectedHealers.length < composition.healers
      ? `Не вистачає хілів: ${selectedHealers.length}/${composition.healers}. Безпечний ДД-ліміт зараз: ${safeDpsCapacity}`
      : null,
    dpsSlotsFilled < composition.dps
      ? `Не вистачає ДД: ${dpsSlotsFilled}/${composition.dps}`
      : null,
    missingBuffs.length
      ? `Втрачені критичні бафи: ${missingBuffs.join(", ")}`
      : null,
  ].filter(Boolean) as string[];

  return { parties: finalizePreviewParties(parties), bench, warnings, targetSize };
}

function RoleRow({
  label,
  item,
  role,
  raid,
}: {
  label: string;
  item?: RaidSignup | null;
  role: RaidCharacterRole;
  raid: Pick<RaidItem, "minItemLevel" | "minItemLevelRequired">;
}) {
  const issue = signupItemLevelIssue(raid, item);
  return (
    <div
      className={`raid-party-row raid-party-row--${role}${item?.status === "late" ? " is-late" : ""}${item?.verifiedGuild === false ? " is-non-guild" : ""}${issue ? " is-undergeared" : ""}${issue?.startsWith("⛔") ? " is-blocked" : ""}`}
      aria-label={`${label}: ${signupDisplayName(item, { hasItemLevelIssue: Boolean(issue) })}`}
    >
      <RoleMarkerStack item={item} role={role} />
      <SignupAvatar item={item} />
      <span className="raid-party-member-copy">
        <strong>
          {signupDisplayName(item, { hasItemLevelIssue: Boolean(issue) })}
        </strong>
        {item ? <small>{signupSpecLabel(item)}</small> : null}
        {item ? <small>{signupExtraLabel(item)}</small> : null}
        {issue ? <small className="raid-ilvl-warning">{issue}</small> : null}
      </span>
    </div>
  );
}

function PartyCard({
  party,
  raid,
}: {
  party: RaidParty;
  raid: Pick<RaidItem, "minItemLevel" | "minItemLevelRequired">;
}) {
  const hasMembers = party.members.length > 0;
  return (
    <article className="raid-party-card">
      <h3>Паті {party.index}</h3>
      {party.tank ? (
        <RoleRow label="Танк" role="tank" item={party.tank} raid={raid} />
      ) : null}
      {party.healer ? (
        <RoleRow label="Хіл" role="healer" item={party.healer} raid={raid} />
      ) : null}
      {party.dps.length ? (
        party.dps.map((member, index) => (
          <RoleRow
            key={`${party.index}-${member.discordId}-${member.characterName || member.discordName}-${index}`}
            label={raidPartyRoleLabel(member.role)}
            role={member.role}
            item={member}
            raid={raid}
          />
        ))
      ) : !hasMembers ? (
        <RoleRow label="ДД" role="dps" item={null} raid={raid} />
      ) : null}
    </article>
  );
}

function BenchCard({
  members,
  raid,
}: {
  members: RaidSignup[];
  raid: Pick<RaidItem, "minItemLevel" | "minItemLevelRequired">;
}) {
  if (!members.length) return null;
  return (
    <article className="raid-party-card raid-bench-card">
      <h3>🪑 Лава запасних</h3>
      {members.map((member, index) => (
        <RoleRow
          key={`bench-${member.discordId}-${member.characterName || member.discordName}-${index}`}
          label={raidPartyRoleLabel(member.role)}
          role={member.role}
          item={member}
          raid={raid}
        />
      ))}
    </article>
  );
}

function readRaidFromForm(
  initialRaid: RaidItem,
  form: HTMLFormElement,
): RaidItem {
  const formData = new FormData(form);
  const difficulty = cleanDifficulty(formData.get("difficulty"));
  const minItemLevel = cleanPositiveNumber(formData.get("minItemLevel"));
  const maxPlayers = cleanPositiveNumber(
    formData.get("maxPlayers"),
    MAX_RAID_PLAYERS,
  );
  const registrationLockEnabled = Boolean(
    form.querySelector<HTMLInputElement>(
      'input[name="registrationLockEnabled"]',
    )?.checked,
  );
  const registrationLockMinutesBefore = registrationLockEnabled
    ? cleanRegistrationLockMinutes(
        formData.get("registrationLockMinutesBefore"),
      )
    : null;
  const minItemLevelRequired = Boolean(
    form.querySelector<HTMLInputElement>('input[name="minItemLevelRequired"]')
      ?.checked,
  );
  const mentionRoleIds = Array.from(
    new Set(
      formData
        .getAll("mentionRoleIds")
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const title = cleanText(formData.get("title"), DEFAULT_RAID_TITLE);
  const description = cleanText(
    formData.get("description"),
    DEFAULT_RAID_DESCRIPTION,
  );
  const thumbnailUrl = cleanText(formData.get("thumbnailUrl"), "") || null;
  const imageUrl = cleanText(formData.get("imageUrl"), "") || null;
  const channelId =
    cleanText(formData.get("channelId"), initialRaid.channelId || "") || null;

  return {
    ...initialRaid,
    title,
    difficulty,
    date: cleanText(formData.get("date"), initialRaid.date || todayIso()),
    time: cleanText(
      formData.get("time"),
      initialRaid.time || DEFAULT_RAID_TIME,
    ),
    description,
    thumbnailUrl,
    imageUrl,
    channelId,
    mentionRoleIds,
    raidLeaderName: cleanText(formData.get("raidLeaderName"), "") || null,
    consumables: cleanConsumables(formData.get("consumables")),
    lootMode: cleanLootMode(formData.get("lootMode")),
    minItemLevel,
    minItemLevelRequired,
    maxPlayers,
    registrationLockEnabled,
    registrationLockMinutesBefore,
    composition: raidAutoComposition({
      ...initialRaid,
      difficulty,
      maxPlayers,
    }),
  };
}

export default function RaidEditorLivePreview({
  initialRaid,
}: RaidEditorLivePreviewProps) {
  const [raid, setRaid] = useState<RaidItem>(initialRaid);

  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>(
      'form[data-raid-editor-form="true"]',
    );
    if (!form) return;

    let pendingSync: number | null = null;
    const syncPreview = () => setRaid(readRaidFromForm(initialRaid, form));
    const scheduleSync = () => {
      if (pendingSync !== null) window.clearTimeout(pendingSync);
      pendingSync = window.setTimeout(() => {
        pendingSync = null;
        syncPreview();
      }, 0);
    };

    syncPreview();
    form.addEventListener("input", scheduleSync);
    form.addEventListener("change", scheduleSync);
    form.addEventListener("click", scheduleSync);

    return () => {
      if (pendingSync !== null) window.clearTimeout(pendingSync);
      form.removeEventListener("input", scheduleSync);
      form.removeEventListener("change", scheduleSync);
      form.removeEventListener("click", scheduleSync);
    };
  }, [initialRaid]);

  const averageItemLevel = useMemo(() => raidAverageItemLevel(raid), [raid]);
  const layout = useMemo(() => buildPreviewLayout(raid), [raid]);
  const slotCounts = useMemo(() => previewSlotCounts(layout.parties), [layout.parties]);
  const layoutCapacity = layout.targetSize || raidDisplayCapacity(raid);
  const parties = layout.parties;
  const bench = layout.bench;
  const compositionWarnings = layout.warnings;
  const closed = raid.status === "closed";
  const thumbnailUrl = resolvePreviewThumbnailUrl(raid);
  const registrationLimit = raidRegistrationLimit(raid);
  const registrationFull = Boolean(
    registrationLimit && slotCounts.roster >= layoutCapacity,
  );
  const registrationLock = previewRegistrationLockSummary(raid);

  return (
    <section
      className={`panel raid-preview-card${closed ? " is-closed" : ""}`}
      aria-label="Живе превʼю оголошення рейду"
    >
      <div className="raid-preview-accent" aria-hidden="true" />
      <div className="raid-preview-head">
        <img
          src={thumbnailUrl}
          alt=""
          width={74}
          height={74}
          referrerPolicy="no-referrer"
        />
        <div>
          <div className="raid-preview-title-row">
            <h2>{closed ? `${raidTitle(raid)} • Закрито` : raidTitle(raid)}</h2>
            <em className="raid-state raid-state--draft">Live preview</em>
          </div>
          <div className="raid-description-markdown">
            <DiscordMarkdown value={raid.description} />
          </div>
          {closed ? (
            <div className="raid-closed-banner">
              🔒 Рейд закрито. Запис і Discord-кнопки неактивні.
            </div>
          ) : null}
        </div>
      </div>
      <div className="raid-preview-meta">
        <span>
          <strong>📌 Статус</strong>
          {raidStatusLabel(raid)}
        </span>
        <span>
          <strong>📅 Дата</strong>
          {formatRaidDateTime(raid.date, raid.time)}
        </span>
        <span>
          <strong>👤 Створив</strong>
          {raid.createdByName}
          {raid.createdByMain ? (
            <small>Мейн: {raid.createdByMain}</small>
          ) : null}
        </span>
        {raid.raidLeaderName ? (
          <span>
            <strong>🧭 РЛ</strong>
            {raid.raidLeaderName}
          </span>
        ) : null}
        <span>
          <strong>🧪 Розхідники</strong>
          {raidConsumablesLabel(raid.consumables)}
        </span>
        <span>
          <strong>🎁 Лут</strong>
          {raidLootLabel(raid.lootMode)}
        </span>
        {raid.minItemLevel ? (
          <span>
            <strong>👙 Мін. ilvl</strong>
            {raid.minItemLevel}
            <small>
              {raid.minItemLevelRequired
                ? "Блокує запис нижче порогу"
                : "Лише попередження"}
            </small>
          </span>
        ) : null}
        {averageItemLevel ? (
          <span>
            <strong>📊 Середній ilvl</strong>
            {averageItemLevel}
            <small>За активними учасниками рейду</small>
          </span>
        ) : null}
        <span>
          <strong>👥 Записано</strong>
          {slotCounts.roster} / {layoutCapacity}
          <small>
            {raid.maxPlayers
              ? `Основний склад: ${raid.maxPlayers} • схема ${raidAutoCompositionLabel(raid)}`
              : raidAutoCompositionLabel(raid)}
          </small>
        </span>
        {registrationLock.enabled ? (
          <span>
            <strong>🔐 Дедлайн запису</strong>
            {registrationLock.label}
            <small>{registrationLock.detail}</small>
          </span>
        ) : null}
      </div>
      {raid.minItemLevel ? (
        <div className="raid-ilvl-notice">
          👙 Мінімальний ilvl для цього рейду:{" "}
          <strong>{raid.minItemLevel}</strong>.{" "}
          {raid.minItemLevelRequired
            ? "Якщо персонаж нижче порогу, система заблокує запис."
            : "Якщо персонаж нижче порогу, система покаже попередження, але не блокує запис."}
        </div>
      ) : null}
      {registrationLimit ? (
        <div className="raid-ilvl-notice">
          👥 Основний склад для цього рейду: <strong>{registrationLimit}</strong>.{" "}
          {registrationFull
            ? "Основний склад заповнений — наступні активні записи будуть відображені в лаві запасних."
            : "Після заповнення основного складу нові активні записи підуть у лаву запасних, а не будуть заблоковані."}
        </div>
      ) : null}
      {registrationLock.enabled ? (
        <div
          className={`raid-ilvl-notice${registrationLock.locked ? " is-blocked" : ""}`}
        >
          🔐 Блокування запису: <strong>{registrationLock.label}</strong>.{" "}
          {registrationLock.locked
            ? "Запис і зміна персонажа вже недоступні."
            : registrationLock.detail}
        </div>
      ) : null}
      {compositionWarnings.length ? (
        <div className="raid-ilvl-notice is-warning">
          ⚠️ Валідація складу: {compositionWarnings.join(" • ")}
        </div>
      ) : null}
      <div
        className={`raid-preview-buttons${closed ? " is-disabled" : ""}`}
        aria-hidden="true"
      >
        <span className="raid-action raid-action--go">✓ Підписатися</span>
        <span className="raid-action raid-action--maybe">❓ 50/50</span>
        <span className="raid-action raid-action--skip">↩ Пропустити</span>
        <span className="raid-action raid-action--late">🕒 Затримаюсь</span>
      </div>
      <div className="raid-preview-roster-head">
        <div>
          <strong>Склад рейду</strong>
          <p>
            Паті будуються динамічно: максимум 2 танки на рейд, хіли масштабуються
            від кількості паті, ДД добираються за критичними бафами та балансом
            мілі/рендж. Якщо основний склад заповнено, зайві ролі йдуть у лаву запасних.
          </p>
        </div>
      </div>
      <div className="raid-party-grid">
        {parties.map((party) => (
          <PartyCard key={party.index} party={party} raid={raid} />
        ))}
        <BenchCard members={bench} raid={raid} />
      </div>
    </section>
  );
}
