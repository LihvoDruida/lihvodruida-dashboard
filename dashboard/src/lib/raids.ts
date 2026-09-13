import { FieldValue } from "@/lib/db/firestoreCompat";
import {
  cleanRaidImageUrl,
  defaultRaidThumbnailPath,
  normalizeRaidThumbnailDifficulty,
} from "@/lib/raidThumbnailAssets";
import {  } from "@/lib/security";
import { mapConcurrentSettled } from "@/lib/concurrency";
import {
  getRuntimeCachedValue,
  setRuntimeCachedValue,
  clearRuntimeCachedValue,
  clearRuntimeCachedValuesByPrefix,
} from "@/lib/runtimeResilience";
import {
  firebaseRead,
  firebaseWrite,
  firebaseUnavailableMessage,
} from "@/lib/firebaseAccess";
import { getSiteRuntimeSettings } from "@/lib/dashboardApiSettings";
import type { DashboardSession } from "@/lib/auth";
import {
  getFirebaseAdminDb,
  hasFirebaseProfileConfig,
} from "@/lib/firebaseAdmin";
import {
  getMainCharacter,
  getProfileByDiscordUserId,
  getProfileByDiscordUserIdForInteraction,
  getProfileById,
  getProfilePublicName,
  cleanProfileGrammaticalGender,
  profileGenderedText,
  refreshProfileCharactersForRaidSignup,
  type DashboardProfile,
  type ProfileCharacter,
  type ProfileGrammaticalGender,
} from "@/lib/profiles";
import {
  buildBattleNetCharacterKey,
  normalizeCharacterKey,
  pickWowAvatarImageUrl,
} from "@/lib/wowCharacters";
import { resolveWowCharacterRole } from "@/lib/wowRoles";
import {
  WOW_CLASS_CATALOG,
  findWowClass,
  findWowSpec,
  wowSpecFullName,
} from "@/lib/wowClassCatalog";
import {
  createDiscordRaidMessage,
  deleteDiscordRaidMessage,
  discordMessageUrl,
  editDiscordRaidMessage,
  fetchDiscordGuildMemberSnapshot,
  getDiscordDefaultChannelId,
  normalizeDiscordEmbed,
  type DiscordMessageRef,
} from "@/lib/discordAdmin";
import {
  RAID_ALGORITHM_MAX_RAID_PARTIES,
  RAID_ALGORITHM_UTILITY_RULES,
  raidAlgorithmMemberUtilityWeight,
  raidAlgorithmRuleMatches,
} from "@/lib/raidCompositionAlgorithm";
import { DpsRangeType, MAX_RAID_PLAYERS, RAID_PARTY_SIZE, dpsRangeType, dpsTierTwoScore, missingCriticalBuffs, partyCapacity, partyFlexRoleCount, partyMembersCount, pickParty, raidMinimumItemLevel, raidRegistrationLimit, roleSortWeight, signupClassKey } from "@/lib/raidPartyShared";
import { cleanSnowflake, cleanSnowflakeIds, timestampToIso, timezoneOffsetMs } from "@/lib/values";
import { resolveDiscordInteractionDocument } from "@/lib/discordInteractionStorage";
import {
  firstDiscordTimestampSeconds,
  firstInteractionEmbed,
  fraction as discordFraction,
  inferDifficultyFromTitle,
  interactionField,
  interactionMessageTimestamp,
  interactionShowsEmptyRaid,
  kyivDateTimeFromEpochSeconds,
  stripDifficultySuffix,
} from "@/lib/discordInteractionRecovery";
import {  isActiveSignupStatus, raidActiveRosterSize, raidAutoComposition } from "@/lib/raidPartyShared";
export { autoRaidCompositionForSize, raidActiveRosterSize, raidAutoComposition, raidAutoCompositionLabel } from "@/lib/raidPartyShared";

// Реекспорт для сумісності: раніше ці помічники жили тут, і на них
// посилаються серверні компоненти (RaidViews та сторінки рейдів).
export { MAX_RAID_PLAYERS, RAID_PARTY_SIZE, raidMinimumItemLevel, raidRegistrationLimit } from "@/lib/raidPartyShared";

export type RaidDifficulty = "normal" | "heroic" | "mythic";
export type RaidConsumables = "own" | "guild";
export type RaidLootMode =
  | "ms-os"
  | "free-roll"
  | "soft-reserve"
  | "loot-council";
export type RaidSignupStatus = "going" | "tentative" | "late" | "skipped";
export type RaidCharacterRole = "tank" | "healer" | "dps";

export type RaidComposition = {
  tanks: number;
  healers: number;
  dps: number;
};

export type RaidSignup = {
  discordId: string;
  signupNumber?: number | null;
  discordName: string;
  profileId?: string | null;
  characterKey?: string | null;
  status: RaidSignupStatus;
  role: RaidCharacterRole;
  grammaticalGender?: ProfileGrammaticalGender | null;
  characterName?: string | null;
  realmName?: string | null;
  realmSlug?: string | null;
  region?: string | null;
  className?: string | null;
  activeSpecName?: string | null;
  activeSpecId?: number | null;
  level?: number | null;
  raceName?: string | null;
  faction?: string | null;
  avatarUrl?: string | null;
  renderUrl?: string | null;
  mediaUrl?: string | null;
  itemLevel?: number | null;
  profileUrl?: string | null;
  verifiedGuild?: boolean | null;
  guildName?: string | null;
  guildRealmSlug?: string | null;
  /** Ручний запис: клас і спек, обрані вручну замість персонажа Battle.net. */
  manualClassKey?: string | null;
  manualSpecKey?: string | null;
  signedAt?: string | null;
  updatedAt?: string | null;
};

export type RaidItem = {
  id: string;
  title: string;
  difficulty: RaidDifficulty;
  date: string;
  time: string;
  description: string;
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  maxPlayers?: number | null;
  registrationLockEnabled?: boolean | null;
  registrationLockMinutesBefore?: number | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  mentionRoleIds?: string[];
  createdByDiscordId: string;
  createdByName: string;
  createdByMain?: string | null;
  raidLeaderName?: string | null;
  consumables: RaidConsumables;
  lootMode: RaidLootMode;
  composition: RaidComposition;
  status: "draft" | "published" | "closed";
  channelId?: string | null;
  messageId?: string | null;
  messageUrl?: string | null;
  discordDeletedAt?: string | null;
  discordDeleteReason?: "manual" | "auto" | null;
  discordCloseSyncedAt?: string | null;
  reminderChannelId?: string | null;
  reminderMessageId?: string | null;
  reminderSentAt?: string | null;
  reminderDeletedAt?: string | null;
  signups: RaidSignup[];
  benchPriority?: RaidBenchPrioritySettings | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  closedAt?: string | null;
  closedReason?: "manual" | "auto" | null;
};

export type RaidParty = {
  index: number;
  tank?: RaidSignup | null;
  healer?: RaidSignup | null;
  dps: RaidSignup[];
  late: RaidSignup[];
  members: RaidSignup[];
};

export type RaidBench = {
  members: RaidSignup[];
  tanks: RaidSignup[];
  healers: RaidSignup[];
  dps: RaidSignup[];
  late: RaidSignup[];
  tentative: RaidSignup[];
};

export type RaidBenchPrioritySettings = {
  enabled: boolean;
  characterKeys: string[];
  manualNames: string[];
  updatedAt?: string | null;
  updatedByDiscordId?: string | null;
  updatedByName?: string | null;
};

export type RaidBenchPriorityMatch = {
  matched: boolean;
  reason?: "characterKey" | "manualName" | null;
};

export type RaidBenchPrioritySaveResult = {
  settings: RaidBenchPrioritySettings;
  changed: boolean;
};

export type RaidGroupLayout = {
  parties: RaidParty[];
  bench: RaidBench;
  composition: RaidComposition;
  targetSize: number;
  benchEnabled: boolean;
  warnings: string[];
  missingCriticalBuffs: string[];
};

export type RaidLayoutCounts = {
  roster: number;
  tanks: number;
  healers: number;
  dps: number;
  late: number;
  tentative: number;
};

const RAID_COLLECTION = "dashboardRaids";
const RAID_SETTINGS_COLLECTION = "dashboardRaidSettings";
const RAID_BENCH_PRIORITY_DOCUMENT = "globalBenchPriority";
const RAID_BENCH_PRIORITY_CACHE_KEY = "raids:bench-priority:global";
const RAID_ACTION_PREFIX = "mbv1:raid";
const DEFAULT_RAID_REGISTRATION_LOCK_MINUTES = 60;
const MAX_RAID_REGISTRATION_LOCK_MINUTES = 7 * 24 * 60;
const DIFFICULTY_LABELS: Record<RaidDifficulty, string> = {
  normal: "Нормал",
  heroic: "Героїк",
  mythic: "Міфік",
};

const DIFFICULTY_COLORS: Record<RaidDifficulty, number> = {
  normal: 0x2f81f7,
  heroic: 0x9b4dff,
  mythic: 0xed4245,
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
function cleanString(value: unknown, max = 300) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function cleanUrl(value: unknown) {
  const text = cleanString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function dashboardBaseUrl() {
  return String(
    process.env.DASHBOARD_URL ||
      process.env.NEXT_PUBLIC_DASHBOARD_URL ||
      process.env.ADMIN_DASHBOARD_URL ||
      process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_URL ||
      process.env.NEXTAUTH_URL ||
      "https://guild.lihvodruida.pp.ua",
  ).replace(/\/$/, "");
}

function absoluteDashboardAssetUrl(path: string) {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  try {
    return new URL(safePath, `${dashboardBaseUrl()}/`).toString();
  } catch {
    return `${dashboardBaseUrl()}${safePath}`;
  }
}

export function dashboardProfileUrl() {
  return `${dashboardBaseUrl()}/profile`;
}

export function dashboardLoginUrl(nextPath = "/profile") {
  const url = new URL("/login", `${dashboardBaseUrl()}/`);
  if (nextPath)
    url.searchParams.set(
      "next",
      nextPath.startsWith("/") ? nextPath : `/${nextPath}`,
    );
  url.searchParams.set("error", "session_required");
  return url.toString();
}

export function dashboardRaidRulesUrl() {
  const value = String(
    process.env.RAID_RULES_URL ||
      process.env.NEXT_PUBLIC_RAID_RULES_URL ||
      process.env.DISCORD_RAID_RULES_URL ||
      "https://discord.com/channels/1449767281453301865/1498719949550784540/1498732894326227024",
  ).trim();
  return value || dashboardProfileUrl();
}

function discordLinkButton(label: string, url: string) {
  return { type: 2, style: 5, label: label.slice(0, 80), url };
}

export function raidActionHelpComponents(raidId?: string | null) {
  const buttons = [
    discordLinkButton("Відкрити профіль", dashboardProfileUrl()),
    discordLinkButton("Правила рейду", dashboardRaidRulesUrl()),
  ];
  if (raidId)
    buttons.push(discordLinkButton("Сторінка рейду", dashboardRaidUrl(raidId)));
  return [{ type: 1, components: buttons.slice(0, 5) }];
}

function raidManualSignupPromptText(reason: "login" | "main") {
  const profile = dashboardProfileUrl();
  const intro =
    reason === "login"
      ? "ℹ️ Ти ще не входив у панель, тому персонажів Battle.net немає."
      : "ℹ️ У профілі немає жодного персонажа Battle.net.";
  return `${intro}
Можна записатися вручну: обери клас, далі спек — роль визначиться автоматично.
Щоб запис підтягував ilvl і персонажа, привʼяжи Battle.net у профілі: ${profile}`;
}

function raidActionHelpText(reason: "login" | "main") {
  const profile = dashboardProfileUrl();
  const rules = dashboardRaidRulesUrl();
  if (reason === "login") {
    return `❌ Запис не зараховано: спочатку увійди через Discord у панелі.
Профіль: ${profile}
Правила рейду: ${rules}`;
  }
  return `❌ Запис не зараховано: у профілі потрібно додати хоча б одного персонажа Battle.net.
Профіль: ${profile}
Правила рейду: ${rules}`;
}

export function resolveRaidThumbnailUrl(
  input: {
    difficulty?: RaidDifficulty | string | null;
    thumbnailUrl?: string | null;
    imageUrl?: string | null;
  },
  options?: { absolute?: boolean; allowImageFallback?: boolean },
) {
  const explicitThumb = cleanRaidImageUrl(input.thumbnailUrl);
  if (explicitThumb) {
    return options?.absolute && explicitThumb.startsWith("/")
      ? absoluteDashboardAssetUrl(explicitThumb)
      : explicitThumb;
  }

  if (options?.allowImageFallback) {
    const explicitImage = cleanRaidImageUrl(input.imageUrl);
    if (explicitImage) {
      return options?.absolute && explicitImage.startsWith("/")
        ? absoluteDashboardAssetUrl(explicitImage)
        : explicitImage;
    }
  }

  const assetPath = defaultRaidThumbnailPath(input.difficulty);
  return options?.absolute ? absoluteDashboardAssetUrl(assetPath) : assetPath;
}

function cleanDifficulty(value: unknown): RaidDifficulty {
  return normalizeRaidThumbnailDifficulty(cleanString(value, 20));
}

function cleanConsumables(value: unknown): RaidConsumables {
  return cleanString(value, 20).toLowerCase() === "guild" ? "guild" : "own";
}

function cleanLootMode(value: unknown): RaidLootMode {
  const key = cleanString(value, 30).toLowerCase();
  if (key === "free-roll") return "free-roll";
  if (key === "soft-reserve") return "soft-reserve";
  if (key === "loot-council") return "loot-council";
  return "ms-os";
}

function cleanSignupStatus(value: unknown): RaidSignupStatus {
  const key = cleanString(value, 20).toLowerCase();
  if (key === "late") return "late";
  if (["tentative", "maybe", "50/50", "5050", "half", "maybe-going"].includes(key)) return "tentative";
  if (key === "skipped" || key === "skip") return "skipped";
  return "going";
}

function cleanRoleStrict(value: unknown): RaidCharacterRole | null {
  const key = cleanString(value, 30).toLowerCase();
  if (["tank", "танк"].some((item) => key.includes(item))) return "tank";
  if (
    ["heal", "healer", "healing", "хіл", "лікар"].some((item) =>
      key.includes(item),
    )
  )
    return "healer";
  if (["dps", "dd", "дд", "damage"].some((item) => key.includes(item)))
    return "dps";
  return null;
}
function raidDateTimeToUtcMs(
  input: Pick<RaidItem, "date" | "time"> | Record<string, unknown>,
) {
  const date = cleanString((input as Record<string, unknown>).date, 20);
  const time =
    cleanString((input as Record<string, unknown>).time, 20) || "00:00";
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})/);
  if (!dateMatch || !timeMatch) return null;
  const y = Number(dateMatch[1]);
  const m = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const timeZone = String(
    process.env.RAID_TIME_ZONE ||
      process.env.NEXT_PUBLIC_RAID_TIME_ZONE ||
      "Europe/Kyiv",
  );
  return guess.getTime() - timezoneOffsetMs(guess, timeZone);
}

export const RAID_REMINDER_BEFORE_START_MINUTES = 15;
export const RAID_REMINDER_DELETE_AFTER_START_HOURS = 4;
export const RAID_DISCORD_MESSAGE_RETENTION_HOURS = 24;

// Backwards-compatible parser kept for runtime settings/UI that still expose
// the old field. Raid lifecycle no longer uses this value for closing signup:
// signup closes at the configured registration deadline, or at raid start.
export function raidDiscordDeleteAfterStartHoursFromSettings(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return RAID_DISCORD_MESSAGE_RETENTION_HOURS;
  return Math.max(0, Math.min(168, Math.floor(parsed)));
}

function raidMainDiscordDeleteDue(
  raid: Pick<RaidItem, "date" | "time"> | Record<string, unknown>,
) {
  const startsAt = raidDateTimeToUtcMs(raid);
  if (startsAt === null) return false;
  return Date.now() >= startsAt + RAID_DISCORD_MESSAGE_RETENTION_HOURS * 60 * 60 * 1000;
}

function raidReminderSendDue(
  raid: Pick<RaidItem, "date" | "time" | "status" | "reminderSentAt">,
) {
  if (raid.status === "draft" || raid.reminderSentAt) return false;
  const startsAt = raidDateTimeToUtcMs(raid);
  if (startsAt === null) return false;
  const now = Date.now();
  const reminderAt = startsAt - RAID_REMINDER_BEFORE_START_MINUTES * 60 * 1000;
  return now >= reminderAt && now < startsAt;
}

function raidReminderDeleteDue(
  raid: Pick<
    RaidItem,
    "date" | "time" | "reminderMessageId" | "reminderDeletedAt"
  >,
) {
  if (!raid.reminderMessageId || raid.reminderDeletedAt) return false;
  const startsAt = raidDateTimeToUtcMs(raid);
  if (startsAt === null) return false;
  return Date.now() >= startsAt + RAID_REMINDER_DELETE_AFTER_START_HOURS * 60 * 60 * 1000;
}

function cleanRaidClosedReason(value: unknown): "manual" | "auto" | null {
  const reason = cleanString(value, 20).toLowerCase();
  if (reason === "manual") return "manual";
  if (reason === "auto") return "auto";
  return null;
}

export function isRaidAutoCloseDue(
  raid:
    | Pick<
        RaidItem,
        "status" | "date" | "time" | "registrationLockEnabled" | "registrationLockMinutesBefore"
      >
    | Record<string, unknown>,
) {
  const raw = raid as Record<string, unknown>;
  const status =
    raw.status === "published" || raw.status === "closed"
      ? String(raw.status)
      : "draft";
  if (status === "draft") return false;
  const deadline = raidRegistrationLockDeadlineMs(
    raid as RaidRegistrationLockInput,
  );
  return deadline !== null && Date.now() >= deadline;
}

export function isRaidClosed(
  raid: Pick<
    RaidItem,
    "status" | "date" | "time" | "registrationLockEnabled" | "registrationLockMinutesBefore"
  > & {
    closedReason?: string | null;
  },
) {
  if (raid.status === "closed") return true;
  return raid.status === "published" && isRaidAutoCloseDue(raid);
}

function profileMainLabel(profile?: DashboardProfile | null) {
  const main = profile ? getMainCharacter(profile) : null;
  if (!main) return null;
  return `${main.name}${main.realmName || main.realmSlug ? ` • ${main.realmName || main.realmSlug}` : ""}`;
}

function normalizeComposition(value: unknown): RaidComposition {
  const fallback = { tanks: 2, healers: 2, dps: 6 };
  if (!value || typeof value !== "object") return fallback;
  const item = value as Record<string, unknown>;
  return {
    tanks: clampInt(item.tanks, 1, 8, fallback.tanks),
    healers: clampInt(item.healers, 1, 16, fallback.healers),
    dps: clampInt(item.dps, 1, 24, fallback.dps),
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function cleanOptionalItemLevel(value: unknown) {
  const raw = cleanString(value, 12).replace(",", ".");
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(1, Math.min(9999, Math.floor(num)));
}

function cleanOptionalMaxPlayers(value: unknown) {
  const raw = cleanString(value, 12).replace(",", ".");
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(1, Math.min(MAX_RAID_PLAYERS, Math.floor(num)));
}

function cleanOptionalSignupNumber(value: unknown) {
  const raw = cleanString(value, 16).replace(",", ".");
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(1, Math.min(9999, Math.floor(num)));
}

const EMPTY_RAID_BENCH_PRIORITY_SETTINGS: RaidBenchPrioritySettings = {
  enabled: true,
  characterKeys: [],
  manualNames: [],
  updatedAt: null,
  updatedByDiscordId: null,
  updatedByName: null,
};

function normalizeBenchPriorityName(value: unknown) {
  return cleanString(value, 80)
    .normalize("NFC")
    .replace(/[ʼ’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function benchPriorityNameKey(value: unknown) {
  return normalizeBenchPriorityName(value)
    .toLocaleLowerCase("uk")
    .replace(/[ʼ’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function splitBenchPriorityManualNames(value: unknown) {
  const raw = cleanString(value, 8000);
  const names = raw
    .split(/[\n,;]+/g)
    .map(normalizeBenchPriorityName)
    .filter((name) => name.length >= 2);
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = benchPriorityNameKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 400);
}

function cleanBenchPriorityCharacterKeys(values: unknown) {
  const rawValues = Array.isArray(values) ? values : values ? [values] : [];
  const keys = rawValues
    .map((value) => normalizeCharacterKey(value))
    .filter(Boolean) as string[];
  return Array.from(new Set(keys)).slice(0, 800);
}

function cleanBenchPriorityEnabled(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const key = cleanString(value, 20).toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(key)) return false;
  if (["1", "true", "on", "yes", "enabled"].includes(key)) return true;
  return fallback;
}

function sameBenchPriorityList(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function sameRaidBenchPrioritySettings(
  current: RaidBenchPrioritySettings,
  next: Pick<RaidBenchPrioritySettings, "enabled" | "characterKeys" | "manualNames">,
) {
  return (
    current.enabled === next.enabled &&
    sameBenchPriorityList(current.characterKeys || [], next.characterKeys || []) &&
    sameBenchPriorityList(
      (current.manualNames || []).map((name) => benchPriorityNameKey(name)),
      (next.manualNames || []).map((name) => benchPriorityNameKey(name)),
    )
  );
}

function normalizeRaidBenchPrioritySettings(
  data?: Record<string, unknown> | null,
): RaidBenchPrioritySettings {
  if (!data) return { ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS };
  return {
    enabled: cleanBenchPriorityEnabled(data.enabled, true),
    characterKeys: cleanBenchPriorityCharacterKeys(
      data.characterKeys ?? data.character_keys,
    ),
    manualNames: splitBenchPriorityManualNames(
      Array.isArray(data.manualNames ?? data.manual_names)
        ? (data.manualNames ?? data.manual_names)
        : String(data.manualNames ?? data.manual_names ?? ""),
    ),
    updatedAt: timestampToIso(data.updatedAt) || null,
    updatedByDiscordId: cleanString(data.updatedByDiscordId, 32) || null,
    updatedByName: cleanString(data.updatedByName, 120) || null,
  };
}

function raidBenchPriorityHasRules(
  settings?: RaidBenchPrioritySettings | null,
) {
  return Boolean(
    settings?.enabled &&
      (settings.characterKeys.length > 0 || settings.manualNames.length > 0),
  );
}

export function raidBenchPriorityMatch(
  signup: Pick<
    RaidSignup,
    | "characterKey"
    | "characterName"
    | "discordName"
    | "realmName"
    | "realmSlug"
    | "region"
  > | null | undefined,
  settings?: RaidBenchPrioritySettings | null,
): RaidBenchPriorityMatch {
  if (!signup || !raidBenchPriorityHasRules(settings)) return { matched: false };

  const characterKey = normalizeCharacterKey(signup.characterKey);
  if (characterKey && settings?.characterKeys.includes(characterKey)) {
    return { matched: true, reason: "characterKey" };
  }

  const manualKeys = new Set(
    (settings?.manualNames || [])
      .map((name) => benchPriorityNameKey(name))
      .filter(Boolean),
  );
  if (!manualKeys.size) return { matched: false };

  const name = normalizeBenchPriorityName(signup.characterName || signup.discordName);
  const realm = normalizeBenchPriorityName(signup.realmSlug || signup.realmName);
  const region = normalizeBenchPriorityName(signup.region);
  const candidates = [
    name,
    realm ? `${name}-${realm}` : "",
    realm ? `${name} ${realm}` : "",
    region && realm ? `${name}-${realm}-${region}` : "",
    region && realm ? `${name} ${realm} ${region}` : "",
  ]
    .map((value) => benchPriorityNameKey(value))
    .filter(Boolean);

  return candidates.some((key) => manualKeys.has(key))
    ? { matched: true, reason: "manualName" }
    : { matched: false };
}

function raidBenchPriorityWeight(
  signup: RaidSignup,
  settings?: RaidBenchPrioritySettings | null,
) {
  return raidBenchPriorityMatch(signup, settings).matched ? 2 : 0;
}

function raidTentativeBenchWeight(signup: Pick<RaidSignup, "status">) {
  return signup.status === "tentative" ? 1 : 0;
}

function raidBenchSelectionWeight(
  signup: RaidSignup,
  settings?: RaidBenchPrioritySettings | null,
) {
  return Math.max(raidBenchPriorityWeight(signup, settings), raidTentativeBenchWeight(signup));
}

function raidReplaceableActiveCount(
  raid: Pick<RaidItem, "signups" | "benchPriority">,
) {
  const settings = raid.benchPriority || null;
  return raid.signups.filter(
    (item) =>
      isActiveSignupStatus(item.status) &&
      raidBenchSelectionWeight(item, settings) > 0,
  ).length;
}

function raidRegistrationAvailableSlots(
  raid: Pick<RaidItem, "maxPlayers" | "signups" | "benchPriority">,
) {
  const limit = raidRegistrationLimit(raid);
  if (limit === null) return null;
  const activeCount = raidActiveRosterSize(raid);
  const replaceableCount = raidReplaceableActiveCount(raid);
  return Math.max(0, limit - activeCount + replaceableCount);
}

export async function getRaidBenchPrioritySettings(
  options: { bypassCache?: boolean } = {},
): Promise<RaidBenchPrioritySettings> {
  if (!hasRaidStorage()) return { ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS };

  return firebaseRead<RaidBenchPrioritySettings>(
    "raid",
    RAID_BENCH_PRIORITY_CACHE_KEY,
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(RAID_SETTINGS_COLLECTION)
        .doc(RAID_BENCH_PRIORITY_DOCUMENT)
        .get();
      if (!snapshot.exists) return { ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS };
      return normalizeRaidBenchPrioritySettings(snapshot.data() || {});
    },
    {
      ttlMs: 5 * 60_000,
      timeoutMs: 2_500,
      circuitTtlMs: 90_000,
      bypassCache: Boolean(options.bypassCache),
      fallback: () =>
        getRuntimeCachedValue<RaidBenchPrioritySettings>(
          RAID_BENCH_PRIORITY_CACHE_KEY,
          24 * 60 * 60 * 1000,
        ) || { ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS },
      logEvent: "raids.bench_priority_read_failed",
    },
  );
}

async function attachRaidBenchPrioritySettings(
  raid: RaidItem | null,
): Promise<RaidItem | null> {
  if (!raid) return null;
  const benchPriority = await getRaidBenchPrioritySettings().catch(
    () => ({ ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS }),
  );
  return { ...raid, benchPriority };
}

async function attachRaidBenchPrioritySettingsToList(
  raids: RaidItem[],
): Promise<RaidItem[]> {
  const benchPriority = await getRaidBenchPrioritySettings().catch(
    () => ({ ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS }),
  );
  return raids.map((raid) => ({ ...raid, benchPriority }));
}

export async function saveRaidBenchPrioritySettingsFromForm(
  form: FormData,
  user: DashboardSession,
): Promise<RaidBenchPrioritySaveResult> {
  if (!hasRaidStorage())
    throw new Error("Збереження сірого списку тимчасово недоступне.");

  const enabled = cleanBenchPriorityEnabled(form.get("enabled"), false);
  const characterKeys = cleanBenchPriorityCharacterKeys(
    form.getAll("characterKeys"),
  );
  const manualNames = splitBenchPriorityManualNames(form.get("manualNames"));
  const nextSettings = { enabled, characterKeys, manualNames };

  const current = await getRaidBenchPrioritySettings({ bypassCache: true }).catch(
    () => ({ ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS }),
  );
  if (sameRaidBenchPrioritySettings(current, nextSettings)) {
    return { settings: current, changed: false };
  }

  const payload = {
    ...nextSettings,
    updatedByDiscordId: user.provider === "discord" ? user.id : "",
    updatedByName: user.name || user.login || user.id || "Адміністратор",
    updatedAt: FieldValue.serverTimestamp(),
  };

  const saved = await firebaseWrite(
    "raid",
    "raids:bench-priority:save",
    async () => {
      const ref = getFirebaseAdminDb()
        .collection(RAID_SETTINGS_COLLECTION)
        .doc(RAID_BENCH_PRIORITY_DOCUMENT);
      await ref.set(payload, { merge: true });
      clearRuntimeCachedValue(RAID_BENCH_PRIORITY_CACHE_KEY);
      clearRuntimeCachedValuesByPrefix("raid:");
      clearRuntimeCachedValuesByPrefix("raids:list:");
      const snapshot = await ref.get();
      const savedSettings = normalizeRaidBenchPrioritySettings(snapshot.data() || {});
      setRuntimeCachedValue(RAID_BENCH_PRIORITY_CACHE_KEY, savedSettings);
      return savedSettings;
    },
    { timeoutMs: 4_000, logEvent: "raids.bench_priority_write_failed" },
  );

  return { settings: saved, changed: true };
}

function cleanRegistrationLockMinutes(
  value: unknown,
  fallback = DEFAULT_RAID_REGISTRATION_LOCK_MINUTES,
) {
  const raw = cleanString(value, 16).replace(",", ".");
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(
    1,
    Math.min(MAX_RAID_REGISTRATION_LOCK_MINUTES, Math.floor(parsed)),
  );
}
function cleanBoolean(value: unknown) {
  if (value === true) return true;
  const key = cleanString(value, 20).toLowerCase();
  return (
    key === "1" ||
    key === "true" ||
    key === "on" ||
    key === "yes" ||
    key === "required" ||
    key === "block"
  );
}

function normalizeSignup(value: unknown): RaidSignup | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const discordId = cleanString(item.discordId, 32);
  if (!/^\d{16,25}$/.test(discordId)) return null;

  const ilvl = Number(item.itemLevel);
  const activeSpecId = Number(item.activeSpecId || item.active_spec_id);
  const activeSpecName =
    cleanString(
      item.activeSpecName ||
        item.active_spec_name ||
        item.specName ||
        item.spec_name,
      80,
    ) || null;
  const className = cleanString(item.className, 80) || null;
  const explicitRole = cleanRoleStrict(
    item.role || item.signupRole || item.raidRole || item.raid_role,
  );
  const resolvedRole =
    explicitRole ||
    resolveWowCharacterRole({
      className,
      activeSpecName,
      activeSpecId: Number.isFinite(activeSpecId) ? activeSpecId : null,
      activeSpecRole: item.activeSpecRole || item.active_spec_role,
    });
  const grammaticalGender = cleanProfileGrammaticalGender(
    item.grammaticalGender || item.grammatical_gender || item.gender,
  );
  const rawVerifiedGuild = item.verifiedGuild ?? item.verified_guild;
  const verifiedGuild =
    typeof rawVerifiedGuild === "boolean"
      ? rawVerifiedGuild
      : String(rawVerifiedGuild || "").toLowerCase() === "false"
        ? false
        : true;
  const level = Number(item.level);
  return {
    discordId,
    signupNumber: cleanOptionalSignupNumber(
      item.signupNumber ??
        item.signup_number ??
        item.orderNumber ??
        item.signupOrder,
    ),
    discordName: cleanString(item.discordName, 100) || "Discord user",
    profileId: cleanString(item.profileId, 80) || null,
    characterKey:
      normalizeCharacterKey(item.characterKey || item.character_key) || null,
    status: cleanSignupStatus(item.status),
    role: resolvedRole,
    grammaticalGender,
    characterName: cleanString(item.characterName, 80) || null,
    realmName: cleanString(item.realmName, 120) || null,
    realmSlug: cleanString(item.realmSlug, 120) || null,
    region: cleanString(item.region, 12) || null,
    className,
    activeSpecName,
    activeSpecId: Number.isFinite(activeSpecId)
      ? Math.floor(activeSpecId)
      : null,
    level: Number.isFinite(level) && level > 0 ? Math.floor(level) : null,
    raceName: cleanString(item.raceName, 80) || null,
    faction: cleanString(item.faction, 80) || null,
    avatarUrl: pickWowAvatarImageUrl(item.avatarUrl, item.renderUrl),
    renderUrl: cleanUrl(item.renderUrl),
    mediaUrl: cleanUrl(item.mediaUrl),
    itemLevel: Number.isFinite(ilvl) && ilvl > 0 ? Math.floor(ilvl) : null,
    profileUrl: cleanUrl(item.profileUrl),
    verifiedGuild,
    guildName: cleanString(item.guildName || item.guild_name, 120) || null,
    guildRealmSlug:
      cleanString(item.guildRealmSlug || item.guild_realm_slug, 120) || null,
    // Ручний запис: зберігаємо ключі каталогу, щоб роль і підпис
    // лишались стабільними навіть якщо назви спеків зміняться.
    manualClassKey:
      cleanString(item.manualClassKey || item.manual_class_key, 40) || null,
    manualSpecKey:
      cleanString(item.manualSpecKey || item.manual_spec_key, 40) || null,
    signedAt: timestampToIso(item.signedAt) || null,
    updatedAt: timestampToIso(item.updatedAt) || null,
  };
}

function normalizeRaid(id: string, data: Record<string, unknown>): RaidItem {
  const rawStatus =
    data.status === "published"
      ? "published"
      : data.status === "closed"
        ? "closed"
        : "draft";
  const closedReason = cleanRaidClosedReason(
    data.closedReason || data.closed_reason,
  );
  const status =
    rawStatus === "closed" &&
    !isRaidClosed({
      status: rawStatus,
      date: data.date as string,
      time: data.time as string,
      closedReason,
    })
      ? "published"
      : rawStatus;
  const signups = normalizeRaidSignupNumbers(
    Array.isArray(data.signups)
      ? (data.signups.map(normalizeSignup).filter(Boolean) as RaidSignup[])
      : [],
  );

  const difficulty = cleanDifficulty(data.difficulty);
  const imageUrl = cleanRaidImageUrl(data.imageUrl);

  return {
    id,
    title: cleanString(data.title, 120) || "Рейд",
    difficulty,
    date: cleanString(data.date, 20),
    time: cleanString(data.time, 20),
    description:
      cleanString(data.description, 4096) ||
      "Будьте готові до рейду та перевірте спорядження заздалегідь.",
    minItemLevel: cleanOptionalItemLevel(
      data.minItemLevel || data.min_item_level,
    ),
    minItemLevelRequired: cleanBoolean(
      data.minItemLevelRequired ??
        data.min_item_level_required ??
        data.blockBelowMinItemLevel,
    ),
    maxPlayers: cleanOptionalMaxPlayers(
      data.maxPlayers ?? data.max_players ?? data.registrationLimit,
    ),
    registrationLockEnabled: cleanBoolean(
      data.registrationLockEnabled ??
        data.registration_lock_enabled ??
        data.lockRegistrationBeforeStartEnabled ??
        data.lock_registration_before_start_enabled,
    ),
    registrationLockMinutesBefore: cleanBoolean(
      data.registrationLockEnabled ??
        data.registration_lock_enabled ??
        data.lockRegistrationBeforeStartEnabled ??
        data.lock_registration_before_start_enabled,
    )
      ? cleanRegistrationLockMinutes(
          data.registrationLockMinutesBefore ??
            data.registration_lock_minutes_before ??
            data.lockRegistrationMinutesBefore ??
            data.lock_registration_minutes_before,
        )
      : null,
    imageUrl,
    thumbnailUrl: resolveRaidThumbnailUrl({
      difficulty,
      thumbnailUrl: data.thumbnailUrl as string | null,
      imageUrl,
    }),
    mentionRoleIds: cleanSnowflakeIds(data.mentionRoleIds ?? data.mention_role_ids, 20),
    createdByDiscordId: cleanString(data.createdByDiscordId, 32),
    createdByName: cleanString(data.createdByName, 120) || "@Raid Lead",
    createdByMain: cleanString(data.createdByMain, 160) || null,
    raidLeaderName:
      cleanString(
        data.raidLeaderName ||
          data.raid_leader_name ||
          data.raidLeadName ||
          data.raid_lead_name,
        120,
      ) || null,
    consumables: cleanConsumables(data.consumables),
    lootMode: cleanLootMode(data.lootMode),
    composition: normalizeComposition(data.composition),
    status,
    channelId: cleanString(data.channelId, 32) || null,
    messageId: cleanString(data.messageId, 32) || null,
    messageUrl: cleanUrl(data.messageUrl),
    discordDeletedAt: timestampToIso(
      data.discordDeletedAt || data.discord_deleted_at,
    ),
    discordDeleteReason: cleanRaidClosedReason(
      data.discordDeleteReason || data.discord_delete_reason,
    ),
    discordCloseSyncedAt: timestampToIso(
      data.discordCloseSyncedAt || data.discord_close_synced_at,
    ),
    reminderChannelId:
      cleanString(data.reminderChannelId || data.reminder_channel_id, 32) || null,
    reminderMessageId:
      cleanString(data.reminderMessageId || data.reminder_message_id, 32) || null,
    reminderSentAt: timestampToIso(
      data.reminderSentAt || data.reminder_sent_at,
    ),
    reminderDeletedAt: timestampToIso(
      data.reminderDeletedAt || data.reminder_deleted_at,
    ),
    signups,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    publishedAt: timestampToIso(data.publishedAt),
    closedAt: timestampToIso(data.closedAt),
    closedReason,
  };
}

export function raidTitle(raid: Pick<RaidItem, "title" | "difficulty">) {
  return `${raid.title} — ${DIFFICULTY_LABELS[raid.difficulty]}`;
}

export function raidDifficultyLabel(value: RaidDifficulty) {
  return DIFFICULTY_LABELS[value];
}

export function raidConsumablesLabel(value: RaidConsumables) {
  return CONSUMABLE_LABELS[value];
}

export function raidLootLabel(value: RaidLootMode) {
  return LOOT_LABELS[value];
}

export function raidCapacity(raid: Pick<RaidItem, "composition">) {
  return (
    raid.composition.tanks + raid.composition.healers + raid.composition.dps
  );
}

export function raidCompositionLabel(raid: Pick<RaidItem, "composition">) {
  return `${raid.composition.tanks} / ${raid.composition.healers} / ${raid.composition.dps}`;
}

type RaidAutoInput = Pick<
  RaidItem,
  "difficulty" | "composition" | "signups" | "maxPlayers"
> & { benchPriority?: RaidBenchPrioritySettings | null };

const MAX_RAID_PARTIES = RAID_ALGORITHM_MAX_RAID_PARTIES;

export function raidAutoCapacity(raid: RaidAutoInput) {
  const composition = raidAutoComposition(raid);
  return composition.tanks + composition.healers + composition.dps;
}

export function raidDisplayCapacity(
  raid: RaidAutoInput & Pick<RaidItem, "maxPlayers">,
) {
  return raidRegistrationLimit(raid) ?? raidAutoCapacity(raid);
}

export function isRaidRegistrationFull(
  raid: Pick<RaidItem, "maxPlayers" | "signups" | "benchPriority">,
) {
  const slots = raidRegistrationAvailableSlots(raid);
  return slots !== null && slots <= 0;
}

type RaidRegistrationLockInput = Pick<
  RaidItem,
  "date" | "time" | "registrationLockEnabled" | "registrationLockMinutesBefore"
>;

export function raidRegistrationLockMinutesBefore(
  raid: Pick<
    RaidItem,
    "registrationLockEnabled" | "registrationLockMinutesBefore"
  >,
) {
  if (!raid.registrationLockEnabled) return null;
  return cleanRegistrationLockMinutes(raid.registrationLockMinutesBefore);
}

export function raidRegistrationLockDeadlineMs(
  raid: RaidRegistrationLockInput,
) {
  const startsAt = raidDateTimeToUtcMs(raid);
  if (startsAt === null) return null;
  const minutesBefore = raidRegistrationLockMinutesBefore(raid);
  // Навіть без окремого дедлайну запис ніколи не залишається відкритим
  // після фактичного часу старту рейду.
  return startsAt - (minutesBefore || 0) * 60 * 1000;
}

export function isRaidRegistrationLocked(raid: RaidRegistrationLockInput) {
  const deadline = raidRegistrationLockDeadlineMs(raid);
  return deadline !== null && Date.now() >= deadline;
}

export function raidRegistrationLockDurationLabel(
  minutes: number | null | undefined,
) {
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

function raidRegistrationLockAbsoluteLabel(deadlineMs: number) {
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: String(
        process.env.RAID_TIME_ZONE ||
          process.env.NEXT_PUBLIC_RAID_TIME_ZONE ||
          "Europe/Kyiv",
      ),
    }).format(new Date(deadlineMs));
  } catch {
    return new Date(deadlineMs).toISOString().slice(0, 16).replace("T", " ");
  }
}

export function raidRegistrationLockSummary(raid: RaidRegistrationLockInput) {
  const minutesBefore = raidRegistrationLockMinutesBefore(raid);
  const deadlineMs = raidRegistrationLockDeadlineMs(raid);
  if (!minutesBefore) {
    const locked = deadlineMs !== null && Date.now() >= deadlineMs;
    const startLabel = deadlineMs !== null
      ? raidRegistrationLockAbsoluteLabel(deadlineMs)
      : null;
    return {
      enabled: false,
      locked,
      minutesBefore: null,
      deadlineMs,
      label: locked
        ? `Закрито зі стартом рейду${startLabel ? ` • ${startLabel}` : ""}`
        : startLabel
          ? `Відкрито до старту • ${startLabel}`
          : "Відкрито до старту",
      detail: "Без окремого дедлайну всі записи й зміни автоматично блокуються в момент старту рейду.",
    };
  }

  const duration = raidRegistrationLockDurationLabel(minutesBefore);
  if (deadlineMs === null) {
    return {
      enabled: true,
      locked: false,
      minutesBefore,
      deadlineMs: null,
      label: `За ${duration} до старту`,
      detail: "Дедлайн буде розраховано після коректної дати та часу рейду.",
    };
  }

  const locked = Date.now() >= deadlineMs;
  const deadlineLabel = raidRegistrationLockAbsoluteLabel(deadlineMs);
  return {
    enabled: true,
    locked,
    minutesBefore,
    deadlineMs,
    label: locked
      ? `Закрито з ${deadlineLabel}`
      : `Закриється ${deadlineLabel}`,
    detail: `Автоблокування за ${duration} до старту рейду.`,
  };
}

function raidRegistrationLockDiscordValue(raid: RaidRegistrationLockInput) {
  const summary = raidRegistrationLockSummary(raid);
  if (summary.deadlineMs === null) return `${summary.label}\n${summary.detail}`;
  const timestamp = Math.floor(summary.deadlineMs / 1000);
  return `${summary.locked ? "🔒 Запис заблоковано" : "🔓 Запис відкрито"}\n${summary.detail}\n<t:${timestamp}:f> • <t:${timestamp}:R>`;
}

function raidRegistrationLockBlockMessage(
  raid: RaidRegistrationLockInput & Pick<RaidItem, "title" | "difficulty">,
  _action: RaidSignupStatus,
) {
  const summary = raidRegistrationLockSummary(raid);
  if (!summary.locked) return null;
  return `🔒 Запис на ${raidTitle(raid)} закрито. Усі кнопки та зміни складу заблоковані. ${summary.detail} ${summary.label}. Якщо потрібна ручна зміна — звернись до РЛ або офіцера.`;
}

function nextRaidSignupNumber(signups: RaidSignup[]) {
  const maxNumber = signups.reduce(
    (max, item) =>
      Math.max(max, cleanOptionalSignupNumber(item.signupNumber) || 0),
    0,
  );
  return Math.min(9999, maxNumber + 1);
}

function signupNumberFallbackSortValue(signup: RaidSignup, index: number) {
  const signedAt = Date.parse(signup.signedAt || signup.updatedAt || "");
  return Number.isFinite(signedAt) ? signedAt : index;
}

function normalizeRaidSignupNumbers(signups: RaidSignup[]) {
  const used = new Set<number>();
  const normalized = signups.map((signup) => {
    const number = cleanOptionalSignupNumber(signup.signupNumber);
    if (number && !used.has(number)) {
      used.add(number);
      return { ...signup, signupNumber: number };
    }
    return { ...signup, signupNumber: null };
  });

  const missingActive = normalized
    .map((signup, index) => ({ signup, index }))
    .filter(
      ({ signup }) =>
        !signup.signupNumber && isActiveSignupStatus(signup.status),
    )
    .sort(
      (a, b) =>
        signupNumberFallbackSortValue(a.signup, a.index) -
        signupNumberFallbackSortValue(b.signup, b.index),
    );

  let nextNumber = 1;
  for (const item of missingActive) {
    while (used.has(nextNumber)) nextNumber += 1;
    item.signup.signupNumber = Math.min(9999, nextNumber);
    used.add(item.signup.signupNumber);
  }

  return normalized;
}

function raidRegistrationFullMessage(
  raid: Pick<
    RaidItem,
    "maxPlayers" | "signups" | "title" | "difficulty" | "benchPriority"
  >,
  discordId: string,
  action: RaidSignupStatus,
  candidate?: RaidSignup | null,
) {
  void raid;
  void discordId;
  void action;
  void candidate;

  // Запис більше не блокується по maxPlayers.
  // Ліміт тепер означає розмір основного складу, а всі зайві активні записи
  // автоматично йдуть у лаву запасних у buildRaidGroupLayout().
  return null;
}

/**
 * Лічильники складу за один прохід.
 *
 * Було вісім послідовних filter() по одному й тому самому масиву плюс три
 * проміжні масиви на викид. Функція викликається на кожен рендер картки
 * рейду, на кожну перебудову Discord-embed і в live-sync, тому вісім
 * проходів перетворювались на помітний обсяг зайвої роботи на списках.
 */
export function raidRosterCounts(raid: Pick<RaidItem, "signups">) {
  let going = 0;
  let tentative = 0;
  let late = 0;
  let skipped = 0;
  let tanks = 0;
  let healers = 0;
  let dps = 0;

  for (const item of raid.signups) {
    if (item.status === "going") going += 1;
    else if (item.status === "tentative") tentative += 1;
    else if (item.status === "late") late += 1;
    else if (item.status === "skipped") skipped += 1;
    else continue;

    if (item.status === "skipped") continue;
    if (item.role === "tank") tanks += 1;
    else if (item.role === "healer") healers += 1;
    else if (item.role === "dps") dps += 1;
  }

  return {
    going,
    tentative,
    late,
    skipped,
    roster: going + tentative + late,
    tanks,
    healers,
    dps,
  };
}

export function raidAverageItemLevel(raid: Pick<RaidItem, "signups">) {
  let sum = 0;
  let count = 0;
  for (const item of raid.signups) {
    if (!isActiveSignupStatus(item.status)) continue;
    const value = Number(item.itemLevel || 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    sum += value;
    count += 1;
  }
  return count ? Math.round(sum / count) : null;
}

type RaidMinimumPolicy = Pick<
  RaidItem,
  "minItemLevel" | "minItemLevelRequired"
>;
type RaidItemLevelSubject =
  | Pick<
      RaidSignup,
      "itemLevel" | "status" | "characterKey" | "manualClassKey" | "manualSpecKey"
    >
  | Pick<RaidSignup, "itemLevel" | "status">
  | Pick<ProfileCharacter, "itemLevel">
  | null
  | undefined;

function raidSubjectItemLevel(subject: RaidItemLevelSubject) {
  const current = Number(subject?.itemLevel || 0);
  return Number.isFinite(current) && current > 0 ? Math.floor(current) : null;
}

/**
 * Ручний запис (клас+спек без персонажа Battle.net) не має і не може мати
 * item level: дані просто нізвідки взяти. Перевірку порогу для таких
 * записів пропускаємо — інакше рейд із мінімальним ilvl блокував би
 * геть усіх, хто записується вручну.
 */
function isUnverifiableItemLevelSubject(subject: RaidItemLevelSubject) {
  if (!subject || typeof subject !== "object") return false;
  const hasManual =
    "manualClassKey" in subject && Boolean((subject as RaidSignup).manualClassKey);
  const hasCharacter =
    "characterKey" in subject && Boolean((subject as RaidSignup).characterKey);
  return hasManual && !hasCharacter;
}

function isSkippedItemLevelSubject(subject: RaidItemLevelSubject) {
  return Boolean(
    subject && "status" in subject && subject.status === "skipped",
  );
}

export function isRaidSubjectBelowMinItemLevel(
  raid: Pick<RaidItem, "minItemLevel">,
  subject: RaidItemLevelSubject,
) {
  const required = raidMinimumItemLevel(raid);
  const current = raidSubjectItemLevel(subject);
  return Boolean(required && current !== null && current < required);
}

export function isRaidSubjectBlockedByMinItemLevel(
  raid: RaidMinimumPolicy,
  subject: RaidItemLevelSubject,
) {
  const required = raidMinimumItemLevel(raid);
  if (
    !raid.minItemLevelRequired ||
    !required ||
    isSkippedItemLevelSubject(subject) ||
    isUnverifiableItemLevelSubject(subject)
  )
    return false;
  const current = raidSubjectItemLevel(subject);
  return current === null || current < required;
}

export function isRaidSubjectWarnedByMinItemLevel(
  raid: RaidMinimumPolicy,
  subject: RaidItemLevelSubject,
) {
  const required = raidMinimumItemLevel(raid);
  if (
    raid.minItemLevelRequired ||
    !required ||
    isSkippedItemLevelSubject(subject) ||
    isUnverifiableItemLevelSubject(subject)
  )
    return false;
  return isRaidSubjectBelowMinItemLevel(raid, subject);
}

export function raidEligibleSignupCharacters(
  raid: RaidMinimumPolicy,
  profile?: Pick<DashboardProfile, "characters"> | null,
) {
  const characters = profile?.characters || [];
  return characters.filter(
    (character) => !isRaidSubjectBlockedByMinItemLevel(raid, character),
  );
}

export function raidSignupCharacterMinimumNote(
  raid: RaidMinimumPolicy,
  character: Pick<ProfileCharacter, "itemLevel">,
) {
  const required = raidMinimumItemLevel(raid);
  const current = raidSubjectItemLevel(character);
  if (!required) return null;
  if (isRaidSubjectBlockedByMinItemLevel(raid, character)) {
    return current === null
      ? `⛔ ilvl не визначено, мінімум ${required}`
      : `⛔ ${current} ilvl нижче мінімуму ${required}`;
  }
  if (isRaidSubjectWarnedByMinItemLevel(raid, character)) {
    return `⚠️ ${current} ilvl нижче мінімуму ${required}`;
  }
  return null;
}

export function hasRaidStorage() {
  return hasFirebaseProfileConfig();
}

function clearRaidRuntimeCaches(raidId?: string | null) {
  const id = cleanRaidId(raidId);
  if (id) clearRuntimeCachedValue(`raid:${id}`);
  clearRuntimeCachedValuesByPrefix("raids:list:");
}

const raidLifecycleSyncInFlight = new Set<string>();

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRaidDiscordSyncEntries:
    | Map<string, { dirty: boolean; promise: Promise<boolean> }>
    | undefined;
}

function raidDiscordSyncEntries() {
  const map = globalThis.__mistblossomRaidDiscordSyncEntries || new Map<string, { dirty: boolean; promise: Promise<boolean> }>();
  globalThis.__mistblossomRaidDiscordSyncEntries = map;
  return map;
}

function raidDiscordSyncDebounceMs() {
  const value = Number(process.env.RAID_DISCORD_SYNC_DEBOUNCE_MS || 350);
  if (!Number.isFinite(value)) return 350;
  return Math.max(0, Math.min(Math.floor(value), 2_000));
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function scheduleRaidAutoCloseSync(raid: RaidItem, source: string) {
  const needsStatusSync =
    raid.status === "published" && isRaidAutoCloseDue(raid);
  const needsReminder = Boolean(
    raid.channelId && !raid.reminderSentAt && raidReminderSendDue(raid),
  );
  const canDeleteReminder = raidReminderDeleteDue(raid);
  const canDeleteDiscordMessage = Boolean(
    raid.channelId &&
    raid.messageId &&
    !raid.discordDeletedAt &&
    raidMainDiscordDeleteDue(raid),
  );
  if (
    (!needsStatusSync && !needsReminder && !canDeleteReminder && !canDeleteDiscordMessage) ||
    raidLifecycleSyncInFlight.has(raid.id)
  )
    return;

  raidLifecycleSyncInFlight.add(raid.id);
  void syncRaidLifecycleAfterRead(raid)
    .catch((error) => {
      console.warn("[raids] Failed to sync raid lifecycle", {
        raidId: raid.id,
        source,
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      raidLifecycleSyncInFlight.delete(raid.id);
    });
}

function raidWriteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (
    /збереження|write|permission|quota|firestore|firebase|timed out|timeout|resource/i.test(
      message,
    )
  ) {
    return firebaseUnavailableMessage("raid", "write");
  }
  return message || "Запис на рейд тимчасово недоступний. Спробуй пізніше.";
}

/**
 * Раніше тут стояв ще один шар кешу — список рейдів у Cloudflare KV поверх
 * кешу `firebaseRead` нижче. Він мав сенс, поки KV був спільним для всіх
 * екземплярів і жив за межами процесу. Після переїзду на власний сервер це
 * перетворилось на другий кеш тих самих даних у тій самій памʼяті: користі
 * нуль, а ризик показати застарілий склад рейду — цілком реальний.
 */
export async function listRaids(limit = 60): Promise<RaidItem[]> {
  const safeLimit = Math.max(1, Math.min(100, limit));
  if (!hasRaidStorage()) return [];
  const raids = await firebaseRead<RaidItem[]>(
    "raid",
    `raids:list:${safeLimit}`,
    async () => {
      let snapshot: any;
      try {
        snapshot = await getFirebaseAdminDb()
          .collection(RAID_COLLECTION)
          .orderBy("date", "desc")
          .limit(safeLimit)
          .get();
      } catch {
        snapshot = await getFirebaseAdminDb()
          .collection(RAID_COLLECTION)
          .limit(safeLimit)
          .get();
      }
      const raidDocs = snapshot.docs as Array<{
        id: string;
        data: () => Record<string, unknown> | undefined;
      }>;
      const raids: RaidItem[] = raidDocs.map((doc) =>
        normalizeRaid(doc.id, doc.data() || {}),
      );
      const sorted = raids.sort(
        (a: RaidItem, b: RaidItem) =>
          `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) ||
          Date.parse(b.updatedAt || b.createdAt || "") -
            Date.parse(a.updatedAt || a.createdAt || ""),
      );
      sorted.forEach((raid) =>
        scheduleRaidAutoCloseSync(raid, "firebase-list-read"),
      );
      return sorted;
    },
    {
      ttlMs: Math.max(
        30_000,
        Math.min(
          300_000,
          Number(
            (await getSiteRuntimeSettings().catch(() => null))
              ?.raidListCacheTtlMs ||
              process.env.RAID_LIST_CACHE_TTL_MS ||
              60_000,
          ),
        ),
      ),
      timeoutMs: 3_000,
      circuitTtlMs: 90_000,
      fallback: () =>
        getRuntimeCachedValue<RaidItem[]>(
          `raids:list:${safeLimit}`,
          24 * 60 * 60 * 1000,
        ) || [],
      logEvent: "raids.list_read_failed",
    },
  );
  return attachRaidBenchPrioritySettingsToList(raids);
}

export async function getRaid(raidId: string): Promise<RaidItem | null> {
  const id = cleanRaidId(raidId);
  if (!id) return null;
  if (!hasRaidStorage()) return null;
  const raid = await firebaseRead(
    "raid",
    `raid:${id}`,
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(RAID_COLLECTION)
        .doc(id)
        .get();
      if (!snapshot.exists) return null;
      const raid = normalizeRaid(snapshot.id, snapshot.data() || {});
      scheduleRaidAutoCloseSync(raid, "firebase-item-read");
      return raid;
    },
    {
      ttlMs: Math.max(
        10_000,
        Math.min(
          120_000,
          Number(
            (await getSiteRuntimeSettings().catch(() => null))
              ?.raidItemCacheTtlMs ||
              process.env.RAID_ITEM_CACHE_TTL_MS ||
              30_000,
          ),
        ),
      ),
      timeoutMs: 2_500,
      circuitTtlMs: 90_000,
      fallback: () =>
        getRuntimeCachedValue<RaidItem | null>(
          `raid:${id}`,
          24 * 60 * 60 * 1000,
        ),
      logEvent: "raids.item_read_failed",
    },
  );
  return attachRaidBenchPrioritySettings(raid);
}

type RaidLifecycleSyncResult = {
  raidId: string;
  status: RaidItem["status"];
  autoClosed: boolean;
  reminderSent: boolean;
  reminderDeleted: boolean;
  discordDeleted: boolean;
};

function buildRaidReminderPayload(raid: RaidItem) {
  const startsAt = raidDateTimeToUtcMs(raid);
  const unix = startsAt === null ? null : Math.floor(startsAt / 1000);
  const roster = raidActiveRosterSize(raid);
  const embed = normalizeDiscordEmbed({
    title: `⏰ Рейд через ${RAID_REMINDER_BEFORE_START_MINUTES} хвилин`,
    url: dashboardRaidUrl(raid.id),
    description: `**${raidTitle(raid)}**\nПідготуйте персонажа, розхідники та зайдіть у голосовий канал завчасно.`,
    color: DIFFICULTY_COLORS[raid.difficulty],
    fields: [
      {
        name: "🕒 Початок",
        value: unix ? `<t:${unix}:f> • <t:${unix}:R>` : discordDateTimeLabel(raid),
        inline: true,
      },
      {
        name: "👥 Записано",
        value: `${roster}`,
        inline: true,
      },
      {
        name: "📌 Статус",
        value: isRaidClosed(raid) ? "🔒 Запис закрито" : "🔓 Запис відкрито",
        inline: true,
      },
    ],
    footer: {
      text: `Нагадування автоматично видалиться через ${RAID_REMINDER_DELETE_AFTER_START_HOURS} год після старту рейду.`,
    },
    timestamp: new Date().toISOString(),
  });
  return {
    content: "",
    embed,
    mentionRoleIds: raid.mentionRoleIds || [],
  };
}

async function syncRaidLifecycleAfterRead(
  raid: RaidItem,
): Promise<RaidLifecycleSyncResult> {
  const closedNow = await syncAutoClosedRaid(raid, { syncDiscord: true });

  const lifecycleRaid: RaidItem = closedNow
    ? {
        ...raid,
        status: "closed",
        closedReason: "auto",
        closedAt: new Date().toISOString(),
      }
    : raid;

  const reminderSent = await syncRaidReminder(lifecycleRaid);
  const reminderRaid: RaidItem = reminderSent
    ? { ...lifecycleRaid, reminderSentAt: new Date().toISOString() }
    : lifecycleRaid;
  const reminderDeleted = await syncRaidReminderDeletion(reminderRaid);
  const discordDeleted = await syncRaidDiscordDeletionAfterStart(lifecycleRaid);

  return {
    raidId: raid.id,
    status: lifecycleRaid.status,
    autoClosed: closedNow,
    reminderSent,
    reminderDeleted,
    discordDeleted,
  };
}

async function syncAutoClosedRaid(
  raid: RaidItem,
  options: { syncDiscord?: boolean } = {},
) {
  if (
    !isRaidAutoCloseDue(raid) ||
    raid.closedReason === "manual" ||
    !hasRaidStorage()
  )
    return false;
  if (raid.status === "closed" && raid.closedReason === "auto") return false;

  let closed = false;
  await firebaseWrite(
    "raid",
    `raid:${raid.id}:auto-close`,
    async () => {
      const ref = getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id);
      await getFirebaseAdminDb().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const current = normalizeRaid(snapshot.id, snapshot.data() || {});
        if (current.status === "draft" || current.closedReason === "manual")
          return;
        if (!isRaidAutoCloseDue(current)) return;
        if (current.status === "closed" && current.closedReason === "auto")
          return;

        transaction.set(
          ref,
          {
            status: "closed",
            closedReason: "auto",
            closedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        closed = true;
      });
      if (closed) clearRaidRuntimeCaches(raid.id);
    },
    {
      timeoutMs: 3_000,
      logEvent: "raids.auto_close_write_failed",
      fallback: () => undefined,
    },
  );

  if (
    closed &&
    options.syncDiscord !== false &&
    raid.channelId &&
    raid.messageId
  ) {
    await publishOrUpdateRaid(
      {
        ...raid,
        status: "closed",
        closedReason: "auto",
        closedAt: new Date().toISOString(),
      },
      raid.channelId,
    ).catch((error) => {
      console.warn("[raids] Failed to sync Discord message after auto-close", {
        raidId: raid.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return closed;
}

async function syncRaidReminder(raid: RaidItem) {
  if (
    !hasRaidStorage() ||
    !raid.channelId ||
    raid.status === "draft" ||
    raid.reminderSentAt ||
    !raidReminderSendDue(raid)
  )
    return false;

  let claimed = false;
  await firebaseWrite(
    "raid",
    `raid:${raid.id}:reminder-claim`,
    async () => {
      const ref = getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id);
      await getFirebaseAdminDb().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const data = snapshot.data() || {};
        const current = normalizeRaid(snapshot.id, data);
        if (current.reminderSentAt || !raidReminderSendDue(current)) return;
        const claimAt = Date.parse(timestampToIso(data.reminderClaimedAt) || "");
        if (Number.isFinite(claimAt) && Date.now() - claimAt < 2 * 60_000) return;
        transaction.set(
          ref,
          {
            reminderClaimedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        claimed = true;
      });
    },
    {
      timeoutMs: 3_000,
      logEvent: "raids.reminder_claim_failed",
      fallback: () => undefined,
    },
  );
  if (!claimed) return false;

  const clearClaim = async () => {
    await firebaseWrite(
      "raid",
      `raid:${raid.id}:reminder-clear-claim`,
      async () => {
        await getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id).set(
          { reminderClaimedAt: null, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      },
      { timeoutMs: 2_000, fallback: () => undefined },
    );
  };

  const payload = buildRaidReminderPayload(raid);
  let message: any;
  try {
    message = await createDiscordRaidMessage({
      channelId: raid.channelId,
      content: payload.content,
      embed: payload.embed,
      components: [],
      mentionRoleIds: payload.mentionRoleIds,
      auditReason: `Raid 15-minute reminder: ${raid.id}`,
    });
  } catch (error) {
    await clearClaim();
    console.warn("[raids] Failed to send raid reminder", {
      raidId: raid.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const channelId = cleanString(message?.channel_id || raid.channelId, 32);
  const messageId = cleanString(message?.id, 32);
  if (!channelId || !messageId) {
    await clearClaim();
    return false;
  }

  let persisted = false;
  await firebaseWrite(
    "raid",
    `raid:${raid.id}:reminder-sent`,
    async () => {
      await getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id).set(
        {
          reminderChannelId: channelId,
          reminderMessageId: messageId,
          reminderSentAt: FieldValue.serverTimestamp(),
          reminderDeletedAt: null,
          reminderClaimedAt: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      persisted = true;
      clearRaidRuntimeCaches(raid.id);
    },
    {
      timeoutMs: 3_000,
      logEvent: "raids.reminder_state_write_failed",
      fallback: () => undefined,
    },
  );
  if (!persisted) {
    await deleteDiscordRaidMessage({
      ref: { channelId, messageId },
      auditReason: `Rollback unpersisted raid reminder: ${raid.id}`,
    }).catch(() => undefined);
    await clearClaim();
    return false;
  }
  return true;
}

async function syncRaidReminderDeletion(raid: RaidItem) {
  if (
    !hasRaidStorage() ||
    !raid.reminderMessageId ||
    raid.reminderDeletedAt ||
    !raidReminderDeleteDue(raid)
  )
    return false;

  const channelId = cleanString(raid.reminderChannelId || raid.channelId, 32);
  if (!channelId) return false;

  try {
    await deleteDiscordRaidMessage({
      ref: { channelId, messageId: raid.reminderMessageId },
      auditReason: `Raid reminder auto-delete after start+${RAID_REMINDER_DELETE_AFTER_START_HOURS}h: ${raid.id}`,
    });
  } catch (error) {
    if (!isMissingDiscordMessageError(error)) {
      console.warn("[raids] Failed to auto-delete raid reminder", {
        raidId: raid.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  await firebaseWrite(
    "raid",
    `raid:${raid.id}:reminder-delete`,
    async () => {
      await getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id).set(
        {
          reminderDeletedAt: FieldValue.serverTimestamp(),
          reminderMessageId: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      clearRaidRuntimeCaches(raid.id);
    },
    {
      timeoutMs: 3_000,
      logEvent: "raids.reminder_delete_write_failed",
      fallback: () => undefined,
    },
  );
  return true;
}

async function syncRaidDiscordDeletionAfterStart(raid: RaidItem) {
  if (
    !hasRaidStorage() ||
    !raid.channelId ||
    !raid.messageId ||
    raid.discordDeletedAt ||
    !raidMainDiscordDeleteDue(raid)
  )
    return false;

  try {
    await deleteDiscordRaidMessage({
      ref: { channelId: raid.channelId, messageId: raid.messageId },
      auditReason: `Raid message auto-delete after start+${RAID_DISCORD_MESSAGE_RETENTION_HOURS}h: ${raid.id}`,
    });
  } catch (error) {
    if (!isMissingDiscordMessageError(error)) {
      console.warn("[raids] Failed to auto-delete raid Discord message", {
        raidId: raid.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  await firebaseWrite(
    "raid",
    `raid:${raid.id}:discord-auto-delete`,
    async () => {
      await getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id).set(
        {
          discordDeletedAt: FieldValue.serverTimestamp(),
          discordDeleteReason: "auto",
          messageId: null,
          messageUrl: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      clearRaidRuntimeCaches(raid.id);
    },
    {
      timeoutMs: 3_000,
      logEvent: "raids.discord_auto_delete_write_failed",
      fallback: () => undefined,
    },
  );
  return true;
}

type RaidLifecycleScanMode = "window" | "sweep";

function lifecycleDateKey(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

async function listRaidsForLifecycle(
  limit: number,
  options: { fullSweep?: boolean } = {},
): Promise<{ raids: RaidItem[]; scanMode: RaidLifecycleScanMode }> {
  if (!hasRaidStorage()) {
    return { raids: [], scanMode: options.fullSweep ? "sweep" : "window" };
  }
  const safeLimit = Math.max(
    1,
    Math.min(100, Math.floor(Number(limit) || 40)),
  );
  const db = getFirebaseAdminDb();
  const docsById = new Map<
    string,
    { id: string; data: () => Record<string, unknown> | undefined }
  >();
  let scanMode: RaidLifecycleScanMode = options.fullSweep ? "sweep" : "window";

  if (!options.fullSweep) {
    // Normal minute ticks use one indexed date-window query instead of two broad
    // status queries. The ±8-day window covers the maximum 7-day pre-close
    // setting and gives post-start Discord cleanup several days to retry.
    const fromDate = lifecycleDateKey(-8);
    const toDate = lifecycleDateKey(8);
    const fetchLimit = Math.max(40, Math.min(200, safeLimit * 2));
    try {
      const snapshot = await db
        .collection(RAID_COLLECTION)
        .where("date", ">=", fromDate)
        .where("date", "<=", toDate)
        .orderBy("date", "asc")
        .limit(fetchLimit)
        .get();
      for (const doc of snapshot.docs) docsById.set(doc.id, doc);
    } catch (error) {
      console.warn(
        "[raids] Lifecycle date-window query failed; using status sweep",
        { message: error instanceof Error ? error.message : String(error) },
      );
      scanMode = "sweep";
    }
  }

  if (options.fullSweep || scanMode === "sweep") {
    // Hourly sweep catches stale Discord messages after a prolonged outage
    // without making every minute perform broad published/closed queries.
    const perStatusLimit = Math.max(25, Math.min(100, safeLimit));
    try {
      const [publishedSnapshot, closedSnapshot] = await Promise.all([
        db
          .collection(RAID_COLLECTION)
          .where("status", "==", "published")
          .limit(perStatusLimit)
          .get(),
        db
          .collection(RAID_COLLECTION)
          .where("status", "==", "closed")
          .limit(perStatusLimit)
          .get(),
      ]);
      for (const doc of [...publishedSnapshot.docs, ...closedSnapshot.docs]) {
        docsById.set(doc.id, doc);
      }
    } catch (error) {
      console.warn(
        "[raids] Lifecycle status sweep failed; using bounded collection scan",
        { message: error instanceof Error ? error.message : String(error) },
      );
      const snapshot = await db
        .collection(RAID_COLLECTION)
        .limit(Math.max(50, Math.min(200, safeLimit * 2)))
        .get();
      for (const doc of snapshot.docs) docsById.set(doc.id, doc);
    }
  }

  const raids = Array.from(docsById.values())
    .map((doc) => normalizeRaid(doc.id, doc.data() || {}))
    .filter((raid) => raid.status === "published" || raid.status === "closed")
    .sort(
      (a, b) =>
        `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) ||
        Date.parse(a.updatedAt || a.createdAt || "") -
          Date.parse(b.updatedAt || b.createdAt || ""),
    )
    .slice(0, safeLimit);

  return { raids, scanMode };
}

function raidLifecycleCandidates(raids: RaidItem[]) {
  return raids.filter((raid) => {
    if (raid.status === "draft") return false;
    if (raid.status === "published" && raid.closedReason !== "manual" && isRaidAutoCloseDue(raid)) {
      return true;
    }
    if (raid.channelId && !raid.reminderSentAt && raidReminderSendDue(raid)) {
      return true;
    }
    if (raidReminderDeleteDue(raid)) {
      return true;
    }
    if (raid.channelId && raid.messageId && !raid.discordDeletedAt && raidMainDiscordDeleteDue(raid)) {
      return true;
    }
    return false;
  });
}

export async function syncRaidLifecycleBatch(
  limit = 100,
  options: { fullSweep?: boolean } = {},
) {
  const safeLimit = Math.max(
    1,
    Math.min(100, Math.floor(Number(limit) || 40)),
  );
  const { raids, scanMode } = await listRaidsForLifecycle(safeLimit, options);
  const candidates = raidLifecycleCandidates(raids);
  const mapped = await mapConcurrentSettled(
    candidates,
    async (raid) => syncRaidLifecycleAfterRead(raid),
    {
      envKey: "RAID_LIFECYCLE_CONCURRENCY",
      maxEnvKey: "RAID_LIFECYCLE_MAX_CONCURRENCY",
      profile: "write",
      min: 1,
      max: 2,
      failFast: false,
    },
  );

  let autoClosed = 0;
  let remindersSent = 0;
  let remindersDeleted = 0;
  let discordDeleted = 0;
  const errors: Array<{ raidId: string; title: string; message: string }> = [];

  for (const item of mapped.results) {
    if (item.ok) {
      if (item.value.autoClosed) autoClosed += 1;
      if (item.value.reminderSent) remindersSent += 1;
      if (item.value.reminderDeleted) remindersDeleted += 1;
      if (item.value.discordDeleted) discordDeleted += 1;
      continue;
    }
    errors.push({
      raidId: item.item.id,
      title: item.item.title || item.item.id,
      message: item.error instanceof Error ? item.error.message : String(item.error || "unknown"),
    });
    console.warn("[raids] Lifecycle item failed", {
      raidId: item.item.id,
      title: item.item.title || item.item.id,
      message: item.error instanceof Error ? item.error.message : String(item.error),
    });
  }

  return {
    scanMode,
    checked: candidates.length,
    scanned: raids.length,
    total: raids.length,
    autoClosed,
    remindersSent,
    remindersDeleted,
    discordDeleted,
    failed: errors.length,
    concurrency: mapped.meta.concurrency,
    durationMs: mapped.meta.durationMs,
    errors: errors.slice(0, 20),
  };
}

export async function closeRaid(raidId: string) {
  const raid = await getRaid(raidId);
  if (!raid) throw new Error("Рейд не знайдено.");
  if (raid.status === "draft")
    throw new Error(
      "Чернетку не можна закрити. Її можна видалити або опублікувати.",
    );

  let closed: RaidItem =
    raid.status === "closed"
      ? raid
      : {
          ...raid,
          status: "closed",
          closedReason: "manual",
          closedAt: raid.closedAt || new Date().toISOString(),
        };

  await firebaseWrite(
    "raid",
    `raid:${raid.id}:close`,
    async () => {
      const ref = getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id);
      await getFirebaseAdminDb().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Рейд не знайдено.");
        const current = normalizeRaid(snapshot.id, snapshot.data() || {});
        if (current.status === "draft") {
          throw new Error(
            "Чернетку не можна закрити. Її можна видалити або опублікувати.",
          );
        }

        if (current.status === "closed") {
          closed = current;
          return;
        }

        closed = {
          ...current,
          status: "closed",
          closedReason: "manual",
          closedAt: current.closedAt || new Date().toISOString(),
        };
        transaction.set(
          ref,
          {
            status: "closed",
            closedReason: "manual",
            ...(current.closedAt
              ? {}
              : { closedAt: FieldValue.serverTimestamp() }),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
      clearRaidRuntimeCaches(raid.id);
    },
    { timeoutMs: 3_000, logEvent: "raids.close_write_failed" },
  );

  let discordSynced = true;
  if (closed.channelId && closed.messageId && !closed.discordDeletedAt) {
    try {
      await publishOrUpdateRaid(closed, closed.channelId);
    } catch (error) {
      discordSynced = false;
      console.warn(
        "[raids] Failed to disable Discord buttons while closing raid",
        {
          raidId: raid.id,
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  return { ...closed, discordSynced };
}

export async function deleteRaid(raidId: string) {
  const raid = await getRaid(raidId);
  if (!raid) throw new Error("Рейд не знайдено.");

  let discordDeleted = false;
  let discordDeleteFailed = false;
  if (raid.reminderMessageId) {
    const reminderChannelId = cleanString(raid.reminderChannelId || raid.channelId, 32);
    if (reminderChannelId) {
      await deleteDiscordRaidMessage({
        ref: { channelId: reminderChannelId, messageId: raid.reminderMessageId },
        auditReason: `Raid reminder manually deleted with raid: ${raid.id}`,
      }).catch((error) => {
        if (!isMissingDiscordMessageError(error)) {
          console.warn("[raids] Failed to delete reminder during manual raid deletion", {
            raidId: raid.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
  }
  if (raid.channelId && raid.messageId) {
    try {
      await deleteDiscordRaidMessage({
        ref: { channelId: raid.channelId, messageId: raid.messageId },
        auditReason: `Raid manually deleted from dashboard: ${raid.id}`,
      });
      discordDeleted = true;
    } catch (error) {
      if (isMissingDiscordMessageError(error)) {
        discordDeleted = true;
      } else {
        discordDeleteFailed = true;
        console.warn(
          "[raids] Failed to delete Discord raid message during manual raid deletion",
          {
            raidId: raid.id,
            message: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  await firebaseWrite(
    "raid",
    `raid:${raid.id}:delete`,
    async () => {
      await getFirebaseAdminDb()
        .collection(RAID_COLLECTION)
        .doc(raid.id)
        .delete();
      clearRaidRuntimeCaches(raid.id);
    },
    { timeoutMs: 3_000, logEvent: "raids.delete_write_failed" },
  );
  return { ...raid, discordDeleted, discordDeleteFailed };
}

export const deleteDraftRaid = deleteRaid;

export type ProfileRaidSignup = {
  raid: RaidItem;
  signup: RaidSignup;
};

function signupMatchesProfile(
  signup: RaidSignup,
  profile: Pick<DashboardProfile, "profileId" | "provider" | "providerUserId">,
) {
  if (signup.profileId && signup.profileId === profile.profileId) return true;
  if (
    profile.provider === "discord" &&
    /^\d{16,25}$/.test(profile.providerUserId || "")
  ) {
    return signup.discordId === profile.providerUserId;
  }
  return false;
}

export async function listProfileRaidSignups(
  profile: Pick<
    DashboardProfile,
    "profileId" | "provider" | "providerUserId" | "grammaticalGender"
  >,
  limit = 80,
): Promise<ProfileRaidSignup[]> {
  if (!profile?.profileId || !hasRaidStorage()) return [];

  const raids = await listRaids(Math.max(20, Math.min(120, limit)));
  const items: ProfileRaidSignup[] = [];
  for (const raid of raids) {
    if (raid.status !== "published" || isRaidClosed(raid)) continue;
    const signup = raid.signups.find((item) =>
      signupMatchesProfile(item, profile),
    );
    if (!signup) continue;
    items.push({
      raid,
      signup: { ...signup, grammaticalGender: profile.grammaticalGender },
    });
  }
  return items.sort((a, b) =>
    `${b.raid.date} ${b.raid.time}`.localeCompare(
      `${a.raid.date} ${a.raid.time}`,
    ),
  );
}

export async function syncRaidSignupGenderForProfile(
  profile: Pick<
    DashboardProfile,
    "profileId" | "provider" | "providerUserId" | "grammaticalGender"
  >,
  limit = 120,
) {
  if (!profile?.profileId || !hasRaidStorage())
    return { updatedRaids: 0, updatedSignups: 0 };

  const raids = await listRaids(Math.max(20, Math.min(120, limit)));
  let updatedRaids = 0;
  let updatedSignups = 0;
  const discordId =
    profile.provider === "discord" &&
    /^\d{16,25}$/.test(profile.providerUserId || "")
      ? profile.providerUserId
      : "";

  for (const raid of raids) {
    if (
      raid.status !== "published" ||
      isRaidClosed(raid) ||
      !raid.signups.length
    )
      continue;
    let changed = false;
    const nextSignups = raid.signups.map((signup) => {
      const matches =
        signup.profileId === profile.profileId ||
        Boolean(discordId && signup.discordId === discordId);
      if (!matches || signup.grammaticalGender === profile.grammaticalGender)
        return signup;
      changed = true;
      updatedSignups += 1;
      return {
        ...signup,
        profileId: signup.profileId || profile.profileId,
        grammaticalGender: profile.grammaticalGender,
        updatedAt: new Date().toISOString(),
      };
    });

    if (!changed) continue;
    await firebaseWrite(
      "raid",
      `raid:${raid.id}:gender-sync`,
      async () => {
        await getFirebaseAdminDb().collection(RAID_COLLECTION).doc(raid.id).set(
          {
            signups: nextSignups,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        clearRaidRuntimeCaches(raid.id);
      },
      {
        timeoutMs: 3_000,
        logEvent: "raids.gender_sync_write_failed",
        fallback: () => undefined,
      },
    );
    updatedRaids += 1;
  }

  return { updatedRaids, updatedSignups };
}

export type RaidSignupAccountCleanupTarget = Pick<
  DashboardProfile,
  "profileId" | "provider" | "providerUserId" | "characters"
>;

function cleanupDiscordIdsFromTargets(targets: RaidSignupAccountCleanupTarget[], extraDiscordUserIds: Iterable<unknown> = []) {
  const ids = new Set<string>();
  for (const value of extraDiscordUserIds) {
    const id = String(value || "").trim();
    if (/^\d{16,25}$/.test(id)) ids.add(id);
  }
  for (const profile of targets) {
    const id = String(profile.providerUserId || "").trim();
    if (profile.provider === "discord" && /^\d{16,25}$/.test(id)) ids.add(id);
  }
  return ids;
}

function cleanupProfileIdsFromTargets(targets: RaidSignupAccountCleanupTarget[]) {
  return new Set(
    targets
      .map((profile) => String(profile.profileId || "").trim())
      .filter((profileId) => /^id[a-f0-9]{16,40}$/.test(profileId)),
  );
}

function cleanupCharacterKeysFromTargets(targets: RaidSignupAccountCleanupTarget[]) {
  const keys = new Set<string>();
  for (const profile of targets) {
    for (const character of profile.characters || []) {
      const direct = normalizeCharacterKey(character.key);
      if (direct) keys.add(direct);

      const region = character.region || "eu";
      const realmValues = [character.realmSlug, character.realmName].filter(Boolean);
      const nameValues = [character.normalizedName, character.name].filter(Boolean);
      for (const realm of realmValues) {
        for (const name of nameValues) {
          const key = buildBattleNetCharacterKey(region, realm, name);
          if (key) keys.add(key);
        }
      }
    }
  }
  return keys;
}

function signupMatchesAccountCleanupTarget(
  signup: RaidSignup,
  filters: { profileIds: Set<string>; discordUserIds: Set<string>; characterKeys: Set<string> },
) {
  const profileId = String(signup.profileId || "").trim();
  if (profileId && filters.profileIds.has(profileId)) return true;

  const discordId = String(signup.discordId || "").trim();
  if (discordId && filters.discordUserIds.has(discordId)) return true;

  const characterKey = normalizeCharacterKey(signup.characterKey);
  if (characterKey && filters.characterKeys.has(characterKey)) return true;

  return false;
}

export async function removeRaidSignupsForAccounts(input: {
  profiles?: RaidSignupAccountCleanupTarget[];
  discordUserIds?: Iterable<unknown>;
  limit?: unknown;
  dryRun?: boolean;
  syncDiscord?: boolean;
  reason?: string;
}) {
  const profiles = Array.isArray(input.profiles) ? input.profiles : [];
  const filters = {
    profileIds: cleanupProfileIdsFromTargets(profiles),
    discordUserIds: cleanupDiscordIdsFromTargets(profiles, input.discordUserIds || []),
    characterKeys: cleanupCharacterKeysFromTargets(profiles),
  };

  if (!filters.profileIds.size && !filters.discordUserIds.size && !filters.characterKeys.size) {
    return {
      dryRun: Boolean(input.dryRun),
      scannedRaids: 0,
      changedRaids: 0,
      removedSignups: 0,
      discordSynced: 0,
      discordFailed: 0,
      changedItems: [] as Array<{ raidId: string; title: string; removed: number; remaining: number }>,
    };
  }

  if (!hasRaidStorage()) {
    return {
      dryRun: Boolean(input.dryRun),
      scannedRaids: 0,
      changedRaids: 0,
      removedSignups: 0,
      discordSynced: 0,
      discordFailed: 0,
      changedItems: [] as Array<{ raidId: string; title: string; removed: number; remaining: number }>,
    };
  }

  const parsedLimit = Number(input.limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(500, Math.floor(parsedLimit))
    : Math.max(80, Math.min(300, Number(process.env.RAID_ACCOUNT_CLEANUP_SCAN_LIMIT || 250) || 250));

  const db = getFirebaseAdminDb();
  let snapshot: any;
  try {
    snapshot = await db.collection(RAID_COLLECTION).orderBy("date", "desc").limit(safeLimit).get();
  } catch {
    snapshot = await db.collection(RAID_COLLECTION).limit(safeLimit).get();
  }

  const changed: Array<{ ref: any; raid: RaidItem; nextSignups: RaidSignup[]; removed: RaidSignup[] }> = [];
  for (const doc of snapshot.docs as Array<{ id: string; ref: any; data: () => Record<string, unknown> | undefined }>) {
    const raid = normalizeRaid(doc.id, doc.data() || {});
    if (!raid.signups.length) continue;

    const removed = raid.signups.filter((signup) => signupMatchesAccountCleanupTarget(signup, filters));
    if (!removed.length) continue;

    changed.push({
      ref: doc.ref,
      raid,
      removed,
      nextSignups: normalizeRaidSignupNumbers(
        raid.signups.filter((signup) => !signupMatchesAccountCleanupTarget(signup, filters)),
      ),
    });
  }

  const changedItems = changed.map((item) => ({
    raidId: item.raid.id,
    title: raidTitle(item.raid),
    removed: item.removed.length,
    remaining: item.nextSignups.length,
  }));
  const removedSignups = changed.reduce((sum, item) => sum + item.removed.length, 0);

  if (input.dryRun || !changed.length) {
    return {
      dryRun: Boolean(input.dryRun),
      scannedRaids: snapshot.docs.length,
      changedRaids: changed.length,
      removedSignups,
      discordSynced: 0,
      discordFailed: 0,
      changedItems: changedItems.slice(0, 200),
    };
  }

  await firebaseWrite(
    "raid",
    `raids:account-cleanup:${Array.from(filters.discordUserIds).join(",") || Array.from(filters.profileIds).join(",")}`,
    async () => {
      for (let index = 0; index < changed.length; index += 350) {
        const batch = db.batch();
        for (const item of changed.slice(index, index + 350)) {
          batch.set(
            item.ref,
            {
              signups: item.nextSignups,
              updatedAt: FieldValue.serverTimestamp(),
              accountCleanup: {
                reason: input.reason || "account_cleanup",
                removedSignups: item.removed.length,
                updatedAt: FieldValue.serverTimestamp(),
              },
            },
            { merge: true },
          );
        }
        await batch.commit();
      }
      for (const item of changed) clearRaidRuntimeCaches(item.raid.id);
    },
    {
      timeoutMs: 20_000,
      logEvent: "raids.account_cleanup_write_failed",
      fallback: () => undefined,
    },
  );

  let discordSynced = 0;
  let discordFailed = 0;
  if (input.syncDiscord !== false) {
    const discordSyncLimit = Math.max(0, Math.min(50, Number(process.env.RAID_ACCOUNT_CLEANUP_DISCORD_SYNC_LIMIT || 20) || 20));
    for (const item of changed.slice(0, discordSyncLimit)) {
      const nextRaid = { ...item.raid, signups: item.nextSignups, updatedAt: new Date().toISOString() };
      if (!nextRaid.channelId || !nextRaid.messageId || nextRaid.discordDeletedAt) continue;
      try {
        await publishOrUpdateRaid(nextRaid, nextRaid.channelId);
        discordSynced += 1;
      } catch (error) {
        discordFailed += 1;
        console.warn("[raids] Discord sync after account cleanup failed", {
          raidId: nextRaid.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    dryRun: false,
    scannedRaids: snapshot.docs.length,
    changedRaids: changed.length,
    removedSignups,
    discordSynced,
    discordFailed,
    changedItems: changedItems.slice(0, 200),
  };
}

function cleanRaidId(value: unknown) {
  const text = cleanString(value, 80);
  return /^[A-Za-z0-9_-]{8,80}$/.test(text) ? text : "";
}

export function formRaidPayload(
  form: FormData,
  user: DashboardSession,
  profile?: DashboardProfile | null,
) {
  const compositionText = cleanString(form.get("composition"), 40);
  const compositionParts = compositionText.match(
    /(\d+)\s*[\/\\|:-]\s*(\d+)\s*[\/\\|:-]\s*(\d+)/,
  );
  const composition = compositionParts
    ? {
        tanks: Number(compositionParts[1]),
        healers: Number(compositionParts[2]),
        dps: Number(compositionParts[3]),
      }
    : {
        tanks: Number(form.get("tanks") || 2),
        healers: Number(form.get("healers") || 2),
        dps: Number(form.get("dps") || 6),
      };

  const difficulty = cleanDifficulty(form.get("difficulty"));
  const imageUrl = cleanRaidImageUrl(form.get("imageUrl"));
  const thumbnailUrl = cleanRaidImageUrl(form.get("thumbnailUrl"));
  const registrationLockEnabled = cleanBoolean(
    form.get("registrationLockEnabled"),
  );
  const registrationLockMinutesBefore = registrationLockEnabled
    ? cleanRegistrationLockMinutes(form.get("registrationLockMinutesBefore"))
    : null;

  return {
    title: cleanString(form.get("title"), 120) || "Рейд",
    difficulty,
    date: cleanString(form.get("date"), 20),
    time: cleanString(form.get("time"), 20),
    description:
      cleanString(form.get("description"), 4096) ||
      "Будьте готові до рейду та перевірте спорядження заздалегідь.",
    minItemLevel: cleanOptionalItemLevel(form.get("minItemLevel")),
    minItemLevelRequired: cleanBoolean(form.get("minItemLevelRequired")),
    maxPlayers: cleanOptionalMaxPlayers(form.get("maxPlayers")),
    registrationLockEnabled,
    registrationLockMinutesBefore,
    imageUrl,
    thumbnailUrl:
      thumbnailUrl || resolveRaidThumbnailUrl({ difficulty, imageUrl }),
    mentionRoleIds: cleanSnowflakeIds(form.getAll("mentionRoleIds"), 20),
    createdByDiscordId: user.provider === "discord" ? user.id : "",
    createdByName: profile
      ? getProfilePublicName(profile)
      : user.name || user.login || "Raid Lead",
    createdByMain: profileMainLabel(profile),
    raidLeaderName: cleanString(form.get("raidLeaderName"), 120) || null,
    consumables: cleanConsumables(form.get("consumables")),
    lootMode: cleanLootMode(form.get("lootMode")),
    composition: normalizeComposition(composition),
    channelId: cleanSnowflake(form.get("channelId")),
  };
}

function isValidRaidDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isValidRaidTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function validateRaidPayload(
  payload: ReturnType<typeof formRaidPayload>,
  existingRaid?: RaidItem | null,
) {
  if (payload.title.length < 2) throw new Error("Вкажи назву рейду.");
  if (!isValidRaidDate(payload.date))
    throw new Error("Вкажи коректну дату рейду.");
  if (!isValidRaidTime(payload.time))
    throw new Error("Вкажи коректний час рейду.");
  if (!payload.description.trim())
    throw new Error("Додай короткий опис рейду.");
  if (payload.minItemLevelRequired && !payload.minItemLevel)
    throw new Error("Щоб блокувати запис за item level, спочатку вкажи мінімальний item level.");

  const limit = raidRegistrationLimit({ maxPlayers: payload.maxPlayers });
  const activeCount = existingRaid ? raidActiveRosterSize(existingRaid) : 0;
  if (limit !== null && activeCount > limit) {
    throw new Error(
      `Ліміт гравців не може бути меншим за поточний активний запис (${activeCount}). Спочатку закрий зайві записи або збільш ліміт.`,
    );
  }
}

export async function saveRaidFromForm(
  form: FormData,
  user: DashboardSession,
  profile?: DashboardProfile | null,
) {
  if (!hasRaidStorage())
    throw new Error("Збереження рейдів тимчасово недоступне.");

  const raidId = cleanRaidId(form.get("raidId"));
  const payload = formRaidPayload(form, user, profile);
  return firebaseWrite(
    "raid",
    raidId ? `raid:${raidId}:save` : "raid:new:save",
    async () => {
      const db = getFirebaseAdminDb();
      const ref = raidId
        ? db.collection(RAID_COLLECTION).doc(raidId)
        : db.collection(RAID_COLLECTION).doc();
      const snapshot = await ref.get();
      const existingRaid = snapshot.exists
        ? normalizeRaid(snapshot.id, snapshot.data() || {})
        : null;
      validateRaidPayload(payload, existingRaid);
      const nextStatus = snapshot.exists
        ? existingRaid?.status || "draft"
        : "draft";
      const reminderScheduleChanged = Boolean(
        existingRaid &&
          (existingRaid.date !== payload.date ||
            existingRaid.time !== payload.time ||
            cleanSnowflake(existingRaid.channelId) !== cleanSnowflake(payload.channelId)),
      );

      await ref.set(
        {
          ...payload,
          status: nextStatus,
          ...(reminderScheduleChanged
            ? {
                reminderChannelId: null,
                reminderMessageId: null,
                reminderSentAt: null,
                reminderDeletedAt: null,
                reminderClaimedAt: null,
              }
            : {}),
          ...(nextStatus === "closed"
            ? {}
            : { closedAt: null, closedReason: null }),
          updatedAt: FieldValue.serverTimestamp(),
          ...(snapshot.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp(), signups: [] }),
        },
        { merge: true },
      );

      if (
        reminderScheduleChanged &&
        existingRaid?.reminderMessageId &&
        (existingRaid.reminderChannelId || existingRaid.channelId)
      ) {
        await deleteDiscordRaidMessage({
          ref: {
            channelId: existingRaid.reminderChannelId || existingRaid.channelId || "",
            messageId: existingRaid.reminderMessageId,
          },
          auditReason: `Raid schedule changed; remove stale reminder: ${ref.id}`,
        }).catch((error) => {
          if (!isMissingDiscordMessageError(error)) {
            console.warn("[raids] Failed to remove stale reminder after schedule change", {
              raidId: ref.id,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        });
      }

      const saved = await ref.get();
      clearRaidRuntimeCaches(ref.id);
      return normalizeRaid(ref.id, saved.data() || {});
    },
    { timeoutMs: 6_000, logEvent: "raids.save_write_failed" },
  );
}

function dateTimeLabel(raid: Pick<RaidItem, "date" | "time">) {
  if (!raid.date && !raid.time) return "Дата уточнюється";
  return [raid.date || "Дата уточнюється", raid.time || ""]
    .filter(Boolean)
    .join(" ");
}

function discordTimestamp(
  raid: Pick<RaidItem, "date" | "time">,
  style: "t" | "T" | "d" | "D" | "f" | "F" | "R" = "F",
) {
  const startsAt = raidDateTimeToUtcMs(raid);
  if (startsAt === null) return null;
  return `<t:${Math.floor(startsAt / 1000)}:${style}>`;
}

function discordTimestampLabel(value?: string | null) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "—";
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:f> • <t:${seconds}:R>`;
}
function discordDateTimeLabel(raid: Pick<RaidItem, "date" | "time">) {
  const full = discordTimestamp(raid, "F");
  const relative = discordTimestamp(raid, "R");
  if (!full || !relative) return dateTimeLabel(raid);
  return `${full}
${relative}`;
}

function compositionLongLabel(raid: RaidAutoInput) {
  const composition = raidAutoComposition(raid);
  return `${composition.tanks} танки / ${composition.healers} хіли / ${composition.dps} дд`;
}

function raidSignupNumberLabel(item?: Pick<RaidSignup, "signupNumber"> | null) {
  const number = cleanOptionalSignupNumber(item?.signupNumber);
  return number ? `#${number}` : null;
}

function truncateDiscordField(value: string, max = 1024) {
  const text = value.trim();
  return text.length <= max
    ? text
    : `${text.slice(0, Math.max(0, max - 20)).trimEnd()}\n…`;
}

function signupSort(a: RaidSignup, b: RaidSignup) {
  const aNumber =
    cleanOptionalSignupNumber(a.signupNumber) || Number.MAX_SAFE_INTEGER;
  const bNumber =
    cleanOptionalSignupNumber(b.signupNumber) || Number.MAX_SAFE_INTEGER;
  return (
    roleSortWeight(a) - roleSortWeight(b) ||
    aNumber - bNumber ||
    String(a.characterName || a.discordName).localeCompare(
      String(b.characterName || b.discordName),
      "uk",
    )
  );
}

function rosterForGroups(raid: Pick<RaidItem, "signups">) {
  const active = raid.signups
    .filter((item) => isActiveSignupStatus(item.status))
    .sort(signupSort);
  // Один прохід замість п'яти: функція викликається на кожну побудову
  // складу, а склад перебудовується на кожен підпис у Discord.
  const tanks: RaidSignup[] = [];
  const healers: RaidSignup[] = [];
  const dps: RaidSignup[] = [];
  const late: RaidSignup[] = [];
  const tentative: RaidSignup[] = [];
  for (const item of active) {
    if (item.role === "tank") tanks.push(item);
    else if (item.role === "healer") healers.push(item);
    else if (item.role === "dps") dps.push(item);
    if (item.status === "late") late.push(item);
    else if (item.status === "tentative") tentative.push(item);
  }
  return { tanks, healers, dps, late, tentative, active };
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
      return true;
    }
  }
  return false;
}

function selectTanksForComposition(
  tanks: RaidSignup[],
  limit: number,
  settings?: RaidBenchPrioritySettings | null,
) {
  return takeClassBalanced(tanks, limit, settings);
}

function selectHealersForComposition(
  healers: RaidSignup[],
  limit: number,
  settings?: RaidBenchPrioritySettings | null,
) {
  return takeClassBalanced(healers, limit, settings);
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
  settings?: RaidBenchPrioritySettings | null,
) {
  if (!pool.length) return null;
  const bestWeight = Math.min(...pool.map((item) => raidBenchSelectionWeight(item, settings)));
  const index = pool.findIndex(
    (item) => raidBenchSelectionWeight(item, settings) === bestWeight && match(item),
  );
  if (index < 0) return null;
  const [picked] = pool.splice(index, 1);
  return picked || null;
}

function selectDpsForComposition(
  dps: RaidSignup[],
  limit: number,
  settings?: RaidBenchPrioritySettings | null,
) {
  const pool = [...dps].sort((a, b) => signupCompositionOrder(a, b, settings));
  const selected: RaidSignup[] = [];

  for (const buff of RAID_CRITICAL_BUFFS) {
    if (selected.length >= limit) break;
    const picked = pickBuffProvider(pool, buff.match, settings);
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
        raidBenchSelectionWeight(a, settings) -
          raidBenchSelectionWeight(b, settings) ||
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

function signupRosterOrder(a: RaidSignup, b: RaidSignup) {
  const aNumber =
    cleanOptionalSignupNumber(a.signupNumber) || Number.MAX_SAFE_INTEGER;
  const bNumber =
    cleanOptionalSignupNumber(b.signupNumber) || Number.MAX_SAFE_INTEGER;
  const aPriority = a.verifiedGuild === false ? 1 : 0;
  const bPriority = b.verifiedGuild === false ? 1 : 0;
  const aSigned = Date.parse(a.signedAt || a.updatedAt || "");
  const bSigned = Date.parse(b.signedAt || b.updatedAt || "");
  const signedDelta =
    (Number.isFinite(aSigned) ? aSigned : Number.MAX_SAFE_INTEGER) -
    (Number.isFinite(bSigned) ? bSigned : Number.MAX_SAFE_INTEGER);
  return (
    aPriority - bPriority ||
    aNumber - bNumber ||
    signedDelta ||
    String(a.characterName || a.discordName).localeCompare(
      String(b.characterName || b.discordName),
      "uk",
    )
  );
}

function signupCompositionOrder(
  a: RaidSignup,
  b: RaidSignup,
  settings?: RaidBenchPrioritySettings | null,
) {
  return (
    raidBenchSelectionWeight(a, settings) -
      raidBenchSelectionWeight(b, settings) || signupRosterOrder(a, b)
  );
}

function takeClassBalanced(
  candidates: RaidSignup[],
  limit: number,
  settings?: RaidBenchPrioritySettings | null,
) {
  const pool = [...candidates].sort((a, b) => signupCompositionOrder(a, b, settings));
  const selected: RaidSignup[] = [];
  const classCounts = new Map<string, number>();

  while (selected.length < limit && pool.length) {
    pool.sort(
      (a, b) =>
        raidBenchSelectionWeight(a, settings) -
          raidBenchSelectionWeight(b, settings) ||
        (classCounts.get(signupClassKey(a)) || 0) -
          (classCounts.get(signupClassKey(b)) || 0) ||
        signupRosterOrder(a, b),
    );
    const member = pool.shift();
    if (!member) break;
    selected.push(member);
    const key = signupClassKey(member);
    classCounts.set(key, (classCounts.get(key) || 0) + 1);
  }

  return selected;
}

function raidLayoutTargetSize(raid: RaidAutoInput) {
  const limit = raidRegistrationLimit(raid);
  return limit ?? raidActiveRosterSize(raid);
}

function createEmptyRaidBench(
  members: RaidSignup[] = [],
  settings?: RaidBenchPrioritySettings | null,
): RaidBench {
  const sortedMembers = [...members].sort(
    (a, b) =>
      raidBenchSelectionWeight(b, settings) -
        raidBenchSelectionWeight(a, settings) || signupSort(a, b),
  );
  // Один прохід замість п'яти filter() по тому самому відсортованому масиву.
  const tanks: RaidSignup[] = [];
  const healers: RaidSignup[] = [];
  const dps: RaidSignup[] = [];
  const late: RaidSignup[] = [];
  const tentative: RaidSignup[] = [];
  for (const item of sortedMembers) {
    if (item.role === "tank") tanks.push(item);
    else if (item.role === "healer") healers.push(item);
    else if (item.role === "dps") dps.push(item);
    if (item.status === "late") late.push(item);
    else if (item.status === "tentative") tentative.push(item);
  }
  return { members: sortedMembers, tanks, healers, dps, late, tentative };
}

function assignTankToParty(parties: RaidParty[], tank: RaidSignup) {
  const number = cleanOptionalSignupNumber(tank.signupNumber);
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
  if (target) {
    target.tank = tank;
    return true;
  }
  return placeFlexMember(parties, tank);
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
    const index = distinctIndex >= 0 ? distinctIndex : 0;
    const [healer] = pool.splice(index, 1);
    if (!healer) continue;
    party.healer = healer;
    used.add(signupClassKey(healer));
    usedByParity.set(parity, used);
  }

  return pool;
}

function assignDpsToParties(parties: RaidParty[], dps: RaidSignup[]) {
  const pool = [...dps].sort(signupRosterOrder);
  for (const member of pool) {
    const memberClass = signupClassKey(member);
    const target = parties
      .filter((party) => partyCapacity(party) > 0)
      .sort((a, b) => {
        const aHasClass =
          a.members
            .concat(a.dps)
            .some((item) => signupClassKey(item) === memberClass) ||
          signupClassKey(a.tank) === memberClass ||
          signupClassKey(a.healer) === memberClass;
        const bHasClass =
          b.members
            .concat(b.dps)
            .some((item) => signupClassKey(item) === memberClass) ||
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

function finalizeParties(parties: RaidParty[]) {
  for (const party of parties) {
    party.members = [party.tank, party.healer, ...party.dps].filter(
      Boolean,
    ) as RaidSignup[];
    party.late = party.members.filter((item) => item.status === "late");
  }
  return parties.sort((a, b) => a.index - b.index);
}

export function raidGroupLayoutSlotCounts(
  layout: Pick<RaidGroupLayout, "parties">,
): RaidLayoutCounts {
  // Один обхід груп замість трьох проходів по parties плюс flatMap,
  // який щоразу створював новий масив усіх учасників рейду.
  let tanks = 0;
  let healers = 0;
  let dps = 0;
  let late = 0;
  let tentative = 0;
  for (const party of layout.parties) {
    if (party.tank) tanks += 1;
    if (party.healer) healers += 1;
    dps += party.dps.length;
    for (const item of party.members) {
      if (item.status === "late") late += 1;
      else if (item.status === "tentative") tentative += 1;
    }
  }
  return { roster: tanks + healers + dps, tanks, healers, dps, late, tentative };
}

export function raidGroupLayoutRoleCounts(
  layout: Pick<RaidGroupLayout, "parties">,
): RaidLayoutCounts {
  let roster = 0;
  let tanks = 0;
  let healers = 0;
  let dps = 0;
  let late = 0;
  let tentative = 0;
  for (const party of layout.parties) {
    for (const item of party.members) {
      roster += 1;
      if (item.role === "tank") tanks += 1;
      else if (item.role === "healer") healers += 1;
      else if (item.role === "dps") dps += 1;
      if (item.status === "late") late += 1;
      else if (item.status === "tentative") tentative += 1;
    }
  }
  return { roster, tanks, healers, dps, late, tentative };
}

export function buildRaidGroupLayout(raid: RaidAutoInput): RaidGroupLayout {
  const roster = rosterForGroups(raid);
  const targetSize = raidLayoutTargetSize(raid);
  const composition = raidAutoComposition(raid);
  const benchEnabled = raidRegistrationLimit(raid) !== null;
  const benchPriority = raid.benchPriority || null;
  const groupCount = Math.max(
    1,
    Math.min(
      MAX_RAID_PARTIES,
      Math.ceil(Math.max(1, targetSize) / RAID_PARTY_SIZE),
    ),
  );
  const parties: RaidParty[] = Array.from(
    { length: groupCount },
    (_, index) => ({
      index: index + 1,
      dps: [],
      late: [],
      members: [],
    }),
  );

  const tanks = [...roster.tanks].sort((a, b) =>
    signupCompositionOrder(a, b, benchPriority),
  );
  const healers = [...roster.healers].sort((a, b) =>
    signupCompositionOrder(a, b, benchPriority),
  );
  const dps = [...roster.dps].sort((a, b) =>
    signupCompositionOrder(a, b, benchPriority),
  );

  const selectedTanks = selectTanksForComposition(
    tanks,
    benchEnabled
      ? composition.tanks
      : Math.max(composition.tanks, Math.min(2, tanks.length)),
    benchPriority,
  );
  // Відсів «хто не потрапив у склад» раніше йшов через Array.includes,
  // тобто повний перебір вибраних на кожного кандидата — O(n²) на кожній
  // перебудові складу. Set дає ту саму семантику (звірка за посиланням)
  // за один прохід.
  const selectedTankSet = new Set(selectedTanks);
  const surplusTanks = tanks.filter((item) => !selectedTankSet.has(item));
  const selectedHealers = selectHealersForComposition(
    healers,
    benchEnabled
      ? composition.healers
      : Math.max(composition.healers, healers.length),
    benchPriority,
  );
  const selectedHealerSet = new Set(selectedHealers);
  const surplusHealers = healers.filter((item) => !selectedHealerSet.has(item));
  const selectedDps = benchEnabled
    ? selectDpsForComposition(dps, composition.dps, benchPriority)
    : selectDpsForComposition(dps, dps.length, benchPriority);
  const selectedDpsSet = new Set(selectedDps);
  const surplusDps = dps.filter((item) => !selectedDpsSet.has(item));

  const selectedMembers = [
    ...selectedTanks,
    ...selectedHealers,
    ...selectedDps,
  ];

  for (const tank of selectedTanks) assignTankToParty(parties, tank);
  const unplacedHealers = assignHealersToParties(parties, selectedHealers);
  for (const healer of unplacedHealers) placeFlexMember(parties, healer);
  assignDpsToParties(parties, selectedDps);

  const benchMembers = benchEnabled
    ? [...surplusTanks, ...surplusHealers, ...surplusDps]
    : [];
  if (!benchEnabled) {
    for (const member of [...surplusTanks, ...surplusHealers])
      placeFlexMember(parties, member);
  }

  const dpsSlotsFilled = selectedDps.length;
  const missingBuffs = missingCriticalBuffs(selectedMembers);
  const safeDpsCapacity = Math.max(
    0,
    Math.min(roster.dps.length, roster.healers.length * 5),
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

  return {
    parties: finalizeParties(parties),
    bench: createEmptyRaidBench(benchMembers, benchPriority),
    composition,
    targetSize,
    benchEnabled,
    warnings,
    missingCriticalBuffs: missingBuffs,
  };
}

export function buildRaidParties(raid: RaidAutoInput): RaidParty[] {
  return buildRaidGroupLayout(raid).parties;
}

export function buildRaidBench(raid: RaidAutoInput): RaidBench {
  return buildRaidGroupLayout(raid).bench;
}

function isSignupBelowRaidMinimum(
  item?: RaidSignup | null,
  raid?: Pick<RaidItem, "minItemLevel"> | null,
) {
  const minimum = Number(raid?.minItemLevel || 0);
  const current = Number(item?.itemLevel || 0);
  return Boolean(
    item &&
    item.status !== "skipped" &&
    Number.isFinite(minimum) &&
    minimum > 0 &&
    Number.isFinite(current) &&
    current > 0 &&
    current < minimum,
  );
}

function isSignupNonGuildCharacter(
  item?: Pick<RaidSignup, "verifiedGuild"> | null,
) {
  return Boolean(item && item.verifiedGuild === false);
}

function discordSignupMarkers(
  item?: RaidSignup | null,
  raid?: Pick<RaidItem, "minItemLevel"> | null,
) {
  if (!item) return "";
  const markers = [
    isSignupBelowRaidMinimum(item, raid) ? "⚠️" : null,
    item.status === "tentative" ? "❓" : null,
    item.status === "late" ? "🕒" : null,
    isSignupNonGuildCharacter(item) ? "🤝" : null,
  ].filter(Boolean);
  return markers.length ? `${markers.join(" ")} ` : "";
}

function compactSignupDiscordLine(
  item?: RaidSignup | null,
  raid?: Pick<RaidItem, "minItemLevel"> | null,
  max = 48,
) {
  if (!item) return "—";
  const base = item.characterName || item.discordName || "Гравець";
  const ilvl = item.itemLevel ? ` • ${item.itemLevel}` : "";
  const number = raidSignupNumberLabel(item);
  const markers = discordSignupMarkers(item, raid).trim();
  const value = [
    number || null,
    markers || null,
    base,
  ]
    .filter(Boolean)
    .join(" • ") + ilvl;
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function compactSignupDiscordLines(
  items: RaidSignup[],
  raid?: Pick<RaidItem, "minItemLevel"> | null,
  max = 44,
) {
  return items.length
    ? items
        .map((item) => compactSignupDiscordLine(item, raid, max))
        .join("\n")
    : "—";
}

function partyDiscordText(
  party: RaidParty,
  raid?: Pick<RaidItem, "minItemLevel"> | null,
) {
  const tanks = [
    party.tank,
    ...party.dps.filter((item) => item.role === "tank"),
  ].filter(Boolean) as RaidSignup[];
  const healers = [
    party.healer,
    ...party.dps.filter((item) => item.role === "healer"),
  ].filter(Boolean) as RaidSignup[];
  const dps = party.dps.filter((item) => item.role === "dps");
  const sections = [
    tanks.length
      ? `**Танк**\n${compactSignupDiscordLines(tanks, raid, 42)}`
      : null,
    healers.length
      ? `**Хіл**\n${compactSignupDiscordLines(healers, raid, 42)}`
      : null,
    dps.length ? `**ДД**\n${compactSignupDiscordLines(dps, raid, 40)}` : null,
  ].filter(Boolean) as string[];

  return truncateDiscordField(
    sections.length ? sections.join("\n\n") : "—",
    700,
  );
}

function raidBenchDiscordText(
  bench: RaidBench,
  raid?: Pick<RaidItem, "minItemLevel"> | null,
) {
  if (!bench.members.length) return "—";
  const sections = [
    bench.tanks.length
      ? `**Танки**\n${compactSignupDiscordLines(bench.tanks, raid, 42)}`
      : null,
    bench.healers.length
      ? `**Хіли**\n${compactSignupDiscordLines(bench.healers, raid, 42)}`
      : null,
    bench.dps.length
      ? `**ДД**\n${compactSignupDiscordLines(bench.dps, raid, 40)}`
      : null,
  ].filter(Boolean) as string[];

  return truncateDiscordField(sections.join("\n\n"), 900);
}

function twoColumnPartyDiscordFields(
  parties: RaidParty[],
  raid?: Pick<RaidItem, "minItemLevel"> | null,
) {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  for (let index = 0; index < parties.length; index += 2) {
    const left = parties[index];
    const right = parties[index + 1];
    if (left) {
      fields.push({
        name: `Паті ${left.index}`,
        value: partyDiscordText(left, raid),
        inline: true,
      });
    }
    if (right) {
      fields.push({
        name: `Паті ${right.index}`,
        value: partyDiscordText(right, raid),
        inline: true,
      });
    }
    fields.push({ name: "\u200B", value: "\u200B", inline: true });
  }
  return fields;
}

function compactDiscordFields(
  fields: Array<{ name: string; value: string; inline?: boolean }>,
  maxTotal = 5600,
) {
  const result: Array<{ name: string; value: string; inline?: boolean }> = [];
  let total = 0;
  for (const field of fields.slice(0, 25)) {
    const name = truncateDiscordField(field.name, 256);
    const value = truncateDiscordField(field.value, 1024);
    const nextTotal = total + name.length + value.length;
    if (nextTotal > maxTotal) break;
    result.push({ name, value, inline: field.inline });
    total = nextTotal;
  }
  return result;
}

export function buildRaidDiscordPayload(raid: RaidItem) {
  const averageItemLevel = raidAverageItemLevel(raid);
  const layout = buildRaidGroupLayout(raid);
  const slotCounts = raidGroupLayoutSlotCounts(layout);
  const composition = layout.composition;
  const allParties = layout.parties;
  const parties = allParties.slice(0, 8);
  const bench = layout.bench;
  const warnings = layout.warnings;
  const closed = isRaidClosed(raid);
  const omittedParties = allParties.length - parties.length;
  const registrationLimit = raidRegistrationLimit(raid);
  const displayCapacity = layout.targetSize || registrationLimit || raidAutoCapacity(raid);
  const rosterValue = [
    `${slotCounts.roster} / ${displayCapacity}`,
    compositionLongLabel(raid),
    registrationLimit
      ? `Вільно місць: ${Math.max(0, displayCapacity - slotCounts.roster)}`
      : null,
    bench.members.length ? `🪑 Лава запасних: ${bench.members.length}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const minItemLevelPolicyText = raid.minItemLevelRequired
    ? "⛔ Запис блокується, якщо персонаж нижче порогу"
    : "⚠️ Лише попередження, запис не блокується";
  const minItemLevelValue = raid.minItemLevel
    ? `${raid.minItemLevel}\n${minItemLevelPolicyText}`
    : null;
  const description = truncateDiscordField(raid.description, 4096);
  const rawFields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "📌 Статус",
      value: closed
        ? [
            "🔒 Запис закрито",
            raid.closedAt
              ? `Закрито: ${discordTimestampLabel(raid.closedAt)}`
              : null,
            raid.closedReason === "manual"
              ? "Причина: вручну"
              : "Причина: авто lifecycle",
          ]
            .filter(Boolean)
            .join("\n")
        : raid.status === "draft"
          ? "Чернетка"
          : "Запис відкрито",
      inline: true,
    },
    {
      name: "📅 Дата",
      value: discordDateTimeLabel(raid),
      inline: true,
    },
    {
      name: "👤 Створив",
      value: raid.createdByName,
      inline: true,
    },
    ...(raid.raidLeaderName
      ? [{ name: "🧭 РЛ", value: raid.raidLeaderName, inline: true }]
      : []),
    {
      name: "🧪 Розхідники",
      value: raidConsumablesLabel(raid.consumables),
      inline: true,
    },
    {
      name: "🎁 Лут",
      value: raidLootLabel(raid.lootMode),
      inline: true,
    },
    {
      name: "👥 Склад рейду",
      value: rosterValue,
      inline: true,
    },
    ...(minItemLevelValue
      ? [{ name: "👙 Мін. ilvl", value: minItemLevelValue, inline: true }]
      : []),
    ...(averageItemLevel
      ? [
          {
            name: "📊 Середній ilvl",
            value: `${averageItemLevel}`,
            inline: true,
          },
        ]
      : []),
    {
      name: "🔐 Блокування запису",
      value: raidRegistrationLockDiscordValue(raid),
      inline: true,
    },
    {
      name: "⚔️ Ролі",
      value: `${slotCounts.tanks}/${composition.tanks} танки • ${slotCounts.healers}/${composition.healers} хіли • ${slotCounts.dps}/${composition.dps} дд`,
      inline: false,
    },
    ...(warnings.length
      ? [
          {
            name: "⚠️ Валідація складу",
            value: truncateDiscordField(warnings.map((item) => `• ${item}`).join("\n"), 900),
            inline: false,
          },
        ]
      : []),
    ...twoColumnPartyDiscordFields(parties, raid),
    ...(bench.members.length
      ? [
          {
            name: "🪑 Лава запасних",
            value: raidBenchDiscordText(bench, raid),
            inline: false,
          },
        ]
      : []),
    ...(omittedParties > 0
      ? [
          {
            name: "Ще групи",
            value: `Ще ${omittedParties} паті доступно на сторінці рейду:\n${dashboardRaidUrl(raid.id)}`,
            inline: false,
          },
        ]
      : []),
  ];
  const fieldsBudget = Math.max(
    1200,
    5800 - description.length - raidTitle(raid).length,
  );
  const fields = compactDiscordFields(rawFields, fieldsBudget);
  const discordAnnouncementImageUrl = cleanUrl(raid.imageUrl);

  const embed = normalizeDiscordEmbed({
    title: closed ? `${raidTitle(raid)} • Запис закрито` : raidTitle(raid),
    url: dashboardRaidUrl(raid.id),
    description,
    color: DIFFICULTY_COLORS[raid.difficulty],
    fields,
    image: discordAnnouncementImageUrl
      ? { url: discordAnnouncementImageUrl }
      : undefined,
    footer: {
      text: closed
        ? "🔒 Запис закрито. Усі Discord-кнопки вимкнені, зміни складу заблоковані."
        : "Склад рейду оновлюється автоматично після кожної заявки.",
    },
    timestamp: new Date().toISOString(),
  });

  return {
    content: "",
    embed,
    mentionRoleIds: raid.mentionRoleIds || [],
  };
}

export function buildRaidAttendanceCustomId(
  raidId: string,
  action: RaidSignupStatus,
) {
  const id = cleanRaidId(raidId);
  const safeAction = cleanSignupStatus(action);
  const customId = `${RAID_ACTION_PREFIX}:${id}:${safeAction}`;
  if (!id || customId.length > 100)
    throw new Error("Некоректний ID рейду для Discord-кнопки.");
  return customId;
}

export function decodeRaidAttendanceCustomId(customId: string) {
  const value = cleanString(customId, 120);
  const match = value.match(
    /^mbv1:raid:([A-Za-z0-9_-]{8,80}):(going|tentative|late|skipped)$/,
  );
  if (!match) return null;
  return { raidId: match[1], action: cleanSignupStatus(match[2]) };
}

export function decodeRaidCharacterSelectCustomId(
  customId: string,
  values?: unknown,
) {
  const value = cleanString(customId, 120);
  const legacyMatch = value.match(
    /^mbv1:rc:([A-Za-z0-9_-]{8,80}):(going|tentative|late|skipped)$/,
  );
  const panelMatch = value.match(
    /^mbv1:rsc:([A-Za-z0-9_-]{8,80}):(going|tentative|late):(tank|healer|dps)$/,
  );
  const match = legacyMatch || panelMatch;
  if (!match) return null;
  const selectedValues = Array.isArray(values) ? values : [];
  const characterKey = cleanString(selectedValues[0], 260);
  if (!characterKey) return null;
  return {
    raidId: match[1],
    action: cleanSignupStatus(match[2]),
    characterKey,
    signupRole: panelMatch ? cleanRoleStrict(panelMatch[3]) : null,
    commit: false,
  };
}

function cleanRaidRoleSelectCharacterKey(value: unknown) {
  const key = cleanString(value, 260);
  return /^[A-Za-z0-9._-]{1,64}$/.test(key) ? key : "";
}

export function buildRaidRoleSelectCustomId(
  raidId: string,
  action: RaidSignupStatus,
  characterKey: string,
) {
  const id = cleanRaidId(raidId);
  const safeAction = cleanSignupStatus(action);
  const safeCharacterKey = cleanRaidRoleSelectCharacterKey(characterKey);
  const customId = `mbv1:rsr:${id}:${safeAction}:${safeCharacterKey}`;
  if (!id || !safeCharacterKey || customId.length > 100)
    throw new Error(
      "Некоректний ID рейду або персонажа для Discord-вибору ролі.",
    );
  return customId;
}

export function decodeRaidRoleSelectCustomId(
  customId: string,
  values?: unknown,
) {
  const value = cleanString(customId, 120);
  const panelMatch = value.match(
    /^mbv1:rsr:([A-Za-z0-9_-]{8,80}):(going|tentative|late):([A-Za-z0-9._-]{1,64})$/,
  );
  const legacyMatch = value.match(
    /^mbv1:rr:([A-Za-z0-9_-]{8,80}):(going|tentative|late):([A-Za-z0-9._-]{1,64})$/,
  );
  const match = panelMatch || legacyMatch;
  if (!match) return null;
  const selectedValues = Array.isArray(values) ? values : [];
  const signupRole = cleanRoleStrict(selectedValues[0]);
  if (!signupRole) return null;
  return {
    raidId: match[1],
    action: cleanSignupStatus(match[2]),
    characterKey: match[3],
    signupRole,
    commit: false,
  };
}

export function buildRaidSignupSubmitCustomId(
  raidId: string,
  action: RaidSignupStatus,
  characterKey: string,
  signupRole: RaidCharacterRole,
) {
  const id = cleanRaidId(raidId);
  const safeAction = cleanSignupStatus(action);
  const safeCharacterKey = cleanRaidRoleSelectCharacterKey(characterKey);
  const safeRole = cleanRoleStrict(signupRole);
  const customId = `mbv1:rss:${id}:${safeAction}:${safeCharacterKey}:${safeRole || "dps"}`;
  if (!id || !safeCharacterKey || customId.length > 100)
    throw new Error(
      "Некоректний ID рейду, персонажа або ролі для Discord-підтвердження.",
    );
  return customId;
}

export function decodeRaidSignupSubmitCustomId(customId: string) {
  const value = cleanString(customId, 120);
  const match = value.match(
    /^mbv1:rss:([A-Za-z0-9_-]{8,80}):(going|tentative|late):([A-Za-z0-9._-]{1,64}):(tank|healer|dps)$/,
  );
  if (!match) return null;
  return {
    raidId: match[1],
    action: cleanSignupStatus(match[2]),
    characterKey: match[3],
    signupRole: cleanRoleStrict(match[4]),
    commit: true,
  };
}

export function buildRaidAttendanceComponents(
  raidId: string,
  options:
    | boolean
    | {
        disabled?: boolean;
        full?: boolean;
        signed?: boolean;
        personalized?: boolean;
        registrationLocked?: boolean;
      } = false,
) {
  const disabled =
    typeof options === "boolean" ? options : Boolean(options.disabled);
  const full = typeof options === "object" && Boolean(options.full);
  const registrationLocked =
    typeof options === "object" && Boolean(options.registrationLocked);
  const personalized =
    typeof options === "object" && Boolean(options.personalized);
  const signed =
    personalized && typeof options === "object" && Boolean(options.signed);

  // Discord рендерить components публічного повідомлення однаково для всіх глядачів.
  // Тому персональний напис “Змінити персонажа” дозволений лише там, де ми точно
  // будуємо приватну/ephemeral відповідь для конкретного користувача. У глобальному
  // embed кнопка лишається нейтральною, а реальний стан перевіряється на сервері.
  const activeJoinDisabled = disabled || registrationLocked;
  const signupLabel = disabled
    ? "Підписатися"
    : registrationLocked
      ? "Запис закрито"
      : signed
        ? "Змінити персонажа"
        : full && personalized
          ? "У лаву запасних"
          : "Підписатися";

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: signupLabel,
          emoji: { name: "✅" },
          custom_id: buildRaidAttendanceCustomId(raidId, "going"),
          disabled: activeJoinDisabled,
        },
        {
          type: 2,
          style: 2,
          label: "50/50",
          emoji: { name: "❓" },
          custom_id: buildRaidAttendanceCustomId(raidId, "tentative"),
          disabled: activeJoinDisabled,
        },
        {
          type: 2,
          style: 2,
          label: "Пропустити",
          emoji: { name: "↩️" },
          custom_id: buildRaidAttendanceCustomId(raidId, "skipped"),
          disabled: activeJoinDisabled,
        },
        {
          type: 2,
          style: 4,
          label: "Затримаюсь",
          emoji: { name: "🕒" },
          custom_id: buildRaidAttendanceCustomId(raidId, "late"),
          disabled: activeJoinDisabled,
        },
      ],
    },
  ];
}

export function buildRaidCharacterSelectCustomId(
  raidId: string,
  action: RaidSignupStatus,
  selectedRole?: RaidCharacterRole | null,
) {
  const id = cleanRaidId(raidId);
  const safeAction = cleanSignupStatus(action);
  const role = cleanRoleStrict(selectedRole);
  const customId =
    role && safeAction !== "skipped"
      ? `mbv1:rsc:${id}:${safeAction}:${role}`
      : `mbv1:rc:${id}:${safeAction}`;
  if (!id || customId.length > 100)
    throw new Error("Некоректний ID рейду для Discord-вибору персонажа.");
  return customId;
}

function raidCharacterOptionLabel(character: ProfileCharacter) {
  const realm = character.realmName || character.realmSlug || "realm";
  const prefix = character.verifiedGuild ? "" : "🤝 ";
  return `${prefix}${character.name} • ${realm}`.slice(0, 100);
}

function raidCharacterOptionDescription(
  character: ProfileCharacter,
  raid?: RaidMinimumPolicy | null,
) {
  const minimumNote = raid
    ? raidSignupCharacterMinimumNote(raid, character)
    : null;
  return (
    [
      minimumNote || null,
      character.verifiedGuild ? "Гільдійний" : "Інший персонаж",
      character.activeSpecName || null,
      character.className || null,
      character.itemLevel ? `${character.itemLevel} ilvl` : null,
    ]
      .filter(Boolean)
      .join(" • ")
      .slice(0, 100) || "Персонаж Battle.net"
  );
}

export function buildRaidCharacterSelectComponents(
  raidId: string,
  action: RaidSignupStatus,
  profile: DashboardProfile,
  selectedCharacterKey?: string | null,
  raid?: RaidMinimumPolicy | null,
  selectedRole?: RaidCharacterRole | null,
) {
  const selectedCharacter = resolveProfileCharacterSelection(
    profile,
    selectedCharacterKey,
  );
  const selectedKey = normalizeCharacterKey(selectedCharacter?.key || "");
  const options = profile.characters
    .map((character, index) => ({ character, index }))
    .filter(
      ({ character }) =>
        !raid || !isRaidSubjectBlockedByMinItemLevel(raid, character),
    )
    .slice(0, 25)
    .map(({ character, index }) => ({
      label:
        `${raid && isRaidSubjectWarnedByMinItemLevel(raid, character) ? "⚠️ " : ""}${raidCharacterOptionLabel(character)}`.slice(
          0,
          100,
        ),
      description: raidCharacterOptionDescription(character, raid),
      value: `c${index}`,
      default: Boolean(
        selectedKey && normalizeCharacterKey(character.key) === selectedKey,
      ),
    }));

  if (!options.length) return [];

  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: buildRaidCharacterSelectCustomId(
            raidId,
            action,
            selectedRole,
          ),
          placeholder:
            action === "skipped"
              ? "Позначити пропуск рейду"
              : "1) Обери персонажа рейду",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
  ];
}

function raidRoleLabel(role: RaidCharacterRole) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  return "ДД / DPS";
}

function raidRoleOptionDescription(role: RaidCharacterRole) {
  if (role === "tank") return "Записати персонажа у колонку Tanks";
  if (role === "healer") return "Записати персонажа у колонку Healers";
  return "Записати персонажа у колонку DPS";
}

function raidRoleSelectOptions(selectedRole?: RaidCharacterRole | null) {
  const roles: Array<{
    role: RaidCharacterRole;
    label: string;
    emoji: string;
  }> = [
    { role: "tank", label: "Танк", emoji: "🛡️" },
    { role: "healer", label: "Хіл", emoji: "💚" },
    { role: "dps", label: "ДД / DPS", emoji: "⚔️" },
  ];

  return roles.map(({ role, label, emoji }) => ({
    label,
    value: role,
    description: raidRoleOptionDescription(role),
    emoji: { name: emoji },
    default: selectedRole === role,
  }));
}

export function buildRaidRoleSelectComponents(
  raidId: string,
  action: RaidSignupStatus,
  characterKey: string,
  selectedRole?: RaidCharacterRole | null,
) {
  const safeCharacterKey = cleanRaidRoleSelectCharacterKey(characterKey);
  if (!safeCharacterKey || action === "skipped") return [];

  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: buildRaidRoleSelectCustomId(
            raidId,
            action,
            safeCharacterKey,
          ),
          placeholder: "2) Обери роль для рейду",
          min_values: 1,
          max_values: 1,
          options: raidRoleSelectOptions(selectedRole),
        },
      ],
    },
  ];
}

function raidCharacterSelectionToken(
  profile: DashboardProfile,
  selectedCharacterKey?: string | null,
) {
  const selected = resolveProfileCharacterSelection(
    profile,
    selectedCharacterKey,
  );
  if (!selected)
    return cleanRaidRoleSelectCharacterKey(selectedCharacterKey || "");
  const selectedKey = normalizeCharacterKey(selected.key);
  const index = profile.characters.findIndex(
    (character) => normalizeCharacterKey(character.key) === selectedKey,
  );
  return index >= 0
    ? `c${index}`
    : cleanRaidRoleSelectCharacterKey(selected.key);
}

function buildDisabledRaidRoleSelectRow(
  raidId: string,
  action: RaidSignupStatus,
) {
  const id = cleanRaidId(raidId);
  const safeAction = cleanSignupStatus(action);
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `mbv1:rsr:${id}:${safeAction}:none`,
        placeholder: "2) Спочатку обери персонажа",
        min_values: 1,
        max_values: 1,
        disabled: true,
        options: raidRoleSelectOptions(null),
      },
    ],
  };
}

export function buildRaidSignupPanelComponents(
  raidId: string,
  action: RaidSignupStatus,
  profile: DashboardProfile,
  selectedCharacterKey?: string | null,
  selectedRole?: RaidCharacterRole | null,
  raid?: RaidMinimumPolicy | null,
) {
  const selectedCharacter = resolveProfileCharacterSelection(
    profile,
    selectedCharacterKey,
  );
  const characterToken = raidCharacterSelectionToken(
    profile,
    selectedCharacterKey,
  );
  const effectiveRole = selectedCharacter
    ? cleanRoleStrict(selectedRole) ||
      resolveRaidSignupRole(profile, selectedCharacter)
    : null;

  const rows: Array<Record<string, unknown>> = [];
  rows.push(
    ...buildRaidCharacterSelectComponents(
      raidId,
      action,
      profile,
      selectedCharacterKey,
      raid,
      effectiveRole,
    ),
  );
  if (selectedCharacter && characterToken) {
    rows.push(
      ...buildRaidRoleSelectComponents(
        raidId,
        action,
        characterToken,
        effectiveRole,
      ),
    );
  } else {
    rows.push(buildDisabledRaidRoleSelectRow(raidId, action));
  }

  const canSubmit = Boolean(
    selectedCharacter && characterToken && effectiveRole,
  );
  rows.push({
    type: 1,
    components: [
      {
        type: 2,
        style: canSubmit ? 3 : 2,
        label: action === "late" ? "Записатися із запізненням" : action === "tentative" ? "Записатися 50/50" : "Записатися",
        custom_id: canSubmit
          ? buildRaidSignupSubmitCustomId(
              raidId,
              action,
              characterToken,
              effectiveRole || "dps",
            )
          : buildRaidAttendanceCustomId(raidId, action),
        disabled: !canSubmit,
      },
      {
        type: 2,
        style: 5,
        label: "Деталі рейду",
        url: dashboardRaidUrl(raidId),
      },
    ],
  });

  return rows.slice(0, 5);
}

export function buildRaidSignupSuccessComponents(
  raidId: string,
  action: RaidSignupStatus,
) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label:
            action === "late" ? "Змінити запис" : action === "tentative" ? "Змінити 50/50 запис" : "Змінити персонажа / роль",
          custom_id: buildRaidAttendanceCustomId(raidId, action),
        },
        {
          type: 2,
          style: 5,
          label: "Відкрити рейд",
          url: dashboardRaidUrl(raidId),
        },
      ],
    },
  ];
}

function resolveProfileCharacterSelection(
  profile: DashboardProfile | null | undefined,
  characterKey?: unknown,
): ProfileCharacter | null {
  if (!profile?.characters?.length) return null;
  const raw = cleanString(characterKey, 260);
  if (!raw) return null;
  const indexMatch = raw.match(/^c(\d{1,2})$/i);
  if (indexMatch) {
    const byIndex = profile.characters[Number(indexMatch[1])];
    if (byIndex) return byIndex;
  }
  const cleanKey = normalizeCharacterKey(raw);
  return cleanKey
    ? profile.characters.find(
        (item) => normalizeCharacterKey(item.key) === cleanKey,
      ) || null
    : null;
}

function isMissingDiscordMessageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /404|unknown message|10008/i.test(message);
}

export async function publishOrUpdateRaid(
  raid: RaidItem,
  channelId?: string | null,
) {
  const closed = isRaidClosed(raid);
  // A draft becomes published as part of this operation. Build the public
  // message from that effective state, otherwise Discord visibly says
  // “Чернетка” while already exposing live signup buttons.
  const publicRaid: RaidItem = { ...raid, status: closed ? "closed" : "published" };
  const payload = buildRaidDiscordPayload(publicRaid);
  const components = buildRaidAttendanceComponents(raid.id, {
    disabled: closed,
    full: !closed && isRaidRegistrationFull(raid),
    registrationLocked: !closed && isRaidRegistrationLocked(raid),
    signed: false,
    personalized: false,
  });
  const targetChannelId = cleanSnowflake(
    channelId || raid.channelId || getDiscordDefaultChannelId(),
  );
  if (!targetChannelId)
    throw new Error(
      "Канал Discord для рейду не вибрано. Вибери канал у формі рейду.",
    );

  let message: any;
  const hasExistingMessage = Boolean(raid.channelId && raid.messageId);
  const canEditExisting = Boolean(
    hasExistingMessage && targetChannelId === raid.channelId,
  );

  if (canEditExisting && raid.channelId && raid.messageId) {
    const existingRef: DiscordMessageRef = {
      channelId: raid.channelId,
      messageId: raid.messageId,
    };
    try {
      message = await editDiscordRaidMessage({
        ref: existingRef,
        content: payload.content,
        embed: payload.embed,
        components,
        mentionRoleIds: payload.mentionRoleIds,
        auditReason: `Raid updated: ${raid.id}`,
      });
    } catch (error) {
      if (!isMissingDiscordMessageError(error)) throw error;
      message = await createDiscordRaidMessage({
        channelId: targetChannelId,
        content: payload.content,
        embed: payload.embed,
        components,
        mentionRoleIds: payload.mentionRoleIds,
        auditReason: `Raid republished after missing message: ${raid.id}`,
      });
    }
  } else {
    message = await createDiscordRaidMessage({
      channelId: targetChannelId,
      content: payload.content,
      embed: payload.embed,
      components,
      mentionRoleIds: payload.mentionRoleIds,
      auditReason: `Raid published: ${raid.id}`,
    });

    if (
      hasExistingMessage &&
      raid.channelId &&
      raid.messageId &&
      raid.channelId !== targetChannelId
    ) {
      await deleteDiscordRaidMessage({
        ref: { channelId: raid.channelId, messageId: raid.messageId },
        auditReason: `Raid moved to another channel: ${raid.id}`,
      }).catch((error) =>
        console.warn("[raids] Failed to delete old Discord raid message", {
          raidId: raid.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  const nextChannelId = String(message?.channel_id || targetChannelId);
  const nextMessageId = String(message?.id || "");
  if (!nextChannelId || !nextMessageId)
    throw new Error(
      "Discord не підтвердив повідомлення. Перевір канал і повтори дію.",
    );
  const messageUrl = discordMessageUrl(nextChannelId, nextMessageId);

  await firebaseWrite(
    "raid",
    `raid:${raid.id}:publish-state`,
    async () => {
      await getFirebaseAdminDb()
        .collection(RAID_COLLECTION)
        .doc(raid.id)
        .set(
          {
            status: closed ? "closed" : "published",
            closedReason: closed
              ? raid.closedReason === "manual"
                ? "manual"
                : "auto"
              : null,
            ...(closed && !raid.closedAt
              ? { closedAt: FieldValue.serverTimestamp() }
              : closed
                ? {}
                : { closedAt: null }),
            discordCloseSyncedAt: closed ? FieldValue.serverTimestamp() : null,
            discordDeletedAt: null,
            discordDeleteReason: null,
            channelId: nextChannelId,
            messageId: nextMessageId,
            messageUrl,
            publishedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      clearRaidRuntimeCaches(raid.id);
    },
    { timeoutMs: 3_000, bypassCircuit: true, logEvent: "raids.publish_state_write_failed" },
  );

  return { channelId: nextChannelId, messageId: nextMessageId, messageUrl };
}

export async function saveAndMaybePublishRaid(
  form: FormData,
  user: DashboardSession,
  profile?: DashboardProfile | null,
) {
  const raid = await saveRaidFromForm(form, user, profile);
  const action = cleanString(form.get("action"), 40);
  if (action === "publish") {
    const wasDiscordPublished = Boolean(
      raid.channelId && raid.messageId && raid.status !== "draft",
    );
    const result = await publishOrUpdateRaid(
      raid,
      form.get("channelId")
        ? cleanString(form.get("channelId"), 32)
        : raid.channelId,
    );
    const shouldAutoClose = isRaidClosed({
      ...raid,
      ...result,
      status: "published",
    });
    const nextStatus = shouldAutoClose
      ? ("closed" as const)
      : ("published" as const);
    return {
      raid: {
        ...raid,
        status: nextStatus,
        closedReason: shouldAutoClose ? ("auto" as const) : null,
        closedAt: shouldAutoClose ? new Date().toISOString() : null,
        ...result,
      },
      published: result.messageUrl,
      discordAction: wasDiscordPublished
        ? ("updated" as const)
        : ("created" as const),
    };
  }
  return { raid, published: null, discordAction: null };
}

async function refreshProfileBeforeRaidSignup(
  profile: DashboardProfile | null,
  context: { raidId: string; userId: string },
) {
  if (!profile?.characters?.length) return profile;
  try {
    return await refreshProfileCharactersForRaidSignup(profile);
  } catch (error) {
    console.warn("[raids] Battle.net character refresh before signup failed", {
      raidId: context.raidId,
      userId: context.userId,
      profileId: profile.profileId,
      message: error instanceof Error ? error.message : String(error),
    });
    return profile;
  }
}

function resolveRaidSignupCharacter(
  profile?: DashboardProfile | null,
  characterKey?: unknown,
): ProfileCharacter | null {
  if (!profile?.characters?.length) return null;
  const cleanKey = normalizeCharacterKey(characterKey);
  if (cleanKey) {
    const selected = profile.characters.find(
      (item) => normalizeCharacterKey(item.key) === cleanKey,
    );
    if (selected) return selected;
  }
  return getMainCharacter(profile);
}

function resolveRaidSignupRole(
  profile: DashboardProfile | null | undefined,
  character: ProfileCharacter | null,
): RaidCharacterRole {
  if (!character) return "dps";
  const manualRole =
    profile?.raidRolePreference?.characterKey === character.key
      ? profile?.raidRolePreference?.role
      : null;
  return (
    manualRole ||
    resolveWowCharacterRole({
      className: character.className,
      activeSpecName: character.activeSpecName,
      activeSpecId: character.activeSpecId,
      activeSpecRole: character.activeSpecRole,
    })
  );
}

/* ----------------------------------------------------------------------------
   РУЧНИЙ ЗАПИС: клас + спек замість персонажа Battle.net

   Другий метод запису для тих, у кого немає привʼязаних персонажів.
   Роль не питаємо окремо — у каталозі кожен спек має рівно одну роль
   (Guardian → tank, Feral → dps), тож зайвий крок лише плодив би
   розбіжність між обраним спеком і роллю у складі.
   -------------------------------------------------------------------------- */

export type RaidManualSelection = { classKey: string; specKey: string };

export function cleanRaidManualSelection(
  classKey: unknown,
  specKey: unknown,
): RaidManualSelection | null {
  const resolved = findWowSpec(classKey, specKey);
  if (!resolved) return null;
  return { classKey: resolved.cls.key, specKey: resolved.spec.key };
}

export function buildRaidManualClassSelectCustomId(
  raidId: string,
  action: RaidSignupStatus,
) {
  const id = cleanRaidId(raidId);
  const safeAction = cleanSignupStatus(action);
  const customId = `mbv1:rmc:${id}:${safeAction}`;
  if (!id || customId.length > 100)
    throw new Error("Некоректний ID рейду для ручного вибору класу.");
  return customId;
}

export function buildRaidManualSpecSelectCustomId(
  raidId: string,
  action: RaidSignupStatus,
  classKey: string,
) {
  const id = cleanRaidId(raidId);
  const safeAction = cleanSignupStatus(action);
  const cls = findWowClass(classKey);
  const customId = `mbv1:rms:${id}:${safeAction}:${cls?.key || ""}`;
  if (!id || !cls || customId.length > 100)
    throw new Error("Некоректний ID рейду або класу для ручного вибору спеку.");
  return customId;
}

export function decodeRaidManualClassCustomId(
  customId: string,
  values?: unknown,
) {
  const value = cleanString(customId, 120);
  const match = value.match(
    /^mbv1:rmc:([A-Za-z0-9_-]{8,80}):(going|tentative|late)$/,
  );
  if (!match) return null;
  const selected = Array.isArray(values) ? values : [];
  const cls = findWowClass(cleanString(selected[0], 40));
  if (!cls) return null;
  return {
    raidId: match[1],
    action: cleanSignupStatus(match[2]),
    classKey: cls.key,
  };
}

export function decodeRaidManualSpecCustomId(
  customId: string,
  values?: unknown,
) {
  const value = cleanString(customId, 120);
  const match = value.match(
    /^mbv1:rms:([A-Za-z0-9_-]{8,80}):(going|tentative|late):([a-z]{2,20})$/,
  );
  if (!match) return null;
  const selected = Array.isArray(values) ? values : [];
  const manual = cleanRaidManualSelection(match[3], cleanString(selected[0], 40));
  if (!manual) return null;
  return {
    raidId: match[1],
    action: cleanSignupStatus(match[2]),
    manual,
  };
}

export function buildRaidManualClassComponents(
  raidId: string,
  action: RaidSignupStatus,
) {
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: buildRaidManualClassSelectCustomId(raidId, action),
          placeholder: "Обери клас",
          min_values: 1,
          max_values: 1,
          options: WOW_CLASS_CATALOG.slice(0, 25).map((cls) => ({
            label: cls.label.slice(0, 100),
            value: cls.key,
            emoji: cls.emoji ? { name: cls.emoji } : undefined,
            description: `${cls.specs.length} спеків`.slice(0, 100),
          })),
        },
      ],
    },
  ];
}

export function buildRaidManualSpecComponents(
  raidId: string,
  action: RaidSignupStatus,
  classKey: string,
) {
  const cls = findWowClass(classKey);
  if (!cls) return buildRaidManualClassComponents(raidId, action);
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: buildRaidManualSpecSelectCustomId(raidId, action, cls.key),
          placeholder: `${cls.label}: обери спек`.slice(0, 150),
          min_values: 1,
          max_values: 1,
          options: cls.specs.slice(0, 25).map((spec) => ({
            label: spec.label.slice(0, 100),
            value: spec.key,
            description: raidManualRoleLabel(spec.role).slice(0, 100),
          })),
        },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Інший клас",
          emoji: { name: "↩️" },
          custom_id: buildRaidAttendanceCustomId(raidId, action),
        },
      ],
    },
  ];
}

/** Каталог класів і спеків для ручного вибору у вебінтерфейсі. */
export function raidManualClassOptions() {
  return WOW_CLASS_CATALOG.map((cls) => ({
    key: cls.key,
    label: cls.label,
    color: cls.color,
    emoji: cls.emoji,
    specs: cls.specs.map((spec) => ({
      key: spec.key,
      label: spec.label,
      role: spec.role,
      roleLabel: raidManualRoleLabel(spec.role),
    })),
  }));
}

function raidManualRoleLabel(role: RaidCharacterRole) {
  if (role === "tank") return "🛡️ Танк";
  if (role === "healer") return "💚 Хіл";
  return "⚔️ ДД";
}

/** Запис без персонажа Battle.net: імʼя береться з гільдійного ніку Discord. */
function signupFromManualSelection(
  status: RaidSignupStatus,
  userId: string,
  userName: string,
  manual: RaidManualSelection,
  profile?: DashboardProfile | null,
): RaidSignup {
  const resolved = findWowSpec(manual.classKey, manual.specKey);
  const now = new Date().toISOString();
  return {
    discordId: userId,
    // Саме гільдійний нік, а не глобальне імʼя Discord: userName приходить
    // із interaction.member.nick, який специфічний для сервера гільдії.
    discordName: userName || "Discord user",
    profileId: profile?.profileId || null,
    characterKey: null,
    status,
    role: resolved?.spec.role || "dps",
    grammaticalGender: cleanProfileGrammaticalGender(profile?.grammaticalGender),
    characterName: null,
    realmName: null,
    realmSlug: null,
    region: null,
    className: resolved?.cls.label || null,
    activeSpecName: resolved?.spec.label || null,
    activeSpecId: null,
    level: null,
    raceName: null,
    faction: null,
    avatarUrl: null,
    renderUrl: null,
    mediaUrl: null,
    itemLevel: null,
    profileUrl: null,
    verifiedGuild: null,
    guildName: null,
    guildRealmSlug: null,
    manualClassKey: manual.classKey,
    manualSpecKey: manual.specKey,
    signedAt: now,
    updatedAt: now,
  };
}

function signupFromProfile(
  status: RaidSignupStatus,
  userId: string,
  userName: string,
  profile?: DashboardProfile | null,
  characterKey?: unknown,
  forcedRole?: unknown,
): RaidSignup {
  const character = resolveRaidSignupCharacter(profile, characterKey);
  const role =
    cleanRoleStrict(forcedRole) || resolveRaidSignupRole(profile, character);
  const now = new Date().toISOString();

  return {
    discordId: userId,
    discordName: profile
      ? getProfilePublicName(profile)
      : userName || "Discord user",
    profileId: profile?.profileId || null,
    characterKey: character?.key || null,
    status,
    role,
    grammaticalGender: cleanProfileGrammaticalGender(
      profile?.grammaticalGender,
    ),
    characterName: character?.name || null,
    realmName: character?.realmName || character?.realmSlug || null,
    realmSlug: character?.realmSlug || null,
    region: character?.region || "eu",
    className: character?.className || null,
    activeSpecName: character?.activeSpecName || null,
    activeSpecId: Number.isFinite(Number(character?.activeSpecId))
      ? Number(character?.activeSpecId)
      : null,
    level: Number.isFinite(Number(character?.level))
      ? Number(character?.level)
      : null,
    raceName: character?.raceName || null,
    faction: character?.faction || null,
    avatarUrl: pickWowAvatarImageUrl(
      character?.avatarUrl,
      character?.renderUrl,
    ),
    renderUrl: character?.renderUrl || null,
    mediaUrl: character?.mediaUrl || null,
    itemLevel: Number.isFinite(Number(character?.itemLevel))
      ? Number(character?.itemLevel)
      : null,
    profileUrl: character?.profileUrl || null,
    verifiedGuild: character ? Boolean(character.verifiedGuild) : null,
    guildName: character?.guildName || null,
    guildRealmSlug: character?.guildRealmSlug || null,
    signedAt: now,
    updatedAt: now,
  };
}

export async function recordRaidSignup(
  raidId: string,
  signup: RaidSignup,
  options: { interaction?: boolean } = {},
) {
  const id = cleanRaidId(raidId);
  if (!id || !hasRaidStorage())
    throw new Error("Рейд не знайдено або збереження тимчасово недоступне.");

  const benchPriority = await getRaidBenchPrioritySettings().catch(
    () => ({ ...EMPTY_RAID_BENCH_PRIORITY_SETTINGS }),
  );

  const updated = await firebaseWrite<RaidItem>(
    "raid",
    `raid:${id}:signup:${signup.discordId}`,
    async () => {
      const db = getFirebaseAdminDb();
      const ref = db.collection(RAID_COLLECTION).doc(id);
      const saved = await db.runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Рейд не знайдено.");
        const raid = {
          ...normalizeRaid(snapshot.id, snapshot.data() || {}),
          benchPriority,
        };
        if (isRaidClosed(raid))
          throw new Error("Рейд уже закритий, запис вимкнено.");
        if (raid.status !== "published")
          throw new Error("Запис доступний тільки для опублікованого рейду.");
        const lockBlock = raidRegistrationLockBlockMessage(raid, signup.status);
        if (lockBlock) throw new Error(lockBlock);
        const block = raidMinItemLevelBlockMessage(raid, signup);
        if (block) throw new Error(block);
        const fullBlock = raidRegistrationFullMessage(
          raid,
          signup.discordId,
          signup.status,
          signup,
        );
        if (fullBlock) throw new Error(fullBlock);
        const existingSignup =
          raid.signups.find((item) => item.discordId === signup.discordId) ||
          null;
        const nextSignups = raid.signups.filter(
          (item) => item.discordId !== signup.discordId,
        );
        const now = new Date().toISOString();
        const becomesActive = isActiveSignupStatus(signup.status);
        const signupCharacterKey = normalizeCharacterKey(signup.characterKey);
        if (becomesActive && signupCharacterKey) {
          const duplicate = nextSignups.find(
            (item) =>
              isActiveSignupStatus(item.status) &&
              normalizeCharacterKey(item.characterKey) === signupCharacterKey,
          );
          if (duplicate) {
            throw new Error(
              `Персонаж ${signup.characterName || duplicate.characterName || "уже"} вже записаний на цей рейд. Один персонаж не може бути записаний двічі.`,
            );
          }
        }
        const existingNumber = cleanOptionalSignupNumber(
          existingSignup?.signupNumber,
        );
        const signupNumber = becomesActive
          ? existingNumber || nextRaidSignupNumber(nextSignups)
          : existingNumber;
        const signedAt =
          existingSignup &&
          (isActiveSignupStatus(existingSignup.status) || existingNumber)
            ? existingSignup.signedAt || signup.signedAt || now
            : signup.signedAt || now;

        nextSignups.push({
          ...signup,
          signupNumber,
          signedAt,
          updatedAt: now,
        });
        const normalizedSignups = normalizeRaidSignupNumbers(nextSignups);
        transaction.set(
          ref,
          {
            signups: normalizedSignups,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return {
          ...raid,
          signups: normalizedSignups,
          updatedAt: now,
        } as RaidItem;
      });
      clearRaidRuntimeCaches(id);
      return saved;
    },
    {
      timeoutMs: 5_000,
      logEvent: "raids.signup_write_failed",
      bypassCircuit: Boolean(options.interaction),
    },
  );

  return updated;
}

type DiscordMessageRefInput = {
  channelId?: string | null;
  messageId?: string | null;
  channel_id?: string | null;
  message_id?: string | null;
};

function cleanDiscordMessageRef(
  input?: DiscordMessageRefInput | null,
): DiscordMessageRef | null {
  const channelId = cleanString(input?.channelId || input?.channel_id, 32);
  const messageId = cleanString(input?.messageId || input?.message_id, 32);
  return channelId && messageId ? { channelId, messageId } : null;
}

async function editCurrentRaidDiscordMessage(
  raid: RaidItem,
  messageRef?: DiscordMessageRefInput | null,
) {
  if (raid.status === "draft") return false;

  // Важливо: під час вибору персонажа Discord надсилає ref на приватне ephemeral-повідомлення
  // з select-menu, а не на основний публічний embed рейду. Якщо редагувати цей ref першим,
  // синхронізація падає і користувач бачить "Discord-повідомлення не оновилося автоматично".
  // Тому основне джерело істини — messageId/channelId, збережені в документі рейду.
  const storedRef = cleanDiscordMessageRef({
    channelId: raid.channelId,
    messageId: raid.messageId,
  });
  const fallbackRef = cleanDiscordMessageRef(messageRef);
  const ref = storedRef || fallbackRef;
  if (!ref) {
    console.warn(
      "[raids] Discord message sync skipped: raid has no stored message ref",
      { raidId: raid.id },
    );
    return false;
  }

  const closed = isRaidClosed(raid);
  const payload = buildRaidDiscordPayload(raid);
  const components = buildRaidAttendanceComponents(raid.id, {
    disabled: closed,
    full: !closed && isRaidRegistrationFull(raid),
    registrationLocked: !closed && isRaidRegistrationLocked(raid),
    signed: false,
    personalized: false,
  });

  await editDiscordRaidMessage({
    ref,
    content: payload.content,
    embed: payload.embed,
    components,
    mentionRoleIds: payload.mentionRoleIds,
    auditReason: closed ? `Raid buttons disabled after close: ${raid.id}` : `Raid signup changed: ${raid.id}`,
  });

  return true;
}

async function runLatestRaidDiscordSignupSync(
  raid: RaidItem,
  messageRef?: DiscordMessageRefInput | null,
) {
  try {
    await waitMs(raidDiscordSyncDebounceMs());
    const latest = await getRaid(raid.id).catch(() => null);
    return await editCurrentRaidDiscordMessage(latest || raid, messageRef);
  } catch (error) {
    console.warn("[raids] Discord message sync after signup failed", {
      raidId: raid.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function syncRaidDiscordAfterSignup(
  raid: RaidItem,
  messageRef?: DiscordMessageRefInput | null,
) {
  const id = cleanRaidId(raid.id);
  if (!id) return false;
  const entries = raidDiscordSyncEntries();
  const existing = entries.get(id);
  if (existing) {
    existing.dirty = true;
    return existing.promise;
  }

  const entry: { dirty: boolean; promise: Promise<boolean> } = {
    dirty: false,
    promise: Promise.resolve(false),
  };
  entry.promise = (async () => {
    let result = false;
    do {
      entry.dirty = false;
      result = await runLatestRaidDiscordSignupSync(raid, messageRef);
    } while (entry.dirty);
    return result;
  })().finally(() => {
    entries.delete(id);
  });
  entries.set(id, entry);
  return entry.promise;
}

export async function syncRaidDiscordSignupUpdate(
  raid: RaidItem,
  messageRef?: DiscordMessageRefInput | null,
) {
  return syncRaidDiscordAfterSignup(raid, messageRef);
}

export function raidMinItemLevelBlockMessage(
  raid: Pick<RaidItem, "minItemLevel" | "minItemLevelRequired">,
  signup?: Pick<
    RaidSignup,
    | "itemLevel"
    | "characterName"
    | "discordName"
    | "status"
    | "grammaticalGender"
    | "characterKey"
    | "manualClassKey"
    | "manualSpecKey"
  > | null,
) {
  if (!isRaidSubjectBlockedByMinItemLevel(raid, signup)) return null;

  const required = raidMinimumItemLevel(raid);
  const current = raidSubjectItemLevel(signup);
  const name = signup?.characterName || signup?.discordName || "Персонаж";
  if (current === null) {
    return `⛔ ${name}: item level не визначено. Для цього рейду потрібен мінімум ${required}. Запис заблоковано.`;
  }
  return `⛔ ${name}: item level ${current} нижче мінімального порогу ${required}. Запис заблоковано для цього рейду.`;
}

export function raidMinItemLevelWarning(
  raid: Pick<RaidItem, "minItemLevel" | "minItemLevelRequired">,
  signup?: Pick<
    RaidSignup,
    | "itemLevel"
    | "characterName"
    | "discordName"
    | "status"
    | "grammaticalGender"
    | "characterKey"
    | "manualClassKey"
    | "manualSpecKey"
  > | null,
) {
  if (!isRaidSubjectWarnedByMinItemLevel(raid, signup)) return null;
  const required = raidMinimumItemLevel(raid);
  const current = raidSubjectItemLevel(signup);
  const name = signup?.characterName || signup?.discordName || "Персонаж";
  const signedText = profileGenderedText(
    signup?.grammaticalGender,
    "Ти записаний",
    "Ти записана",
    "Тебе записали",
  );
  return `⚠️ ${name}: item level ${current} нижче мінімального порогу ${required}. ${signedText}, але краще підняти спорядження перед рейдом.`;
}

function attendanceSuccessText(
  action: RaidSignupStatus,
  raid: RaidItem,
  signup?: RaidSignup | null,
  discordSynced: boolean | "queued" = true,
) {
  const syncText = discordSynced === "queued"
    ? "Запис збережено. Discord оновлюється у фоні."
    : discordSynced
      ? "Склад Discord оновлено."
      : "Запис збережено, але Discord-повідомлення не оновилося автоматично. Офіцер може натиснути “Оновити Discord”.";
  if (action === "skipped")
    return `👌 Позначено, що ти пропускаєш: ${raidTitle(raid)}. ${syncText}`;
  const warning = raidMinItemLevelWarning(raid, signup);
  const characterText = signup?.characterName
    ? ` як ${signup.characterName}`
    : signup?.manualClassKey && signup?.manualSpecKey
      ? ` як ${wowSpecFullName(signup.manualClassKey, signup.manualSpecKey)}`
      : "";
  const signupNumberText = raidSignupNumberLabel(signup)
    ? ` Номер запису: ${raidSignupNumberLabel(signup)}.`
    : "";
  const signedText = profileGenderedText(
    signup?.grammaticalGender,
    "Ти записаний",
    "Ти записана",
    "Тебе записали",
  );
  const base =
    action === "late"
      ? `🕒 Записано: ти затримаєшся на ${raidTitle(raid)}${characterText}.${signupNumberText} ${syncText}`
      : action === "tentative"
        ? `❓ ${signedText} 50/50 на ${raidTitle(raid)}${characterText}.${signupNumberText} Якщо основний склад заповниться, цей запис піде в лаву запасних після сірого списку. ${syncText}`
        : `✅ ${signedText} на ${raidTitle(raid)}${characterText}.${signupNumberText} ${syncText}`;
  return warning ? `${base}\n\n${warning}` : base;
}


async function recoverEmptyRaidFromDiscordMessage(
  raidId: string,
  messageRef: DiscordMessageRefInput | null | undefined,
  interactionMessage?: unknown,
): Promise<RaidItem | null> {
  const id = cleanRaidId(raidId);
  const ref = cleanDiscordMessageRef(messageRef);
  const embed = firstInteractionEmbed(interactionMessage);
  if (!id || !ref || !embed) return null;

  // We can safely recreate an orphan only while the public message proves that
  // no signup state exists. Never turn a populated Discord roster into an
  // empty database record: that would trade a visible error for silent loss.
  const rosterField = interactionField(interactionMessage, /склад рейду/i);
  const roster = discordFraction(rosterField);
  const emptyEvidence = Boolean(roster && roster.current === 0) || interactionShowsEmptyRaid(interactionMessage);
  if (!emptyEvidence) return null;

  const title = stripDifficultySuffix(embed.title) || "Рейд";
  const difficulty = inferDifficultyFromTitle(embed.title);
  const dateField = interactionField(interactionMessage, /дата/i);
  const dateTime = kyivDateTimeFromEpochSeconds(firstDiscordTimestampSeconds(dateField));
  const roleField = interactionField(interactionMessage, /ролі/i);
  const roleMatches = Array.from(roleField.matchAll(/(\d+)\s*\/\s*(\d+)\s*(?:танк|хіл|дд)/giu));
  const composition: RaidComposition = {
    tanks: Math.max(1, Number(roleMatches[0]?.[2] || 2)),
    healers: Math.max(1, Number(roleMatches[1]?.[2] || 2)),
    dps: Math.max(1, Number(roleMatches[2]?.[2] || 6)),
  };
  const consumablesText = interactionField(interactionMessage, /розхідники/i).toLowerCase();
  const lootText = interactionField(interactionMessage, /лут/i).toLowerCase();
  const lockText = interactionField(interactionMessage, /блокування запису/i).toLowerCase();
  const creator = interactionField(interactionMessage, /створив/i) || "Відновлено з Discord";
  const createdAt = interactionMessageTimestamp(interactionMessage);
  const now = new Date().toISOString();

  const raw: Record<string, unknown> = {
    title,
    difficulty,
    date: dateTime?.date || "",
    time: dateTime?.time || "",
    description: String(embed.description || "").trim() || "Рейд відновлено з активного Discord-повідомлення.",
    minItemLevel: null,
    minItemLevelRequired: false,
    maxPlayers: roster && roster.total > 0 ? roster.total : null,
    registrationLockEnabled: lockText ? !/вимкн/i.test(lockText) : false,
    registrationLockMinutesBefore: null,
    imageUrl: null,
    thumbnailUrl: null,
    mentionRoleIds: [],
    createdByDiscordId: "",
    createdByName: creator,
    createdByMain: null,
    raidLeaderName: null,
    consumables: consumablesText.includes("гільд") ? "guild" : "own",
    lootMode: lootText.includes("soft") ? "soft-reserve" : lootText.includes("council") ? "loot-council" : lootText.includes("віль") ? "free-roll" : "ms-os",
    composition,
    status: "published",
    channelId: ref.channelId,
    messageId: ref.messageId,
    messageUrl: discordMessageUrl(ref.channelId, ref.messageId),
    signups: [],
    createdAt,
    updatedAt: now,
    publishedAt: createdAt,
    recoveredFromDiscordMessageAt: now,
    recoveredFromDiscordMessage: true,
  };

  await firebaseWrite(
    "raid",
    `raid:${id}:discord-orphan-recovery`,
    async () => {
      await getFirebaseAdminDb().collection(RAID_COLLECTION).doc(id).set(raw, { merge: true });
      return true;
    },
    { timeoutMs: 5_000, bypassCircuit: true, logEvent: "raids.discord_orphan_recovered" },
  );
  clearRaidRuntimeCaches(id);
  console.warn("[raids] restored empty raid backing document from Discord message", {
    raidId: id,
    channelId: ref.channelId,
    messageId: ref.messageId,
  });
  return normalizeRaid(id, raw);
}

async function getRaidForDiscordInteraction(
  raidId: string,
  messageRef?: DiscordMessageRefInput | null,
  interactionMessage?: unknown,
): Promise<RaidItem | null> {
  const id = cleanRaidId(raidId);
  if (!id || !hasRaidStorage()) return null;

  const ref = cleanDiscordMessageRef(messageRef);
  const resolved = await resolveDiscordInteractionDocument({
    collection: RAID_COLLECTION,
    resourceId: id,
    messageRef: ref,
  });
  if (!resolved) {
    return recoverEmptyRaidFromDiscordMessage(id, ref, interactionMessage);
  }

  const raid = normalizeRaid(resolved.id, resolved.data);
  clearRaidRuntimeCaches(raid.id);
  scheduleRaidAutoCloseSync(raid, `discord-interaction:${resolved.source}`);
  if (resolved.recovered) {
    console.warn("[raids] Discord interaction resource recovered", {
      requestedRaidId: id,
      resolvedRaidId: raid.id,
      source: resolved.source,
      channelId: ref?.channelId || null,
      messageId: ref?.messageId || null,
    });
  }
  return raid;
}

export async function handleRaidDiscordAction(params: {
  raidId: string;
  action: RaidSignupStatus;
  userId: string;
  userName: string;
  characterKey?: string | null;
  signupRole?: RaidCharacterRole | null;
  /** Ручний запис клас+спек для тих, у кого немає персонажів Battle.net. */
  manual?: RaidManualSelection | null;
  commit?: boolean;
  messageRef?: DiscordMessageRefInput | null;
  interactionMessage?: unknown;
  syncDiscord?: boolean;
}) {
  let raid: RaidItem | null = null;
  try {
    raid = await getRaidForDiscordInteraction(params.raidId, params.messageRef, params.interactionMessage);
  } catch (error) {
    console.error("[raids] authoritative Discord lookup failed", {
      raidId: params.raidId,
      message: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      content: message.includes("storage mismatch")
        ? "❌ Discord interaction досі обробляє старий runtime без PostgreSQL. Interactions Endpoint URL має бути https://guild.lihvodruida.pp.ua/discord/interactions — старий Worker/Vercel endpoint потрібно вимкнути."
        : "⚠️ Сховище рейдів зараз не відповідає. Дані не видалені — спробуй кнопку ще раз за кілька секунд.",
      storageUnavailable: true,
    };
  }
  if (!raid)
    return { ok: false, content: "❌ Рейд справді не знайдено. Повідомлення Discord могло залишитися від уже видаленого рейду." };
  const lifecycle = await syncRaidLifecycleAfterRead(raid).catch(() => null);
  if (lifecycle?.status === "closed" || isRaidClosed(raid))
    return {
      ok: false,
      content: "🔒 Запис на рейд уже закрито. Усі кнопки та зміни складу вимкнені.",
      components: buildRaidAttendanceComponents(raid.id, { disabled: true }),
    };
  if (raid.status !== "published")
    return {
      ok: false,
      content: "❌ Запис доступний тільки для опублікованого рейду.",
    };
  const lockBlock = raidRegistrationLockBlockMessage(raid, params.action);
  if (lockBlock)
    return {
      ok: false,
      content: lockBlock,
      warning: null,
      blockedByRegistrationLock: true,
    };
  const fullBlock = raidRegistrationFullMessage(
    raid,
    params.userId,
    params.action,
  );
  if (fullBlock)
    return {
      ok: false,
      content: fullBlock,
      warning: null,
      blockedByMaxPlayers: true,
    };

  let profile: DashboardProfile | null = null;
  let selectedCharacter: ProfileCharacter | null = null;
  const manualSelection = params.manual
    ? cleanRaidManualSelection(params.manual.classKey, params.manual.specKey)
    : null;
  if (params.action !== "skipped") {
    profile = await getProfileByDiscordUserIdForInteraction(params.userId);
    profile = await refreshProfileBeforeRaidSignup(profile, {
      raidId: raid.id,
      userId: params.userId,
    });
    if (!profile || !profile.characters.length) {
      // Другий метод запису: замість глухого блокування ведемо
      // через вибір клас → спек. Роль виводиться зі спеку.
      if (!manualSelection) {
        return {
          ok: false,
          content: raidManualSignupPromptText(!profile ? "login" : "main"),
          components: buildRaidManualClassComponents(raid.id, params.action),
          blockedByProfile: true,
          manualSignupOffered: true,
        };
      }
    }

    // Ручний запис не має персонажа: перевірки ilvl і меню вибору
    // персонажа пропускаємо повністю, далі одразу збірка запису.
    if (!manualSelection && profile) {
    const requestedCharacter = resolveProfileCharacterSelection(
      profile,
      params.characterKey,
    );
    const eligibleCharacters = raidEligibleSignupCharacters(raid, profile);
    const currentSignup = raid.signups.find(
      (item) => item.discordId === params.userId,
    );
    const isCharacterChange = Boolean(
      currentSignup && isActiveSignupStatus(currentSignup.status),
    );
    if (
      requestedCharacter &&
      isRaidSubjectBlockedByMinItemLevel(raid, requestedCharacter)
    ) {
      const blockedSignup = signupFromProfile(
        params.action,
        params.userId,
        params.userName,
        profile,
        requestedCharacter.key,
      );
      return {
        ok: false,
        content:
          raidMinItemLevelBlockMessage(raid, blockedSignup) ||
          "⛔ Цей персонаж не проходить мінімальний item level для рейду.",
        warning: null,
        blockedByMinItemLevel: true,
      };
    }
    selectedCharacter = requestedCharacter;

    if (!selectedCharacter && eligibleCharacters.length > 0) {
      const hiddenCount = profile.characters.length - eligibleCharacters.length;
      const selectedKey = currentSignup?.characterKey || null;
      const selectedRole = currentSignup?.role || null;
      return {
        ok: true,
        content: isCharacterChange
          ? `🔁 Приватний пульт запису. Ти вже записаний на рейд${currentSignup?.characterName ? ` як ${currentSignup.characterName}` : ""}. Обери персонажа й роль в цьому ж повідомленні, потім натисни підтвердження. ${hiddenCount > 0 ? `Персонажі нижче мінімального ilvl (${raid.minItemLevel}) приховані.` : ""}`
          : `🎯 Приватний пульт запису на рейд. Обери персонажа, перевір роль і натисни підтвердження. ${hiddenCount > 0 ? `Персонажі нижче мінімального ilvl (${raid.minItemLevel}) приховані.` : "Інші учасники цей вибір не бачать."}`,
        components: buildRaidSignupPanelComponents(
          raid.id,
          params.action,
          profile,
          selectedKey,
          selectedRole,
          raid,
        ),
        requiresCharacterSelection: true,
      };
    }
    const selectedSignupRole =
      cleanRoleStrict(params.signupRole) ||
      (selectedCharacter
        ? resolveRaidSignupRole(profile, selectedCharacter)
        : null);
    if (selectedCharacter && !params.commit) {
      return {
        ok: true,
        content: `🎯 Приватний пульт запису на рейд. Персонаж: **${selectedCharacter.name}**${selectedCharacter.realmName || selectedCharacter.realmSlug ? ` • ${selectedCharacter.realmName || selectedCharacter.realmSlug}` : ""}. Роль: **${selectedSignupRole ? raidRoleLabel(selectedSignupRole) : "не вибрано"}**. Натисни кнопку підтвердження, щоб запис зарахувався.`,
        components: buildRaidSignupPanelComponents(
          raid.id,
          params.action,
          profile,
          cleanRaidRoleSelectCharacterKey(params.characterKey) ||
            selectedCharacter.key ||
            "",
          selectedSignupRole,
          raid,
        ),
        requiresConfirmation: true,
      };
    }
    if (!selectedCharacter) {
      const minimum = raidMinimumItemLevel(raid);
      const content =
        profile.characters.length && raid.minItemLevelRequired && minimum
          ? `⛔ Немає доступних персонажів для запису: потрібен мінімум ${minimum} ilvl. Персонажі нижче порогу не показуються і не можуть бути записані.`
          : raidActionHelpText("main");
      const allBlocked = Boolean(
        profile.characters.length && raid.minItemLevelRequired && minimum,
      );
      return {
        ok: false,
        content,
        components: allBlocked ? [] : raidActionHelpComponents(raid.id),
        blockedByProfile: !allBlocked,
        blockedByMinItemLevel: allBlocked,
      };
    }
    }
  } else {
    profile = await getProfileByDiscordUserIdForInteraction(params.userId).catch(() => null);
  }

  const signup = manualSelection
    ? signupFromManualSelection(
        params.action,
        params.userId,
        params.userName,
        manualSelection,
        profile,
      )
    : signupFromProfile(
        params.action,
        params.userId,
        params.userName,
        profile,
        selectedCharacter?.key || params.characterKey,
        params.signupRole,
      );
  const block = raidMinItemLevelBlockMessage(raid, signup);
  if (block)
    return {
      ok: false,
      content: block,
      warning: null,
      blockedByMinItemLevel: true,
    };
  let updated: RaidItem;
  try {
    updated = await recordRaidSignup(raid.id, signup, { interaction: true });
  } catch (error) {
    return {
      ok: false,
      content: raidWriteErrorMessage(error),
      warning: null,
      storageReadOnly: true,
    };
  }
  const discordSynced = params.syncDiscord === false
    ? "queued"
    : await syncRaidDiscordAfterSignup(
      updated,
      params.messageRef,
    );
  const warning =
    params.action === "skipped"
      ? null
      : raidMinItemLevelWarning(updated, signup);
  const updatedSignup =
    updated.signups.find((item) => item.discordId === signup.discordId) ||
    signup;
  return {
    ok: true,
    content: attendanceSuccessText(
      params.action,
      updated,
      updatedSignup,
      discordSynced,
    ),
    components: buildRaidSignupSuccessComponents(updated.id, params.action),
    warning,
    raid: updated,
    discordSynced,
  };
}

/**
 * Імʼя для запису беремо з ніку на сервері гільдії, а не з глобального
 * імені Discord: у людини можуть бути різні ніки на різних серверах,
 * і в рейді має стояти саме наш. Порядок: живий member.nick → імʼя
 * сесії (воно вже збагачене displayName у auth.ts) → логін.
 */
async function resolveGuildSignupName(
  user: DashboardSession,
  discordId: string,
) {
  const fallback = user.name || user.login || "Discord user";
  if (!discordId) return fallback;
  const snapshot = await fetchDiscordGuildMemberSnapshot(discordId).catch(
    () => null,
  );
  return snapshot?.nick || fallback;
}

export async function handleRaidSessionAction(params: {
  raidId: string;
  action: RaidSignupStatus;
  user: DashboardSession;
  characterKey?: string | null;
  /** Ручний запис клас+спек для авторизованих без персонажів Battle.net. */
  manual?: RaidManualSelection | null;
  syncDiscord?: boolean;
}) {
  const manualSelection = params.manual
    ? cleanRaidManualSelection(params.manual.classKey, params.manual.specKey)
    : null;
  const raid = await getRaid(params.raidId);
  if (!raid)
    return { ok: false, content: "❌ Рейд не знайдено або він уже видалений." };
  const lifecycle = await syncRaidLifecycleAfterRead(raid).catch(() => null);
  if (lifecycle?.status === "closed" || isRaidClosed(raid))
    return { ok: false, content: "🔒 Запис на рейд уже закрито. Усі кнопки та зміни складу вимкнені." };
  if (raid.status !== "published")
    return {
      ok: false,
      content: "❌ Запис доступний тільки для опублікованого рейду.",
    };
  const lockBlock = raidRegistrationLockBlockMessage(raid, params.action);
  if (lockBlock)
    return {
      ok: false,
      content: lockBlock,
      warning: null,
      blockedByRegistrationLock: true,
    };

  const discordId =
    params.user.provider === "discord" && /^\d{16,25}$/.test(params.user.id)
      ? params.user.id
      : "";
  if (!discordId) {
    return {
      ok: false,
      content: raidActionHelpText("login"),
      components: raidActionHelpComponents(raid.id),
      blockedByProfile: true,
    };
  }
  const fullBlock = raidRegistrationFullMessage(raid, discordId, params.action);
  if (fullBlock)
    return {
      ok: false,
      content: fullBlock,
      warning: null,
      blockedByMaxPlayers: true,
    };

  let profile: DashboardProfile | null = null;
  if (params.user.profileId) {
    profile = await getProfileById(params.user.profileId).catch(() => null);
  }
  if (!profile) {
    profile = await getProfileByDiscordUserId(discordId).catch(() => null);
  }

  // Нік саме з нашого сервера, а не глобальне імʼя Discord.
  const signupName = await resolveGuildSignupName(params.user, discordId);

  let selectedCharacter: ProfileCharacter | null = null;
  if (params.action !== "skipped") {
    profile = await refreshProfileBeforeRaidSignup(profile, {
      raidId: raid.id,
      userId: discordId,
    });
    // Ручний запис не має персонажа: перевірки ilvl і меню вибору
    // персонажа пропускаємо повністю, далі одразу збірка запису.
    if (!manualSelection && profile) {
    const requestedCharacter = resolveProfileCharacterSelection(
      profile,
      params.characterKey,
    );
    const eligibleCharacters = raidEligibleSignupCharacters(raid, profile);
    if (
      requestedCharacter &&
      isRaidSubjectBlockedByMinItemLevel(raid, requestedCharacter)
    ) {
      const blockedSignup = signupFromProfile(
        params.action,
        discordId,
        signupName,
        profile,
        requestedCharacter.key,
      );
      return {
        ok: false,
        content:
          raidMinItemLevelBlockMessage(raid, blockedSignup) ||
          "⛔ Цей персонаж не проходить мінімальний item level для рейду.",
        warning: null,
        blockedByMinItemLevel: true,
      };
    }
    selectedCharacter = requestedCharacter;
    if (!profile || !profile.characters.length || !selectedCharacter) {
      const minimum = raidMinimumItemLevel(raid);
      const allBlocked = Boolean(
        profile?.characters.length &&
        raid.minItemLevelRequired &&
        minimum &&
        eligibleCharacters.length === 0,
      );
      return {
        ok: false,
        content: !profile
          ? raidActionHelpText("login")
          : allBlocked
            ? `⛔ Немає доступних персонажів для запису: потрібен мінімум ${minimum} ilvl. Персонажі нижче порогу не показуються і не можуть бути записані.`
            : params.characterKey
              ? "❌ Обраного персонажа не знайдено у твоєму профілі або він недоступний для цього рейду. Онови персонажів у профілі й повтори запис."
              : eligibleCharacters.length > 0
                ? "🎯 Перед записом на рейд потрібно явно вибрати персонажа. Автовибір вимкнено, щоб випадково не записати не того персонажа."
                : raidActionHelpText("main"),
        components: raidActionHelpComponents(raid.id),
        blockedByProfile: !allBlocked,
        blockedByMinItemLevel: allBlocked,
      };
    }
    }
  }

  // Авторизований без персонажів: пропонуємо той самий ручний метод.
  if (
    params.action !== "skipped" &&
    !manualSelection &&
    (!profile || !profile.characters.length)
  ) {
    return {
      ok: false,
      content: raidManualSignupPromptText(!profile ? "login" : "main"),
      blockedByProfile: true,
      manualSignupOffered: true,
      manualClasses: raidManualClassOptions(),
    };
  }

  const signup = manualSelection
    ? signupFromManualSelection(
        params.action,
        discordId,
        signupName,
        manualSelection,
        profile,
      )
    : signupFromProfile(
        params.action,
        discordId,
        signupName,
        profile,
        selectedCharacter?.key || params.characterKey,
      );
  const block = raidMinItemLevelBlockMessage(raid, signup);
  if (block)
    return {
      ok: false,
      content: block,
      warning: null,
      blockedByMinItemLevel: true,
    };
  let updated: RaidItem;
  try {
    updated = await recordRaidSignup(raid.id, signup);
  } catch (error) {
    return {
      ok: false,
      content: raidWriteErrorMessage(error),
      warning: null,
      storageReadOnly: true,
    };
  }
  const discordSynced = params.syncDiscord === false
    ? "queued"
    : await syncRaidDiscordAfterSignup(updated);
  const warning =
    params.action === "skipped"
      ? null
      : raidMinItemLevelWarning(updated, signup);
  const updatedSignup =
    updated.signups.find((item) => item.discordId === signup.discordId) ||
    signup;
  return {
    ok: true,
    content: attendanceSuccessText(
      params.action,
      updated,
      updatedSignup,
      discordSynced,
    ),
    warning,
    raid: updated,
    discordSynced,
  };
}

export function raidLiveRevision(raid: RaidItem) {
  const signupsSignature = [...(raid.signups || [])]
    .sort((a, b) =>
      `${a.discordId}:${a.characterName || ""}`.localeCompare(
        `${b.discordId}:${b.characterName || ""}`,
      ),
    )
    .map((item) =>
      [
        item.discordId,
        item.characterKey || "",
        item.signupNumber ?? "",
        item.status,
        item.role,
        item.characterName || "",
        item.realmSlug || item.realmName || "",
        item.itemLevel ?? "",
        item.grammaticalGender || "unspecified",
        item.verifiedGuild === false ? "other" : "guild",
        item.updatedAt || item.signedAt || "",
      ].join("~"),
    )
    .join("|");

  return [
    raid.id,
    raid.status,
    raid.updatedAt || "",
    raid.channelId || "",
    raid.messageId || "",
    raid.raidLeaderName || "",
    raid.registrationLockEnabled ? "lock-on" : "lock-off",
    raid.registrationLockMinutesBefore ?? "",
    raid.signups?.length || 0,
    signupsSignature,
  ].join("::");
}

export function dashboardRaidUrl(raidId: string) {
  const base = dashboardBaseUrl();
  return `${base}/raids/${encodeURIComponent(raidId)}`;
}
