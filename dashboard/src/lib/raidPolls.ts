import { createHash, randomUUID } from "crypto";
import {
  FieldValue,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import type { DashboardSession } from "@/lib/auth";
import { getMainCharacter, getProfileByDiscordUserId, refreshProfileCharactersForRaidSignup, type DashboardProfile, type ProfileCharacter } from "@/lib/profiles";
import { loadStoredGuildRosterData } from "@/lib/guildRoster";
import { resolveWowCharacterRole } from "@/lib/wowRoles";
import { buildBattleNetCharacterKey, normalizeCharacterKey } from "@/lib/wowCharacters";
import { firebaseRead, firebaseWrite, firebaseUnavailableMessage } from "@/lib/firebaseAccess";
import { clearRuntimeCachedValue, clearRuntimeCachedValuesByPrefix, getRuntimeCachedValue, setRuntimeCachedValue } from "@/lib/runtimeResilience";
import { mapConcurrentSettled } from "@/lib/concurrency";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import {
  createDiscordRaidMessage,
  deleteDiscordRaidMessage,
  discordMessageUrl,
  editDiscordRaidMessage,
  getDiscordDefaultChannelId,
  normalizeDiscordEmbed,
  type DiscordMessageRef,
} from "@/lib/discordAdmin";
import { raidAlgorithmAnalyzePollSlot } from "@/lib/raidCompositionAlgorithm";

export {
  RAID_POLL_AVAILABILITY_OPTIONS,
  RAID_POLL_CLOSE_OPTIONS,
  RAID_POLL_DAYS,
  RAID_POLL_DESCRIPTION,
  RAID_POLL_ROLE_OPTIONS,
  RAID_POLL_SCHEDULE_GROUPS,
  RAID_POLL_REPEAT_TIMES,
  RAID_POLL_TIMES,
  raidPollAvailabilityLabel,
  raidPollClassColor,
  raidPollRoleLabel,
  raidPollAcceptsVotes,
  raidPollIsClosed,
  raidPollIsPaused,
  raidPollStateKey,
  raidPollStateTone,
  raidPollVotingLocked,
} from "@/lib/raidPollShared";
export type {
  RaidPollAvailability,
  RaidPollCreateInput,
  RaidPollUpdateInput,
  RaidPollDay,
  RaidPollDifficulty,
  RaidPollItem,
  RaidPollRepeatTime,
  RaidPollRole,
  RaidPollSchedule,
  RaidPollScheduleValue,
  RaidPollStatus,
  RaidPollTime,
  RaidPollVote,
  RaidPollVoteResult,
} from "@/lib/raidPollShared";
import {
  RAID_POLL_AVAILABILITY_OPTIONS,
  RAID_POLL_CLOSE_OPTIONS,
  RAID_POLL_DAYS,
  RAID_POLL_DESCRIPTION,
  RAID_POLL_ROLE_OPTIONS,
  RAID_POLL_SCHEDULE_GROUPS,
  RAID_POLL_REPEAT_TIMES,
  RAID_POLL_TIMES,
  raidPollAvailabilityLabel,
  raidPollRoleLabel,
  raidPollAcceptsVotes,
  raidPollIsPaused,
  raidPollVotingLocked,
  type RaidPollAvailability,
  type RaidPollCreateInput,
  type RaidPollUpdateInput,
  type RaidPollDay,
  type RaidPollRepeatTime,
  type RaidPollDifficulty,
  type RaidPollItem,
  type RaidPollRole,
  type RaidPollSchedule,
  type RaidPollScheduleValue,
  type RaidPollStatus,
  type RaidPollTime,
  type RaidPollVote,
  type RaidPollVoteResult,
} from "@/lib/raidPollShared";

const RAID_POLL_COLLECTION = "dashboardRaidPolls";
const RAID_POLL_ACTION_PREFIX = "mbv1:poll";
const RAID_POLL_LIST_CACHE_KEY = "raid-polls:list:v1";
const RAID_POLL_DEFAULT_CACHE_TTL_MS = 60_000;
const RAID_POLL_DEFAULT_GET_CACHE_TTL_MS = 60_000;
const RAID_POLL_GET_CACHE_PREFIX = "raid-poll:";
const RAID_POLL_DEFAULT_GUILD_MEMBERSHIP_CACHE_TTL_MS = 90_000;
const RAID_POLL_VOTE_CLEANUP_DEFAULT_MIN_MS = 10 * 60_000;
const RAID_POLL_DISCORD_SIGNATURE_PREFIX = "raid-poll:discord-signature:";
const RAID_POLL_DISCORD_SIGNATURE_TTL_MS = 6 * 60 * 60_000;

function envFlag(names: string[], fallback = false) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") continue;
    return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
  }
  return fallback;
}

function raidPollEcoModeEnabled() {
  return envFlag(["FIREBASE_ECO_MODE", "FIRESTORE_ECO_MODE", "DASHBOARD_ECO_MODE"], false);
}

function envDurationMs(names: string[], fallback: number, min: number, max: number) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") continue;
    const number = Number(raw);
    if (Number.isFinite(number)) return Math.max(min, Math.min(Math.floor(number), max));
  }
  return Math.max(min, Math.min(Math.floor(fallback), max));
}

function raidPollListCacheTtlMs() {
  return envDurationMs(["RAID_POLL_LIST_CACHE_TTL_MS"], raidPollEcoModeEnabled() ? 300_000 : RAID_POLL_DEFAULT_CACHE_TTL_MS, 30_000, 600_000);
}

function raidPollItemCacheTtlMs() {
  return envDurationMs(["RAID_POLL_ITEM_CACHE_TTL_MS"], raidPollEcoModeEnabled() ? 180_000 : RAID_POLL_DEFAULT_GET_CACHE_TTL_MS, 30_000, 600_000);
}

function raidPollGuildMembershipCacheTtlMs() {
  return envDurationMs(["RAID_POLL_GUILD_MEMBERSHIP_CACHE_TTL_MS"], raidPollEcoModeEnabled() ? 600_000 : RAID_POLL_DEFAULT_GUILD_MEMBERSHIP_CACHE_TTL_MS, 60_000, 60 * 60_000);
}

function raidPollDueScanLimit() {
  const fallback = raidPollEcoModeEnabled() ? 20 : 50;
  const value = Number(process.env.RAID_POLL_CLOSE_DUE_SCAN_LIMIT || process.env.RAID_POLL_SCAN_LIMIT || fallback);
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), 100)) : fallback;
}

function raidPollVoteCleanupOnIdleCron() {
  return envFlag(["RAID_POLL_CLEANUP_ON_IDLE_CRON", "RAID_POLL_CLEANUP_ON_CRON"], !raidPollEcoModeEnabled());
}

function clearRaidPollRuntimeCaches(pollId?: string | null) {
  const id = cleanString(pollId, 80);
  if (id) clearRuntimeCachedValue(`${RAID_POLL_GET_CACHE_PREFIX}${id}`);
  clearRuntimeCachedValuesByPrefix(`${RAID_POLL_LIST_CACHE_KEY}:`);
}

function clearRaidPollDiscordSignatureCache(pollId?: string | null) {
  const id = cleanString(pollId, 80);
  clearRuntimeCachedValuesByPrefix(id ? `${RAID_POLL_DISCORD_SIGNATURE_PREFIX}${id}:` : RAID_POLL_DISCORD_SIGNATURE_PREFIX);
}

function isMissingDiscordMessageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /404|unknown message|10008/i.test(message);
}


const DIFFICULTY_LABELS: Record<RaidPollDifficulty, string> = {
  normal: "Нормал",
  heroic: "Героїк",
  mythic: "Міфік",
};

const DIFFICULTY_COLORS: Record<RaidPollDifficulty, number> = {
  normal: 0x2f81f7,
  heroic: 0x9b4dff,
  mythic: 0xed4245,
};

function cleanString(value: unknown, max = 300) {
  return Array.from(String(value || "").replace(/\r\n/g, "\n").trim()).slice(0, max).join("");
}

function cleanPollDescription(value: unknown) {
  const description = cleanString(value, 900);
  return description.length >= 20 ? description : RAID_POLL_DESCRIPTION;
}

function cleanSnowflake(value: unknown) {
  const text = cleanString(value, 32);
  return /^\d{16,25}$/.test(text) ? text : "";
}

function cleanSnowflakeIds(values: unknown) {
  const list = Array.isArray(values) ? values : typeof values === "string" ? values.split(/[\s,]+/) : [];
  return Array.from(new Set(list.map(cleanSnowflake).filter(Boolean))).slice(0, 25);
}

function cleanBoolean(value: unknown) {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  const text = cleanString(value, 20).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on" || text === "так";
}

function cleanDifficulty(value: unknown): RaidPollDifficulty {
  const key = cleanString(value, 40).toLowerCase();
  if (key === "normal" || key === "нормал") return "normal";
  if (key === "mythic" || key === "міфік" || key === "мф") return "mythic";
  return "heroic";
}

function cleanCloseAfterMinutes(value: unknown) {
  const minutes = Math.floor(Number(value) || 0);
  const allowed = RAID_POLL_CLOSE_OPTIONS.map((item) => item.minutes);
  return allowed.includes(minutes) ? minutes : 12 * 60;
}

function cleanPollDay(value: unknown): RaidPollDay | null {
  const key = cleanString(value, 12).toLowerCase();
  return RAID_POLL_DAYS.some((day) => day.value === key) ? key as RaidPollDay : null;
}

function cleanPollDays(values: unknown): RaidPollDay[] {
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  return Array.from(new Set(list.map(cleanPollDay).filter(Boolean) as RaidPollDay[]));
}

function cleanRepeatWeeklyDay(value: unknown): RaidPollDay {
  return cleanPollDay(value) || "mon";
}

function cleanRepeatWeeklyTime(value: unknown): RaidPollRepeatTime {
  const text = cleanString(value, 8);
  return RAID_POLL_REPEAT_TIMES.includes(text as RaidPollRepeatTime) ? text as RaidPollRepeatTime : "12:00";
}

function cleanPollTime(value: unknown): RaidPollTime | null {
  const text = cleanString(value, 10);
  return RAID_POLL_TIMES.includes(text as RaidPollTime) ? text as RaidPollTime : null;
}

function cleanPollAvailability(value: unknown): RaidPollAvailability | null {
  const text = cleanString(value, 12).toLowerCase();
  if (text === "absent" || text === "не можу" || text === "cannot") return "absent";
  return cleanPollTime(text);
}

function uniquePollTimes(values: unknown[]): RaidPollTime[] {
  const times = values.map(cleanPollTime).filter(Boolean) as RaidPollTime[];
  return RAID_POLL_TIMES.filter((time) => times.includes(time));
}

function compactScheduleValue(value: RaidPollScheduleValue | null | undefined): RaidPollScheduleValue | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    // Legacy votes could store many concrete times for one day. New semantics: one
    // earliest available time per day; that earliest time implies every later slot.
    return uniquePollTimes(value)[0] || null;
  }
  return cleanPollAvailability(value);
}

function scheduleTimes(value: RaidPollScheduleValue | null | undefined): RaidPollTime[] {
  if (!value || value === "absent") return [];
  if (Array.isArray(value)) {
    const first = uniquePollTimes(value)[0];
    return first ? [first] : [];
  }
  return cleanPollTime(value) ? [value] : [];
}

function impliedScheduleTimes(value: RaidPollScheduleValue | null | undefined): RaidPollTime[] {
  const [first] = scheduleTimes(value);
  if (!first) return [];
  const index = RAID_POLL_TIMES.indexOf(first);
  return index >= 0 ? RAID_POLL_TIMES.slice(index) : [];
}

function scheduleHasTime(schedule: RaidPollSchedule, day: RaidPollDay, time: RaidPollTime) {
  return impliedScheduleTimes(schedule[day]).includes(time);
}

function cleanPollScheduleValue(value: unknown): RaidPollScheduleValue | null {
  if (Array.isArray(value)) return compactScheduleValue(value);
  const availability = cleanPollAvailability(value);
  return availability || null;
}

function cleanPollSchedule(value: unknown): RaidPollSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const schedule: RaidPollSchedule = {};
  for (const day of RAID_POLL_DAYS) {
    const availability = cleanPollScheduleValue(raw[day.value]);
    if (availability) schedule[day.value] = availability;
  }
  return schedule;
}

function scheduleFromLegacy(selectedDays: RaidPollDay[], selectedTime: RaidPollTime | null): RaidPollSchedule {
  const schedule: RaidPollSchedule = {};
  for (const day of selectedDays) schedule[day] = selectedTime || "19:00";
  return schedule;
}

function activeDaysFromSchedule(schedule: RaidPollSchedule) {
  return RAID_POLL_DAYS
    .map((day) => day.value)
    .filter((day): day is RaidPollDay => scheduleTimes(schedule[day]).length > 0);
}

function firstTimeFromSchedule(schedule: RaidPollSchedule): RaidPollTime | null {
  for (const day of RAID_POLL_DAYS) {
    const [first] = scheduleTimes(schedule[day.value]);
    if (first) return first;
  }
  return null;
}

function parseScheduleValuesDetailed(values: unknown): { schedule: RaidPollSchedule; duplicateDays: RaidPollDay[] } {
  const valuesByDay = new Map<RaidPollDay, RaidPollAvailability>();
  const duplicateDays = new Set<RaidPollDay>();
  const list = Array.isArray(values) ? values : String(values || "").split(",");

  for (const item of list) {
    const text = cleanString(item, 32);
    const separatorIndex = text.indexOf(":");
    if (separatorIndex <= 0) continue;
    const day = cleanPollDay(text.slice(0, separatorIndex));
    const availability = cleanPollAvailability(text.slice(separatorIndex + 1));
    if (!day || !availability) continue;

    if (valuesByDay.has(day)) {
      duplicateDays.add(day);
      const previous = valuesByDay.get(day);
      if (previous && previous !== "absent" && availability !== "absent") {
        const previousIndex = RAID_POLL_TIMES.indexOf(previous);
        const nextIndex = RAID_POLL_TIMES.indexOf(availability);
        valuesByDay.set(day, nextIndex >= 0 && (previousIndex < 0 || nextIndex < previousIndex) ? availability : previous);
      }
      continue;
    }

    valuesByDay.set(day, availability);
  }

  const schedule: RaidPollSchedule = {};
  for (const day of RAID_POLL_DAYS) {
    const value = valuesByDay.get(day.value);
    if (value) schedule[day.value] = value;
  }
  return { schedule, duplicateDays: RAID_POLL_DAYS.map((day) => day.value).filter((day) => duplicateDays.has(day)) };
}

function parseScheduleValues(values: unknown): RaidPollSchedule {
  return parseScheduleValuesDetailed(values).schedule;
}

function cleanCharacterSelector(value: unknown) {
  const text = cleanString(value, 260);
  if (/^c\d{1,2}$/i.test(text) || /^alt_[1-9][0-9]?$/.test(text) || text === "main") return text;
  const key = normalizeCharacterKey(text);
  return key || text;
}

function cleanCharacterRole(value: unknown): RaidPollRole | null {
  const text = cleanString(value, 20).toLowerCase();
  if (text === "tank") return "tank";
  if (text === "healer") return "healer";
  if (text === "dps") return "dps";
  return null;
}

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate().toISOString();
  return null;
}

function safeIso(value: unknown, fallback = new Date().toISOString()) {
  const text = timestampToIso(value) || cleanString(value, 40);
  if (!text) return fallback;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function safeMs(value: unknown, fallback = Date.now()) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function dayLabel(value: RaidPollDay) {
  return RAID_POLL_DAYS.find((day) => day.value === value)?.label || value;
}

function dayFullLabel(value: RaidPollDay) {
  return RAID_POLL_DAYS.find((day) => day.value === value)?.fullLabel || value;
}

export function raidPollDifficultyLabel(value: RaidPollDifficulty) {
  return DIFFICULTY_LABELS[value] || DIFFICULTY_LABELS.heroic;
}

export function raidPollTitle(poll: Pick<RaidPollItem, "title" | "difficulty">) {
  return `${poll.title} — ${raidPollDifficultyLabel(poll.difficulty)}`;
}

export function raidPollStatusLabel(poll: Pick<RaidPollItem, "status" | "closesAtMs">) {
  if (poll.status === "closed") return "Закрито";
  if (poll.status === "paused") return "На паузі";
  return poll.closesAtMs <= Date.now() ? "Завершується" : "Відкрите";
}

/** Скільки лишилось до автозакриття у людському форматі. Для паузи — заморожений залишок. */
export function raidPollRemainingLabel(poll: Pick<RaidPollItem, "status" | "closesAtMs" | "pausedRemainingMs">) {
  if (poll.status === "closed") return "Завершено";
  const remaining = poll.status === "paused"
    ? Math.max(0, Number(poll.pausedRemainingMs) || 0)
    : poll.closesAtMs - Date.now();
  if (remaining <= 0) return poll.status === "paused" ? "Час вичерпано" : "Закривається";
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  if (days > 0) return `${days} дн ${hours} год`;
  if (hours > 0) return `${hours} год ${minutes % 60} хв`;
  return `${Math.max(1, minutes)} хв`;
}

function dashboardBaseUrl() {
  const configured = String(process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.ADMIN_DASHBOARD_URL || process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_URL || process.env.NEXTAUTH_URL || "https://dashboard.lihvodruida.pp.ua").trim();
  try {
    const url = new URL(configured || "https://dashboard.lihvodruida.pp.ua");
    if (url.hostname.endsWith(".vercel.app")) return "https://dashboard.lihvodruida.pp.ua";
    return url.origin;
  } catch {
    return "https://dashboard.lihvodruida.pp.ua";
  }
}

export function dashboardPollUrl(pollId: string) {
  return `${dashboardBaseUrl()}/polls/${encodeURIComponent(pollId)}`;
}

function raidPollTimeZone() {
  return String(process.env.RAID_POLL_TIME_ZONE || process.env.RAID_TIME_ZONE || process.env.NEXT_PUBLIC_RAID_TIME_ZONE || "Europe/Kyiv");
}

function timezoneOffsetMs(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour === "24" ? "0" : values.hour),
      Number(values.minute),
      Number(values.second),
    );
    return asUtc - date.getTime();
  } catch {
    return 0;
  }
}

function zonedDateTimeToUtcMs(year: number, month: number, day: number, hour: number, minute: number, timeZone = raidPollTimeZone()) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return guess.getTime() - timezoneOffsetMs(guess, timeZone);
}

function localDateParts(date: Date, timeZone = raidPollTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: String(values.weekday || ""),
  };
}

const WEEKDAY_SHORT_BY_POLL_DAY: Record<RaidPollDay, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function nextWeeklyRepeatMs(fromMs = Date.now(), repeatDay: RaidPollDay = "mon", repeatTime: RaidPollRepeatTime = "12:00") {
  const timeZone = raidPollTimeZone();
  const local = localDateParts(new Date(fromMs), timeZone);
  const [hourText, minuteText] = cleanRepeatWeeklyTime(repeatTime).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const targetWeekday = WEEKDAY_SHORT_BY_POLL_DAY[cleanRepeatWeeklyDay(repeatDay)] || "Mon";

  for (let addDays = 0; addDays <= 14; addDays += 1) {
    const localCandidateDate = new Date(Date.UTC(local.year, local.month - 1, local.day + addDays, hour, minute, 0));
    const year = localCandidateDate.getUTCFullYear();
    const month = localCandidateDate.getUTCMonth() + 1;
    const day = localCandidateDate.getUTCDate();
    const candidateMs = zonedDateTimeToUtcMs(year, month, day, hour, minute, timeZone);
    const candidateLocal = localDateParts(new Date(candidateMs), timeZone);
    if (candidateLocal.weekday === targetWeekday && candidateMs > fromMs + 60_000) return candidateMs;
  }
  return fromMs + 7 * 24 * 60 * 60 * 1000;
}

export function raidPollRepeatScheduleLabel(poll: Pick<RaidPollItem, "autoRepeatWeekly" | "repeatWeeklyDay" | "repeatWeeklyTime">) {
  if (!poll.autoRepeatWeekly) return "Вимкнено";
  const day = cleanRepeatWeeklyDay(poll.repeatWeeklyDay);
  const time = cleanRepeatWeeklyTime(poll.repeatWeeklyTime);
  return `${dayFullLabel(day)} о ${time}`;
}

export function hasRaidPollStorage() {
  return hasFirebaseProfileConfig();
}

function newPollId() {
  return randomUUID().replace(/-/g, "").slice(0, 18);
}

function normalizeVote(raw: unknown, discordIdFallback = ""): RaidPollVote | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const discordId = cleanSnowflake(data.discordId || data.discord_id || discordIdFallback);
  if (!discordId) return null;
  const now = new Date().toISOString();
  const selectedDays = cleanPollDays(data.selectedDays || data.selected_days);
  const selectedTime = cleanPollTime(data.selectedTime || data.selected_time);
  const explicitSchedule = cleanPollSchedule(data.schedule);
  const schedule = Object.keys(explicitSchedule).length ? explicitSchedule : scheduleFromLegacy(selectedDays, selectedTime);
  const normalizedSelectedDays = activeDaysFromSchedule(schedule);
  const normalizedSelectedTime = selectedTime || firstTimeFromSchedule(schedule);

  return {
    discordId,
    discordName: cleanString(data.discordName || data.discord_name, 100) || "Discord user",
    guildId: cleanSnowflake(data.guildId || data.guild_id),
    guildName: cleanString(data.guildName || data.guild_name, 120) || "Discord server",
    selectedDays: normalizedSelectedDays,
    selectedTime: normalizedSelectedTime,
    schedule,
    characterKey: cleanString(data.characterKey || data.character_key, 260) || null,
    characterName: cleanString(data.characterName || data.character_name || data.charName || data.char_name, 80) || null,
    characterClass: cleanString(data.characterClass || data.character_class || data.charClass || data.char_class, 80) || null,
    characterSpecName: cleanString(data.characterSpecName || data.character_spec_name || data.activeSpecName || data.active_spec_name || data.specName || data.spec_name, 80) || null,
    characterSpecId: Number.isFinite(Number(data.characterSpecId || data.character_spec_id || data.activeSpecId || data.active_spec_id || data.specId || data.spec_id)) ? Math.floor(Number(data.characterSpecId || data.character_spec_id || data.activeSpecId || data.active_spec_id || data.specId || data.spec_id)) : null,
    characterRole: cleanCharacterRole(data.characterRole || data.character_role || data.charRole || data.char_role),
    characterRealm: cleanString(data.characterRealm || data.character_realm || data.realmName || data.realm_name, 100) || null,
    characterRegion: cleanString(data.characterRegion || data.character_region || data.region, 12) || null,
    createdAt: safeIso(data.createdAt || data.created_at, now),
    updatedAt: safeIso(data.updatedAt || data.updated_at, now),
  };
}

function normalizeVotes(data: Record<string, unknown>): RaidPollVote[] {
  const fromMap = data.votesByDiscordId && typeof data.votesByDiscordId === "object" && !Array.isArray(data.votesByDiscordId)
    ? Object.entries(data.votesByDiscordId as Record<string, unknown>).map(([discordId, vote]) => normalizeVote(vote, discordId)).filter(Boolean) as RaidPollVote[]
    : [];
  const fromArray = Array.isArray(data.votes)
    ? data.votes.map((vote) => normalizeVote(vote)).filter(Boolean) as RaidPollVote[]
    : [];
  const byId = new Map<string, RaidPollVote>();
  for (const vote of [...fromArray, ...fromMap]) byId.set(vote.discordId, vote);
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function normalizeRaidPoll(id: string, data: Record<string, unknown>): RaidPollItem {
  const now = new Date().toISOString();
  const closeAfterMinutes = cleanCloseAfterMinutes(data.closeAfterMinutes || data.close_after_minutes);
  const createdAt = safeIso(data.createdAt || data.created_at, now);
  const closesAtMs = safeMs(data.closesAtMs || data.closes_at_ms, Date.parse(createdAt) + closeAfterMinutes * 60 * 1000);
  // Важливо: не закриваємо обʼєкт тільки під час normalize.
  // Інакше closeDueRaidPoll() бачить already closed і не PATCH-ить Discord,
  // через що публічна кнопка "Проголосувати" лишається активною у старому embed.
  const rawStatus = cleanString(data.status, 20).toLowerCase();
  const status: RaidPollStatus = rawStatus === "closed" ? "closed" : rawStatus === "paused" ? "paused" : "open";
  const pausedAt = status === "paused" ? timestampToIso(data.pausedAt || data.paused_at) : null;
  // Пауза морозить дедлайн. Якщо залишок не збережений (старий документ) — рахуємо від pausedAt.
  const pausedRemainingMs = status === "paused"
    ? Math.max(0, Math.floor(Number(data.pausedRemainingMs ?? data.paused_remaining_ms ?? (pausedAt ? closesAtMs - Date.parse(pausedAt) : 0)) || 0))
    : null;
  const autoRepeatWeekly = cleanBoolean(data.autoRepeatWeekly ?? data.auto_repeat_weekly ?? data.repeatWeekly ?? data.repeat_weekly);
  const repeatWeeklyDay = autoRepeatWeekly ? cleanRepeatWeeklyDay(data.repeatWeeklyDay ?? data.repeat_weekly_day ?? data.repeatDay ?? data.repeat_day) : null;
  const repeatWeeklyTime = autoRepeatWeekly ? cleanRepeatWeeklyTime(data.repeatWeeklyTime ?? data.repeat_weekly_time ?? data.repeatTime ?? data.repeat_time) : null;
  const repeatNextAtMs = autoRepeatWeekly
    ? safeMs(data.repeatNextAtMs ?? data.repeat_next_at_ms, nextWeeklyRepeatMs(Date.parse(createdAt) || Date.now(), repeatWeeklyDay || "mon", repeatWeeklyTime || "12:00"))
    : null;

  return {
    id,
    title: cleanString(data.title, 160) || "Рейд-пул",
    difficulty: cleanDifficulty(data.difficulty),
    description: cleanString(data.description, 900) || RAID_POLL_DESCRIPTION,
    status,
    closeAfterMinutes,
    closesAt: new Date(closesAtMs).toISOString(),
    closesAtMs,
    closedAt: timestampToIso(data.closedAt || data.closed_at),
    pausedAt,
    pausedByName: status === "paused" ? cleanString(data.pausedByName || data.paused_by_name, 120) || null : null,
    pausedNote: status === "paused" ? cleanString(data.pausedNote || data.paused_note, 300) || null : null,
    pausedRemainingMs,
    resumedAt: timestampToIso(data.resumedAt || data.resumed_at),
    closedReason: cleanString(data.closedReason || data.closed_reason, 20) === "manual" ? "manual" : cleanString(data.closedReason || data.closed_reason, 20) === "auto" ? "auto" : null,
    createdByDiscordId: cleanSnowflake(data.createdByDiscordId || data.created_by_discord_id),
    createdByName: cleanString(data.createdByName || data.created_by_name, 120) || "Dashboard",
    channelId: cleanSnowflake(data.channelId || data.channel_id) || null,
    messageId: cleanSnowflake(data.messageId || data.message_id) || null,
    messageUrl: cleanString(data.messageUrl || data.message_url, 2048) || null,
    mentionRoleIds: cleanSnowflakeIds(data.mentionRoleIds ?? data.mention_role_ids),
    autoRepeatWeekly,
    repeatWeeklyDay,
    repeatWeeklyTime,
    repeatNextAt: repeatNextAtMs ? new Date(repeatNextAtMs).toISOString() : null,
    repeatNextAtMs,
    repeatSeriesId: cleanString(data.repeatSeriesId || data.repeat_series_id, 80) || (autoRepeatWeekly ? id : null),
    repeatedFromPollId: cleanString(data.repeatedFromPollId || data.repeated_from_poll_id, 80) || null,
    days: cleanPollDays(data.days).length ? cleanPollDays(data.days) : RAID_POLL_DAYS.map((day) => day.value),
    votes: normalizeVotes(data),
    createdAt,
    updatedAt: safeIso(data.updatedAt || data.updated_at, createdAt),
  };
}

function pollRef(pollId: string) {
  const id = cleanString(pollId, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error("Некоректний ID рейд-пулу.");
  return getFirebaseAdminDb().collection(RAID_POLL_COLLECTION).doc(id);
}


function raidPollVoteCleanupState() {
  return globalThis as typeof globalThis & {
    __mistblossomRaidPollVoteCleanup?: { lastStartedAt: number };
  };
}

function raidPollVoteCleanupMinMs() {
  const fallback = raidPollEcoModeEnabled() ? 60 * 60_000 : RAID_POLL_VOTE_CLEANUP_DEFAULT_MIN_MS;
  return envDurationMs(["RAID_POLL_GUILD_VOTE_CLEANUP_MIN_MS", "RAID_POLL_VOTE_CLEANUP_MIN_MS"], fallback, 60_000, 24 * 60 * 60_000);
}

function votesByDiscordId(votes: RaidPollVote[]) {
  return Object.fromEntries(votes.filter((vote) => cleanSnowflake(vote.discordId)).map((vote) => [vote.discordId, vote]));
}

async function cleanupRaidPollDocumentVotes(pollId: string, membership: RaidPollGuildMembershipSnapshot) {
  const nowIso = new Date().toISOString();
  const ref = pollRef(pollId);
  const cleaned = await firebaseWrite<{ poll: RaidPollItem; removed: number } | null>("raid", `raid-poll:guild-vote-cleanup:${pollId}`, async () => {
    return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const poll = normalizeRaidPoll(snap.id, snap.data() || {});
      const validVotes = poll.votes.filter((vote) => isRaidPollVoteGuildMember(vote, membership));
      const removed = poll.votes.length - validVotes.length;
      if (removed <= 0) return null;
      const nextPoll = { ...poll, votes: validVotes, updatedAt: nowIso };
      tx.update(ref, {
        votes: validVotes,
        votesByDiscordId: votesByDiscordId(validVotes),
        invalidGuildVotesRemoved: FieldValue.increment(removed),
        invalidGuildVotesRemovedAt: nowIso,
        updatedAt: nowIso,
        updatedAtMs: Date.now(),
      });
      return { poll: nextPoll, removed };
    });
  }, { logEvent: "raid_polls.guild_vote_cleanup_failed" });

  if (cleaned?.poll) {
    clearRaidPollRuntimeCaches(cleaned.poll.id);
    await syncRaidPollDiscordMessage(cleaned.poll).catch(() => null);
  }
  return cleaned;
}

export async function cleanupRaidPollVotesForGuildMembers(options: { pollIds?: string[]; force?: boolean; limit?: number } = {}) {
  if (!hasRaidPollStorage()) return { checked: 0, cleaned: 0, removed: 0, skipped: true, reason: "storage_unavailable" as const };

  const state = raidPollVoteCleanupState();
  const minMs = raidPollVoteCleanupMinMs();
  const now = Date.now();
  if (!options.force && state.__mistblossomRaidPollVoteCleanup?.lastStartedAt && now - state.__mistblossomRaidPollVoteCleanup.lastStartedAt < minMs) {
    return { checked: 0, cleaned: 0, removed: 0, skipped: true, reason: "throttled" as const };
  }
  state.__mistblossomRaidPollVoteCleanup = { lastStartedAt: now };

  const membership = await loadRaidPollGuildMembershipSnapshot();
  if (!membership.available) return { checked: 0, cleaned: 0, removed: 0, skipped: true, reason: "guild_roster_unavailable" as const };

  const pollIds = Array.from(new Set((options.pollIds || []).map((id) => cleanString(id, 80)).filter(Boolean))).slice(0, Math.max(1, Math.min(100, Math.floor(options.limit || 80))));
  let ids = pollIds;
  if (!ids.length) {
    const snap = await getFirebaseAdminDb()
      .collection(RAID_POLL_COLLECTION)
      .where("status", "==", "open")
      .limit(Math.max(1, Math.min(100, Math.floor(options.limit || 80))))
      .get();
    ids = snap.docs.map((doc: QueryDocumentSnapshot) => doc.id);
  }

  let cleaned = 0;
  let removed = 0;
  for (const pollId of ids) {
    const next = await cleanupRaidPollDocumentVotes(pollId, membership).catch((error) => {
      console.warn("[raidPolls] Failed to cleanup non-guild poll votes", { pollId, message: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (next) {
      cleaned += 1;
      removed += next.removed;
    }
  }

  return { checked: ids.length, cleaned, removed, skipped: false as const, reason: null };
}

export function pollVoteCounts(poll: Pick<RaidPollItem, "votes">) {
  const days = Object.fromEntries(RAID_POLL_DAYS.map((day) => [day.value, 0])) as Record<RaidPollDay, number>;
  const absent = Object.fromEntries(RAID_POLL_DAYS.map((day) => [day.value, 0])) as Record<RaidPollDay, number>;
  const times = Object.fromEntries(RAID_POLL_TIMES.map((time) => [time, 0])) as Record<RaidPollTime, number>;
  const dayTimes = Object.fromEntries(
    RAID_POLL_DAYS.map((day) => [day.value, Object.fromEntries(RAID_POLL_TIMES.map((time) => [time, 0]))]),
  ) as Record<RaidPollDay, Record<RaidPollTime, number>>;

  for (const vote of poll.votes) {
    const schedule = vote.schedule && Object.keys(vote.schedule).length
      ? vote.schedule
      : scheduleFromLegacy(vote.selectedDays, vote.selectedTime);
    for (const day of RAID_POLL_DAYS) {
      const value = schedule[day.value];
      if (!value) continue;
      if (value === "absent") {
        absent[day.value] += 1;
        continue;
      }

      const selectedTimes = impliedScheduleTimes(value);
      if (!selectedTimes.length) continue;
      days[day.value] += 1;
      for (const time of selectedTimes) {
        times[time] += 1;
        dayTimes[day.value][time] += 1;
      }
    }
  }

  return { days, absent, times, dayTimes, total: poll.votes.length };
}

export function pollVotersForDay(poll: Pick<RaidPollItem, "votes">, day: RaidPollDay) {
  return poll.votes.filter((vote) => {
    const schedule = vote.schedule && Object.keys(vote.schedule).length ? vote.schedule : scheduleFromLegacy(vote.selectedDays, vote.selectedTime);
    return scheduleTimes(schedule[day]).length > 0;
  });
}

export function pollAbsentVotersForDay(poll: Pick<RaidPollItem, "votes">, day: RaidPollDay) {
  return poll.votes.filter((vote) => {
    const schedule = vote.schedule && Object.keys(vote.schedule).length ? vote.schedule : scheduleFromLegacy(vote.selectedDays, vote.selectedTime);
    return schedule[day] === "absent";
  });
}

export function raidPollVoteSchedule(vote: RaidPollVote) {
  return vote.schedule && Object.keys(vote.schedule).length ? vote.schedule : scheduleFromLegacy(vote.selectedDays, vote.selectedTime);
}

export type RaidPollSlotRecommendation = {
  day: RaidPollDay;
  time: RaidPollTime;
  total: number;
  tanks: number;
  healers: number;
  dps: number;
  unknown: number;
  parties: number;
  desiredHealers: number;
  requiredHealers: number;
  desiredTanks: number;
  requiredTanks: number;
  minimumDps: number;
  effectiveDps: number;
  effectiveRaidSize: number;
  coreReady: boolean;
  melee: number;
  ranged: number;
  rangeBalanceScore: number;
  utilityScore: number;
  missingUtility: string[];
  voters: RaidPollVote[];
  score: number;
};

export type RaidPollUniqueDayRecommendation = RaidPollSlotRecommendation & {
  pollId: string;
  pollTitle: string;
};

export type RaidPollRecommendationContext = Pick<RaidPollItem, "id" | "title" | "days" | "votes"> & Partial<Pick<RaidPollItem, "difficulty" | "status" | "createdAt" | "closesAtMs" | "channelId" | "messageId">>;

const RAID_POLL_MAX_SLOT_RECOMMENDATIONS = RAID_POLL_DAYS.length * RAID_POLL_TIMES.length;
const RAID_POLL_WEEKEND_DAYS = new Set<RaidPollDay>(["sat", "sun"]);

function raidPollDayIndex(day: RaidPollDay) {
  return RAID_POLL_DAYS.findIndex((item) => item.value === day);
}

function compareRaidPollSlotRecommendations(a: RaidPollSlotRecommendation, b: RaidPollSlotRecommendation) {
  return b.score - a.score ||
    Number(b.coreReady) - Number(a.coreReady) ||
    Math.min(b.tanks, b.requiredTanks) - Math.min(a.tanks, a.requiredTanks) ||
    Math.min(b.healers, b.requiredHealers) - Math.min(a.healers, a.requiredHealers) ||
    b.effectiveDps - a.effectiveDps ||
    b.utilityScore - a.utilityScore ||
    b.rangeBalanceScore - a.rangeBalanceScore ||
    b.effectiveRaidSize - a.effectiveRaidSize ||
    raidPollDayIndex(a.day) - raidPollDayIndex(b.day) ||
    RAID_POLL_TIMES.indexOf(a.time) - RAID_POLL_TIMES.indexOf(b.time);
}

function roleBucket(role: RaidPollRole | null | undefined) {
  if (role === "tank") return "tanks";
  if (role === "healer") return "healers";
  if (role === "dps") return "dps";
  return "unknown";
}


type RaidPollGuildMembershipSnapshot = {
  available: boolean;
  memberKeys: Set<string>;
  error?: string | null;
  updatedAt?: string | null;
};

function raidPollGuildMembershipCacheState() {
  return globalThis as typeof globalThis & {
    __mistblossomRaidPollGuildMembership?: {
      checkedAt: number;
      snapshot: RaidPollGuildMembershipSnapshot;
    };
  };
}

function characterRosterKey(input: {
  key?: unknown;
  region?: unknown;
  characterRegion?: unknown;
  realmSlug?: unknown;
  realmName?: unknown;
  characterRealm?: unknown;
  normalizedName?: unknown;
  name?: unknown;
  characterName?: unknown;
}) {
  const explicitKey = normalizeCharacterKey(input.key);
  if (explicitKey) return explicitKey;
  return buildBattleNetCharacterKey(
    input.region || input.characterRegion || "eu",
    input.realmSlug || input.characterRealm || input.realmName,
    input.normalizedName || input.name || input.characterName,
  );
}

async function loadRaidPollGuildMembershipSnapshot(): Promise<RaidPollGuildMembershipSnapshot> {
  const state = raidPollGuildMembershipCacheState();
  const cached = state.__mistblossomRaidPollGuildMembership;
  if (cached && Date.now() - cached.checkedAt < raidPollGuildMembershipCacheTtlMs()) {
    return cached.snapshot;
  }

  const roster = await loadStoredGuildRosterData({ bypassCache: false }).catch((error) => ({
    members: [],
    stats: { updatedAt: null },
    source: "error",
    error: error instanceof Error ? error.message : String(error || "guild_roster_unavailable"),
  }));
  const memberKeys = new Set<string>();
  for (const member of roster.members || []) {
    const key = characterRosterKey(member);
    if (key) memberKeys.add(key);
  }

  const snapshot: RaidPollGuildMembershipSnapshot = {
    available: memberKeys.size > 0,
    memberKeys,
    error: (roster as { error?: string | null }).error || null,
    updatedAt: roster.stats?.updatedAt || null,
  };
  state.__mistblossomRaidPollGuildMembership = { checkedAt: Date.now(), snapshot };
  return snapshot;
}

function isProfileCharacterGuildMember(character: ProfileCharacter, membership: RaidPollGuildMembershipSnapshot | null | undefined) {
  if (!membership?.available) return false;
  const key = characterRosterKey(character);
  return Boolean(key && membership.memberKeys.has(key));
}

function isRaidPollVoteGuildMember(vote: Pick<RaidPollVote, "characterKey" | "characterName" | "characterRealm" | "characterRegion">, membership: RaidPollGuildMembershipSnapshot | null | undefined) {
  if (!membership?.available) return false;
  const key = characterRosterKey(vote);
  return Boolean(key && membership.memberKeys.has(key));
}

function guildMembershipUnavailableContent(membership: RaidPollGuildMembershipSnapshot | null | undefined) {
  const detail = membership?.error ? `\nПричина: ${cleanString(membership.error, 180)}` : "";
  return `⚠️ Голосування доступне тільки персонажам зі складу гільдії, але зараз не вдалося підтягнути актуальний guild roster.${detail}\nСпробуй пізніше або попроси офіцера оновити синхронізацію складу.`;
}

function noGuildCharactersContent() {
  return "⚠️ Голосувати можна тільки персонажем, який є учасником гільдії. У твоєму dashboard-профілі немає підтвердженого гільдійного персонажа. Додай/онови персонажа в профілі або звернись до офіцера.";
}

function raidPollSlotFormation(item: Pick<RaidPollSlotRecommendation, "tanks" | "healers" | "dps" | "unknown" | "total" | "voters"> & { difficulty?: RaidPollDifficulty | null }) {
  return raidAlgorithmAnalyzePollSlot({
    total: item.total,
    tanks: item.tanks,
    healers: item.healers,
    dps: item.dps,
    unknown: item.unknown,
    difficulty: item.difficulty || "heroic",
    members: item.voters.map((vote) => ({
      role: vote.characterRole || null,
      characterRole: vote.characterRole || null,
      characterClass: vote.characterClass || null,
      className: vote.characterClass || null,
      characterSpecName: vote.characterSpecName || null,
      activeSpecName: vote.characterSpecName || null,
      characterSpecId: vote.characterSpecId || null,
      activeSpecId: vote.characterSpecId || null,
    })),
  });
}

export function raidPollSlotRecommendations(poll: Pick<RaidPollItem, "days" | "votes"> & Partial<Pick<RaidPollItem, "difficulty">>, limit = 6): RaidPollSlotRecommendation[] {
  const active = poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value);
  const activeSet = new Set(active);
  const rows: RaidPollSlotRecommendation[] = [];

  for (const day of RAID_POLL_DAYS) {
    if (!activeSet.has(day.value)) continue;
    for (const time of RAID_POLL_TIMES) {
      const voters = poll.votes.filter((vote) => scheduleHasTime(raidPollVoteSchedule(vote), day.value, time));
      let tanks = 0;
      let healers = 0;
      let dps = 0;
      let unknown = 0;
      for (const vote of voters) {
        const bucket = roleBucket(vote.characterRole);
        if (bucket === "tanks") tanks += 1;
        else if (bucket === "healers") healers += 1;
        else if (bucket === "dps") dps += 1;
        else unknown += 1;
      }
      const total = voters.length;
      const formation = raidPollSlotFormation({ tanks, healers, dps, unknown, total, voters, difficulty: poll.difficulty || "heroic" });
      rows.push({
        day: day.value,
        time,
        total,
        tanks,
        healers,
        dps,
        unknown,
        ...formation,
        voters,
      });
    }
  }

  return rows
    .filter((item) => item.total > 0)
    .sort(compareRaidPollSlotRecommendations)
    .slice(0, Math.max(1, Math.min(RAID_POLL_MAX_SLOT_RECOMMENDATIONS, Math.floor(limit))));
}

export function raidPollDayRecommendations(poll: Pick<RaidPollItem, "days" | "votes"> & Partial<Pick<RaidPollItem, "difficulty">>, limit = 2): RaidPollSlotRecommendation[] {
  const bestByDay = new Map<RaidPollDay, RaidPollSlotRecommendation>();
  for (const slot of raidPollSlotRecommendations(poll, RAID_POLL_MAX_SLOT_RECOMMENDATIONS)) {
    const current = bestByDay.get(slot.day);
    if (!current || compareRaidPollSlotRecommendations(slot, current) < 0) bestByDay.set(slot.day, slot);
  }
  return Array.from(bestByDay.values())
    .sort(compareRaidPollSlotRecommendations)
    .slice(0, Math.max(1, Math.min(RAID_POLL_DAYS.length, Math.floor(limit))));
}

function raidPollContextMs(value: unknown) {
  const num = Number(value || 0);
  if (Number.isFinite(num) && num > 0) return num;
  const ms = Date.parse(cleanString(value, 40));
  return Number.isFinite(ms) ? ms : 0;
}

function normalizePollRecommendationContext(poll: RaidPollRecommendationContext, index: number): RaidPollRecommendationContext & { id: string; title: string; contextOrder: number } {
  const id = cleanString(poll.id, 80) || `poll-${index}`;
  return {
    ...poll,
    id,
    title: cleanString(poll.title, 160) || `Raid poll ${index + 1}`,
    contextOrder: index,
  };
}

function uniquePollRecommendationContexts(current: RaidPollRecommendationContext, allPolls: RaidPollRecommendationContext[]) {
  const byId = new Map<string, RaidPollRecommendationContext>();
  [...allPolls, current].forEach((poll, index) => {
    const id = cleanString(poll.id, 80) || `poll-${index}`;
    byId.set(id, { ...poll, id });
  });
  return Array.from(byId.values());
}

function comparePollCandidate(a: { pollOrder: number; candidate: RaidPollUniqueDayRecommendation }, b: { pollOrder: number; candidate: RaidPollUniqueDayRecommendation }) {
  return compareRaidPollSlotRecommendations(a.candidate, b.candidate) || a.pollOrder - b.pollOrder || a.candidate.pollTitle.localeCompare(b.candidate.pollTitle, "uk");
}

function isRaidPollWeekendDay(day: RaidPollDay) {
  return RAID_POLL_WEEKEND_DAYS.has(day);
}

function raidPollWeekendCandidateMakesSense(
  candidate: RaidPollSlotRecommendation,
  best: RaidPollSlotRecommendation | null | undefined,
) {
  if (!isRaidPollWeekendDay(candidate.day)) return false;
  if (!candidate.coreReady) return false;
  const bestTotal = Math.max(0, Math.floor(Number(best?.total || 0)));
  const minimumMeaningfulTotal = Math.max(5, Math.ceil(bestTotal * 0.65));
  return candidate.total >= minimumMeaningfulTotal;
}

function assignPollRecommendationCandidate(
  plan: Record<string, RaidPollUniqueDayRecommendation[]>,
  usedDays: Set<RaidPollDay>,
  pollId: string,
  candidate: RaidPollUniqueDayRecommendation,
  limit: number,
) {
  const assigned = plan[pollId] || [];
  if (assigned.length >= limit) return false;
  if (usedDays.has(candidate.day)) return false;
  if (assigned.some((slot) => slot.day === candidate.day)) return false;
  assigned.push(candidate);
  plan[pollId] = assigned;
  usedDays.add(candidate.day);
  return true;
}

export function raidPollUniqueDayRecommendationPlan(polls: RaidPollRecommendationContext[], limitPerPoll = 2): Record<string, RaidPollUniqueDayRecommendation[]> {
  const normalized = polls.map(normalizePollRecommendationContext);
  const perPollLimit = Math.max(1, Math.min(RAID_POLL_DAYS.length, Math.floor(limitPerPoll)));
  const plan: Record<string, RaidPollUniqueDayRecommendation[]> = {};
  const usedDays = new Set<RaidPollDay>();
  const candidatesByPoll = new Map<string, RaidPollUniqueDayRecommendation[]>();

  const orderedPolls = normalized
    .map((poll, index) => {
      const candidates = raidPollDayRecommendations(poll, RAID_POLL_DAYS.length).map((slot) => ({ ...slot, pollId: poll.id, pollTitle: poll.title }));
      candidatesByPoll.set(poll.id, candidates);
      const best = candidates[0] || null;
      return {
        poll,
        best,
        order: raidPollContextMs(poll.closesAtMs) || raidPollContextMs(poll.createdAt) || index,
      };
    })
    .filter((item) => item.best)
    .sort((a, b) => compareRaidPollSlotRecommendations(a.best as RaidPollSlotRecommendation, b.best as RaidPollSlotRecommendation) || a.order - b.order || a.poll.title.localeCompare(b.poll.title, "uk"));

  for (const item of orderedPolls) plan[item.poll.id] = [];

  // Спершу намагаємось дати кожному опублікованому Discord-пулу один вихідний день,
  // але тільки якщо там є реальний склад: ядро готове і кількість гравців не просідає
  // нижче 65% від найкращого дня цього ж рейду. Дні все одно лишаються унікальними.
  const weekendCandidates: Array<{ pollId: string; pollOrder: number; candidate: RaidPollUniqueDayRecommendation }> = [];
  orderedPolls.forEach((item, pollOrder) => {
    const candidates = candidatesByPoll.get(item.poll.id) || [];
    const weekend = candidates.find((candidate) => raidPollWeekendCandidateMakesSense(candidate, item.best));
    if (weekend) weekendCandidates.push({ pollId: item.poll.id, pollOrder, candidate: weekend });
  });
  weekendCandidates.sort(comparePollCandidate);
  for (const row of weekendCandidates) {
    assignPollRecommendationCandidate(plan, usedDays, row.pollId, row.candidate, perPollLimit);
  }

  for (let round = 0; round < perPollLimit; round += 1) {
    const roundCandidates: Array<{ pollId: string; pollOrder: number; candidate: RaidPollUniqueDayRecommendation }> = [];
    orderedPolls.forEach((item, pollOrder) => {
      const assigned = plan[item.poll.id] || [];
      if (assigned.length > round) return;
      for (const candidate of candidatesByPoll.get(item.poll.id) || []) {
        if (usedDays.has(candidate.day)) continue;
        if (assigned.some((slot) => slot.day === candidate.day)) continue;
        roundCandidates.push({ pollId: item.poll.id, pollOrder, candidate });
      }
    });

    roundCandidates.sort(comparePollCandidate);
    let changed = false;
    for (const row of roundCandidates) {
      const assigned = plan[row.pollId] || [];
      if (assigned.length > round || assigned.length >= perPollLimit) continue;
      if (assignPollRecommendationCandidate(plan, usedDays, row.pollId, row.candidate, perPollLimit)) {
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const pollId of Object.keys(plan)) {
    plan[pollId] = plan[pollId].sort(compareRaidPollSlotRecommendations);
  }

  return plan;
}

export function raidPollUniqueDayRecommendations(poll: RaidPollRecommendationContext, allPolls: RaidPollRecommendationContext[] = [poll], limit = 2): RaidPollUniqueDayRecommendation[] {
  const pollId = cleanString(poll.id, 80);
  if (!pollId) {
    return raidPollDayRecommendations(poll, limit).map((slot) => ({ ...slot, pollId: "", pollTitle: cleanString(poll.title, 160) || "Raid poll" }));
  }
  const contexts = uniquePollRecommendationContexts(poll, allPolls);
  const plan = raidPollUniqueDayRecommendationPlan(contexts, limit);
  const planned = plan[pollId] || [];
  if (planned.length) return planned.slice(0, Math.max(1, Math.min(RAID_POLL_DAYS.length, Math.floor(limit))));
  const hasOtherPublishedPolls = contexts.some((context) => context.id !== pollId);
  if (hasOtherPublishedPolls) return [];
  return raidPollDayRecommendations(poll, limit).map((slot) => ({ ...slot, pollId, pollTitle: cleanString(poll.title, 160) || "Raid poll" }));
}

export function raidPollBestSlot(poll: Pick<RaidPollItem, "days" | "votes"> & Partial<Pick<RaidPollItem, "difficulty">>) {
  return raidPollSlotRecommendations(poll, 1)[0] || null;
}

export function raidPollSlotSummary(slot: RaidPollSlotRecommendation | null | undefined) {
  if (!slot) return "Ще немає достатніх голосів.";
  const core = slot.coreReady ? "ядро готове" : "ядро не готове";
  const tankTarget = slot.desiredTanks > slot.requiredTanks ? `, ціль ${slot.desiredTanks}` : "";
  const utility = slot.utilityScore ? ` • utility ${slot.utilityScore}` : "";
  return `${dayLabel(slot.day)} ${slot.time} — танки ${slot.tanks}/${slot.requiredTanks}${tankTarget} • хіли ${slot.healers}/${slot.requiredHealers} (ціль ${slot.desiredHealers}) • ДД ${slot.dps} (${slot.melee}/${slot.ranged})${utility} • ${core} • всього ${slot.total}`;
}


type RaidPollVoteDraft = RaidPollVote & {
  roleSelected: boolean;
};

const RAID_POLL_PRIVATE_SCHEDULE_GROUPS: Array<{ key: "a" | "b"; label: string; days: RaidPollDay[] }> = [
  // Legacy/API fallback. Новий Discord UI нижче показує кожен день окремим select-полем.
  { key: "a", label: "Пн-Чт", days: ["mon", "tue", "wed", "thu"] },
  { key: "b", label: "Пт-Нд", days: ["fri", "sat", "sun"] },
];
const RAID_POLL_PRIVATE_DAY_PAGE_SIZE = 2;

function baseDraftForUser(params: { userId: string; userName: string; guildId?: string | null; guildName?: string | null }, nowIso: string): RaidPollVoteDraft {
  return {
    discordId: cleanSnowflake(params.userId),
    discordName: cleanString(params.userName, 100) || "Discord user",
    guildId: cleanSnowflake(params.guildId),
    guildName: cleanString(params.guildName, 120) || "Discord server",
    selectedDays: [],
    selectedTime: null,
    schedule: {},
    characterKey: null,
    characterName: null,
    characterClass: null,
    characterSpecName: null,
    characterSpecId: null,
    characterRole: null,
    characterRealm: null,
    characterRegion: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    roleSelected: false,
  };
}

function draftFromExistingVote(vote: RaidPollVote, nowIso: string): RaidPollVoteDraft {
  return {
    ...vote,
    schedule: raidPollVoteSchedule(vote),
    selectedDays: activeDaysFromSchedule(raidPollVoteSchedule(vote)),
    selectedTime: firstTimeFromSchedule(raidPollVoteSchedule(vote)),
    roleSelected: Boolean(vote.characterRole),
    updatedAt: vote.updatedAt || nowIso,
  };
}

function normalizeVoteDraft(raw: unknown, fallback: RaidPollVoteDraft): RaidPollVoteDraft {
  const normalized = normalizeVote(raw, fallback.discordId);
  const rawObject = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const roleSelected = rawObject
    ? rawObject.roleSelected === true || rawObject.role_selected === true
    : fallback.roleSelected;
  const source = normalized || fallback;
  const schedule = raidPollVoteSchedule(source);
  return {
    ...fallback,
    ...source,
    schedule,
    selectedDays: activeDaysFromSchedule(schedule),
    selectedTime: firstTimeFromSchedule(schedule),
    roleSelected,
    createdAt: source.createdAt || fallback.createdAt,
    updatedAt: source.updatedAt || fallback.updatedAt,
  };
}

function voteDraftFromPollData(data: Record<string, unknown>, userId: string, fallback: RaidPollVoteDraft) {
  const drafts = data.voteDraftsByDiscordId && typeof data.voteDraftsByDiscordId === "object" && !Array.isArray(data.voteDraftsByDiscordId)
    ? data.voteDraftsByDiscordId as Record<string, unknown>
    : {};
  return normalizeVoteDraft(drafts[userId], fallback);
}

function voteDraftToFirestore(draft: RaidPollVoteDraft) {
  return {
    ...draft,
    selectedDays: activeDaysFromSchedule(draft.schedule),
    selectedTime: firstTimeFromSchedule(draft.schedule),
    roleSelected: Boolean(draft.roleSelected),
  };
}

function hasDraftSchedule(draft: Pick<RaidPollVoteDraft, "schedule">) {
  return Object.keys(draft.schedule || {}).some((day) => Boolean((draft.schedule as Record<string, unknown>)[day]));
}

function isDraftReadyToSubmit(draft: RaidPollVoteDraft) {
  return Boolean(draft.characterKey && draft.characterName && draft.roleSelected && draft.characterRole && hasDraftSchedule(draft));
}

function draftReadinessLines(draft: RaidPollVoteDraft, poll: Pick<RaidPollItem, "days">) {
  const character = draft.characterName
    ? `✅ Персонаж: ${draft.characterName}${draft.characterRealm ? ` • ${draft.characterRealm}` : ""}`
    : "⬜ Персонаж: не вибрано";
  const role = draft.roleSelected && draft.characterRole
    ? `✅ Роль: ${raidPollRoleLabel(draft.characterRole)}`
    : "⬜ Роль: не вибрано";
  const schedule = hasDraftSchedule(draft)
    ? `✅ Дні/години: ${scheduleSummary(draft.schedule, poll.days)}`
    : "⬜ Дні/години: не вибрано";
  const submit = isDraftReadyToSubmit(draft)
    ? "🟢 Можна натискати **Проголосувати**."
    : "🟡 Це ще чернетка. Вибери персонажа, роль і доступність, потім натисни **Проголосувати**.";
  return [character, role, schedule, submit].join("\n");
}

function draftSavedContent(draft: RaidPollVoteDraft, poll: RaidPollItem) {
  return `📝 Чернетку оновлено, але голос ще **не зараховано**.\n${draftReadinessLines(draft, poll)}`;
}

function draftPromptContent(draft: RaidPollVoteDraft, poll: RaidPollItem) {
  const intro = poll.votes.some((vote) => vote.discordId === draft.discordId)
    ? "✏️ Зміни свій голос: персонаж, роль і розклад редагуються тут приватно."
    : "🗳️ Створи голос: вибери персонажа, роль, дні й години.";
  return `${intro}\n${draftReadinessLines(draft, poll)}`;
}

function submittedVoteContent(vote: RaidPollVote, poll: RaidPollItem) {
  const characterLabel = vote.characterName
    ? `${vote.characterName}${vote.characterClass ? ` • ${vote.characterClass}` : ""}${vote.characterRole ? ` • ${raidPollRoleLabel(vote.characterRole)}` : ""}`
    : "персонаж не вказаний";
  return `✅ Голос зараховано для **${raidPollTitle(poll)}**.\nПерсонаж: **${characterLabel}**\nРозклад: **${scheduleSummary(raidPollVoteSchedule(vote), poll.days)}**`;
}

function formatDiscordTimestamp(ms: number) {
  const stamp = Math.floor(ms / 1000);
  return `<t:${stamp}:f> • <t:${stamp}:R>`;
}

function isRaidPollPublishedToDiscordContext(poll: RaidPollRecommendationContext, currentId?: string | null) {
  const id = cleanString(poll.id, 80);
  if (currentId && id === currentId) return true;
  return Boolean(cleanSnowflake(poll.channelId) && cleanSnowflake(poll.messageId));
}

function activeRecommendationPolls(current: RaidPollItem, relatedPolls: RaidPollRecommendationContext[] = [current]) {
  const byId = new Map<string, RaidPollRecommendationContext>();
  for (const poll of relatedPolls) {
    const id = cleanString(poll.id, 80);
    if (!id) continue;
    if (!isRaidPollPublishedToDiscordContext(poll, current.id)) continue;
    byId.set(id, { ...poll, id });
  }
  byId.set(current.id, current);
  return Array.from(byId.values());
}

function topDaySummary(poll: RaidPollItem, relatedPolls: RaidPollRecommendationContext[] = [poll]) {
  const slots = raidPollUniqueDayRecommendations(poll, activeRecommendationPolls(poll, relatedPolls), 2);
  return slots.length ? slots.map((slot, index) => `${index + 1}) ${raidPollSlotSummary(slot)}`).join("\n") : raidPollSlotSummary(null);
}

function pollActiveDays(poll: Pick<RaidPollItem, "days">) {
  const allowed = poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value);
  return RAID_POLL_DAYS.filter((day) => allowed.includes(day.value));
}

function scheduleSummary(schedule: RaidPollSchedule, days: RaidPollDay[] = RAID_POLL_DAYS.map((day) => day.value)) {
  const parts = days
    .map((day) => {
      const value = schedule[day];
      return value ? `${dayLabel(day)} ${raidPollAvailabilityLabel(value)}` : null;
    })
    .filter(Boolean) as string[];
  return parts.length ? parts.join(" • ") : "розклад ще не вибрано";
}

function characterSummary(vote: RaidPollVote) {
  const name = vote.characterName || vote.discordName;
  const details = [vote.characterClass, vote.characterRole ? raidPollRoleLabel(vote.characterRole) : null].filter(Boolean).join(" • ");
  return details ? `${name} (${details})` : name;
}

function dayCountsDiscordValue(poll: RaidPollItem) {
  const counts = pollVoteCounts(poll);
  return pollActiveDays(poll).map((day) => {
    const cant = counts.absent[day.value] ? ` • ❌ ${counts.absent[day.value]}` : "";
    return `${day.emoji} **${day.label}** — ${counts.days[day.value]}${cant}`;
  }).join("\n") || "—";
}

function timeCountsDiscordValue(poll: RaidPollItem) {
  const counts = pollVoteCounts(poll);
  return RAID_POLL_TIMES.map((time) => `**${time}** — ${counts.times[time]}`).join("\n");
}

function votersDiscordValue(poll: RaidPollItem) {
  if (!poll.votes.length) return "—";
  const days = pollActiveDays(poll).map((day) => day.value);
  return [...poll.votes]
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))
    .slice(0, 5)
    .map((vote) => `• ${characterSummary(vote)}: ${scheduleSummary(raidPollVoteSchedule(vote), days)}`)
    .join("\n")
    .slice(0, 1000);
}

function raidPollDiscordStatusValue(poll: RaidPollItem) {
  if (poll.status === "closed") return "🔒 **Голосування завершено**";
  if (poll.status === "paused") {
    const note = poll.pausedNote ? `\n📝 ${poll.pausedNote}` : "";
    const remaining = raidPollRemainingLabel(poll);
    return `⏸️ **Голосування призупинено**\nЗалишок часу заморожено: ${remaining}${note}`;
  }
  return `🟢 **Голосування відкрите**\nЗакриття: ${formatDiscordTimestamp(poll.closesAtMs)}`;
}

export function buildRaidPollDiscordPayload(poll: RaidPollItem, relatedPolls: RaidPollRecommendationContext[] = [poll]) {
  const counts = pollVoteCounts(poll);
  const closed = poll.status === "closed" || (poll.status === "open" && poll.closesAtMs <= Date.now());
  const paused = raidPollIsPaused(poll);
  const fields = [
    { name: "📌 Статус", value: raidPollDiscordStatusValue(poll), inline: false },
    { name: "🗓️ Голоси за днями", value: dayCountsDiscordValue(poll), inline: true },
    { name: "⏰ Голоси за часом", value: timeCountsDiscordValue(poll), inline: true },
    { name: "👥 Проголосували", value: `${counts.total}`, inline: true },
    { name: "🧠 2 рекомендовані дні/час", value: topDaySummary(poll, relatedPolls), inline: false },
    { name: "🧾 Останні 5 голосів", value: votersDiscordValue(poll), inline: false },
  ];

  const embed = normalizeDiscordEmbed({
    title: `${closed ? "🔒" : paused ? "⏸️" : "🗳️"} ${raidPollTitle(poll)}`,
    description: poll.description,
    color: closed ? 0x5865f2 : paused ? 0x9aa4b2 : DIFFICULTY_COLORS[poll.difficulty],
    url: dashboardPollUrl(poll.id),
    fields,
    footer: {
      text: closed
        ? "Mistblossom Vanguard • Рейд-пул завершено"
        : paused
          ? "Mistblossom Vanguard • Пауза: голоси тимчасово не приймаються"
          : "Mistblossom Vanguard • Натисни кнопку голосування й підтвердь вибір",
    },
    // Детермінований timestamp: інакше кожен payload унікальний і Discord
    // отримує PATCH навіть тоді, коли нічого не змінилося.
    timestamp: safeIso(poll.updatedAt, poll.createdAt),
  });

  return {
    content: closed
      ? "🔒 **Голосування завершено. Фінальний результат нижче.**"
      : paused
        ? "⏸️ **Рейд-пул на паузі. Голоси тимчасово не приймаються — стежте за оновленням.**"
        : "🗳️ **Рейд-пул відкрито. Натисніть кнопку, оберіть персонажа/роль/розклад і підтвердьте голос.**",
    embed,
    components: buildRaidPollDiscordComponents(poll),
    mentionRoleIds: cleanSnowflakeIds(poll.mentionRoleIds || []),
  };
}

function scheduleOptionLabel(day: RaidPollDay, availability: RaidPollAvailability) {
  return `${dayLabel(day)} • ${raidPollAvailabilityLabel(availability)}`.slice(0, 100);
}

function scheduleOptionDescription(day: RaidPollDay, availability: RaidPollAvailability) {
  return availability === "absent"
    ? `${dayFullLabel(day)}: гравець позначає, що не може бути в рейді`
    : `${dayFullLabel(day)}: готовий/готова з ${availability} і на всі пізніші слоти`;
}

function scheduleSelectOptions(days: RaidPollDay[]) {
  return days.flatMap((day) => RAID_POLL_AVAILABILITY_OPTIONS.map((availability) => ({
    label: scheduleOptionLabel(day, availability),
    value: `${day}:${availability}`,
    description: scheduleOptionDescription(day, availability).slice(0, 100),
  })));
}

/** Текст приватної Discord-відповіді, коли пул на паузі. */
function raidPollPausedContent(poll: Pick<RaidPollItem, "status" | "closesAtMs" | "pausedRemainingMs" | "pausedNote">) {
  const note = poll.pausedNote ? `\n📝 ${poll.pausedNote}` : "";
  return `⏸️ Рейд-пул на паузі — голоси тимчасово не приймаються.\nТвій попередній голос збережено, час до закриття заморожено (${raidPollRemainingLabel(poll)}).${note}`;
}

function raidPollLockedButtonLabel(poll: Pick<RaidPollItem, "status">, activeLabel: string) {
  if (raidPollIsPaused(poll)) return "⏸️ Пауза — голоси не приймаються";
  return activeLabel;
}

export function buildRaidPollDiscordComponents(poll: Pick<RaidPollItem, "id" | "status" | "closesAtMs" | "days">) {
  const disabled = raidPollVotingLocked(poll);

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: disabled ? 2 : 3,
          custom_id: `${RAID_POLL_ACTION_PREFIX}_character_prompt:${poll.id}`,
          label: disabled ? raidPollLockedButtonLabel(poll, "Голосування завершено") : "Проголосувати / змінити голос",
          disabled,
        },
        { type: 2, style: 5, label: "Деталі на сайті", url: dashboardPollUrl(poll.id) },
      ],
    },
  ];
}

function buildRaidPollSubmittedComponents(poll: Pick<RaidPollItem, "id" | "status" | "closesAtMs" | "days">) {
  const disabled = raidPollVotingLocked(poll);
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          custom_id: `${RAID_POLL_ACTION_PREFIX}_character_prompt:${poll.id}`,
          label: disabled ? raidPollLockedButtonLabel(poll, "Голосування завершено") : "Змінити голос",
          disabled,
        },
        { type: 2, style: 5, label: "Деталі на сайті", url: dashboardPollUrl(poll.id) },
      ],
    },
  ];
}

function roleSelectOptions(draft: RaidPollVoteDraft) {
  return RAID_POLL_ROLE_OPTIONS.map((role) => ({
    label: `${role.emoji} ${role.label}`.slice(0, 100),
    value: role.value,
    description: role.description.slice(0, 100),
    default: draft.roleSelected && draft.characterRole === role.value,
  }));
}

function isScheduleOptionDefault(schedule: RaidPollSchedule, day: RaidPollDay, availability: RaidPollAvailability) {
  const value = schedule[day];
  if (availability === "absent") return value === "absent";
  return scheduleTimes(value).includes(availability);
}

function scheduleSelectOptionsWithDefaults(days: RaidPollDay[], draft: RaidPollVoteDraft) {
  return days.flatMap((day) => RAID_POLL_AVAILABILITY_OPTIONS.map((availability) => ({
    label: scheduleOptionLabel(day, availability),
    value: `${day}:${availability}`,
    description: scheduleOptionDescription(day, availability).slice(0, 100),
    default: isScheduleOptionDefault(draft.schedule, day, availability),
  })));
}

function scheduleDaySelectOptions(day: RaidPollDay, draft: RaidPollVoteDraft) {
  // У приватному Discord-пульті кожен день винесений в окремий select.
  // Discord показує в закритому select тільки label вибраного option, а не placeholder,
  // тому без префікса дня користувач бачив два однакові рядки «з 20:00».
  // Формат має бути самодостатнім: «Пн · з 20:00», «Вт · Не можу».
  return RAID_POLL_AVAILABILITY_OPTIONS.map((availability) => ({
    label: `${dayLabel(day)} · ${raidPollAvailabilityLabel(availability)}`.slice(0, 100),
    value: `${day}:${availability}`,
    description: scheduleOptionDescription(day, availability).slice(0, 100),
    default: isScheduleOptionDefault(draft.schedule, day, availability),
  }));
}

function scheduleActiveDayValues(poll: Pick<RaidPollItem, "days">) {
  return pollActiveDays(poll).map((day) => day.value);
}

function schedulePageCount(poll: Pick<RaidPollItem, "days">) {
  return Math.max(1, Math.ceil(scheduleActiveDayValues(poll).length / RAID_POLL_PRIVATE_DAY_PAGE_SIZE));
}

function clampSchedulePage(page: unknown, poll: Pick<RaidPollItem, "days">) {
  const count = schedulePageCount(poll);
  const value = Math.floor(Number(page) || 0);
  return Math.max(0, Math.min(count - 1, value));
}

function schedulePageForDay(day: RaidPollDay, poll: Pick<RaidPollItem, "days">) {
  const index = scheduleActiveDayValues(poll).indexOf(day);
  return index >= 0 ? Math.floor(index / RAID_POLL_PRIVATE_DAY_PAGE_SIZE) : 0;
}

function schedulePageFromGroup(group: string | null | undefined, poll: Pick<RaidPollItem, "days">) {
  const day = cleanPollDay(group);
  if (day) return schedulePageForDay(day, poll);
  const pageMatch = cleanString(group, 24).match(/^page_(\d{1,2})$/i);
  if (pageMatch) return clampSchedulePage(pageMatch[1], poll);
  return clampSchedulePage(group, poll);
}

function buildRaidPollVoteDraftComponents(
  poll: Pick<RaidPollItem, "id" | "status" | "closesAtMs" | "days">,
  profile: DashboardProfile,
  draft: RaidPollVoteDraft,
  membership?: RaidPollGuildMembershipSnapshot | null,
  schedulePageInput: unknown = 0,
) {
  const disabled = raidPollVotingLocked(poll);
  const rows: Array<Record<string, unknown>> = [];

  const characterOptions: Array<{ label: string; description: string; value: string; default: boolean }> = [];
  const seenCharacterOptions = new Set<string>();
  let characterDefaultAssigned = false;
  const selectedCharacterKey = normalizeCharacterKey(draft.characterKey || "");
  pollSelectableProfileCharacters(profile, membership).forEach((character, index) => {
    if (characterOptions.length >= 25) return;
    const optionKey = normalizeCharacterKey(character.key || "") || `${String(character.name || "").toLowerCase()}:${String(character.realmSlug || character.realmName || "").toLowerCase()}`;
    if (optionKey && seenCharacterOptions.has(optionKey)) return;
    if (optionKey) seenCharacterOptions.add(optionKey);
    const isDefault = Boolean(selectedCharacterKey && !characterDefaultAssigned && normalizeCharacterKey(character.key) === selectedCharacterKey);
    if (isDefault) characterDefaultAssigned = true;
    characterOptions.push({
      label: pollCharacterOptionLabel(character, index),
      description: pollCharacterOptionDescription(character),
      value: `c${index}`,
      default: isDefault,
    });
  });

  if (characterOptions.length) {
    rows.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${RAID_POLL_ACTION_PREFIX}_character:${poll.id}`,
          placeholder: "1) Обери персонажа",
          min_values: 1,
          max_values: 1,
          disabled,
          options: characterOptions,
        },
      ],
    });
  }

  rows.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `${RAID_POLL_ACTION_PREFIX}_role:${poll.id}`,
        placeholder: "2) Обери роль у рейді",
        min_values: 1,
        max_values: 1,
        disabled,
        options: roleSelectOptions(draft),
      },
    ],
  });

  const activeDays = scheduleActiveDayValues(poll);
  const pageCount = schedulePageCount(poll);
  const schedulePage = clampSchedulePage(schedulePageInput, poll);
  const pageDays = activeDays.slice(
    schedulePage * RAID_POLL_PRIVATE_DAY_PAGE_SIZE,
    schedulePage * RAID_POLL_PRIVATE_DAY_PAGE_SIZE + RAID_POLL_PRIVATE_DAY_PAGE_SIZE,
  );

  for (const day of pageDays) {
    rows.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${RAID_POLL_ACTION_PREFIX}_schedule_${day}:${poll.id}`,
          placeholder: `3) ${dayFullLabel(day)}: обери один варіант`,
          min_values: 1,
          max_values: 1,
          disabled,
          options: scheduleDaySelectOptions(day, draft),
        },
      ],
    });
  }

  const previousPage = Math.max(0, schedulePage - 1);
  const nextPage = Math.min(pageCount - 1, schedulePage + 1);
  const footerButtons: Array<Record<string, unknown>> = [];
  if (pageCount > 1) {
    footerButtons.push({
      type: 2,
      style: 2,
      custom_id: `${RAID_POLL_ACTION_PREFIX}_schedule_page_${previousPage}:${poll.id}`,
      label: "◀ Дні",
      disabled: disabled || schedulePage <= 0,
    });
  }
  footerButtons.push({
    type: 2,
    style: isDraftReadyToSubmit(draft) && !disabled ? 3 : 2,
    custom_id: `${RAID_POLL_ACTION_PREFIX}_submit:${poll.id}`,
    label: isDraftReadyToSubmit(draft) ? "Проголосувати / оновити голос" : "Проголосувати",
    disabled: disabled || !isDraftReadyToSubmit(draft),
  });
  if (pageCount > 1) {
    footerButtons.push({
      type: 2,
      style: 2,
      custom_id: `${RAID_POLL_ACTION_PREFIX}_schedule_page_${nextPage}:${poll.id}`,
      label: "Дні ▶",
      disabled: disabled || schedulePage >= pageCount - 1,
    });
  }
  footerButtons.push({ type: 2, style: 5, label: `Деталі • ${schedulePage + 1}/${pageCount}`, url: dashboardPollUrl(poll.id) });

  rows.push({
    type: 1,
    components: footerButtons.slice(0, 5),
  });

  // Не обрізаємо останній рядок із submit-кнопкою. Якщо через майбутні зміни рядків
  // стане більше 5, прибираємо зайві day-select-и перед footer-рядком, а не кнопку голосування.
  if (rows.length > 5) {
    const footer = rows[rows.length - 1];
    const head = rows.slice(0, 2);
    const middle = rows.slice(2, -1).slice(0, Math.max(0, 5 - head.length - 1));
    return [...head, ...middle, footer].slice(0, 5);
  }
  return rows;
}

async function loadPublishedRaidPollsForRecommendations(current?: RaidPollItem | null) {
  if (!hasRaidPollStorage()) return current ? [current] : [];
  const byId = new Map<string, RaidPollItem>();

  try {
    const polls = await listRaidPolls(120);
    for (const poll of polls) {
      if (!cleanSnowflake(poll.channelId) || !cleanSnowflake(poll.messageId)) continue;
      byId.set(poll.id, poll);
    }
  } catch (error) {
    console.warn("[raidPolls] Failed to load related published polls for recommendation allocation", {
      message: error instanceof Error ? error.message : String(error || "unknown"),
    });
  }

  if (current) byId.set(current.id, current);
  return Array.from(byId.values());
}

/**
 * Підпис відрендереного Discord-повідомлення. Discord не має where-умов, тому
 * єдиний спосіб не витрачати rate limit — не слати PATCH, якщо байти ті самі.
 * Працює тільки завдяки детермінованому embed timestamp у buildRaidPollDiscordPayload.
 */
function raidPollDiscordSignature(payload: { content: string; embed: unknown; components: unknown; mentionRoleIds: string[] }) {
  try {
    return createHash("sha1")
      .update(JSON.stringify({ c: payload.content, e: payload.embed, k: payload.components, m: payload.mentionRoleIds }))
      .digest("hex");
  } catch {
    return "";
  }
}

function raidPollSignatureCacheKey(pollId: string, messageId: string) {
  return `${RAID_POLL_DISCORD_SIGNATURE_PREFIX}${pollId}:${messageId}`;
}

export async function recalculatePublishedRaidPollDiscordRecommendations(
  current?: RaidPollItem | null,
  options: { force?: boolean } = {},
) {
  if (!current) clearRaidPollRuntimeCaches();
  const polls = await loadPublishedRaidPollsForRecommendations(current);
  const publishedPolls = polls.filter((poll) => cleanSnowflake(poll.channelId) && cleanSnowflake(poll.messageId));
  const result = { total: publishedPolls.length, updated: 0, skipped: 0, failed: 0, failedPollIds: [] as string[] };

  // Паралельно, але з профілем external-api: Discord не любить бурсти на 10+ PATCH.
  const settled = await mapConcurrentSettled(
    publishedPolls,
    (poll) => syncRaidPollDiscordMessage(poll, { relatedPolls: publishedPolls, force: options.force }),
    { profile: "external-api", envKey: "RAID_POLL_DISCORD_SYNC_CONCURRENCY", max: 4 },
  );

  for (const item of settled.results) {
    if (item.ok) {
      if (item.value === "skipped") result.skipped += 1;
      else result.updated += 1;
      continue;
    }
    result.failed += 1;
    result.failedPollIds.push(item.item.id);
    console.warn("[raidPolls] Failed to recalculate published poll recommendation message", {
      pollId: item.item.id,
      message: item.error instanceof Error ? item.error.message : String(item.error || "unknown"),
    });
  }

  return result;
}

/**
 * Єдина точка синхронізації існуючого Discord-повідомлення пулу.
 * Повертає "skipped", якщо стан не змінився з попереднього PATCH.
 */
export async function syncRaidPollDiscordMessage(
  poll: RaidPollItem,
  options: { relatedPolls?: RaidPollRecommendationContext[]; force?: boolean } = {},
): Promise<"updated" | "skipped" | "noop"> {
  if (!poll.channelId || !poll.messageId) return "noop";
  const payload = buildRaidPollDiscordPayload(poll, options.relatedPolls || await loadPublishedRaidPollsForRecommendations(poll));
  const signature = raidPollDiscordSignature(payload);
  const cacheKey = raidPollSignatureCacheKey(poll.id, poll.messageId);

  if (!options.force && signature) {
    const previous = getRuntimeCachedValue<string>(cacheKey, RAID_POLL_DISCORD_SIGNATURE_TTL_MS);
    if (previous === signature) return "skipped";
  }

  await editDiscordRaidMessage({
    ref: { channelId: poll.channelId, messageId: poll.messageId },
    content: payload.content,
    embed: payload.embed,
    components: payload.components,
    mentionRoleIds: payload.mentionRoleIds,
    auditReason: `Raid poll sync: ${poll.id}`,
  });

  if (signature) setRuntimeCachedValue(cacheKey, signature);
  return "updated";
}

async function publishOrUpdatePollDiscordMessage(poll: RaidPollItem, channelIdInput?: string | null) {
  const targetChannelId = cleanSnowflake(channelIdInput) || cleanSnowflake(poll.channelId) || getDiscordDefaultChannelId();
  if (!targetChannelId) throw new Error("Discord-канал для рейд-пулу не вибрано.");

  const relatedPolls = await loadPublishedRaidPollsForRecommendations(poll);
  const payload = buildRaidPollDiscordPayload(poll, relatedPolls);
  const hasExistingMessage = Boolean(poll.channelId && poll.messageId);
  const canEditExisting = Boolean(hasExistingMessage && poll.channelId === targetChannelId);
  let message: Record<string, unknown> | null = null;

  if (canEditExisting && poll.channelId && poll.messageId) {
    try {
      message = await editDiscordRaidMessage({
        ref: { channelId: poll.channelId, messageId: poll.messageId },
        content: payload.content,
        embed: payload.embed,
        components: payload.components,
        mentionRoleIds: payload.mentionRoleIds,
        auditReason: `Raid poll updated: ${poll.id}`,
      }) as Record<string, unknown>;
    } catch (error) {
      if (!isMissingDiscordMessageError(error)) throw error;
      message = await createDiscordRaidMessage({
        channelId: targetChannelId,
        content: payload.content,
        embed: payload.embed,
        components: payload.components,
        mentionRoleIds: payload.mentionRoleIds,
        auditReason: `Raid poll republished after missing message: ${poll.id}`,
      }) as Record<string, unknown>;
    }
  } else {
    message = await createDiscordRaidMessage({
      channelId: targetChannelId,
      content: payload.content,
      embed: payload.embed,
      components: payload.components,
      mentionRoleIds: payload.mentionRoleIds,
      auditReason: hasExistingMessage ? `Raid poll moved to another channel: ${poll.id}` : `Raid poll created from dashboard: ${poll.id}`,
    }) as Record<string, unknown>;

    if (hasExistingMessage && poll.channelId && poll.messageId && poll.channelId !== targetChannelId) {
      await deleteDiscordRaidMessage({
        ref: { channelId: poll.channelId, messageId: poll.messageId },
        auditReason: `Raid poll moved to another channel: ${poll.id}`,
      }).catch((error) => {
        console.warn("[raidPolls] Failed to delete old Discord poll message", {
          pollId: poll.id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  const messageId = cleanSnowflake(message?.id || message?.message_id || poll.messageId);
  const finalChannelId = cleanSnowflake(message?.channel_id || targetChannelId);
  if (!messageId || !finalChannelId) throw new Error("Discord не підтвердив повідомлення рейд-пулу.");
  return { channelId: finalChannelId, messageId, messageUrl: discordMessageUrl(finalChannelId, messageId) };
}

async function savePollDiscordRef(pollId: string, ref: { channelId: string; messageId: string; messageUrl: string }) {
  const updatedAt = new Date().toISOString();
  await firebaseWrite("raid", `raid-poll:discord-ref:${pollId}`, async () => {
    await pollRef(pollId).update({
      channelId: ref.channelId,
      messageId: ref.messageId,
      messageUrl: ref.messageUrl,
      updatedAt,
      updatedAtMs: Date.now(),
    });
    return true;
  }, { logEvent: "raid_polls.discord_ref_failed" });
  clearRaidPollRuntimeCaches(pollId);
  clearRaidPollDiscordSignatureCache(pollId);
  return updatedAt;
}


export function raidPollLiveRevision(poll: Pick<RaidPollItem, "id" | "status" | "updatedAt" | "closedAt" | "votes">) {
  const votesSignature = [...(poll.votes || [])]
    .sort((a, b) => String(a.discordId || "").localeCompare(String(b.discordId || "")))
    .map((vote) => [
      vote.discordId || "",
      vote.characterKey || "",
      vote.characterName || "",
      vote.characterRole || "",
      vote.characterClass || "",
      JSON.stringify(raidPollVoteSchedule(vote)),
      vote.updatedAt || vote.createdAt || "",
    ].join("~"))
    .join("|");

  return [
    poll.id || "",
    poll.status || "",
    poll.updatedAt || "",
    poll.closedAt || "",
    poll.votes?.length || 0,
    votesSignature,
  ].join("::");
}

export async function getRaidPoll(pollId: string, options: { closeDue?: boolean; bypassCache?: boolean } = {}) {
  if (!hasRaidPollStorage()) return null;
  const poll = await firebaseRead<RaidPollItem | null>(
    "raid",
    `raid-poll:${pollId}`,
    async () => {
      const snap = await pollRef(pollId).get();
      if (!snap.exists) return null;
      return normalizeRaidPoll(snap.id, snap.data() || {});
    },
    { ttlMs: raidPollItemCacheTtlMs(), fallback: () => null, logEvent: "raid_polls.read_failed", bypassCache: options.bypassCache },
  );
  if (poll && options.closeDue !== false) return closeDueRaidPoll(poll);
  return poll;
}

export async function listRaidPolls(limit = 100) {
  if (!hasRaidPollStorage()) return [];
  return firebaseRead<RaidPollItem[]>(
    "raid",
    `${RAID_POLL_LIST_CACHE_KEY}:${limit}`,
    async () => {
      const snap = await getFirebaseAdminDb()
        .collection(RAID_POLL_COLLECTION)
        .orderBy("createdAtMs", "desc")
        .limit(Math.max(1, Math.min(200, Math.floor(limit))))
        .get();
      return snap.docs.map((doc: QueryDocumentSnapshot) => normalizeRaidPoll(doc.id, doc.data() || {}));
    },
    { ttlMs: raidPollListCacheTtlMs(), fallback: () => [], logEvent: "raid_polls.list_failed" },
  );
}

export async function saveRaidPollFromInput(input: RaidPollCreateInput, user: DashboardSession) {
  if (!hasRaidPollStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));

  const title = cleanString(input.title, 160);
  if (title.length < 3) throw new Error("Вкажи назву рейду для голосування.");

  const difficulty = cleanDifficulty(input.difficulty);
  const closeAfterMinutes = cleanCloseAfterMinutes(input.closeAfterMinutes);
  const description = cleanPollDescription(input.description);
  const days = cleanPollDays(input.days);
  const activeDays = days.length ? days : RAID_POLL_DAYS.map((day) => day.value);
  const now = new Date();
  const nowIso = now.toISOString();
  const closesAtMs = now.getTime() + closeAfterMinutes * 60 * 1000;
  const id = newPollId();
  const channelId = cleanSnowflake(input.channelId) || getDiscordDefaultChannelId();
  const mentionRoleIds = cleanSnowflakeIds(input.mentionRoleIds);
  const autoRepeatWeekly = cleanBoolean(input.autoRepeatWeekly);
  const repeatWeeklyDay = autoRepeatWeekly ? cleanRepeatWeeklyDay(input.repeatWeeklyDay) : null;
  const repeatWeeklyTime = autoRepeatWeekly ? cleanRepeatWeeklyTime(input.repeatWeeklyTime) : null;
  const repeatNextAtMs = autoRepeatWeekly ? nextWeeklyRepeatMs(now.getTime(), repeatWeeklyDay || "mon", repeatWeeklyTime || "12:00") : null;
  const repeatSeriesId = autoRepeatWeekly ? id : null;

  const basePoll: RaidPollItem = {
    id,
    title,
    difficulty,
    description,
    status: "open",
    closeAfterMinutes,
    closesAt: new Date(closesAtMs).toISOString(),
    closesAtMs,
    closedAt: null,
    closedReason: null,
    createdByDiscordId: user.provider === "discord" ? user.id : "",
    createdByName: user.name || "Dashboard",
    channelId: channelId || null,
    messageId: null,
    messageUrl: null,
    mentionRoleIds,
    autoRepeatWeekly,
    repeatWeeklyDay,
    repeatWeeklyTime,
    repeatNextAt: repeatNextAtMs ? new Date(repeatNextAtMs).toISOString() : null,
    repeatNextAtMs,
    repeatSeriesId,
    repeatedFromPollId: null,
    days: activeDays,
    votes: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await firebaseWrite("raid", `raid-poll:create:${id}`, async () => {
    await pollRef(id).set({
      ...basePoll,
      days: activeDays,
      mentionRoleIds,
      autoRepeatWeekly,
      repeatWeeklyDay,
      repeatWeeklyTime,
      repeatNextAt: repeatNextAtMs ? new Date(repeatNextAtMs).toISOString() : null,
      repeatNextAtMs,
      repeatSeriesId,
      repeatedFromPollId: null,
      votes: [],
      votesByDiscordId: {},
      createdAtMs: now.getTime(),
      updatedAtMs: now.getTime(),
    });
    return true;
  }, { logEvent: "raid_polls.create_failed" });
  clearRaidPollRuntimeCaches(id);

  let published: { channelId: string; messageId: string; messageUrl: string } | null = null;
  try {
    published = await publishOrUpdatePollDiscordMessage(basePoll, channelId);
    const updatedAt = await savePollDiscordRef(id, published);
    const createdPoll = { ...basePoll, ...published, updatedAt };
    await recalculatePublishedRaidPollDiscordRecommendations(createdPoll).catch(() => null);
    return createdPoll;
  } catch (error) {
    if (published?.channelId && published?.messageId) {
      await deleteDiscordRaidMessage({
        ref: { channelId: published.channelId, messageId: published.messageId },
        auditReason: `Rollback failed raid poll create: ${id}`,
      }).catch(() => null);
    }
    await firebaseWrite("raid", `raid-poll:create-rollback:${id}`, async () => {
      await pollRef(id).delete().catch(() => null);
      return true;
    }, { logEvent: "raid_polls.create_rollback_failed" }).catch(() => null);
    clearRaidPollRuntimeCaches(id);
    throw error;
  }
}

export async function saveRaidPollFromForm(form: FormData, user: DashboardSession) {
  return saveRaidPollFromInput({
    title: form.get("title"),
    difficulty: form.get("difficulty"),
    description: form.get("description"),
    channelId: form.get("channelId"),
    closeAfterMinutes: form.get("closeAfterMinutes"),
    days: form.getAll("days"),
    mentionRoleIds: form.getAll("mentionRoleIds"),
    autoRepeatWeekly: form.get("autoRepeatWeekly"),
    repeatWeeklyDay: form.get("repeatWeeklyDay"),
    repeatWeeklyTime: form.get("repeatWeeklyTime"),
  }, user);
}

export async function updateRaidPollFromInput(pollId: string, input: RaidPollUpdateInput) {
  if (!hasRaidPollStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));

  const title = cleanString(input.title, 160);
  if (title.length < 3) throw new Error("Вкажи назву рейду для голосування.");
  const difficulty = cleanDifficulty(input.difficulty);
  const closeAfterMinutes = cleanCloseAfterMinutes(input.closeAfterMinutes);
  const description = cleanPollDescription(input.description);
  const days = cleanPollDays(input.days);
  const activeDays = days.length ? days : RAID_POLL_DAYS.map((day) => day.value);
  const channelId = cleanSnowflake(input.channelId) || getDiscordDefaultChannelId();
  const mentionRoleIds = cleanSnowflakeIds(input.mentionRoleIds);
  const autoRepeatWeekly = cleanBoolean(input.autoRepeatWeekly);
  const repeatWeeklyDay = autoRepeatWeekly ? cleanRepeatWeeklyDay(input.repeatWeeklyDay) : null;
  const repeatWeeklyTime = autoRepeatWeekly ? cleanRepeatWeeklyTime(input.repeatWeeklyTime) : null;
  if (!channelId) throw new Error("Discord-канал для рейд-пулу не вибрано.");

  const updatedAt = new Date().toISOString();
  const updatedPoll = await firebaseWrite<RaidPollItem>("raid", `raid-poll:update:${pollId}`, async () => {
    const ref = pollRef(pollId);
    return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Рейд-пул не знайдено.");
      const previous = normalizeRaidPoll(snap.id, snap.data() || {});
      const createdAtMs = Date.parse(previous.createdAt);
      const closesAtMs = previous.status === "closed"
        ? previous.closesAtMs
        : (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()) + closeAfterMinutes * 60 * 1000;
      const repeatConfigChanged = previous.repeatWeeklyDay !== repeatWeeklyDay || previous.repeatWeeklyTime !== repeatWeeklyTime || previous.autoRepeatWeekly !== autoRepeatWeekly;
      const nextRepeatAtMs = autoRepeatWeekly
        ? repeatConfigChanged || !previous.repeatNextAtMs
          ? nextWeeklyRepeatMs(Date.now(), repeatWeeklyDay || "mon", repeatWeeklyTime || "12:00")
          : previous.repeatNextAtMs
        : null;
      const nextRepeatAt = nextRepeatAtMs ? new Date(nextRepeatAtMs).toISOString() : null;
      const next: RaidPollItem = {
        ...previous,
        title,
        difficulty,
        description,
        closeAfterMinutes,
        closesAt: new Date(closesAtMs).toISOString(),
        closesAtMs,
        channelId,
        mentionRoleIds,
        autoRepeatWeekly,
        repeatWeeklyDay,
        repeatWeeklyTime,
        repeatNextAt: nextRepeatAt,
        repeatNextAtMs: nextRepeatAtMs,
        repeatSeriesId: autoRepeatWeekly ? previous.repeatSeriesId || previous.id : null,
        days: activeDays,
        updatedAt,
      };
      tx.update(ref, {
        title,
        difficulty,
        description,
        closeAfterMinutes,
        closesAt: next.closesAt,
        closesAtMs,
        channelId,
        mentionRoleIds,
        autoRepeatWeekly,
        repeatWeeklyDay,
        repeatWeeklyTime,
        repeatNextAt: nextRepeatAt,
        repeatNextAtMs: nextRepeatAtMs,
        repeatSeriesId: autoRepeatWeekly ? previous.repeatSeriesId || previous.id : null,
        days: activeDays,
        updatedAt,
        updatedAtMs: Date.now(),
      });
      return next;
    });
  }, { logEvent: "raid_polls.update_failed" });

  clearRaidPollRuntimeCaches(updatedPoll.id);
  const published = await publishOrUpdatePollDiscordMessage(updatedPoll, channelId);
  const discordUpdatedAt = await savePollDiscordRef(updatedPoll.id, published);
  const finalPoll = { ...updatedPoll, ...published, updatedAt: discordUpdatedAt };
  await recalculatePublishedRaidPollDiscordRecommendations(finalPoll).catch(() => null);
  return finalPoll;
}

export async function updateRaidPollFromForm(pollId: string, form: FormData) {
  return updateRaidPollFromInput(pollId, {
    title: form.get("title"),
    difficulty: form.get("difficulty"),
    description: form.get("description"),
    channelId: form.get("channelId"),
    closeAfterMinutes: form.get("closeAfterMinutes"),
    days: form.getAll("days"),
    mentionRoleIds: form.getAll("mentionRoleIds"),
    autoRepeatWeekly: form.get("autoRepeatWeekly"),
    repeatWeeklyDay: form.get("repeatWeeklyDay"),
    repeatWeeklyTime: form.get("repeatWeeklyTime"),
  });
}

async function markRaidPollRepeatFailed(pollId: string, message: string) {
  await firebaseWrite("raid", `raid-poll:repeat-failed:${pollId}`, async () => {
    await pollRef(pollId).update({
      repeatLockedAtMs: FieldValue.delete(),
      repeatLockId: FieldValue.delete(),
      repeatLastError: cleanString(message, 400),
      repeatLastErrorAt: new Date().toISOString(),
      updatedAtMs: Date.now(),
    });
    return true;
  }, { logEvent: "raid_polls.repeat_unlock_failed" }).catch(() => null);
}

async function claimRaidPollRepeat(pollId: string, nowMs: number, lockId: string) {
  return firebaseWrite<RaidPollItem | null>("raid", `raid-poll:repeat-claim:${pollId}:${lockId}`, async () => {
    const ref = pollRef(pollId);
    return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const raw = snap.data() || {};
      const poll = normalizeRaidPoll(snap.id, raw);
      if (!poll.autoRepeatWeekly || !poll.repeatNextAtMs || poll.repeatNextAtMs > nowMs) return null;

      const existingLockAt = safeMs((raw as Record<string, unknown>).repeatLockedAtMs, 0);
      if (existingLockAt && nowMs - existingLockAt < 5 * 60 * 1000) return null;

      tx.update(ref, {
        repeatLockedAtMs: nowMs,
        repeatLockId: lockId,
        updatedAt: new Date(nowMs).toISOString(),
        updatedAtMs: nowMs,
      });
      return poll;
    });
  }, { logEvent: "raid_polls.repeat_claim_failed" });
}

async function createRepeatedRaidPoll(template: RaidPollItem) {
  const now = new Date();
  const nowIso = now.toISOString();
  const id = newPollId();
  const closesAtMs = now.getTime() + template.closeAfterMinutes * 60 * 1000;
  const repeatWeeklyDay = template.repeatWeeklyDay || "mon";
  const repeatWeeklyTime = template.repeatWeeklyTime || "12:00";
  const repeatNextAtMs = nextWeeklyRepeatMs(now.getTime(), repeatWeeklyDay, repeatWeeklyTime);
  const repeatSeriesId = template.repeatSeriesId || template.id;
  const nextPoll: RaidPollItem = {
    ...template,
    id,
    title: template.title,
    difficulty: template.difficulty,
    description: template.description,
    channelId: template.channelId || getDiscordDefaultChannelId() || null,
    mentionRoleIds: cleanSnowflakeIds(template.mentionRoleIds || []),
    days: template.days?.length ? template.days : RAID_POLL_DAYS.map((day) => day.value),
    closeAfterMinutes: template.closeAfterMinutes,
    status: "open",
    closesAt: new Date(closesAtMs).toISOString(),
    closesAtMs,
    closedAt: null,
    closedReason: null,
    messageId: null,
    messageUrl: null,
    votes: [],
    autoRepeatWeekly: true,
    repeatWeeklyDay,
    repeatWeeklyTime,
    repeatNextAt: new Date(repeatNextAtMs).toISOString(),
    repeatNextAtMs,
    repeatSeriesId,
    repeatedFromPollId: template.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await firebaseWrite("raid", `raid-poll:repeat-create:${template.id}:${id}`, async () => {
    await pollRef(id).set({
      ...nextPoll,
      votes: [],
      votesByDiscordId: {},
      voteDraftsByDiscordId: {},
      createdAtMs: now.getTime(),
      updatedAtMs: now.getTime(),
      repeatedAt: nowIso,
    });
    return true;
  }, { logEvent: "raid_polls.repeat_create_failed" });
  clearRaidPollRuntimeCaches(id);

  let published: { channelId: string; messageId: string; messageUrl: string } | null = null;
  try {
    published = await publishOrUpdatePollDiscordMessage(nextPoll, nextPoll.channelId || template.channelId);
    const updatedAt = await savePollDiscordRef(id, published);
    const publishedPoll = { ...nextPoll, ...published, updatedAt };
    const deleteResult = await deleteRaidPoll(template.id).catch(async (error) => {
      await firebaseWrite("raid", `raid-poll:repeat-old-disable:${template.id}`, async () => {
        await pollRef(template.id).update({
          autoRepeatWeekly: false,
          repeatWeeklyDay: null,
          repeatWeeklyTime: null,
          repeatNextAt: null,
          repeatNextAtMs: null,
          repeatReplacedByPollId: id,
          status: "closed",
          closedAt: nowIso,
          closedReason: "auto",
          updatedAt: nowIso,
          updatedAtMs: now.getTime(),
        });
        return true;
      }, { logEvent: "raid_polls.repeat_old_disable_failed" }).catch(() => null);
      console.warn("[raidPolls] Failed to delete repeated old poll", {
        pollId: template.id,
        newPollId: id,
        message: error instanceof Error ? error.message : String(error),
      });
      return { discordDeleted: false, discordDeleteFailed: true };
    });
    return { poll: publishedPoll, oldPollId: template.id, discordDeleted: Boolean(deleteResult?.discordDeleted), discordDeleteFailed: Boolean(deleteResult?.discordDeleteFailed) };
  } catch (error) {
    if (published?.channelId && published?.messageId) {
      await deleteDiscordRaidMessage({
        ref: { channelId: published.channelId, messageId: published.messageId },
        auditReason: `Rollback failed repeated raid poll create: ${id}`,
      }).catch(() => null);
    }
    await pollRef(id).delete().catch(() => null);
    clearRaidPollRuntimeCaches(id);
    throw error;
  }
}

export async function repeatDueRaidPolls(options: { limit?: number } = {}) {
  if (!hasRaidPollStorage()) return { checked: 0, repeated: 0, deleted: 0, failed: 0 };
  const nowMs = Date.now();
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit || (raidPollEcoModeEnabled() ? 10 : 25))));
  let docs: QueryDocumentSnapshot[] = [];

  try {
    const snap = await getFirebaseAdminDb()
      .collection(RAID_POLL_COLLECTION)
      .where("autoRepeatWeekly", "==", true)
      .where("repeatNextAtMs", "<=", nowMs)
      .orderBy("repeatNextAtMs", "asc")
      .limit(limit)
      .get();
    docs = snap.docs;
  } catch {
    const snap = await getFirebaseAdminDb()
      .collection(RAID_POLL_COLLECTION)
      .where("autoRepeatWeekly", "==", true)
      .limit(limit)
      .get();
    docs = snap.docs;
  }

  let checked = 0;
  let repeated = 0;
  let deleted = 0;
  let failed = 0;

  for (const doc of docs) {
    const poll = normalizeRaidPoll(doc.id, doc.data() || {});
    if (!poll.repeatNextAtMs || poll.repeatNextAtMs > nowMs) continue;
    // Пауза морозить і автоповтор: інакше cron перестворив би пул і видалив
    // Discord-повідомлення, повністю зруйнувавши сенс паузи.
    if (raidPollIsPaused(poll)) continue;
    checked += 1;
    const lockId = randomUUID();
    const claimed = await claimRaidPollRepeat(doc.id, nowMs, lockId).catch((error) => {
      failed += 1;
      console.warn("[raidPolls] Failed to claim repeated poll", { pollId: doc.id, message: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (!claimed) continue;

    await createRepeatedRaidPoll(claimed)
      .then((result) => {
        repeated += 1;
        if (result.discordDeleted) deleted += 1;
        if (result.discordDeleteFailed) failed += 1;
      })
      .catch(async (error) => {
        failed += 1;
        await markRaidPollRepeatFailed(claimed.id, error instanceof Error ? error.message : String(error));
        console.warn("[raidPolls] Failed to repeat raid poll", { pollId: claimed.id, message: error instanceof Error ? error.message : String(error) });
      });
  }

  return { checked, repeated, deleted, failed };
}

export async function closeDueRaidPoll(input: RaidPollItem) {
  if (input.status === "closed" || input.closesAtMs > Date.now()) return input;
  return closeRaidPoll(input.id, "auto", { silentIfClosed: true });
}

async function readDueRaidPolls(nowMs: number, limit: number) {
  try {
    const snap = await getFirebaseAdminDb()
      .collection(RAID_POLL_COLLECTION)
      .where("status", "==", "open")
      .where("closesAtMs", "<=", nowMs)
      .orderBy("closesAtMs", "asc")
      .limit(limit)
      .get();
    return snap.docs.map((doc: QueryDocumentSnapshot) => normalizeRaidPoll(doc.id, doc.data() || {}));
  } catch {
    const snap = await getFirebaseAdminDb()
      .collection(RAID_POLL_COLLECTION)
      .where("status", "==", "open")
      .limit(limit)
      .get();
    return snap.docs
      .map((doc: QueryDocumentSnapshot) => normalizeRaidPoll(doc.id, doc.data() || {}))
      .filter((poll: RaidPollItem) => poll.status !== "closed" && poll.closesAtMs <= nowMs)
      .sort((a: RaidPollItem, b: RaidPollItem) => a.closesAtMs - b.closesAtMs);
  }
}

export async function closeDueRaidPolls(options: { force?: boolean; cleanupVotes?: boolean } = {}) {
  if (!hasRaidPollStorage()) return { checked: 0, scanned: 0, closed: 0, repeatedChecked: 0, repeated: 0, deleted: 0, voteCleanupChecked: 0, voteCleanupCleaned: 0, voteCleanupRemoved: 0, voteCleanupSkipped: true, voteCleanupReason: "storage_unavailable", failed: 0, errors: [] as string[] };

  const nowMs = Date.now();
  const limit = raidPollDueScanLimit();
  let duePolls: RaidPollItem[] = [];
  let failed = 0;
  const errors: string[] = [];

  try {
    duePolls = (await readDueRaidPolls(nowMs, limit)).slice(0, Math.min(limit, 20));
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error || "unknown");
    errors.push(message.slice(0, 220));
    console.warn("[raidPolls] Failed to read due polls", { message });
  }

  const shouldCleanupVotes = options.cleanupVotes === true || (duePolls.length > 0 && !raidPollEcoModeEnabled()) || raidPollVoteCleanupOnIdleCron();
  const voteCleanup = shouldCleanupVotes
    ? await cleanupRaidPollVotesForGuildMembers({
        pollIds: duePolls.map((poll) => poll.id),
        limit: Math.max(1, Math.min(limit, 50)),
        force: options.force,
      }).catch((error) => {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error || "unknown");
        errors.push(`vote-cleanup: ${message}`.slice(0, 220));
        return { checked: 0, cleaned: 0, removed: 0, skipped: true as const, reason: "failed" as const };
      })
    : { checked: 0, cleaned: 0, removed: 0, skipped: true as const, reason: "idle_eco" as const };

  let closed = 0;
  for (const poll of duePolls) {
    await closeRaidPoll(poll.id, "auto", { silentIfClosed: true })
      .then(() => { closed += 1; })
      .catch((error) => {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error || "unknown");
        errors.push(`${poll.id}: ${message}`.slice(0, 220));
        console.warn("[raidPolls] Failed to close due poll", { pollId: poll.id, message });
      });
  }

  const repeated = await repeatDueRaidPolls({ limit: raidPollEcoModeEnabled() ? 10 : 25 }).catch((error) => {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error || "unknown");
    errors.push(`repeat: ${message}`.slice(0, 220));
    console.warn("[raidPolls] Failed to repeat due polls", { message });
    return { checked: 0, repeated: 0, deleted: 0, failed: 0 };
  });

  return {
    checked: duePolls.length,
    scanned: duePolls.length,
    closed,
    repeatedChecked: repeated.checked,
    repeated: repeated.repeated,
    deleted: repeated.deleted,
    voteCleanupChecked: voteCleanup.checked,
    voteCleanupCleaned: voteCleanup.cleaned,
    voteCleanupRemoved: voteCleanup.removed,
    voteCleanupSkipped: voteCleanup.skipped,
    voteCleanupReason: voteCleanup.reason,
    failed: failed + repeated.failed,
    errors: errors.slice(0, 8),
  };
}

export async function closeRaidPoll(pollId: string, reason: "manual" | "auto" = "manual", options: { silentIfClosed?: boolean } = {}) {
  if (!hasRaidPollStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));
  const closedAt = new Date().toISOString();
  const updated = await firebaseWrite<RaidPollItem>("raid", `raid-poll:close:${pollId}:${reason}`, async () => {
    const ref = pollRef(pollId);
    return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Рейд-пул не знайдено.");
      const poll = normalizeRaidPoll(snap.id, snap.data() || {});
      if (poll.status === "closed") return poll;
      tx.update(ref, {
        status: "closed",
        closedAt,
        closedReason: reason,
        updatedAt: closedAt,
        updatedAtMs: Date.now(),
      });
      return { ...poll, status: "closed", closedAt, closedReason: reason, updatedAt: closedAt };
    });
  }, { logEvent: "raid_polls.close_failed" });

  clearRaidPollRuntimeCaches(updated.id);
  await recalculatePublishedRaidPollDiscordRecommendations(updated).catch(() => null);
  return updated;
}

const RAID_POLL_MIN_RESUME_WINDOW_MS = 5 * 60_000;

/**
 * Пауза не архівує пул: статус стає "paused", а залишок часу до автозакриття
 * заморожується в pausedRemainingMs. Cron шукає тільки status == "open",
 * тому призупинений пул не буде закрито автоматично.
 */
export async function pauseRaidPoll(pollId: string, options: { actorName?: string; note?: string } = {}) {
  if (!hasRaidPollStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));
  const pausedAt = new Date().toISOString();
  const actorName = cleanString(options.actorName, 120) || "Dashboard";
  const note = cleanString(options.note, 300);

  const updated = await firebaseWrite<RaidPollItem>("raid", `raid-poll:pause:${pollId}`, async () => {
    const ref = pollRef(pollId);
    return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Рейд-пул не знайдено.");
      const poll = normalizeRaidPoll(snap.id, snap.data() || {});
      if (poll.status === "closed") throw new Error("Закритий рейд-пул не можна поставити на паузу. Спочатку створи новий.");
      if (poll.status === "paused") return poll;

      const remaining = Math.max(0, poll.closesAtMs - Date.now());
      tx.update(ref, {
        status: "paused",
        pausedAt,
        pausedByName: actorName,
        pausedNote: note || null,
        pausedRemainingMs: remaining,
        updatedAt: pausedAt,
        updatedAtMs: Date.now(),
      });
      return {
        ...poll,
        status: "paused" as RaidPollStatus,
        pausedAt,
        pausedByName: actorName,
        pausedNote: note || null,
        pausedRemainingMs: remaining,
        updatedAt: pausedAt,
      };
    });
  }, { logEvent: "raid_polls.pause_failed" });

  clearRaidPollRuntimeCaches(updated.id);
  await syncRaidPollDiscordMessage(updated, { force: true }).catch(() => null);
  return updated;
}

/**
 * Відновлення повертає статус "open" і зсуває дедлайн на замороженний залишок,
 * щоб пауза не з'їдала час голосування.
 */
export async function resumeRaidPoll(pollId: string, options: { actorName?: string; extendMinutes?: number } = {}) {
  if (!hasRaidPollStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));
  const resumedAt = new Date().toISOString();
  const extendMs = Math.max(0, Math.floor(Number(options.extendMinutes) || 0)) * 60_000;

  const updated = await firebaseWrite<RaidPollItem>("raid", `raid-poll:resume:${pollId}`, async () => {
    const ref = pollRef(pollId);
    return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Рейд-пул не знайдено.");
      const poll = normalizeRaidPoll(snap.id, snap.data() || {});
      if (poll.status === "closed") throw new Error("Рейд-пул уже закрито, відновлення неможливе.");
      if (poll.status !== "paused") return poll;

      // Мінімальне вікно, щоб пул не закрився тією ж секундою, якщо пауза почалась на межі дедлайну.
      const frozen = Math.max(0, Number(poll.pausedRemainingMs) || 0);
      const remaining = Math.max(RAID_POLL_MIN_RESUME_WINDOW_MS, frozen + extendMs);
      const closesAtMs = Date.now() + remaining;

      // Якщо автоповтор «протермінувався» під час паузи — переносимо його на
      // наступну майбутню дату, щоб пул не продублювався одразу після відновлення.
      const repeatOverdue = Boolean(poll.autoRepeatWeekly && poll.repeatNextAtMs && poll.repeatNextAtMs <= Date.now());
      const repeatNextAtMs = repeatOverdue
        ? nextWeeklyRepeatMs(Date.now(), poll.repeatWeeklyDay || "mon", poll.repeatWeeklyTime || "12:00")
        : poll.repeatNextAtMs || null;

      tx.update(ref, {
        status: "open",
        closesAtMs,
        closesAt: new Date(closesAtMs).toISOString(),
        ...(repeatOverdue ? { repeatNextAtMs, repeatNextAt: new Date(repeatNextAtMs as number).toISOString() } : {}),
        pausedAt: null,
        pausedByName: null,
        pausedNote: null,
        pausedRemainingMs: null,
        resumedAt,
        updatedAt: resumedAt,
        updatedAtMs: Date.now(),
      });
      return {
        ...poll,
        status: "open" as RaidPollStatus,
        closesAtMs,
        closesAt: new Date(closesAtMs).toISOString(),
        repeatNextAtMs,
        repeatNextAt: repeatNextAtMs ? new Date(repeatNextAtMs).toISOString() : null,
        pausedAt: null,
        pausedByName: null,
        pausedNote: null,
        pausedRemainingMs: null,
        resumedAt,
        updatedAt: resumedAt,
      };
    });
  }, { logEvent: "raid_polls.resume_failed" });

  clearRaidPollRuntimeCaches(updated.id);
  await syncRaidPollDiscordMessage(updated, { force: true }).catch(() => null);
  return updated;
}

function orderedProfileCharacters(profile: DashboardProfile | null | undefined) {
  if (!profile?.characters?.length) return [] as ProfileCharacter[];
  const main = getMainCharacter(profile);
  const rest = profile.characters.filter((character) => character.key !== main?.key);
  return main ? [main, ...rest] : rest;
}

function pollSelectableProfileCharacters(profile: DashboardProfile | null | undefined, membership?: RaidPollGuildMembershipSnapshot | null) {
  const characters = orderedProfileCharacters(profile);
  if (!membership?.available) return characters;
  return characters.filter((character) => isProfileCharacterGuildMember(character, membership));
}

function pollCharacterOptionLabel(character: ProfileCharacter, index: number) {
  const realm = character.realmName || character.realmSlug || "realm";
  const prefix = index === 0 ? "★ " : "";
  return `${prefix}${character.name || "Персонаж"} • ${realm}`.slice(0, 100);
}

function pollCharacterOptionDescription(character: ProfileCharacter) {
  return ([
    "Гільдійний персонаж",
    character.activeSpecName || null,
    character.className || null,
    character.itemLevel ? `${character.itemLevel} ilvl` : null,
  ].filter(Boolean).join(" • ").slice(0, 100) || "Персонаж Battle.net");
}

function buildRaidPollCharacterSelectComponents(pollId: string, profile: DashboardProfile, selectedCharacterKey?: string | null, membership?: RaidPollGuildMembershipSnapshot | null) {
  const options = pollSelectableProfileCharacters(profile, membership)
    .slice(0, 25)
    .map((character, index) => ({
      label: pollCharacterOptionLabel(character, index),
      description: pollCharacterOptionDescription(character),
      value: `c${index}`,
      default: selectedCharacterKey ? normalizeCharacterKey(character.key) === normalizeCharacterKey(selectedCharacterKey) : index === 0,
    }));

  if (!options.length) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${RAID_POLL_ACTION_PREFIX}_character:${pollId}`,
          placeholder: "Обери персонажа з dashboard-профілю",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
  ];
}

function profileLinkComponents() {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: "Відкрити dashboard-профіль", url: `${dashboardBaseUrl()}/profile` },
      ],
    },
  ];
}

function resolvePollProfileCharacter(profile: DashboardProfile | null, selectorInput: unknown, membership?: RaidPollGuildMembershipSnapshot | null) {
  const selector = cleanCharacterSelector(selectorInput || "main");
  const characters = pollSelectableProfileCharacters(profile, membership);
  if (!characters.length) return null;
  if (selector === "main") return characters[0] || null;
  const characterIndexMatch = selector.match(/^c(\d{1,2})$/i);
  if (characterIndexMatch) return characters[Number(characterIndexMatch[1])] || null;
  const altMatch = selector.match(/^alt_(\d+)$/);
  if (altMatch) return characters[Math.max(1, Number(altMatch[1]))] || null;
  const key = normalizeCharacterKey(selector);
  return key ? characters.find((character) => normalizeCharacterKey(character.key) === key) || null : null;
}

async function refreshProfileBeforePollVote(profile: DashboardProfile | null, context: { pollId: string; userId: string }) {
  if (!profile?.characters?.length) return profile;
  try {
    return await refreshProfileCharactersForRaidSignup(profile);
  } catch (error) {
    console.warn("[raidPolls] Battle.net character refresh before poll vote failed", {
      pollId: context.pollId,
      userId: context.userId,
      profileId: profile.profileId,
      message: error instanceof Error ? error.message : String(error),
    });
    return profile;
  }
}

function voteCharacterPayload(profile: DashboardProfile | null, selector: unknown, membership?: RaidPollGuildMembershipSnapshot | null) {
  const character = resolvePollProfileCharacter(profile, selector, membership);
  if (!character) return null;
  const manualRole = profile?.raidRolePreference?.characterKey === character.key ? profile.raidRolePreference?.role : null;
  const resolvedRole = manualRole === "tank" || manualRole === "healer" || manualRole === "dps"
    ? manualRole
    : resolveWowCharacterRole({
        className: character.className,
        activeSpecName: character.activeSpecName,
        activeSpecId: character.activeSpecId,
        activeSpecRole: character.activeSpecRole,
      });
  return {
    characterKey: character.key || null,
    characterName: character.name || null,
    characterClass: character.className || null,
    characterSpecName: character.activeSpecName || null,
    characterSpecId: Number.isFinite(Number(character.activeSpecId || 0)) && Number(character.activeSpecId || 0) > 0 ? Math.floor(Number(character.activeSpecId || 0)) : null,
    characterRole: resolvedRole,
    characterRealm: character.realmName || character.realmSlug || null,
    characterRegion: character.region || "eu",
  } satisfies Pick<RaidPollVote, "characterKey" | "characterName" | "characterClass" | "characterSpecName" | "characterSpecId" | "characterRole" | "characterRealm" | "characterRegion">;
}

function normalizeVoteScheduleForPoll(poll: RaidPollItem, schedule: RaidPollSchedule) {
  const allowed = new Set((poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value)) as RaidPollDay[]);
  const next: RaidPollSchedule = {};
  for (const day of RAID_POLL_DAYS) {
    if (!allowed.has(day.value)) continue;
    const value = compactScheduleValue(schedule[day.value]);
    if (value) next[day.value] = value;
  }
  return next;
}


function scheduleGroupDays(groupKey: string | null | undefined, poll: Pick<RaidPollItem, "days">): RaidPollDay[] {
  const active = new Set((poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value)) as RaidPollDay[]);
  const directDay = cleanPollDay(groupKey);
  if (directDay && active.has(directDay)) return [directDay];
  const group = RAID_POLL_PRIVATE_SCHEDULE_GROUPS.find((item) => item.key === groupKey);
  return (group?.days || []).filter((day) => active.has(day));
}

function shouldAutoAttachMainCharacter(kind: "days" | "time" | "schedule" | "schedule_page" | "character" | "character_prompt", existing: RaidPollVote | undefined) {
  if (kind === "character" || kind === "character_prompt") return false;
  return !existing?.characterKey && !existing?.characterName;
}

function dedupeSchedulePatch(schedule: RaidPollSchedule) {
  const next: RaidPollSchedule = {};
  for (const day of RAID_POLL_DAYS) {
    const value = compactScheduleValue(schedule[day.value]);
    if (value) next[day.value] = value;
  }
  return next;
}

export async function handleRaidPollDiscordVote(params: {
  pollId: string;
  kind: "days" | "time" | "schedule" | "schedule_page" | "character" | "character_prompt" | "role" | "submit";
  group?: string | null;
  values: string[];
  userId: string;
  userName: string;
  guildId?: string | null;
  guildName?: string | null;
  messageRef?: DiscordMessageRef | null;
}): Promise<RaidPollVoteResult> {
  if (!hasRaidPollStorage()) {
    return { ok: false, content: "❌ Голосування тимчасово недоступне: Firebase не налаштований." };
  }

  const userId = cleanSnowflake(params.userId);
  if (!userId) return { ok: false, content: "❌ Не вдалося визначити Discord ID користувача." };

  const nowIso = new Date().toISOString();
  let changedPoll: RaidPollItem | null = null;
  let profile = await getProfileByDiscordUserId(userId).catch(() => null);
  profile = await refreshProfileBeforePollVote(profile, { pollId: params.pollId, userId });
  const guildMembership = profile?.characters?.length
    ? await loadRaidPollGuildMembershipSnapshot()
    : null;
  const membershipForComponents = guildMembership?.available ? guildMembership : null;

  const readPollAndDraft = async () => {
    const snap = await pollRef(params.pollId).get();
    if (!snap.exists) return null;
    const poll = normalizeRaidPoll(snap.id, snap.data() || {});
    const existingVote = poll.votes.find((vote) => vote.discordId === userId) || null;
    const fallback = existingVote
      ? draftFromExistingVote(existingVote, nowIso)
      : baseDraftForUser({ ...params, userId }, nowIso);
    const draft = voteDraftFromPollData(snap.data() || {}, userId, fallback);
    return { poll, draft, data: snap.data() || {} };
  };

  if (params.kind === "character_prompt" || params.kind === "schedule_page") {
    const state = await readPollAndDraft();
    if (!state) return { ok: false, content: "❌ Рейд-пул не знайдено або його було видалено." };
    const { poll, draft } = state;
    const schedulePage = params.kind === "schedule_page" ? schedulePageFromGroup(params.group, poll) : 0;
    if (raidPollIsPaused(poll)) {
      return { ok: false, poll, content: raidPollPausedContent(poll) };
    }
    if (!raidPollAcceptsVotes(poll)) {
      return { ok: false, closed: true, poll, content: "🔒 Голосування вже завершено. Голос змінити не можна." };
    }
    if (!profile?.characters?.length) {
      return {
        ok: false,
        poll,
        content: "⚠️ Не знайшов персонажів у твоєму dashboard-профілі. Відкрий профіль, привʼяжи Battle.net і додай персонажів, тоді повернись до голосування.",
        components: profileLinkComponents(),
      };
    }
    if (!guildMembership?.available) {
      return { ok: false, poll, content: guildMembershipUnavailableContent(guildMembership), components: profileLinkComponents() };
    }
    if (!pollSelectableProfileCharacters(profile, guildMembership).length) {
      return { ok: false, poll, content: noGuildCharactersContent(), components: profileLinkComponents() };
    }

    return {
      ok: true,
      poll,
      content: draftPromptContent(draft, poll),
      components: buildRaidPollVoteDraftComponents(poll, profile, draft, membershipForComponents, schedulePage),
    };
  }

  if (!profile?.characters?.length && (params.kind === "character" || params.kind === "submit")) {
    return {
      ok: false,
      content: "⚠️ Не знайшов персонажів у твоєму dashboard-профілі. Привʼяжи Battle.net/персонажів на сайті, тоді повернись до голосування.",
      components: profileLinkComponents(),
    };
  }

  if ((params.kind === "character" || params.kind === "submit") && profile?.characters?.length) {
    if (!guildMembership?.available) {
      return { ok: false, content: guildMembershipUnavailableContent(guildMembership), components: profileLinkComponents() };
    }
    if (!pollSelectableProfileCharacters(profile, guildMembership).length) {
      return { ok: false, content: noGuildCharactersContent(), components: profileLinkComponents() };
    }
  }

  const result = await firebaseWrite<RaidPollVoteResult>("raid", `raid-poll:vote:${params.pollId}:${userId}:${params.kind}`, async () => {
    const ref = pollRef(params.pollId);
    return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, content: "❌ Рейд-пул не знайдено або його було видалено." };

      const poll = normalizeRaidPoll(snap.id, snap.data() || {});
      // Пауза перевіряється першою: у призупиненого пулу closesAtMs може вже бути
      // в минулому, і без цієї гілки транзакція помилково закрила б його назавжди.
      if (raidPollIsPaused(poll)) {
        return { ok: false, poll, content: raidPollPausedContent(poll) };
      }
      if (!raidPollAcceptsVotes(poll)) {
        const closedPoll = poll.status === "closed" ? poll : { ...poll, status: "closed" as RaidPollStatus, closedAt: nowIso, closedReason: "auto" as const, updatedAt: nowIso };
        tx.update(ref, {
          status: "closed",
          closedAt: poll.closedAt || nowIso,
          closedReason: poll.closedReason || "auto",
          updatedAt: nowIso,
          updatedAtMs: Date.now(),
        });
        changedPoll = closedPoll;
        return { ok: false, closed: true, poll: closedPoll, content: "🔒 Голосування вже завершено. Нові голоси не приймаються." };
      }

      const existing = poll.votes.find((vote) => vote.discordId === userId) || null;
      const fallback = existing
        ? draftFromExistingVote(existing, nowIso)
        : baseDraftForUser({ ...params, userId }, nowIso);
      let draft = voteDraftFromPollData(snap.data() || {}, userId, fallback);
      draft = {
        ...draft,
        discordName: cleanString(params.userName, 100) || draft.discordName,
        guildId: cleanSnowflake(params.guildId) || draft.guildId,
        guildName: cleanString(params.guildName, 120) || draft.guildName,
        updatedAt: nowIso,
      };

      if (params.kind === "character") {
        const selectedCharacter = voteCharacterPayload(profile, params.values[0] || "main", guildMembership);
        if (!selectedCharacter) {
          return {
            ok: false,
            poll,
            content: "⚠️ Обраний персонаж не підтверджений у складі гільдії. Голосувати можна тільки гільдійним персонажем.",
            components: profile ? buildRaidPollVoteDraftComponents(poll, profile, draft, membershipForComponents) : [],
          };
        }
        const selectedCharacterKey = normalizeCharacterKey(selectedCharacter.characterKey || "");
        const previousCharacterKey = normalizeCharacterKey(draft.characterKey || "");
        const changedCharacter = Boolean(previousCharacterKey && selectedCharacterKey && previousCharacterKey !== selectedCharacterKey);
        const explicitRole = !changedCharacter && draft.roleSelected ? draft.characterRole : null;
        draft = {
          ...draft,
          ...selectedCharacter,
          characterRole: explicitRole,
          roleSelected: Boolean(explicitRole),
          selectedDays: activeDaysFromSchedule(draft.schedule),
          selectedTime: firstTimeFromSchedule(draft.schedule),
        };
      } else if (params.kind === "role") {
        const selectedRole = cleanCharacterRole(params.values[0]);
        if (!selectedRole) {
          return { ok: false, poll, content: "⚠️ Роль не розпізнано. Обери Танк / Хіл / ДД." };
        }
        draft = {
          ...draft,
          characterRole: selectedRole,
          roleSelected: true,
        };
      } else if (params.kind === "schedule") {
        const parsedSchedule = parseScheduleValuesDetailed(params.values);
        if (parsedSchedule.duplicateDays.length) {
          const days = parsedSchedule.duplicateDays.map(dayLabel).join(", ");
          return {
            ok: false,
            poll,
            content: `⚠️ Для одного дня можна вибрати тільки один варіант часу або «Не можу». Виправ: ${days}. Якщо тобі зручно з 19:00, обери лише 19:00 — система сама врахує всі пізніші години.`,
            components: profile ? buildRaidPollVoteDraftComponents(poll, profile, draft, membershipForComponents, schedulePageFromGroup(params.group, poll)) : [],
          };
        }
        const patch = parsedSchedule.schedule;
        const groupDays = scheduleGroupDays(params.group, poll);
        const nextDraftSchedule: RaidPollSchedule = { ...draft.schedule };
        for (const day of groupDays) delete nextDraftSchedule[day];
        const nextSchedule = normalizeVoteScheduleForPoll(poll, dedupeSchedulePatch({ ...nextDraftSchedule, ...patch }));
        draft = {
          ...draft,
          schedule: nextSchedule,
          selectedDays: activeDaysFromSchedule(nextSchedule),
          selectedTime: firstTimeFromSchedule(nextSchedule),
        };
      } else if (params.kind === "days") {
        const legacyDays = cleanPollDays(params.values);
        const fallbackTime = draft.selectedTime || firstTimeFromSchedule(draft.schedule) || "19:00";
        const nextSchedule = { ...draft.schedule };
        for (const day of legacyDays) nextSchedule[day] = fallbackTime;
        const normalizedSchedule = normalizeVoteScheduleForPoll(poll, nextSchedule);
        draft = {
          ...draft,
          schedule: normalizedSchedule,
          selectedDays: activeDaysFromSchedule(normalizedSchedule),
          selectedTime: firstTimeFromSchedule(normalizedSchedule),
        };
      } else if (params.kind === "time") {
        const nextTime = cleanPollTime(params.values[0]);
        if (nextTime) {
          const days = activeDaysFromSchedule(draft.schedule).length ? activeDaysFromSchedule(draft.schedule) : poll.days;
          const nextSchedule = { ...draft.schedule };
          for (const day of days) nextSchedule[day] = nextTime;
          const normalizedSchedule = normalizeVoteScheduleForPoll(poll, nextSchedule);
          draft = {
            ...draft,
            schedule: normalizedSchedule,
            selectedDays: activeDaysFromSchedule(normalizedSchedule),
            selectedTime: firstTimeFromSchedule(normalizedSchedule),
          };
        }
      }

      if (params.kind !== "submit") {
        tx.update(ref, {
          [`voteDraftsByDiscordId.${userId}`]: voteDraftToFirestore(draft),
          voteDraftsUpdatedAtMs: Date.now(),
          ...(params.messageRef?.channelId ? { channelId: params.messageRef.channelId } : {}),
          ...(params.messageRef?.messageId ? { messageId: params.messageRef.messageId } : {}),
        });

        return {
          ok: true,
          poll,
          content: params.kind === "character_prompt" ? draftPromptContent(draft, poll) : draftSavedContent(draft, poll),
          components: profile ? buildRaidPollVoteDraftComponents(poll, profile, draft, membershipForComponents, params.kind === "schedule" ? schedulePageFromGroup(params.group, poll) : 0) : [],
        };
      }

      if (!isDraftReadyToSubmit(draft)) {
        return {
          ok: false,
          poll,
          content: `⚠️ Голос ще не зараховано.\n${draftReadinessLines(draft, poll)}`,
          components: profile ? buildRaidPollVoteDraftComponents(poll, profile, draft, membershipForComponents, 0) : [],
        };
      }

      if (!isRaidPollVoteGuildMember(draft, guildMembership)) {
        return {
          ok: false,
          poll,
          content: "⚠️ Голос не зараховано: вибраний персонаж не знайдений у складі гільдії. Обери гільдійного персонажа або онови профіль.",
          components: profile ? buildRaidPollVoteDraftComponents(poll, profile, draft, membershipForComponents, 0) : [],
        };
      }

      const finalSchedule = normalizeVoteScheduleForPoll(poll, draft.schedule);
      const finalVote: RaidPollVote = {
        discordId: userId,
        discordName: draft.discordName,
        guildId: draft.guildId,
        guildName: draft.guildName,
        selectedDays: activeDaysFromSchedule(finalSchedule),
        selectedTime: firstTimeFromSchedule(finalSchedule),
        schedule: finalSchedule,
        characterKey: draft.characterKey || null,
        characterName: draft.characterName || null,
        characterClass: draft.characterClass || null,
        characterRole: draft.characterRole || null,
        characterRealm: draft.characterRealm || null,
        characterRegion: draft.characterRegion || null,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      tx.update(ref, {
        [`votesByDiscordId.${userId}`]: finalVote,
        [`voteDraftsByDiscordId.${userId}`]: FieldValue.delete(),
        updatedAt: nowIso,
        updatedAtMs: Date.now(),
        ...(params.messageRef?.channelId ? { channelId: params.messageRef.channelId } : {}),
        ...(params.messageRef?.messageId ? { messageId: params.messageRef.messageId } : {}),
      });

      const votes = poll.votes.filter((vote) => vote.discordId !== userId).concat(finalVote);
      changedPoll = {
        ...poll,
        channelId: params.messageRef?.channelId || poll.channelId,
        messageId: params.messageRef?.messageId || poll.messageId,
        messageUrl: params.messageRef?.channelId && params.messageRef?.messageId ? discordMessageUrl(params.messageRef.channelId, params.messageRef.messageId) : poll.messageUrl,
        votes,
        updatedAt: nowIso,
      };

      const submittedDraft = draftFromExistingVote(finalVote, nowIso);
      return {
        ok: true,
        poll: changedPoll,
        content: submittedVoteContent(finalVote, poll),
        components: buildRaidPollSubmittedComponents(changedPoll),
      };
    });
  }, { logEvent: "raid_polls.vote_failed" });

  if (result.poll) {
    clearRaidPollRuntimeCaches(result.poll.id);
  }
  if (changedPoll) {
    await recalculatePublishedRaidPollDiscordRecommendations(changedPoll).catch(() => null);
  }

  return result;
}

export async function deleteRaidPoll(pollId: string) {
  if (!hasRaidPollStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));

  const ref = pollRef(pollId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Рейд-пул не знайдено або його вже видалено.");

  const poll = normalizeRaidPoll(snap.id, snap.data() || {});
  let discordDeleted = false;
  let discordDeleteFailed = false;

  if (poll.channelId && poll.messageId) {
    try {
      await deleteDiscordRaidMessage({
        ref: { channelId: poll.channelId, messageId: poll.messageId },
        auditReason: `Raid poll manually deleted from dashboard: ${poll.id}`,
      });
      discordDeleted = true;
    } catch (error) {
      if (isMissingDiscordMessageError(error)) {
        discordDeleted = true;
      } else {
        discordDeleteFailed = true;
        console.warn("[raidPolls] Failed to delete Discord poll message", {
          pollId: poll.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await firebaseWrite("raid", `raid-poll:delete:${poll.id}`, async () => {
    await ref.delete();
    return true;
  }, { logEvent: "raid_polls.delete_failed" });

  clearRaidPollRuntimeCaches(poll.id);
  return { poll, discordDeleted, discordDeleteFailed };
}

export function raidPollDayLabel(value: RaidPollDay) {
  return dayLabel(value);
}

export function raidPollDayFullLabel(value: RaidPollDay) {
  return dayFullLabel(value);
}

export function raidPollDescription() {
  return RAID_POLL_DESCRIPTION;
}
