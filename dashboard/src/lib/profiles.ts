import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DashboardRole, DashboardSession } from "@/lib/auth";
import { createStableProfileId } from "@/lib/profileIds";
import {
  getFirebaseAdminDb,
  hasFirebaseProfileConfig,
} from "@/lib/firebaseAdmin";
import {
  getAdaptiveConcurrency,
  mapConcurrent,
  readIntegerEnv,
} from "@/lib/concurrency";
import { getDashboardApiSettings, getSiteRuntimeSettings } from "@/lib/dashboardApiSettings";
import {
  fetchRaiderIoCharacterProfile,
  stripRaiderIoRaw,
  type RaiderIoCharacterSnapshot,
} from "@/lib/raiderIo";
import {
  fetchBattleNetCharacterSnapshot,
  type BattleNetAccountInfo,
  type BattleNetCharacterCandidate,
  type BattleNetGuildCharacterStatus,
  type BattleNetRegion,
} from "@/lib/battlenet";
import {
  buildBattleNetCharacterKey,
  normalizeBattleNetNameSlug,
  normalizeBattleNetRealmSlug,
  normalizeCharacterKey,
} from "@/lib/wowCharacters";
import {
  normalizeWowRole,
  resolveWowCharacterRole,
  type WowCharacterRole,
} from "@/lib/wowRoles";
import {
  DEFAULT_NICKNAME_TEMPLATE,
  renderNicknameFromTemplate,
} from "@/lib/guildNicknamePolicy";
import {
  canManageApplications,
  canViewAllProfiles,
  canViewProfiles,
  canViewProfilesInOwnGroupOrBelow,
  dashboardRoleRank,
} from "@/lib/permissions";
import { listAccessGroups } from "@/lib/accessGroups";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import { resilientRead, resilientWrite, getRuntimeCachedValue, setRuntimeCachedValue, clearRuntimeCachedValue, clearRuntimeCachedValuesByPrefix } from "@/lib/runtimeResilience";
import { firebaseWrite, firebaseUnavailableMessage } from "@/lib/firebaseAccess";

export {
  deleteDashboardProfileById,
  deleteDashboardProfilesByDiscordUserId,
} from "@/lib/profileCleanup";

export type ProfileCharacter = BattleNetCharacterCandidate & {
  guildRank?: number | null;
  guildStatus?: BattleNetGuildCharacterStatus | null;
  guildStatusLabel?: string | null;
  addedAt?: string | null;
  isMain?: boolean;
  raiderIo?: RaiderIoCharacterSnapshot | null;
};

export type ProfilePublicNameMode = "name" | "server_nickname";
export type ProfileGrammaticalGender =
  | "unspecified"
  | "neutral"
  | "nonbinary"
  | "male"
  | "female";

export type DashboardProfile = {
  profileId: string;
  provider: DashboardSession["provider"];
  providerUserId: string;
  displayName: string;
  preferredName?: string | null;
  publicNameMode?: ProfilePublicNameMode;
  grammaticalGender: ProfileGrammaticalGender;
  login?: string | null;
  role: DashboardRole;
  groupId?: string | null;
  groupName?: string | null;
  groupRank?: number | null;
  avatarUrl?: string | null;
  discordRoleIds: string[];
  characters: ProfileCharacter[];
  mainCharacterKey?: string | null;
  nicknameCharacterKeys?: string[];
  raidRolePreference?: {
    characterKey: string;
    role: WowCharacterRole | null;
    updatedAt?: string | null;
  } | null;
  discordNickname?: {
    value?: string | null;
    syncedAt?: string | null;
    sourcePreferredName?: string | null;
    sourceCharacters?: string[];
  } | null;
  battlenet?: {
    linked: boolean;
    region?: BattleNetRegion | string | null;
    accountLabel?: string | null;
    accountIdHash?: string | null;
    lastConnectedAt?: string | null;
    lastSyncAt?: string | null;
    lastCharacterRefreshAt?: string | null;
    lastProfileViewRefreshAt?: string | null;
    lastProfileViewRefresh?: {
      refreshed?: number;
      failed?: number;
      skipped?: number;
      updatedAt?: string | null;
    } | null;
    totalCharacters?: number;
    scannedCharacters?: number;
    eligibleCharacters?: number;
    guildCharacters?: number;
    otherCharacters?: number;
    candidateCharacters?: ProfileCharacter[];
    candidateSavedAt?: string | null;
    candidateExpiresAt?: string | null;
  } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastLoginAt?: string | null;
};

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") {
    return maybeTimestamp.toDate().toISOString();
  }
  return null;
}

function cleanRole(value: unknown): DashboardRole {
  return value === "admin" ||
    value === "moderator" ||
    value === "mentor" ||
    value === "member"
    ? value
    : "member";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.slice(0, 500) : null;
}

function readBoundedIntegerEnv(
  names: string[],
  fallback: number,
  min: number,
  max: number,
) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value))
      return Math.max(min, Math.min(Math.floor(value), max));
  }
  return Math.max(min, Math.min(Math.floor(fallback), max));
}

function getBattleNetCandidateTtlMs() {
  const minutes = readBoundedIntegerEnv(
    ["BATTLENET_CANDIDATE_TTL_MINUTES"],
    3,
    1,
    1440,
  );
  return minutes * 60 * 1000;
}

function timestampMillis(value: unknown) {
  const iso = timestampToIso(value) || optionalString(value);
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : null;
}

function isFutureTimestamp(value: unknown) {
  const time = timestampMillis(value);
  return typeof time === "number" && time > Date.now();
}

function candidateExpiryIso(value: unknown) {
  return isFutureTimestamp(value)
    ? timestampToIso(value) || optionalString(value)
    : null;
}

function hasCandidateStorage(battlenetRaw: Record<string, unknown> | null) {
  if (!battlenetRaw) return false;
  return (
    Array.isArray(battlenetRaw.candidateCharacters) ||
    battlenetRaw.candidateSavedAt !== undefined ||
    battlenetRaw.candidateExpiresAt !== undefined
  );
}

function candidateStorageDeleteUpdate() {
  return {
    "battlenet.candidateCharacters": FieldValue.delete(),
    "battlenet.candidateSavedAt": FieldValue.delete(),
    "battlenet.candidateExpiresAt": FieldValue.delete(),
  };
}

function stripCandidateStorageFromData(data: Record<string, unknown>) {
  const battlenetRaw =
    data.battlenet && typeof data.battlenet === "object"
      ? (data.battlenet as Record<string, unknown>)
      : null;
  if (!battlenetRaw) return data;
  const {
    candidateCharacters,
    candidateSavedAt,
    candidateExpiresAt,
    ...restBattlenet
  } = battlenetRaw;
  return { ...data, battlenet: restBattlenet };
}

function cleanString(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sliceCodePoints(value: string, maxLength: number) {
  return Array.from(value).slice(0, Math.max(0, maxLength)).join("");
}

function codePointLength(value: string) {
  return Array.from(value || "").length;
}

function cleanProfileName(value: unknown, maxLength = 32) {
  const cleaned = String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>@#`*_~|{}[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?'"ʼ’\-]+|[\s.,;:!?'"ʼ’\-]+$/g, "")
    .trim();
  return sliceCodePoints(cleaned, maxLength).trim();
}

function cleanDiscordNicknamePart(value: unknown, maxLength = 32) {
  return cleanProfileName(value, maxLength)
    .replace(/[\[\]]/g, "")
    .trim();
}

function cleanAuthorName(value: unknown, maxLength = 80) {
  const cleaned = String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>@#`*_~|{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?"ʼ’\-]+|[\s.,;:!?"ʼ’\-]+$/g, "")
    .trim();
  return sliceCodePoints(cleaned, maxLength).trim();
}

function cleanCharacterKey(value: unknown) {
  return normalizeCharacterKey(value);
}

function cleanProfilePublicNameMode(value: unknown): ProfilePublicNameMode {
  return value === "server_nickname" ? "server_nickname" : "name";
}

function cleanNicknameCharacterKeys(
  value: unknown,
  mainCharacterKey?: string | null,
) {
  if (!Array.isArray(value)) return [];
  const mainKey = cleanCharacterKey(mainCharacterKey);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of value) {
    const key = cleanCharacterKey(raw);
    if (!key || key === mainKey || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= 2) break;
  }

  return result;
}

export function cleanProfileGrammaticalGender(
  value: unknown,
): ProfileGrammaticalGender {
  const key = String(value || "")
    .trim()
    .toLocaleLowerCase("uk");
  if (
    ["male", "man", "boy", "m", "чоловік", "чоловіча", "ч", "хлопець"].includes(
      key,
    )
  )
    return "male";
  if (
    [
      "female",
      "woman",
      "girl",
      "f",
      "жінка",
      "жіноча",
      "ж",
      "дівчина",
    ].includes(key)
  )
    return "female";
  if (
    [
      "nonbinary",
      "non-binary",
      "non_binary",
      "nb",
      "небінарна",
      "небінарний",
      "небінарна особа",
    ].includes(key)
  )
    return "nonbinary";
  if (
    [
      "neutral",
      "neuter",
      "n",
      "нейтральна",
      "нейтральне",
      "нейтрально",
      "нейтральний",
      "нейтральне звертання",
    ].includes(key)
  )
    return "neutral";
  return "unspecified";
}

export function profileGenderLabel(value: unknown) {
  const gender = cleanProfileGrammaticalGender(value);
  if (gender === "male") return "Чоловіча";
  if (gender === "female") return "Жіноча";
  if (gender === "nonbinary") return "Небінарна особа";
  if (gender === "neutral") return "Нейтральне звертання";
  return "Не вибрано";
}

export function profileGenderedText(
  value: unknown,
  maleText: string,
  femaleText: string,
  neutralText = maleText,
) {
  const gender = cleanProfileGrammaticalGender(value);
  if (gender === "male") return maleText;
  if (gender === "female") return femaleText;
  return neutralText;
}

export type ProfileSettingsSetupStepKey =
  | "profile_name"
  | "profile_gender"
  | "profile_display_mode";

export type ProfileSettingsSetupStep = {
  key: ProfileSettingsSetupStepKey;
  title: string;
  description: string;
  complete: boolean;
  href?: string;
};

function isProfileNameReady(
  profile:
    | Pick<DashboardProfile, "preferredName" | "displayName" | "login">
    | null
    | undefined,
) {
  return (
    codePointLength(cleanProfileName(profile?.preferredName || "", 32)) >= 2
  );
}

export function profileSettingsSetupStatus(
  profile: DashboardProfile | null | undefined,
) {
  const profileId = profile?.profileId || "";
  const settingsHref = profileId
    ? `/profile/${profileId}/settings?setup=1`
    : "/profile";
  const publicMode = cleanProfilePublicNameMode(profile?.publicNameMode);
  const hasName = isProfileNameReady(profile);
  const hasGender = Boolean(
    profile &&
    cleanProfileGrammaticalGender(profile.grammaticalGender) !== "unspecified",
  );
  const hasDisplayMode = Boolean(
    profile && (publicMode === "name" || publicMode === "server_nickname"),
  );

  const steps: ProfileSettingsSetupStep[] = [
    {
      key: "profile_name",
      title: "Імʼя профілю",
      description: hasName
        ? `Вказано: ${profile?.preferredName}`
        : "Вкажи коротке імʼя, з якого будується профіль і серверний Discord-нік.",
      complete: hasName,
      href: settingsHref,
    },
    {
      key: "profile_gender",
      title: "Стать / звертання",
      description: hasGender
        ? "Звертання вибрано."
        : "Вибери звертання для особистих повідомлень сайту та Discord.",
      complete: hasGender,
      href: settingsHref,
    },
    {
      key: "profile_display_mode",
      title: "Формат відображення",
      description: hasDisplayMode
        ? "Формат імені профілю валідний."
        : "Потрібно вибрати, що показувати публічно: імʼя профілю або серверний формат.",
      complete: hasDisplayMode,
      href: settingsHref,
    },
  ];

  return {
    complete: steps.every((step) => step.complete),
    steps,
    missing: steps.filter((step) => !step.complete),
    settingsHref,
  };
}

export function profileNeedsSettingsSetup(
  profile: DashboardProfile | null | undefined,
) {
  return !profileSettingsSetupStatus(profile).complete;
}

export function profileSettingsSetupPath(profileId: string) {
  const cleanProfileId = String(profileId || "").trim();
  return /^id[a-f0-9]{16,40}$/.test(cleanProfileId)
    ? `/profile/${cleanProfileId}/settings?setup=1`
    : "/profile";
}

function normalizeRaiderIoScoreSegment(value: unknown) {
  const item =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  const score = item ? Number(item.score) : Number(value);
  const color = cleanString(item?.color, 16);
  return {
    score: Number.isFinite(score) && score >= 0 ? score : null,
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : null,
  };
}

function normalizeRaiderIoSnapshot(
  value: unknown,
): RaiderIoCharacterSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rawScores =
    item.currentScores && typeof item.currentScores === "object"
      ? (item.currentScores as Record<string, unknown>)
      : {};
  const currentScores: RaiderIoCharacterSnapshot["currentScores"] = {
    all: normalizeRaiderIoScoreSegment(rawScores.all),
    dps: normalizeRaiderIoScoreSegment(rawScores.dps),
    healer: normalizeRaiderIoScoreSegment(rawScores.healer),
    tank: normalizeRaiderIoScoreSegment(rawScores.tank),
  };
  const currentScore = Number(item.currentScore ?? currentScores.all.score);
  const itemLevelEquipped = Number(item.itemLevelEquipped);

  return {
    profileUrl: optionalString(item.profileUrl),
    thumbnailUrl: optionalString(item.thumbnailUrl),
    itemLevelEquipped:
      Number.isFinite(itemLevelEquipped) && itemLevelEquipped > 0
        ? itemLevelEquipped
        : null,
    currentScore:
      Number.isFinite(currentScore) && currentScore >= 0
        ? currentScore
        : currentScores.all.score,
    currentScores,
    updatedAt:
      timestampToIso(item.updatedAt) ||
      optionalString(item.updatedAt) ||
      new Date(0).toISOString(),
  };
}

function normalizeCharacter(
  value: unknown,
  mainCharacterKey?: string | null,
): ProfileCharacter | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const key = cleanCharacterKey(item.key);
  const name = cleanString(item.name, 80);
  const realmSlug = normalizeBattleNetRealmSlug(item.realmSlug);
  const normalizedName = normalizeBattleNetNameSlug(
    item.normalizedName || name,
  );
  if (!key || !name || !realmSlug) return null;

  const className = optionalString(item.className);
  const activeSpecName = optionalString(
    item.activeSpecName ||
      item.active_spec_name ||
      item.specName ||
      item.spec_name,
  );
  const activeSpecId = Number.isFinite(
    Number(
      item.activeSpecId || item.active_spec_id || item.specId || item.spec_id,
    ),
  )
    ? Math.floor(
        Number(
          item.activeSpecId ||
            item.active_spec_id ||
            item.specId ||
            item.spec_id,
        ),
      )
    : null;
  const activeSpecRole = resolveWowCharacterRole({
    className,
    activeSpecName,
    activeSpecId,
    activeSpecRole: item.activeSpecRole || item.active_spec_role || item.role,
  });

  return {
    key,
    source: "battlenet",
    region: (cleanString(item.region, 12).toLocaleLowerCase("uk") ||
      "eu") as BattleNetRegion,
    name,
    normalizedName,
    realmSlug,
    realmName: cleanString(item.realmName, 120) || realmSlug,
    level: Number.isFinite(Number(item.level)) ? Number(item.level) : null,
    faction: optionalString(item.faction),
    className,
    activeSpecName,
    activeSpecId,
    activeSpecRole,
    raceName: optionalString(item.raceName),
    genderName: optionalString(item.genderName),
    guildName: optionalString(item.guildName),
    guildRealmSlug: optionalString(item.guildRealmSlug),
    guildRank: Number.isFinite(Number(item.guildRank))
      ? Math.max(0, Math.floor(Number(item.guildRank)))
      : null,
    guildStatus: ["guild_master", "officer", "member"].includes(
      String(item.guildStatus || ""),
    )
      ? (item.guildStatus as BattleNetGuildCharacterStatus)
      : null,
    guildStatusLabel: optionalString(item.guildStatusLabel),
    profileUrl: optionalString(item.profileUrl) || "#",
    avatarUrl: optionalString(item.avatarUrl),
    renderUrl: optionalString(item.renderUrl),
    mediaUrl: optionalString(item.mediaUrl),
    verifiedGuild:
      typeof item.verifiedGuild === "boolean"
        ? item.verifiedGuild
        : Boolean(item.guildName),
    itemLevel: Number.isFinite(Number(item.itemLevel))
      ? Number(item.itemLevel)
      : null,
    raiderIo: normalizeRaiderIoSnapshot(item.raiderIo || item.raider_io),
    lastSeenAt:
      timestampToIso(item.lastSeenAt) ||
      optionalString(item.lastSeenAt) ||
      null ||
      new Date(0).toISOString(),
    addedAt: timestampToIso(item.addedAt) || optionalString(item.addedAt),
    isMain: Boolean(mainCharacterKey && key === mainCharacterKey),
  };
}

function normalizeCharacterList(
  value: unknown,
  mainCharacterKey?: string | null,
) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const characters: ProfileCharacter[] = [];
  for (const raw of value) {
    const character = normalizeCharacter(raw, mainCharacterKey);
    if (!character || seen.has(character.key)) continue;
    seen.add(character.key);
    characters.push(character);
  }
  return characters;
}

function normalizeCharacters(value: unknown, mainCharacterKey?: string | null) {
  return normalizeCharacterList(value, mainCharacterKey);
}

function normalizeBattleNetCandidateCharacters(
  battlenetRaw: Record<string, unknown> | null,
) {
  if (!battlenetRaw) return [];
  if (!isFutureTimestamp(battlenetRaw.candidateExpiresAt)) return [];
  return normalizeCharacterList(battlenetRaw.candidateCharacters, null);
}

function cleanGroupId(value: unknown) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
  return cleaned || null;
}

function cleanGroupName(value: unknown) {
  const cleaned = Array.from(
    String(value || "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " "),
  )
    .slice(0, 80)
    .join("");
  return cleaned || null;
}

function cleanGroupRank(value: unknown) {
  const rank = Number(value);
  return Number.isFinite(rank) ? Math.floor(rank) : null;
}

function fallbackProfileRank(role: DashboardRole) {
  return dashboardRoleRank(role) || 10;
}

function groupForProfile(
  profile: Pick<DashboardProfile, "groupId" | "role">,
  groups: AccessGroup[],
) {
  if (profile.groupId) {
    const byId = groups.find((group) => group.id === profile.groupId);
    if (byId) return byId;
  }
  return groups.find((group) => group.role === profile.role) || null;
}

function applyCurrentProfileGroup(
  profile: DashboardProfile,
  groups: AccessGroup[],
) {
  const group = groupForProfile(profile, groups);
  if (!group) {
    return {
      ...profile,
      groupRank: profile.groupRank ?? fallbackProfileRank(profile.role),
      groupName: profile.groupName || null,
    };
  }
  return {
    ...profile,
    role: group.role,
    groupId: group.id,
    groupName: group.name,
    groupRank: group.rank,
  };
}

export async function resolveProfileAccessForCurrentGroups(
  profile: DashboardProfile,
) {
  const groups = await listAccessGroups().catch(() => [] as AccessGroup[]);
  return groups.length ? applyCurrentProfileGroup(profile, groups) : profile;
}

function normalizeRaidRolePreference(
  value: unknown,
  mainCharacterKey?: string | null,
): DashboardProfile["raidRolePreference"] {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const characterKey = cleanCharacterKey(item.characterKey);
  const role = normalizeWowRole(item.role);
  if (!characterKey || !role) return null;

  // Manual raid role belongs to the current main only. If the main changes,
  // stale choices are ignored instead of being applied to a different character.
  if (mainCharacterKey && characterKey !== mainCharacterKey) return null;

  return {
    characterKey,
    role,
    updatedAt: timestampToIso(item.updatedAt) || optionalString(item.updatedAt),
  };
}

function normalizeProfile(
  profileId: string,
  data: Record<string, unknown>,
): DashboardProfile {
  const mainCharacterKey = cleanCharacterKey(data.mainCharacterKey) || null;
  const battlenetRaw =
    data.battlenet && typeof data.battlenet === "object"
      ? (data.battlenet as Record<string, unknown>)
      : null;
  const discordNicknameRaw =
    data.discordNickname && typeof data.discordNickname === "object"
      ? (data.discordNickname as Record<string, unknown>)
      : null;

  return {
    profileId,
    provider:
      data.provider === "github" || data.provider === "token"
        ? data.provider
        : "discord",
    providerUserId: String(data.providerUserId || ""),
    displayName: String(data.displayName || data.login || "Guild member").slice(
      0,
      120,
    ),
    preferredName: cleanProfileName(data.preferredName, 32) || null,
    publicNameMode: cleanProfilePublicNameMode(data.publicNameMode),
    grammaticalGender: cleanProfileGrammaticalGender(
      data.grammaticalGender || data.gender || data.sex,
    ),
    login: data.login ? String(data.login).slice(0, 120) : null,
    role: cleanRole(data.role),
    groupId: cleanGroupId(data.groupId),
    groupName: cleanGroupName(data.groupName),
    groupRank: cleanGroupRank(data.groupRank),
    avatarUrl: optionalString(data.avatarUrl),
    discordRoleIds: Array.isArray(data.discordRoleIds)
      ? data.discordRoleIds
          .map((roleId: unknown) => String(roleId || "").trim())
          .filter(Boolean)
          .slice(0, 100)
      : [],
    characters: normalizeCharacters(data.characters, mainCharacterKey),
    mainCharacterKey,
    nicknameCharacterKeys: cleanNicknameCharacterKeys(
      data.nicknameCharacterKeys || data.discordNicknameCharacterKeys,
      mainCharacterKey,
    ),
    raidRolePreference: normalizeRaidRolePreference(
      data.raidRolePreference,
      mainCharacterKey,
    ),
    discordNickname: discordNicknameRaw
      ? {
          value: cleanDiscordNicknamePart(discordNicknameRaw.value, 32) || null,
          syncedAt:
            timestampToIso(discordNicknameRaw.syncedAt) ||
            optionalString(discordNicknameRaw.syncedAt),
          sourcePreferredName:
            cleanProfileName(discordNicknameRaw.sourcePreferredName, 32) ||
            null,
          sourceCharacters: Array.isArray(discordNicknameRaw.sourceCharacters)
            ? discordNicknameRaw.sourceCharacters
                .map((item: unknown) => cleanDiscordNicknamePart(item, 16))
                .filter(Boolean)
                .slice(0, 3)
            : [],
        }
      : null,
    battlenet: battlenetRaw
      ? {
          linked: Boolean(battlenetRaw.linked),
          region: optionalString(battlenetRaw.region),
          accountLabel: optionalString(battlenetRaw.accountLabel),
          accountIdHash: optionalString(battlenetRaw.accountIdHash),
          lastConnectedAt: timestampToIso(battlenetRaw.lastConnectedAt),
          lastSyncAt: timestampToIso(battlenetRaw.lastSyncAt),
          lastCharacterRefreshAt: timestampToIso(
            battlenetRaw.lastCharacterRefreshAt,
          ),
          lastProfileViewRefreshAt: timestampToIso(
            battlenetRaw.lastProfileViewRefreshAt,
          ),
          lastProfileViewRefresh:
            battlenetRaw.lastProfileViewRefresh &&
            typeof battlenetRaw.lastProfileViewRefresh === "object"
              ? {
                  refreshed: Number.isFinite(
                    Number(
                      (
                        battlenetRaw.lastProfileViewRefresh as Record<
                          string,
                          unknown
                        >
                      ).refreshed,
                    ),
                  )
                    ? Number(
                        (
                          battlenetRaw.lastProfileViewRefresh as Record<
                            string,
                            unknown
                          >
                        ).refreshed,
                      )
                    : undefined,
                  failed: Number.isFinite(
                    Number(
                      (
                        battlenetRaw.lastProfileViewRefresh as Record<
                          string,
                          unknown
                        >
                      ).failed,
                    ),
                  )
                    ? Number(
                        (
                          battlenetRaw.lastProfileViewRefresh as Record<
                            string,
                            unknown
                          >
                        ).failed,
                      )
                    : undefined,
                  skipped: Number.isFinite(
                    Number(
                      (
                        battlenetRaw.lastProfileViewRefresh as Record<
                          string,
                          unknown
                        >
                      ).skipped,
                    ),
                  )
                    ? Number(
                        (
                          battlenetRaw.lastProfileViewRefresh as Record<
                            string,
                            unknown
                          >
                        ).skipped,
                      )
                    : undefined,
                  updatedAt: timestampToIso(
                    (
                      battlenetRaw.lastProfileViewRefresh as Record<
                        string,
                        unknown
                      >
                    ).updatedAt,
                  ),
                }
              : null,
          totalCharacters: Number.isFinite(Number(battlenetRaw.totalCharacters))
            ? Number(battlenetRaw.totalCharacters)
            : undefined,
          scannedCharacters: Number.isFinite(
            Number(battlenetRaw.scannedCharacters),
          )
            ? Number(battlenetRaw.scannedCharacters)
            : undefined,
          eligibleCharacters: Number.isFinite(
            Number(battlenetRaw.eligibleCharacters),
          )
            ? Number(battlenetRaw.eligibleCharacters)
            : undefined,
          guildCharacters: Number.isFinite(Number(battlenetRaw.guildCharacters))
            ? Number(battlenetRaw.guildCharacters)
            : undefined,
          otherCharacters: Number.isFinite(Number(battlenetRaw.otherCharacters))
            ? Number(battlenetRaw.otherCharacters)
            : undefined,
          candidateCharacters:
            normalizeBattleNetCandidateCharacters(battlenetRaw),
          candidateSavedAt: candidateExpiryIso(battlenetRaw.candidateExpiresAt)
            ? timestampToIso(battlenetRaw.candidateSavedAt)
            : null,
          candidateExpiresAt: candidateExpiryIso(
            battlenetRaw.candidateExpiresAt,
          ),
        }
      : null,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    lastLoginAt: timestampToIso(data.lastLoginAt),
  };
}

export async function getOwnProfilePath(session: DashboardSession) {
  const profileId =
    session.profileId ||
    (await createStableProfileId(session.provider, session.id));
  const profile = await getProfileById(profileId).catch(() => null);
  if (
    profileNeedsSettingsSetup(
      profile || profileFromSession({ ...session, profileId }),
    )
  ) {
    return profileSettingsSetupPath(profileId);
  }
  return `/profile/${profileId}`;
}

export function canViewProfile(
  viewer: DashboardSession | null | undefined,
  profileId: string,
  profile?: Pick<
    DashboardProfile,
    | "role"
    | "profileId"
    | "provider"
    | "providerUserId"
    | "groupId"
    | "groupRank"
  > | null,
) {
  if (!viewer) return false;
  const ownProfileId = viewer.profileId || "";
  const isOwnProfile =
    Boolean(ownProfileId && ownProfileId === profileId) ||
    Boolean(
      profile &&
      profile.provider === viewer.provider &&
      profile.providerUserId === viewer.id,
    );
  if (isOwnProfile) return true;

  if (canViewAllProfiles(viewer)) return true;
  if (!profile) return canViewProfiles(viewer);
  if (!canViewProfilesInOwnGroupOrBelow(viewer)) return false;

  const viewerRank = Number.isFinite(Number(viewer.groupRank))
    ? Math.floor(Number(viewer.groupRank))
    : dashboardRoleRank(viewer.role);
  const targetRank = Number.isFinite(Number(profile.groupRank))
    ? Math.floor(Number(profile.groupRank))
    : dashboardRoleRank(profile.role);
  return viewerRank >= targetRank;
}

export function canManageProfiles(viewer: DashboardSession | null | undefined) {
  return canManageApplications(viewer);
}

export function canManageOwnCharacters(
  viewer: DashboardSession | null | undefined,
  profileId: string,
) {
  return Boolean(viewer?.profileId && viewer.profileId === profileId);
}

export async function upsertProfileFromSession(session: DashboardSession) {
  const profileId =
    session.profileId ||
    (await createStableProfileId(session.provider, session.id));
  const profile: DashboardProfile = {
    profileId,
    provider: session.provider,
    providerUserId: session.id,
    displayName: session.name || session.login || "Guild member",
    preferredName: null,
    publicNameMode: "name",
    grammaticalGender: "unspecified",
    login: session.login || null,
    role: session.role,
    groupId: session.groupId || null,
    groupName: session.groupName || null,
    groupRank: Number.isFinite(Number(session.groupRank))
      ? Math.floor(Number(session.groupRank))
      : dashboardRoleRank(session.role),
    avatarUrl: session.avatar_url || session.avatar || null,
    discordRoleIds: Array.from(
      new Set(
        (session.discordRoleIds || [])
          .map((roleId) => String(roleId || "").trim())
          .filter(Boolean),
      ),
    ).slice(0, 100),
    characters: [],
    mainCharacterKey: null,
    nicknameCharacterKeys: [],
    raidRolePreference: null,
    discordNickname: null,
    battlenet: null,
  };

  if (!hasFirebaseProfileConfig()) {
    return {
      profile,
      stored: false,
      reason: "firebase-not-configured" as const,
    };
  }

  await writeProfileStorage(
    `profile:${profileId}:ensure`,
    async () => {
      const db = getFirebaseAdminDb();
      const ref = db.collection("dashboardProfiles").doc(profileId);
      const snapshot = await ref.get();
      await ref.set(
        {
          profileId,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          displayName: profile.displayName,
          login: profile.login || null,
          role: profile.role,
          groupId: profile.groupId || null,
          groupName: profile.groupName || null,
          groupRank: Number.isFinite(Number(profile.groupRank))
            ? Math.floor(Number(profile.groupRank))
            : fallbackProfileRank(profile.role),
          avatarUrl: profile.avatarUrl || null,
          discordRoleIds: profile.discordRoleIds,
          updatedAt: FieldValue.serverTimestamp(),
          lastLoginAt: FieldValue.serverTimestamp(),
          ...(snapshot.exists
            ? {}
            : {
                createdAt: FieldValue.serverTimestamp(),
                characters: [],
                mainCharacterKey: null,
                nicknameCharacterKeys: [],
                raidRolePreference: null,
                publicNameMode: "name",
                grammaticalGender: "unspecified",
              }),
        },
        { merge: true },
      );
    },
    { timeoutMs: 4_000, logEvent: "profiles.ensure_write_failed" },
  );

  clearProfileRuntimeCaches(profileId);
  return { profile, stored: true };
}

export async function getProfileById(profileId: string) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId)) return null;
  if (!hasFirebaseProfileConfig()) return null;

  return resilientRead(
    `profile:${profileId}`,
    async () => {
      const ref = getFirebaseAdminDb()
        .collection("dashboardProfiles")
        .doc(profileId);
      const snapshot = await ref.get();
      if (!snapshot.exists) return null;

      let data = snapshot.data() || {};
      const battlenetRaw =
        data.battlenet && typeof data.battlenet === "object"
          ? (data.battlenet as Record<string, unknown>)
          : null;
      if (
        hasCandidateStorage(battlenetRaw) &&
        !isFutureTimestamp(battlenetRaw?.candidateExpiresAt)
      ) {
        data = stripCandidateStorageFromData(data);
        void resilientWrite(
          `profile:${profileId}:candidate-cleanup`,
          () => ref.update({
            ...candidateStorageDeleteUpdate(),
            updatedAt: FieldValue.serverTimestamp(),
          }),
          {
            circuitKey: "firebase-profile-write",
            timeoutMs: 2_000,
            fallback: () => undefined,
            logEvent: "profiles.candidate_cleanup_failed",
          },
        );
      }

      const profile = normalizeProfile(profileId, data);
      return resolveProfileAccessForCurrentGroups(profile);
    },
    {
      ttlMs: Math.max(30_000, Math.min(300_000, Number((await getSiteRuntimeSettings().catch(() => null))?.profileReadCacheTtlMs || process.env.PROFILE_READ_CACHE_TTL_MS || 60_000))),
      timeoutMs: 3_000,
      circuitKey: "firebase-profile-read",
      circuitTtlMs: 90_000,
      fallback: () => getRuntimeCachedValue<DashboardProfile | null>(`profile:${profileId}`, 24 * 60 * 60 * 1000),
      logEvent: "profiles.item_read_failed",
    },
  );
}

export async function getProfileByDiscordUserId(discordUserId: string) {
  const cleanDiscordId = String(discordUserId || "").trim();
  if (!/^\d{16,25}$/.test(cleanDiscordId)) return null;
  if (!hasFirebaseProfileConfig()) return null;

  // Fast path: current stable document id. This is what new Discord logins use.
  const stableProfileId = await createStableProfileId(
    "discord",
    cleanDiscordId,
  );
  const stableProfile = await getProfileById(stableProfileId);
  if (stableProfile) return stableProfile;

  // Compatibility path for existing Firebase profiles. If PROFILE_ID_SECRET or
  // SESSION_SECRET was rotated after a profile was created, the deterministic
  // document id changes. Querying Firestore by providerUserId keeps already
  // stored dashboardProfiles documents usable for Worker lookups.
  return resilientRead(
    `profile:discord:${cleanDiscordId}`,
    async () => {
      const db = getFirebaseAdminDb();
      const byProviderUserId = await db
        .collection("dashboardProfiles")
        .where("providerUserId", "==", cleanDiscordId)
        .limit(5)
        .get();

      for (const doc of byProviderUserId.docs) {
        const profile = normalizeProfile(doc.id, doc.data() || {});
        if (
          profile.provider === "discord" ||
          profile.providerUserId === cleanDiscordId
        ) {
          return resolveProfileAccessForCurrentGroups(profile);
        }
      }

      // Older experiments may have stored the Discord id under a direct field.
      // Keep these fallbacks cheap and limited.
      for (const field of ["discordId", "discordUserId"]) {
        const snapshot = await db
          .collection("dashboardProfiles")
          .where(field, "==", cleanDiscordId)
          .limit(1)
          .get()
          .catch(() => null);

        const doc = snapshot?.docs?.[0];
        if (doc)
          return resolveProfileAccessForCurrentGroups(
            normalizeProfile(doc.id, doc.data() || {}),
          );
      }

      return null;
    },
    {
      ttlMs: 60_000,
      timeoutMs: 3_000,
      circuitKey: "firebase-profile-read",
      circuitTtlMs: 90_000,
      fallback: () => getRuntimeCachedValue<DashboardProfile | null>(`profile:discord:${cleanDiscordId}`, 24 * 60 * 60 * 1000),
      logEvent: "profiles.discord_lookup_read_failed",
    },
  );
}

export async function listDashboardProfiles(params: {
  viewer: DashboardSession;
  query?: string;
  limit?: number;
}): Promise<DashboardProfile[]> {
  if (!hasFirebaseProfileConfig()) return [];

  const safeLimit = Math.max(10, Math.min(200, Number(params.limit || 120)));
  const query = String(params.query || "")
    .trim()
    .toLocaleLowerCase("uk");
  const [profilesFromStore, groups] = await Promise.all([
    resilientRead(
      `profiles:list:${safeLimit}`,
      async () => {
        const snapshot = await getFirebaseAdminDb().collection("dashboardProfiles").limit(safeLimit).get();
        return snapshot.docs.map((doc: any) => normalizeProfile(doc.id, doc.data() || {}));
      },
      {
        ttlMs: Math.max(30_000, Math.min(300_000, Number((await getSiteRuntimeSettings().catch(() => null))?.profileListCacheTtlMs || process.env.PROFILE_LIST_CACHE_TTL_MS || 60_000))),
        timeoutMs: 3_000,
        circuitKey: "firebase-profile-read",
        circuitTtlMs: 90_000,
        fallback: () => getRuntimeCachedValue<DashboardProfile[]>(`profiles:list:${safeLimit}`, 24 * 60 * 60 * 1000) || [],
        logEvent: "profiles.list_read_failed",
      },
    ),
    listAccessGroups().catch(() => [] as AccessGroup[]),
  ]);
  const profiles: DashboardProfile[] = profilesFromStore
    .map((profile: DashboardProfile) =>
      groups.length ? applyCurrentProfileGroup(profile, groups) : profile,
    )
    .filter((profile: DashboardProfile) =>
      canViewProfile(params.viewer, profile.profileId, profile),
    );

  const filtered = query
    ? profiles.filter((profile: DashboardProfile) =>
        [
          getProfilePublicName(profile),
          getProfileSiteName(profile),
          getProfileServerStyleName(profile),
          profile.displayName,
          profile.preferredName,
          profile.login,
          profile.role,
          profile.provider,
          profile.characters
            .map((item: ProfileCharacter) => item.name)
            .join(" "),
          profile.characters
            .map((item: ProfileCharacter) => item.realmName || item.realmSlug)
            .join(" "),
          getMainCharacter(profile)?.name,
        ].some((value) =>
          String(value || "")
            .toLocaleLowerCase("uk")
            .includes(query),
        ),
      )
    : profiles;

  return filtered.sort((a: DashboardProfile, b: DashboardProfile) => {
    const aTime =
      Date.parse(a.lastLoginAt || a.updatedAt || a.createdAt || "") || 0;
    const bTime =
      Date.parse(b.lastLoginAt || b.updatedAt || b.createdAt || "") || 0;
    return (
      bTime - aTime ||
      getProfilePublicName(a).localeCompare(getProfilePublicName(b), "uk")
    );
  });
}

export async function listDashboardProfilesForDiscordSync(
  limit = 1000,
): Promise<DashboardProfile[]> {
  if (!hasFirebaseProfileConfig()) return [];
  const safeLimit = Math.max(
    10,
    Math.min(1000, Math.floor(Number(limit) || 1000)),
  );
  const snapshotProfiles = await resilientRead(
    `profiles:discord-sync:${safeLimit}`,
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection("dashboardProfiles")
        .limit(safeLimit)
        .get();
      return snapshot.docs.map((doc: any) => normalizeProfile(doc.id, doc.data() || {}));
    },
    {
      ttlMs: 60_000,
      timeoutMs: 4_000,
      circuitKey: "firebase-profile-read",
      circuitTtlMs: 90_000,
      fallback: () => getRuntimeCachedValue<DashboardProfile[]>(`profiles:discord-sync:${safeLimit}`, 10 * 60_000) || [],
      logEvent: "profiles.discord_sync_read_failed",
    },
  );
  const groups = await listAccessGroups().catch(() => [] as AccessGroup[]);
  return snapshotProfiles
    .map((profile: DashboardProfile) =>
      groups.length ? applyCurrentProfileGroup(profile, groups) : profile,
    );
}

export async function listAllDashboardProfilesForDiscordSync(
  maxTotalInput?: unknown,
): Promise<DashboardProfile[]> {
  if (!hasFirebaseProfileConfig()) return [];

  const maxTotalNumber = Number(maxTotalInput);
  const maxTotal =
    Number.isFinite(maxTotalNumber) && maxTotalNumber > 0
      ? Math.min(50_000, Math.floor(maxTotalNumber))
      : 50_000;
  const pageSize = 500;
  const profiles = await resilientRead(
    `profiles:discord-sync:all:${maxTotal}`,
    async () => {
      const db = getFirebaseAdminDb();
      const baseQuery = db
        .collection("dashboardProfiles")
        .orderBy(FieldPath.documentId());
      const docs: any[] = [];
      let cursor: any = null;

      while (docs.length < maxTotal) {
        let query: any = baseQuery.limit(
          Math.min(pageSize, maxTotal - docs.length),
        );
        if (cursor)
          query = baseQuery
            .startAfter(cursor)
            .limit(Math.min(pageSize, maxTotal - docs.length));

        const snapshot = await query.get();
        if (snapshot.empty) break;
        docs.push(...snapshot.docs);
        cursor = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < pageSize) break;
      }

      return docs.map((doc: any) => normalizeProfile(doc.id, doc.data() || {}));
    },
    {
      ttlMs: 60_000,
      timeoutMs: 8_000,
      circuitKey: "firebase-profile-read",
      circuitTtlMs: 90_000,
      fallback: () => getRuntimeCachedValue<DashboardProfile[]>(`profiles:discord-sync:all:${maxTotal}`, 10 * 60_000) || [],
      logEvent: "profiles.discord_sync_all_read_failed",
    },
  );

  const groups = await listAccessGroups().catch(() => [] as AccessGroup[]);
  return profiles
    .map((profile: DashboardProfile) =>
      groups.length ? applyCurrentProfileGroup(profile, groups) : profile,
    );
}

export type CharacterProfileLink = {
  profileId: string;
  displayName: string;
};

const PROFILE_CHARACTER_LINKS_COLLECTION = "dashboardProfileCharacterLinks";

function profileCharacterLinksScanFallbackEnabled() {
  const raw = process.env.PROFILE_CHARACTER_LINKS_SCAN_FALLBACK;
  if (raw === undefined || raw === null || raw === "") return true;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function profileCharacterLinksReadRepairEnabled() {
  const raw = process.env.PROFILE_CHARACTER_LINKS_READ_REPAIR;
  if (raw === undefined || raw === null || raw === "") return true;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function profileCharacterLinksScanFallbackLimit() {
  const value = Number(process.env.PROFILE_CHARACTER_LINKS_SCAN_LIMIT || 250);
  if (!Number.isFinite(value)) return 250;
  return Math.max(50, Math.min(500, Math.floor(value)));
}

type CharacterProfileLinksCacheEntry = {
  checkedAt: number;
  links: Map<string, CharacterProfileLink>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomCharacterProfileLinksCache:
    | CharacterProfileLinksCacheEntry
    | undefined;
}

async function characterProfileLinksCacheTtlMs() {
  const settings = await getSiteRuntimeSettings().catch(() => null);
  const configured = Number(settings?.profileCharacterLinksCacheTtlMs);
  if (Number.isFinite(configured)) {
    return Math.max(30_000, Math.min(600_000, Math.floor(configured)));
  }
  const parsed = Number(process.env.PROFILE_CHARACTER_LINK_CACHE_SECONDS || 120);
  if (!Number.isFinite(parsed)) return 120_000;
  return Math.max(30, Math.min(900, Math.floor(parsed))) * 1000;
}

export function clearCharacterProfileLinksCache() {
  globalThis.__mistblossomCharacterProfileLinksCache = undefined;
  clearRuntimeCachedValue("profile-character-links");
  clearRuntimeCachedValuesByPrefix("profile-character-links:");
}

function clearProfileRuntimeCaches(profileId?: string | null, options: { characterLinks?: boolean } = {}) {
  const cleanId = String(profileId || "").trim();
  if (cleanId) clearRuntimeCachedValue(`profile:${cleanId}`);
  clearRuntimeCachedValuesByPrefix("profiles:list:");
  if (options.characterLinks) {
    clearCharacterProfileLinksCache();
    if (cleanId) void syncCharacterProfileLinksForProfileId(cleanId).catch(() => null);
  }
}

function profileWriteUnavailableError() {
  return new Error(firebaseUnavailableMessage("profile", "write"));
}

async function writeProfileStorage<T>(
  key: string,
  writer: () => Promise<T>,
  options: { timeoutMs?: number; logEvent?: string } = {},
) {
  return firebaseWrite("profile", key, writer, {
    timeoutMs: options.timeoutMs || 4_000,
    logEvent: options.logEvent || "profiles.write_failed",
    fallback: () => {
      throw profileWriteUnavailableError();
    },
  });
}

function characterProfileLinkKeys(character: ProfileCharacter) {
  const keys = new Set<string>();
  const existingKey = normalizeCharacterKey(character.key);
  if (existingKey) keys.add(existingKey);

  const region = character.region || "eu";
  const realmValues = [character.realmSlug, character.realmName].filter(
    Boolean,
  );
  const nameValues = [character.normalizedName, character.name].filter(Boolean);

  for (const realm of realmValues) {
    for (const name of nameValues) {
      const key = buildBattleNetCharacterKey(region, realm, name);
      if (key) keys.add(key);
    }
  }

  return keys;
}

function normalizeCharacterProfileLinkData(data: any): CharacterProfileLink | null {
  const profileId = cleanString(data?.profileId, 80);
  const displayName = cleanProfileName(data?.displayName || data?.profileDisplayName || "", 64);
  if (!/^id[a-f0-9]{16,40}$/.test(profileId)) return null;
  return { profileId, displayName: displayName || "Учасник" };
}

function characterProfileLinkDocId(keyInput: unknown) {
  const normalized = normalizeCharacterKey(keyInput);
  return normalized ? normalized.replace(/\//g, ":") : "";
}

function buildProfileCharacterLinkDocuments(profile: DashboardProfile) {
  const displayName = getProfilePublicName(profile);
  const docs = new Map<string, Record<string, unknown>>();
  for (const character of profile.characters || []) {
    for (const key of characterProfileLinkKeys(character)) {
      const docId = characterProfileLinkDocId(key);
      if (!docId) continue;
      docs.set(docId, {
        key: docId,
        profileId: profile.profileId,
        displayName,
        characterName: character.name,
        normalizedName: character.normalizedName,
        realmSlug: character.realmSlug,
        realmName: character.realmName,
        region: character.region || "eu",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  return docs;
}

async function syncCharacterProfileLinksForProfileId(profileId: string) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId) || !hasFirebaseProfileConfig()) return;
  const db = getFirebaseAdminDb();
  const profileRef = db.collection("dashboardProfiles").doc(profileId);
  const snapshot = await profileRef.get();
  const profile = snapshot.exists ? normalizeProfile(profileId, snapshot.data() || {}) : null;
  const nextDocs = profile ? buildProfileCharacterLinkDocuments(profile) : new Map<string, Record<string, unknown>>();
  const existing = await db
    .collection(PROFILE_CHARACTER_LINKS_COLLECTION)
    .where("profileId", "==", profileId)
    .limit(500)
    .get();
  const nextIds = new Set(nextDocs.keys());
  const writes: Array<{ type: "delete"; ref: any } | { type: "set"; ref: any; data: Record<string, unknown> }> = [];

  for (const doc of existing.docs) {
    if (!nextIds.has(doc.id)) writes.push({ type: "delete", ref: doc.ref });
  }
  for (const [docId, data] of nextDocs) {
    writes.push({
      type: "set",
      ref: db.collection(PROFILE_CHARACTER_LINKS_COLLECTION).doc(docId),
      data,
    });
  }

  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const item of writes.slice(index, index + 400)) {
      if (item.type === "delete") batch.delete(item.ref);
      else batch.set(item.ref, item.data, { merge: true });
    }
    await batch.commit();
  }

  clearCharacterProfileLinksCache();
}

async function readCharacterProfileLinksFromIndex(keys?: Iterable<string>) {
  const links = new Map<string, CharacterProfileLink>();
  const db = getFirebaseAdminDb();
  const normalizedKeys = Array.from(
    new Set(Array.from(keys || []).map(characterProfileLinkDocId).filter(Boolean)),
  );

  if (normalizedKeys.length) {
    for (let index = 0; index < normalizedKeys.length; index += 300) {
      const refs = normalizedKeys
        .slice(index, index + 300)
        .map((key) => db.collection(PROFILE_CHARACTER_LINKS_COLLECTION).doc(key));
      const snapshots = await db.getAll(...refs);
      for (let itemIndex = 0; itemIndex < snapshots.length; itemIndex += 1) {
        const snapshot = snapshots[itemIndex];
        if (!snapshot.exists) continue;
        const link = normalizeCharacterProfileLinkData(snapshot.data() || {});
        if (link) links.set(normalizedKeys[index + itemIndex], link);
      }
    }
    return links;
  }

  const snapshot = await db
    .collection(PROFILE_CHARACTER_LINKS_COLLECTION)
    .limit(5000)
    .get();
  for (const doc of snapshot.docs) {
    const link = normalizeCharacterProfileLinkData(doc.data() || {});
    if (link) links.set(doc.id, link);
  }
  return links;
}

async function repairCharacterProfileLinksIndex(
  links: Map<string, CharacterProfileLink>,
) {
  if (!links.size || !profileCharacterLinksReadRepairEnabled()) return;
  const db = getFirebaseAdminDb();
  const entries = Array.from(links.entries()).filter(([key, link]) =>
    Boolean(characterProfileLinkDocId(key) && link?.profileId),
  );
  for (let index = 0; index < entries.length; index += 400) {
    const batch = db.batch();
    for (const [key, link] of entries.slice(index, index + 400)) {
      const docId = characterProfileLinkDocId(key);
      if (!docId) continue;
      batch.set(
        db.collection(PROFILE_CHARACTER_LINKS_COLLECTION).doc(docId),
        {
          key: docId,
          profileId: link.profileId,
          displayName: link.displayName || "Учасник",
          repairedFromProfileScan: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

function subsetCharacterProfileLinks(
  links: Map<string, CharacterProfileLink>,
  keys: string[],
) {
  const subset = new Map<string, CharacterProfileLink>();
  for (const key of keys) {
    const link = links.get(key);
    if (link) subset.set(key, link);
  }
  return subset;
}

async function scanCharacterProfileLinksFromProfiles() {
  const contenders = new Map<
    string,
    { link: CharacterProfileLink; profileIds: Set<string>; duplicate: boolean }
  >();
  const snapshot = await getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .limit(profileCharacterLinksScanFallbackLimit())
    .get();
  const profiles = snapshot.docs.map((doc: any) =>
    normalizeProfile(doc.id, doc.data() || {}),
  );

  for (const profile of profiles) {
    const displayName = getProfilePublicName(profile);
    for (const character of profile.characters) {
      for (const key of characterProfileLinkKeys(character)) {
        const docId = characterProfileLinkDocId(key);
        if (!docId) continue;
        const existing = contenders.get(docId);
        if (!existing) {
          contenders.set(docId, {
            link: {
              profileId: profile.profileId,
              displayName,
            },
            profileIds: new Set([profile.profileId]),
            duplicate: false,
          });
          continue;
        }

        existing.profileIds.add(profile.profileId);
        if (existing.profileIds.size > 1) existing.duplicate = true;
      }
    }
  }

  const links = new Map<string, CharacterProfileLink>();
  for (const [key, contender] of contenders) {
    if (!contender.duplicate) links.set(key, contender.link);
  }
  return links;
}

export async function listCharacterProfileLinks() {
  const emptyLinks = new Map<string, CharacterProfileLink>();
  if (!hasFirebaseProfileConfig()) return emptyLinks;

  const cached = globalThis.__mistblossomCharacterProfileLinksCache;
  const ttlMs = await characterProfileLinksCacheTtlMs();
  if (cached && Date.now() - cached.checkedAt < ttlMs) {
    return new Map(cached.links);
  }

  return resilientRead(
    "profile-character-links",
    async () => {
      let links = await readCharacterProfileLinksFromIndex();
      if (!links.size && profileCharacterLinksScanFallbackEnabled()) {
        links = await scanCharacterProfileLinksFromProfiles();
        await repairCharacterProfileLinksIndex(links).catch(() => null);
      }
      globalThis.__mistblossomCharacterProfileLinksCache = {
        checkedAt: Date.now(),
        links: new Map(links),
      };
      return links;
    },
    {
      ttlMs,
      timeoutMs: 3_500,
      circuitKey: "firebase-profile-links-read",
      circuitTtlMs: 90_000,
      fallback: () => cached ? new Map(cached.links) : emptyLinks,
      logEvent: "profiles.character_links_read_failed",
    },
  );
}

export async function listCharacterProfileLinksForKeys(keysInput: Iterable<string>) {
  const emptyLinks = new Map<string, CharacterProfileLink>();
  if (!hasFirebaseProfileConfig()) return emptyLinks;
  const keys = Array.from(new Set(Array.from(keysInput || []).map(characterProfileLinkDocId).filter(Boolean)));
  if (!keys.length) return emptyLinks;

  const cached = globalThis.__mistblossomCharacterProfileLinksCache;
  const ttlMs = await characterProfileLinksCacheTtlMs();
  if (cached && Date.now() - cached.checkedAt < ttlMs) {
    const subset = subsetCharacterProfileLinks(cached.links, keys);
    if (subset.size === keys.length) return subset;
  }

  return resilientRead(
    `profile-character-links:v2:${keys.length}:${keys.slice(0, 20).join("|")}`,
    async () => {
      let links = await readCharacterProfileLinksFromIndex(keys);
      const missingKeys = keys.filter((key) => !links.has(key));

      if (missingKeys.length && profileCharacterLinksScanFallbackEnabled()) {
        const scanned = await scanCharacterProfileLinksFromProfiles();
        globalThis.__mistblossomCharacterProfileLinksCache = {
          checkedAt: Date.now(),
          links: new Map(scanned),
        };

        const repairedLinks = subsetCharacterProfileLinks(scanned, missingKeys);
        if (repairedLinks.size) {
          await repairCharacterProfileLinksIndex(repairedLinks).catch(() => null);
          links = new Map([...links, ...repairedLinks]);
        }
      }

      return links;
    },
    {
      ttlMs,
      timeoutMs: 2_500,
      circuitKey: "firebase-profile-links-read",
      circuitTtlMs: 90_000,
      fallback: () => {
        if (!cached) return emptyLinks;
        const subset = new Map<string, CharacterProfileLink>();
        for (const key of keys) {
          const link = cached.links.get(key);
          if (link) subset.set(key, link);
        }
        return subset;
      },
      logEvent: "profiles.character_links_read_failed",
    },
  );
}

export type ProfileCharacterConflict = {
  profileId: string;
  displayName: string;
  characterKey: string;
  characterName: string;
  realmName: string | null;
  requestedKey: string;
};

export class ProfileCharacterConflictError extends Error {
  conflicts: ProfileCharacterConflict[];

  constructor(conflicts: ProfileCharacterConflict[]) {
    const first = conflicts[0];
    const character = first
      ? `${first.characterName}${first.realmName ? `-${first.realmName}` : ""}`
      : "персонаж";
    super(`${character} уже привʼязаний до іншого профілю.`);
    this.name = "ProfileCharacterConflictError";
    this.conflicts = conflicts;
  }
}

function normalizedConflictCharacters(inputs: unknown[]) {
  const byKey = new Map<string, ProfileCharacter>();
  for (const input of inputs || []) {
    const character = normalizeCharacter(input, null);
    if (!character?.key) continue;
    for (const key of characterProfileLinkKeys(character)) {
      if (!byKey.has(key)) byKey.set(key, character);
    }
  }
  return byKey;
}

export async function findProfileCharacterConflicts(
  profileId: string,
  characterInputs: unknown[],
  options: {
    maxProfiles?: number;
    maxConflicts?: number;
    excludeProviderUserId?: string | null;
  } = {},
): Promise<ProfileCharacterConflict[]> {
  const requestedByKey = normalizedConflictCharacters(characterInputs);
  const cleanProfileId = String(profileId || "").trim();
  if (!requestedByKey.size || !hasFirebaseProfileConfig()) return [];

  const maxProfiles = Math.max(
    100,
    Math.min(50_000, Math.floor(Number(options.maxProfiles) || 50_000)),
  );
  const maxConflicts = Math.max(
    1,
    Math.min(100, Math.floor(Number(options.maxConflicts) || 25)),
  );
  const excludedProviderUserId = String(
    options.excludeProviderUserId || "",
  ).trim();
  const pageSize = 500;
  const db = getFirebaseAdminDb();
  const baseQuery = db
    .collection("dashboardProfiles")
    .orderBy(FieldPath.documentId());
  const conflicts: ProfileCharacterConflict[] = [];
  const seen = new Set<string>();
  let cursor: any = null;
  let checked = 0;

  while (checked < maxProfiles && conflicts.length < maxConflicts) {
    let query: any = baseQuery.limit(Math.min(pageSize, maxProfiles - checked));
    if (cursor)
      query = baseQuery
        .startAfter(cursor)
        .limit(Math.min(pageSize, maxProfiles - checked));

    const snapshot = await query.get();
    if (snapshot.empty) break;
    checked += snapshot.docs.length;
    cursor = snapshot.docs[snapshot.docs.length - 1];

    for (const doc of snapshot.docs) {
      if (doc.id === cleanProfileId) continue;
      const profile = normalizeProfile(doc.id, doc.data() || {});
      if (
        excludedProviderUserId &&
        profile.providerUserId === excludedProviderUserId
      )
        continue;
      if (!profile.characters.length) continue;

      for (const character of profile.characters) {
        for (const linkKey of characterProfileLinkKeys(character)) {
          const requested = requestedByKey.get(linkKey);
          if (!requested) continue;
          const conflictId = `${profile.profileId}:${character.key}:${requested.key}`;
          if (seen.has(conflictId)) continue;
          seen.add(conflictId);
          conflicts.push({
            profileId: profile.profileId,
            displayName: getProfilePublicName(profile),
            characterKey: character.key,
            characterName: character.name,
            realmName: character.realmName || character.realmSlug || null,
            requestedKey: requested.key,
          });
          if (conflicts.length >= maxConflicts) return conflicts;
        }
      }
    }

    if (snapshot.docs.length < pageSize) break;
  }

  return conflicts;
}

export async function assertNoProfileCharacterConflicts(
  profileId: string,
  characterInputs: unknown[],
) {
  let excludeProviderUserId = "";
  if (
    /^id[a-f0-9]{16,40}$/.test(String(profileId || "")) &&
    hasFirebaseProfileConfig()
  ) {
    const snapshot = await getFirebaseAdminDb()
      .collection("dashboardProfiles")
      .doc(profileId)
      .get()
      .catch(() => null);
    excludeProviderUserId = String(
      snapshot?.data()?.providerUserId || "",
    ).trim();
  }
  const conflicts = await findProfileCharacterConflicts(
    profileId,
    characterInputs,
    { excludeProviderUserId },
  );
  if (conflicts.length) throw new ProfileCharacterConflictError(conflicts);
  return true;
}

export function profileFromSession(
  session: DashboardSession,
): DashboardProfile {
  return {
    profileId: session.profileId || "",
    provider: session.provider,
    providerUserId: session.id,
    displayName: session.name || session.login || "Guild member",
    preferredName: null,
    publicNameMode: "name",
    grammaticalGender: "unspecified",
    login: session.login || null,
    role: session.role,
    groupId: session.groupId || null,
    groupName: session.groupName || null,
    groupRank: Number.isFinite(Number(session.groupRank))
      ? Math.floor(Number(session.groupRank))
      : dashboardRoleRank(session.role),
    avatarUrl: session.avatar_url || session.avatar || null,
    discordRoleIds: session.discordRoleIds || [],
    characters: [],
    mainCharacterKey: null,
    nicknameCharacterKeys: [],
    raidRolePreference: null,
    discordNickname: null,
    battlenet: null,
  };
}

export async function saveBattleNetSyncState(
  profileId: string,
  scan: {
    region: BattleNetRegion | string;
    totalCharacters: number;
    scannedCharacters: number;
    eligibleCharacters: number;
    guildCharacters?: number;
    otherCharacters?: number;
    characters?: BattleNetCharacterCandidate[];
  },
  account?: BattleNetAccountInfo | null,
) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId))
    throw new Error("Некоректний ID профілю.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);
  const snapshot = await ref.get();
  const freshByKey = new Map<string, ProfileCharacter>();

  for (const candidateInput of scan.characters || []) {
    const candidate = normalizeCharacter(candidateInput, null);
    if (candidate?.key) freshByKey.set(candidate.key, candidate);
  }

  const candidateCharacters = Array.from(freshByKey.values());
  const candidateExpiresAt = Timestamp.fromDate(
    new Date(Date.now() + getBattleNetCandidateTtlMs()),
  );
  const guildCharacters = Number.isFinite(Number(scan.guildCharacters))
    ? Math.max(0, Math.floor(Number(scan.guildCharacters)))
    : candidateCharacters.filter((character) =>
        Boolean(character.verifiedGuild),
      ).length;

  const payload: Record<string, unknown> = {
    battlenet: {
      linked: true,
      region: scan.region,
      accountLabel: account?.accountLabel || null,
      accountIdHash: account?.accountIdHash || null,
      lastConnectedAt: FieldValue.serverTimestamp(),
      lastSyncAt: FieldValue.serverTimestamp(),
      totalCharacters: scan.totalCharacters,
      scannedCharacters: scan.scannedCharacters,
      eligibleCharacters: scan.eligibleCharacters,
      guildCharacters,
      otherCharacters: Number.isFinite(Number(scan.otherCharacters))
        ? Math.max(0, Math.floor(Number(scan.otherCharacters)))
        : Math.max(0, candidateCharacters.length - guildCharacters),
      candidateCharacters,
      candidateSavedAt: FieldValue.serverTimestamp(),
      candidateExpiresAt,
    },
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!candidateCharacters.length) {
    payload.battlenet = {
      ...(payload.battlenet as Record<string, unknown>),
      candidateCharacters: FieldValue.delete(),
      candidateSavedAt: FieldValue.delete(),
      candidateExpiresAt: FieldValue.delete(),
    };
  }

  if (snapshot.exists && freshByKey.size) {
    const profile = normalizeProfile(profileId, snapshot.data() || {});
    if (profile.characters.length) {
      payload.characters = profile.characters.map((current) => {
        const fresh = freshByKey.get(current.key);
        if (!fresh) return current;
        return {
          ...current,
          ...fresh,
          addedAt: current.addedAt || fresh.addedAt || null,
          isMain: current.isMain,
        };
      });
    }
  }

  await writeProfileStorage(
    `profile:${profileId}:battlenet-scan`,
    async () => {
      await ref.set(payload, { merge: true });
      clearProfileRuntimeCaches(profileId, { characterLinks: true });
    },
    { timeoutMs: 4_000, logEvent: "profiles.battlenet_scan_write_failed" },
  );
}

export async function getProfileBattleNetCandidates(profileId: string) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId)) return [];
  const profile = await getProfileById(profileId).catch(() => null);
  return profile?.battlenet?.candidateCharacters || [];
}

export async function clearProfileBattleNetCandidates(
  profileId: string,
  expectedExpiresAt?: string | null,
) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId) || !hasFirebaseProfileConfig())
    return false;

  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;

  const data = snapshot.data() || {};
  const battlenetRaw =
    data.battlenet && typeof data.battlenet === "object"
      ? (data.battlenet as Record<string, unknown>)
      : null;
  if (!hasCandidateStorage(battlenetRaw)) return false;

  const currentExpiresMs = timestampMillis(battlenetRaw?.candidateExpiresAt);
  const expectedExpiresMs = expectedExpiresAt
    ? timestampMillis(expectedExpiresAt)
    : null;

  // A stale tab must not clear a freshly refreshed candidate list.
  // But once the stored list is already expired, clear it even if string formatting
  // differs between Firestore Timestamp and ISO sent by the client.
  if (
    expectedExpiresMs !== null &&
    currentExpiresMs !== null &&
    currentExpiresMs > expectedExpiresMs + 1000 &&
    isFutureTimestamp(battlenetRaw?.candidateExpiresAt)
  ) {
    return false;
  }
  if (isFutureTimestamp(battlenetRaw?.candidateExpiresAt)) return false;

  await writeProfileStorage(
    `profile:${profileId}:candidate-clear`,
    async () => {
      await ref.update({
        ...candidateStorageDeleteUpdate(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      clearProfileRuntimeCaches(profileId);
    },
    { timeoutMs: 3_000, logEvent: "profiles.candidate_clear_write_failed" },
  );
  return true;
}

export async function removeProfileBattleNetCandidates(
  profileId: string,
  characterKeys: string[],
) {
  const removeKeys = new Set(
    (characterKeys || []).map((key) => cleanCharacterKey(key)).filter(Boolean),
  );
  if (
    !removeKeys.size ||
    !/^id[a-f0-9]{16,40}$/.test(profileId) ||
    !hasFirebaseProfileConfig()
  )
    return;

  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);
  await writeProfileStorage(
    `profile:${profileId}:candidate-remove`,
    async () => {
      await getFirebaseAdminDb().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;

        const profile = normalizeProfile(profileId, snapshot.data() || {});
        const remaining = (profile.battlenet?.candidateCharacters || []).filter(
          (candidate) => !removeKeys.has(candidate.key),
        );
        if (!remaining.length) {
          transaction.update(ref, {
            ...candidateStorageDeleteUpdate(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        transaction.set(
          ref,
          {
            battlenet: {
              candidateCharacters: remaining,
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
      clearProfileRuntimeCaches(profileId);
    },
    { timeoutMs: 4_000, logEvent: "profiles.candidate_remove_write_failed" },
  );
}

type ProfileExternalRefreshReason =
  | "profile_view"
  | "raid_signup"
  | "manual"
  | "cron"
  | "background_api";

type ProfileExternalRefreshOptions = {
  reason?: ProfileExternalRefreshReason;
  maxCharacters?: number;
  minSpacingSeconds?: number;
  force?: boolean;
};

type ProfileExternalRefreshResult = {
  profile: DashboardProfile | null;
  refreshed: number;
  failed: number;
  skipped: number;
  locked: boolean;
};

type ProfileRefreshLock = {
  checkedAt: number;
  promise: Promise<ProfileExternalRefreshResult>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomProfileExternalRefreshLocks:
    | Map<string, ProfileRefreshLock>
    | undefined;
}

function profileRefreshLocks() {
  if (!globalThis.__mistblossomProfileExternalRefreshLocks) {
    globalThis.__mistblossomProfileExternalRefreshLocks = new Map<
      string,
      ProfileRefreshLock
    >();
  }
  return globalThis.__mistblossomProfileExternalRefreshLocks;
}

function profileRefreshConcurrency(
  total: number,
  configuredConcurrency = 0,
  configuredMaxConcurrency = 8,
) {
  return getAdaptiveConcurrency(total, {
    profile: "external-api",
    concurrency: configuredConcurrency > 0 ? configuredConcurrency : undefined,
    min: 1,
    max: Math.max(1, Math.min(configuredMaxConcurrency || 8, 8)),
  });
}

async function profileViewRefreshMinSpacingSeconds() {
  const settings = await getDashboardApiSettings();
  return settings.profileViewRefreshMinSeconds;
}

function profileCronRefreshLimit() {
  return readIntegerEnv("PROFILE_EXTERNAL_REFRESH_BATCH_LIMIT", 50, 1, 500);
}

function profileCronRefreshConcurrency(
  total: number,
  configuredConcurrency = 0,
  configuredMaxConcurrency = 6,
) {
  return getAdaptiveConcurrency(total, {
    profile: "external-api",
    concurrency: configuredConcurrency > 0 ? configuredConcurrency : undefined,
    min: 1,
    max: Math.max(1, Math.min(configuredMaxConcurrency || 6, 6)),
  });
}

function lastProfileRefreshMillis(
  profile: DashboardProfile | null | undefined,
  reason: ProfileExternalRefreshReason,
) {
  const candidate =
    reason === "profile_view"
      ? profile?.battlenet?.lastProfileViewRefreshAt ||
        profile?.battlenet?.lastCharacterRefreshAt ||
        profile?.battlenet?.lastSyncAt
      : profile?.battlenet?.lastCharacterRefreshAt ||
        profile?.battlenet?.lastSyncAt;
  return timestampMillis(candidate);
}

function isProfileRefreshFresh(
  profile: DashboardProfile | null | undefined,
  reason: ProfileExternalRefreshReason,
  minSpacingSeconds: number,
) {
  if (minSpacingSeconds <= 0) return false;
  const last = lastProfileRefreshMillis(profile, reason);
  return (
    typeof last === "number" && Date.now() - last < minSpacingSeconds * 1000
  );
}

function mergeFreshCharacter(
  current: ProfileCharacter,
  fresh: ProfileCharacter,
): ProfileCharacter {
  return {
    ...current,
    ...fresh,
    key: current.key,
    addedAt: current.addedAt || fresh.addedAt || null,
    isMain: current.isMain,
    verifiedGuild: fresh.verifiedGuild,
    raiderIo: fresh.raiderIo ?? current.raiderIo ?? null,
    lastSeenAt:
      fresh.lastSeenAt || current.lastSeenAt || new Date().toISOString(),
  };
}

async function refreshCharacterSnapshot(current: ProfileCharacter) {
  const characterRegion = current.region || "eu";
  const characterName = current.normalizedName || current.name;
  const [battleNetSnapshot, raiderIoSnapshot] = await Promise.all([
    fetchBattleNetCharacterSnapshot(current).catch(() => null),
    fetchRaiderIoCharacterProfile({
      region: characterRegion,
      realmSlug: current.realmSlug,
      name: characterName,
    }).catch(() => null),
  ]);

  if (!battleNetSnapshot && !raiderIoSnapshot) return null;

  const source = battleNetSnapshot || current;
  const normalized = normalizeCharacter(
    {
      ...source,
      key: current.key,
      isMain: current.isMain,
      raiderIo: stripRaiderIoRaw(raiderIoSnapshot) || current.raiderIo || null,
      itemLevel:
        battleNetSnapshot?.itemLevel ??
        raiderIoSnapshot?.itemLevelEquipped ??
        current.itemLevel ??
        null,
      avatarUrl:
        battleNetSnapshot?.avatarUrl ||
        current.avatarUrl ||
        raiderIoSnapshot?.thumbnailUrl ||
        null,
      profileUrl:
        battleNetSnapshot?.profileUrl ||
        current.profileUrl ||
        raiderIoSnapshot?.profileUrl ||
        "#",
      lastSeenAt:
        battleNetSnapshot?.lastSeenAt ||
        raiderIoSnapshot?.updatedAt ||
        current.lastSeenAt ||
        new Date().toISOString(),
    },
    current.isMain ? current.key : null,
  );

  return normalized;
}

async function refreshProfileExternalDataInternal(
  profile: DashboardProfile,
  options: Required<ProfileExternalRefreshOptions>,
): Promise<ProfileExternalRefreshResult> {
  if (
    !profile?.profileId ||
    !profile.characters.length ||
    !hasFirebaseProfileConfig()
  ) {
    return {
      profile: profile || null,
      refreshed: 0,
      failed: 0,
      skipped: 0,
      locked: false,
    };
  }

  if (
    !options.force &&
    isProfileRefreshFresh(profile, options.reason, options.minSpacingSeconds)
  ) {
    return {
      profile,
      refreshed: 0,
      failed: 0,
      skipped: profile.characters.length,
      locked: false,
    };
  }

  const characters = (() => {
    const mainKey =
      profile.mainCharacterKey || profile.characters[0]?.key || "";
    const main =
      profile.characters.find((item) => item.key === mainKey) ||
      profile.characters[0] ||
      null;
    const rest = profile.characters.filter((item) => item.key !== main?.key);
    const ordered = main ? [main, ...rest] : rest;
    return ordered.slice(
      0,
      Math.max(0, Math.min(options.maxCharacters, ordered.length)),
    );
  })();

  if (!characters.length) {
    return { profile, refreshed: 0, failed: 0, skipped: 0, locked: false };
  }

  const apiSettings = await getDashboardApiSettings();
  const concurrency = profileRefreshConcurrency(
    characters.length,
    apiSettings.profileCharacterRefreshConcurrency,
    apiSettings.profileCharacterRefreshMaxConcurrency,
  );
  const { results } = await mapConcurrent(
    characters,
    async (character) => {
      const fresh = await refreshCharacterSnapshot(character);
      return fresh ? { key: character.key, fresh } : null;
    },
    {
      profile: "external-api",
      concurrency,
      failFast: false,
    },
  );

  const freshByKey = new Map<string, ProfileCharacter>();
  let failed = 0;
  for (const result of results) {
    if (result?.fresh?.key) {
      freshByKey.set(result.key, result.fresh);
    } else {
      failed += 1;
    }
  }

  const refreshed = freshByKey.size;
  const skipped = Math.max(0, profile.characters.length - refreshed - failed);
  if (!freshByKey.size) {
    return { profile, refreshed: 0, failed, skipped, locked: false };
  }

  const nextCharacters = profile.characters.map((current) => {
    const fresh = freshByKey.get(current.key);
    return fresh ? mergeFreshCharacter(current, fresh) : current;
  });

  const firstCharacter = nextCharacters[0] || null;
  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profile.profileId);
  const battlenetPayload: Record<string, unknown> = {
    linked: profile.battlenet?.linked ?? true,
    region: profile.battlenet?.region || firstCharacter?.region || "eu",
    lastSyncAt: FieldValue.serverTimestamp(),
    lastCharacterRefreshAt: FieldValue.serverTimestamp(),
  };

  if (options.reason === "profile_view") {
    battlenetPayload.lastProfileViewRefreshAt = FieldValue.serverTimestamp();
    battlenetPayload.lastProfileViewRefresh = {
      refreshed,
      failed,
      skipped,
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  if (options.reason === "raid_signup") {
    battlenetPayload.lastSignupRefresh = {
      refreshed,
      failed,
      skipped,
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  if (
    options.reason === "manual" ||
    options.reason === "cron" ||
    options.reason === "background_api"
  ) {
    battlenetPayload.lastAutomatedRefresh = {
      reason: options.reason,
      refreshed,
      failed,
      skipped,
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  await writeProfileStorage(
    `profile:${profile.profileId}:external-refresh`,
    async () => {
      await ref.set(
        {
          characters: nextCharacters,
          battlenet: battlenetPayload,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      clearProfileRuntimeCaches(profile.profileId, { characterLinks: true });
    },
    { timeoutMs: 5_000, logEvent: "profiles.external_refresh_write_failed" },
  );

  const snapshot = await ref.get().catch(() => null);
  return {
    profile: snapshot?.exists
      ? normalizeProfile(profile.profileId, snapshot.data() || {})
      : { ...profile, characters: nextCharacters },
    refreshed,
    failed,
    skipped,
    locked: false,
  };
}

export async function refreshProfileExternalData(
  profile: DashboardProfile | null | undefined,
  options: ProfileExternalRefreshOptions = {},
): Promise<ProfileExternalRefreshResult> {
  if (
    !profile?.profileId ||
    !profile.characters.length ||
    !hasFirebaseProfileConfig()
  ) {
    return {
      profile: profile || null,
      refreshed: 0,
      failed: 0,
      skipped: 0,
      locked: false,
    };
  }

  const resolved: Required<ProfileExternalRefreshOptions> = {
    reason: options.reason || "manual",
    maxCharacters: Math.max(
      1,
      Math.min(
        Number(options.maxCharacters || profile.characters.length) ||
          profile.characters.length,
        profile.characters.length,
      ),
    ),
    minSpacingSeconds: Math.max(
      0,
      Math.floor(Number(options.minSpacingSeconds ?? 0) || 0),
    ),
    force: Boolean(options.force),
  };

  const lockKey = `${profile.profileId}:${resolved.reason}`;
  const locks = profileRefreshLocks();
  const existing = locks.get(lockKey);
  if (existing && Date.now() - existing.checkedAt < 90_000) {
    const result = await existing.promise.catch(() => ({
      profile,
      refreshed: 0,
      failed: 1,
      skipped: 0,
      locked: true,
    }));
    return { ...result, locked: true };
  }

  const promise = refreshProfileExternalDataInternal(profile, resolved).finally(
    () => locks.delete(lockKey),
  );
  locks.set(lockKey, { checkedAt: Date.now(), promise });
  return promise;
}

export async function refreshProfileExternalDataOnView(
  profile: DashboardProfile | null | undefined,
) {
  return refreshProfileExternalData(profile, {
    reason: "profile_view",
    minSpacingSeconds: await profileViewRefreshMinSpacingSeconds(),
    maxCharacters: profile?.characters.length || 0,
  });
}

export async function refreshProfileCharactersForRaidSignup(
  profile: DashboardProfile | null | undefined,
) {
  const restLimitRaw = Number(process.env.BATTLENET_SIGNUP_REFRESH_REST_LIMIT);
  const maxCharacters = profile?.characters.length
    ? Number.isFinite(restLimitRaw) && restLimitRaw >= 0
      ? Math.min(profile.characters.length, 1 + Math.floor(restLimitRaw))
      : profile.characters.length
    : 0;
  const minSpacingSeconds = readBoundedIntegerEnv(
    ["BATTLENET_SIGNUP_REFRESH_MIN_SECONDS", "RAID_SIGNUP_PROFILE_REFRESH_MIN_SECONDS"],
    180,
    0,
    3600,
  );
  const force = ["1", "true", "yes", "on"].includes(
    String(process.env.BATTLENET_SIGNUP_REFRESH_FORCE || "").trim().toLowerCase(),
  );
  const result = await refreshProfileExternalData(profile, {
    reason: "raid_signup",
    maxCharacters,
    minSpacingSeconds,
    force,
  });
  return result.profile;
}

export async function refreshAllProfilesExternalData(
  options: {
    limit?: number;
    minSpacingSeconds?: number;
    force?: boolean;
    reason?: "manual" | "cron";
  } = {},
) {
  if (!hasFirebaseProfileConfig()) {
    return {
      checked: 0,
      refreshedProfiles: 0,
      refreshedCharacters: 0,
      failedProfiles: 0,
      skippedProfiles: 0,
    };
  }

  const apiSettings = await getDashboardApiSettings();
  const defaultLimit =
    apiSettings.profileExternalRefreshBatchLimit || profileCronRefreshLimit();
  const limit = Math.max(
    1,
    Math.min(
      Math.floor(Number(options.limit || defaultLimit) || defaultLimit),
      500,
    ),
  );
  const minSpacingSeconds = Math.max(
    0,
    Math.floor(
      Number(
        options.minSpacingSeconds ??
          apiSettings.profileExternalRefreshMinSeconds,
      ) || 0,
    ),
  );
  const profiles: DashboardProfile[] = await resilientRead(
    `profiles:external-refresh:${limit}`,
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection("dashboardProfiles")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((doc: any) => normalizeProfile(doc.id, doc.data() || {}))
        .filter((profile: DashboardProfile) => profile.characters.length);
    },
    {
      ttlMs: 60_000,
      timeoutMs: 4_000,
      circuitKey: "firebase-profile-read",
      circuitTtlMs: 90_000,
      fallback: () => getRuntimeCachedValue<DashboardProfile[]>(`profiles:external-refresh:${limit}`, 10 * 60_000) || [],
      logEvent: "profiles.external_refresh_list_read_failed",
    },
  );

  let refreshedProfiles = 0;
  let refreshedCharacters = 0;
  let failedProfiles = 0;
  let skippedProfiles = 0;

  const concurrency = profileCronRefreshConcurrency(
    profiles.length,
    apiSettings.profileExternalRefreshConcurrency,
    apiSettings.profileExternalRefreshMaxConcurrency,
  );
  await mapConcurrent(
    profiles,
    async (profile) => {
      try {
        const result = await refreshProfileExternalData(profile, {
          reason: options.reason || "cron",
          minSpacingSeconds,
          force: Boolean(options.force),
        });
        if (result.refreshed > 0) refreshedProfiles += 1;
        refreshedCharacters += result.refreshed;
        if (result.skipped > 0 && result.refreshed === 0) skippedProfiles += 1;
      } catch {
        failedProfiles += 1;
      }
    },
    {
      profile: "external-api",
      concurrency,
      failFast: false,
    },
  );

  return {
    checked: profiles.length,
    refreshedProfiles,
    refreshedCharacters,
    failedProfiles,
    skippedProfiles,
  };
}

export async function addProfileCharacter(
  profileId: string,
  candidateInput: BattleNetCharacterCandidate,
) {
  const candidate = normalizeCharacter(candidateInput, null);
  const cleanKey = cleanCharacterKey(candidate?.key);
  if (!candidate || !cleanKey) {
    throw new Error(
      "Цей персонаж не підтверджений через Battle.net або має некоректні дані.",
    );
  }
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  await assertNoProfileCharacterConflicts(profileId, [candidate]);

  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);
  const result = await writeProfileStorage<{ added: boolean; reason?: "duplicate"; key: string }>(
    `profile:${profileId}:character-add:${cleanKey}`,
    () => getFirebaseAdminDb().runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Профіль не знайдено.");
      const profile = normalizeProfile(profileId, snapshot.data() || {});
      const current = profile.characters;
      if (current.some((item) => item.key === cleanKey)) {
        return { added: false, reason: "duplicate" as const, key: cleanKey };
      }
      const now = new Date().toISOString();
      const nextCharacter: ProfileCharacter = {
        ...candidate,
        addedAt: now,
        lastSeenAt: candidate.lastSeenAt || now,
      };
      const nextCharacters = [...current, nextCharacter];
      const mainCharacterKey = profile.mainCharacterKey || nextCharacter.key;

      transaction.set(
        ref,
        {
          characters: nextCharacters,
          mainCharacterKey,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { added: true, key: cleanKey };
    }),
    { timeoutMs: 5_000, logEvent: "profiles.character_add_write_failed" },
  );
  if (result.added) clearProfileRuntimeCaches(profileId, { characterLinks: true });
  return result;
}

export async function addProfileCharacters(
  profileId: string,
  candidateInputs: BattleNetCharacterCandidate[],
) {
  const requested = Array.isArray(candidateInputs) ? candidateInputs.length : 0;
  const normalized = new Map<string, ProfileCharacter>();
  for (const input of candidateInputs || []) {
    const candidate = normalizeCharacter(input, null);
    const cleanKey = cleanCharacterKey(candidate?.key);
    if (!candidate || !cleanKey) continue;
    normalized.set(cleanKey, candidate);
  }

  if (!normalized.size) {
    throw new Error("Немає підтверджених Battle.net персонажів для додавання.");
  }
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  await assertNoProfileCharacterConflicts(
    profileId,
    Array.from(normalized.values()),
  );

  const addedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const skippedReasons: Record<string, "duplicate"> = {};
  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);

  await writeProfileStorage(
    `profile:${profileId}:characters-bulk-add`,
    () => getFirebaseAdminDb().runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Профіль не знайдено.");

      const profile = normalizeProfile(profileId, snapshot.data() || {});
      const current = profile.characters;
      const currentKeys = new Set(current.map((item) => item.key));
      const now = new Date().toISOString();
      const nextCharacters = [...current];

      for (const [key, candidate] of normalized) {
        if (currentKeys.has(key)) {
          skippedKeys.push(key);
          skippedReasons[key] = "duplicate";
          continue;
        }
        nextCharacters.push({
          ...candidate,
          addedAt: now,
          lastSeenAt: candidate.lastSeenAt || now,
        });
        currentKeys.add(key);
        addedKeys.push(key);
      }

      if (!addedKeys.length) return;

      transaction.set(
        ref,
        {
          characters: nextCharacters,
          mainCharacterKey:
            profile.mainCharacterKey || nextCharacters[0]?.key || null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }),
    { timeoutMs: 6_000, logEvent: "profiles.characters_bulk_add_write_failed" },
  );

  if (addedKeys.length) clearProfileRuntimeCaches(profileId, { characterLinks: true });

  return {
    requested,
    validRequested: normalized.size,
    added: addedKeys.length,
    skipped: skippedKeys.length,
    addedKeys,
    skippedKeys,
    skippedReasons,
  };
}

export async function removeProfileCharacter(
  profileId: string,
  characterKey: string,
) {
  const cleanKey = cleanCharacterKey(characterKey);
  if (!cleanKey) throw new Error("Некоректний персонаж.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);
  await writeProfileStorage(
    `profile:${profileId}:character-remove:${cleanKey}`,
    () => getFirebaseAdminDb().runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Профіль не знайдено.");
      const profile = normalizeProfile(profileId, snapshot.data() || {});
      const nextCharacters = profile.characters.filter(
        (item) => item.key !== cleanKey,
      );
      const nextMain =
        profile.mainCharacterKey === cleanKey
          ? nextCharacters[0]?.key || null
          : profile.mainCharacterKey || null;

      const updatePayload: Record<string, unknown> = {
        characters: nextCharacters,
        mainCharacterKey: nextMain,
        nicknameCharacterKeys: (profile.nicknameCharacterKeys || [])
          .filter(
            (key) =>
              key !== cleanKey &&
              nextCharacters.some(
                (item) => item.key === key && item.key !== nextMain,
              ),
          )
          .slice(0, 2),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (
        profile.raidRolePreference?.characterKey === cleanKey ||
        (profile.mainCharacterKey && profile.mainCharacterKey !== nextMain)
      ) {
        updatePayload.raidRolePreference = FieldValue.delete();
      }

      transaction.set(ref, updatePayload, { merge: true });
    }),
    { timeoutMs: 5_000, logEvent: "profiles.character_remove_write_failed" },
  );
  clearProfileRuntimeCaches(profileId, { characterLinks: true });
}

export async function setMainProfileCharacter(
  profileId: string,
  characterKey: string,
) {
  const cleanKey = cleanCharacterKey(characterKey);
  if (!cleanKey) throw new Error("Некоректний персонаж.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);
  await writeProfileStorage(
    `profile:${profileId}:character-main:${cleanKey}`,
    () => getFirebaseAdminDb().runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Профіль не знайдено.");
      const profile = normalizeProfile(profileId, snapshot.data() || {});
      if (!profile.characters.some((item) => item.key === cleanKey)) {
        throw new Error("Персонаж не доданий до профілю.");
      }

      const updatePayload: Record<string, unknown> = {
        mainCharacterKey: cleanKey,
        nicknameCharacterKeys: (profile.nicknameCharacterKeys || [])
          .filter((key) => key !== cleanKey)
          .slice(0, 2),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (profile.mainCharacterKey && profile.mainCharacterKey !== cleanKey) {
        updatePayload.raidRolePreference = FieldValue.delete();
      }

      transaction.set(ref, updatePayload, { merge: true });
    }),
    { timeoutMs: 5_000, logEvent: "profiles.character_main_write_failed" },
  );
  clearProfileRuntimeCaches(profileId, { characterLinks: true });
}

export function normalizeProfilePreferredName(value: unknown) {
  return cleanProfileName(value, 32);
}

export function getProfileSiteName(
  profile: DashboardProfile | null | undefined,
) {
  return (
    cleanProfileName(profile?.preferredName || "", 32) ||
    cleanProfileName(profile?.displayName || profile?.login || "", 32) ||
    "Учасник"
  );
}

export function getProfileDiscordName(
  profile: DashboardProfile | null | undefined,
) {
  return (
    cleanProfileName(profile?.displayName || profile?.login || "", 32) ||
    "Discord"
  );
}

export function getProfileServerStyleName(
  profile: DashboardProfile | null | undefined,
  maxLength = 80,
  template = DEFAULT_NICKNAME_TEMPLATE,
) {
  if (!profile) return "Учасник";
  const base =
    cleanDiscordNicknamePart(
      profile.preferredName || profile.displayName || profile.login || "",
      32,
    ) || "Учасник";
  const characterNames = orderedCharactersForNickname(profile).slice(0, 3);
  if (!characterNames.length)
    return sliceCodePoints(base, maxLength).trim() || "Учасник";

  for (let count = characterNames.length; count >= 1; count -= 1) {
    const candidate = composeDiscordNickname(
      base,
      characterNames.slice(0, count),
      template,
    );
    if (codePointLength(candidate) <= maxLength) return candidate;
  }

  return sliceCodePoints(base, maxLength).trim() || "Учасник";
}

export function getProfilePublicName(
  profile: DashboardProfile | null | undefined,
  template = DEFAULT_NICKNAME_TEMPLATE,
) {
  if (!profile) return "Учасник";
  return profile.publicNameMode === "server_nickname"
    ? getProfileServerStyleName(profile, 80, template)
    : getProfileSiteName(profile);
}

export type AuthorNameSuggestion = {
  source: "server" | "discord" | "site" | "profile";
  label: string;
  value: string;
};

export function buildAuthorNameSuggestions(params: {
  profile?: DashboardProfile | null;
  sessionName?: string | null;
  serverDiscordName?: string | null;
}) {
  const profile = params.profile || null;
  const candidates: AuthorNameSuggestion[] = [
    {
      source: "server",
      label: "Імʼя на сервері",
      value: cleanAuthorName(params.serverDiscordName || "", 80),
    },
    {
      source: "site",
      label: "Імʼя з сайту",
      value: profile ? getProfileSiteName(profile) : "",
    },
    {
      source: "profile",
      label: "Формат профілю",
      value: profile ? getProfilePublicName(profile) : "",
    },
    {
      source: "discord",
      label: "Discord",
      value: cleanAuthorName(
        profile?.displayName || params.sessionName || profile?.login || "",
        80,
      ),
    },
  ];

  const seen = new Set<string>();
  return candidates.filter((item) => {
    const value = String(item.value || "").trim();
    const key = value.toLocaleLowerCase("uk");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    item.value = value;
    return true;
  });
}

function orderedCharactersForNickname(profile: DashboardProfile) {
  const main = getMainCharacter(profile);
  const characterByKey = new Map(
    profile.characters.map((character) => [character.key, character]),
  );
  const selectedAlts = cleanNicknameCharacterKeys(
    profile.nicknameCharacterKeys,
    main?.key,
  )
    .map((key) => characterByKey.get(key))
    .filter((character): character is ProfileCharacter => Boolean(character));
  const fallbackAlts = profile.characters.filter(
    (item) =>
      item.key !== main?.key &&
      !selectedAlts.some((alt) => alt.key === item.key),
  );
  const ordered = [...(main ? [main] : []), ...selectedAlts, ...fallbackAlts];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const character of ordered) {
    const name = cleanDiscordNicknamePart(character.name, 16);
    const key = name.toLocaleLowerCase("uk");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length >= 3) break;
  }
  return result;
}

function composeDiscordNickname(
  name: string,
  characters: string[],
  template = DEFAULT_NICKNAME_TEMPLATE,
) {
  return renderNicknameFromTemplate(template, { name, characters });
}

export type ProfileDiscordNicknamePlan = {
  value: string | null;
  baseName: string | null;
  characterNames: string[];
  requestedCharacterNames: string[];
  hasRequiredName: boolean;
  truncated: boolean;
  maxLength: number;
};

export function buildProfileDiscordNicknamePlan(
  profile: DashboardProfile | null | undefined,
  template = DEFAULT_NICKNAME_TEMPLATE,
): ProfileDiscordNicknamePlan {
  const maxLength = 32;
  const base = cleanDiscordNicknamePart(
    profile?.preferredName || "",
    maxLength,
  );
  if (!profile || !base) {
    return {
      value: null,
      baseName: base || null,
      characterNames: [],
      requestedCharacterNames: [],
      hasRequiredName: Boolean(base),
      truncated: false,
      maxLength,
    };
  }

  const requestedNames = orderedCharactersForNickname(profile)
    .map((name) => sliceCodePoints(name, 16).trim())
    .filter(Boolean)
    .slice(0, 3);

  if (!requestedNames.length) {
    return {
      value: sliceCodePoints(base, maxLength),
      baseName: base,
      characterNames: [],
      requestedCharacterNames: [],
      hasRequiredName: true,
      truncated: codePointLength(base) > maxLength,
      maxLength,
    };
  }

  for (let count = requestedNames.length; count >= 1; count -= 1) {
    const names = requestedNames.slice(0, count);
    const candidate = composeDiscordNickname(base, names, template);
    if (codePointLength(candidate) <= maxLength) {
      return {
        value: candidate,
        baseName: base,
        characterNames: names,
        requestedCharacterNames: requestedNames,
        hasRequiredName: true,
        truncated: count < requestedNames.length,
        maxLength,
      };
    }
  }

  const spaceForMain = Math.max(1, maxLength - codePointLength(base) - 3);
  if (spaceForMain >= 1 && codePointLength(base) <= maxLength - 4) {
    const mainName = sliceCodePoints(requestedNames[0], spaceForMain).trim();
    const candidate = composeDiscordNickname(
      base,
      mainName ? [mainName] : [],
      template,
    );
    if (mainName && codePointLength(candidate) <= maxLength) {
      return {
        value: candidate,
        baseName: base,
        characterNames: [mainName],
        requestedCharacterNames: requestedNames,
        hasRequiredName: true,
        truncated: true,
        maxLength,
      };
    }
  }

  return {
    value: sliceCodePoints(base, maxLength),
    baseName: base,
    characterNames: [],
    requestedCharacterNames: requestedNames,
    hasRequiredName: true,
    truncated: true,
    maxLength,
  };
}

export function buildProfileDiscordNickname(
  profile: DashboardProfile | null | undefined,
  template = DEFAULT_NICKNAME_TEMPLATE,
) {
  return buildProfileDiscordNicknamePlan(profile, template).value;
}

export async function setProfilePreferredName(
  profileId: string,
  nameInput: unknown,
) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId))
    throw new Error("Некоректний ID профілю.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const preferredName = normalizeProfilePreferredName(nameInput);
  if (codePointLength(preferredName) < 2)
    throw new Error("Імʼя має містити щонайменше 2 символи.");

  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);
  await writeProfileStorage(
    `profile:${profileId}:preferred-name`,
    () => ref.set(
      {
        preferredName,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
    { timeoutMs: 3_000, logEvent: "profiles.preferred_name_write_failed" },
  );

  clearProfileRuntimeCaches(profileId, { characterLinks: true });
  return preferredName;
}

export async function setProfilePublicNameMode(
  profileId: string,
  modeInput: unknown,
) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId))
    throw new Error("Некоректний ID профілю.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const publicNameMode = cleanProfilePublicNameMode(modeInput);
  await writeProfileStorage(
    `profile:${profileId}:public-name-mode`,
    () => getFirebaseAdminDb().collection("dashboardProfiles").doc(profileId).set(
      {
        publicNameMode,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
    { timeoutMs: 3_000, logEvent: "profiles.public_name_mode_write_failed" },
  );

  clearProfileRuntimeCaches(profileId, { characterLinks: true });
  return publicNameMode;
}

export async function setProfileGrammaticalGender(
  profileId: string,
  genderInput: unknown,
) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId))
    throw new Error("Некоректний ID профілю.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const grammaticalGender = cleanProfileGrammaticalGender(genderInput);
  await writeProfileStorage(
    `profile:${profileId}:grammatical-gender`,
    () => getFirebaseAdminDb().collection("dashboardProfiles").doc(profileId).set(
      {
        grammaticalGender,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
    { timeoutMs: 3_000, logEvent: "profiles.grammatical_gender_write_failed" },
  );

  clearProfileRuntimeCaches(profileId);
  return grammaticalGender;
}

export async function markProfileDiscordNicknameSynced(
  profileId: string,
  nickname: string,
  source?: Pick<ProfileDiscordNicknamePlan, "baseName" | "characterNames">,
) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId))
    throw new Error("Некоректний ID профілю.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const sourceCharacterNames = Array.isArray(source?.characterNames)
    ? source.characterNames
    : [];

  await writeProfileStorage(
    `profile:${profileId}:discord-nickname-synced`,
    () => getFirebaseAdminDb()
      .collection("dashboardProfiles")
      .doc(profileId)
      .set(
        {
          discordNickname: {
            value: cleanDiscordNicknamePart(nickname, 32),
            syncedAt: FieldValue.serverTimestamp(),
            sourcePreferredName:
              cleanProfileName(source?.baseName || "", 32) || null,
            sourceCharacters: sourceCharacterNames
              .map((item) => cleanDiscordNicknamePart(item, 16))
              .filter(Boolean)
              .slice(0, 3),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    { timeoutMs: 3_000, logEvent: "profiles.discord_nickname_synced_write_failed" },
  );
  clearProfileRuntimeCaches(profileId);
}

export async function setProfileNicknameCharacters(
  profileId: string,
  characterKeysInput: unknown,
) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId))
    throw new Error("Некоректний ID профілю.");
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const requestedKeys = cleanNicknameCharacterKeys(characterKeysInput);
  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);

  const selected = await writeProfileStorage(
    `profile:${profileId}:nickname-characters`,
    () => getFirebaseAdminDb().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Профіль не знайдено.");

    const profile = normalizeProfile(profileId, snapshot.data() || {});
    const mainKey =
      getMainCharacter(profile)?.key || profile.mainCharacterKey || null;
    const characterKeys = new Set(profile.characters.map((item) => item.key));
    const selected = requestedKeys
      .filter((key) => key !== mainKey && characterKeys.has(key))
      .slice(0, 2);

    transaction.set(
      ref,
      {
        nicknameCharacterKeys: selected,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return selected;
    }),
    { timeoutMs: 4_000, logEvent: "profiles.nickname_characters_write_failed" },
  );
  clearProfileRuntimeCaches(profileId, { characterLinks: true });
  return selected;
}

export async function setProfileRaidRolePreference(
  profileId: string,
  roleInput: unknown,
) {
  if (!hasFirebaseProfileConfig())
    throw new Error("Профілі тимчасово недоступні.");

  const role = normalizeWowRole(roleInput);
  const ref = getFirebaseAdminDb()
    .collection("dashboardProfiles")
    .doc(profileId);

  await writeProfileStorage(
    `profile:${profileId}:raid-role`,
    () => getFirebaseAdminDb().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Профіль не знайдено.");

    const profile = normalizeProfile(profileId, snapshot.data() || {});
    const main = getMainCharacter(profile);
    if (!main?.key) throw new Error("Спочатку вибери мейна.");

    const updatePayload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!role) {
      updatePayload.raidRolePreference = FieldValue.delete();
    } else {
      updatePayload.raidRolePreference = {
        characterKey: main.key,
        role,
        updatedAt: FieldValue.serverTimestamp(),
      };
    }

    transaction.set(ref, updatePayload, { merge: true });
    }),
    { timeoutMs: 4_000, logEvent: "profiles.raid_role_write_failed" },
  );
  clearProfileRuntimeCaches(profileId);
}

export function getProfileRaidRole(
  profile: DashboardProfile | null | undefined,
) {
  const main = profile ? getMainCharacter(profile) : null;
  const manualRole =
    profile?.raidRolePreference?.characterKey === main?.key
      ? profile?.raidRolePreference?.role
      : null;
  return (
    manualRole ||
    (main
      ? resolveWowCharacterRole({
          className: main.className,
          activeSpecName: main.activeSpecName,
          activeSpecId: main.activeSpecId,
          activeSpecRole: main.activeSpecRole,
        })
      : "dps")
  );
}

export function getMainCharacter(profile: DashboardProfile) {
  return (
    profile.characters.find((item) => item.key === profile.mainCharacterKey) ||
    profile.characters[0] ||
    null
  );
}
