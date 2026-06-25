import { readIntegerEnv } from "@/lib/concurrency";
import { getExternalCharacterDataSettings } from "@/lib/dashboardApiSettings";
import { apiFetchJson } from "@/lib/apiHttp";
import type { BattleNetRegion } from "@/lib/battlenet";
import { normalizeBattleNetNameSlug, normalizeBattleNetRealmSlug } from "@/lib/wowCharacters";

export type RaiderIoScoreSegmentKey = "all" | "dps" | "healer" | "tank";

export type RaiderIoScoreSegment = {
  score: number | null;
  color: string | null;
};

export type RaiderIoCharacterSnapshot = {
  profileUrl: string | null;
  thumbnailUrl: string | null;
  itemLevelEquipped: number | null;
  currentScore: number | null;
  currentScores: Record<RaiderIoScoreSegmentKey, RaiderIoScoreSegment>;
  updatedAt: string;
};

export type RaiderIoCharacterProfile = RaiderIoCharacterSnapshot & {
  raw?: Record<string, unknown>;
};

export type RaiderIoDungeonRun = {
  dungeon: string;
  shortName: string | null;
  level: number | null;
  score: number | null;
  upgrades: number | null;
  completedAt: string | null;
  url: string | null;
};

export type RaiderIoDungeonRunStats = {
  runCount: number;
  bestLevel: number | null;
  bestScore: number | null;
  averageLevel: number | null;
  averageScore: number | null;
  timedRunCount: number;
  timedRate: number | null;
  lastCompletedAt: string | null;
};

export type RaiderIoRaidProgress = {
  slug: string;
  name: string;
  summary: string | null;
  totalBosses: number | null;
  normalKills: number | null;
  heroicKills: number | null;
  mythicKills: number | null;
};

export type RaiderIoCharacterDetails = {
  snapshot: RaiderIoCharacterSnapshot | null;
  bestRuns: RaiderIoDungeonRun[];
  recentRuns: RaiderIoDungeonRun[];
  highestRuns: RaiderIoDungeonRun[];
  weeklyHighestRuns: RaiderIoDungeonRun[];
  previousWeekHighestRuns: RaiderIoDungeonRun[];
  allBestRuns: RaiderIoDungeonRun[];
  raidProgression: RaiderIoRaidProgress[];
  bestRunStats: RaiderIoDungeonRunStats;
  recentRunStats: RaiderIoDungeonRunStats;
  highestRunStats: RaiderIoDungeonRunStats;
};

const SCORE_SEGMENTS: RaiderIoScoreSegmentKey[] = ["all", "dps", "healer", "tank"];
const DEFAULT_FIELDS = "gear,mythic_plus_scores_by_season:current";

type RaiderIoProfileCacheEntry = {
  expiresAt: number;
  value: RaiderIoCharacterProfile | null;
};

const profileCache = new Map<string, RaiderIoProfileCacheEntry>();
export const RAIDERIO_CHARACTER_DETAIL_FIELDS = [
  "gear",
  "guild",
  "mythic_plus_scores_by_season:current",
  "mythic_plus_ranks",
  "mythic_plus_best_runs",
  "mythic_plus_recent_runs",
  "mythic_plus_highest_level_runs",
  "mythic_plus_weekly_highest_level_runs",
  "mythic_plus_previous_weekly_highest_level_runs",
  "mythic_plus_alternate_runs",
  "raid_progression",
  "raid_achievement_curve",
  "raid_achievement_meta",
].join(",");

function cleanText(value: unknown, maxLength = 500) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, maxLength));
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveNumberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getRecordValue(record: Record<string, unknown> | null, key: string): unknown {
  return record ? record[key] : undefined;
}

function arrayFromValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function timestampOrNull(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return null;
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : text;
}

function raiderIoTimeoutMs() {
  return readIntegerEnv("RAIDERIO_REQUEST_TIMEOUT_MS", 10_000, 2_500, 30_000);
}

function raiderIoRetryCount() {
  return readIntegerEnv("RAIDERIO_REQUEST_RETRIES", 1, 0, 4);
}

async function raiderIoCharacterCacheTtlMs() {
  try {
    return (await getExternalCharacterDataSettings()).raiderIoCharacterCacheTtlMs;
  } catch {
    return readIntegerEnv("RAIDERIO_CHARACTER_CACHE_TTL_MS", 120_000, 0, 900_000);
  }
}

function raiderIoAccessKey() {
  return cleanText(process.env.RAIDERIO_ACCESS_KEY, 240);
}


export type RaiderIoPeriodWindow = {
  period: number;
  start: string;
  end: string;
};

export type RaiderIoRegionPeriods = {
  region: string;
  previous: RaiderIoPeriodWindow;
  current: RaiderIoPeriodWindow;
  next: RaiderIoPeriodWindow;
  updatedAt: string;
};

type RaiderIoPeriodsCacheEntry = {
  expiresAt: number;
  value: RaiderIoRegionPeriods | null;
};

const RAIDERIO_PERIODS_CACHE_TTL_MS = 5 * 60 * 1000;
const periodsCache = new Map<string, RaiderIoPeriodsCacheEntry>();

function validIsoString(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizePeriodWindow(value: unknown): RaiderIoPeriodWindow | null {
  const record = asRecord(value);
  if (!record) return null;
  const period = numberOrNull(record.period);
  const start = validIsoString(record.start);
  const end = validIsoString(record.end);
  if (period === null || !start || !end) return null;
  if (new Date(start).getTime() >= new Date(end).getTime()) return null;
  return { period, start, end };
}

function normalizeRegionPeriods(value: unknown, region: string): RaiderIoRegionPeriods | null {
  const record = asRecord(value);
  if (!record) return null;
  const normalizedRegion = cleanText(record.region, 12).toLowerCase();
  if (normalizedRegion !== region) return null;
  const previous = normalizePeriodWindow(record.previous);
  const current = normalizePeriodWindow(record.current);
  const next = normalizePeriodWindow(record.next);
  if (!previous || !current || !next) return null;
  return {
    region: normalizedRegion,
    previous,
    current,
    next,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePeriodsPayload(payload: unknown, region: string): RaiderIoRegionPeriods | null {
  const record = asRecord(payload);
  const periods = arrayFromValue(record?.periods);
  for (const item of periods) {
    const normalized = normalizeRegionPeriods(item, region);
    if (normalized) return normalized;
  }
  return null;
}

export function buildRaiderIoPeriodsUrl() {
  const url = new URL("https://raider.io/api/v1/periods");
  const key = raiderIoAccessKey();
  if (key) url.searchParams.set("access_key", key);
  return url;
}

export async function fetchRaiderIoRegionPeriods(region = "eu"): Promise<RaiderIoRegionPeriods | null> {
  const normalizedRegion = cleanText(region, 12).toLowerCase() || "eu";
  const cached = periodsCache.get(normalizedRegion);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const payload = await apiFetchJson(buildRaiderIoPeriodsUrl(), {
      label: "Raider.IO periods",
      timeoutMs: raiderIoTimeoutMs(),
      retries: raiderIoRetryCount(),
      retryMethods: ["GET", "HEAD"],
      cache: "no-store",
    });
    const normalized = normalizePeriodsPayload(payload, normalizedRegion);
    periodsCache.set(normalizedRegion, { expiresAt: Date.now() + RAIDERIO_PERIODS_CACHE_TTL_MS, value: normalized });
    return normalized;
  } catch {
    periodsCache.set(normalizedRegion, { expiresAt: Date.now() + 60_000, value: null });
    return null;
  }
}


function scoreSegmentFromValue(value: unknown): RaiderIoScoreSegment {
  const record = asRecord(value);
  if (record) {
    const color = cleanText(record.color, 16);
    return {
      score: numberOrNull(record.score),
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : null,
    };
  }

  return { score: numberOrNull(value), color: null };
}

function currentSeasonSegments(payload: Record<string, unknown>) {
  const seasons = Array.isArray(payload.mythic_plus_scores_by_season) ? payload.mythic_plus_scores_by_season : [];
  const season = asRecord(seasons[0]);
  return asRecord(season?.segments) || {};
}

function normalizeCurrentScores(payload: Record<string, unknown>): Record<RaiderIoScoreSegmentKey, RaiderIoScoreSegment> {
  const segments = currentSeasonSegments(payload);
  return SCORE_SEGMENTS.reduce((acc, segment) => {
    acc[segment] = scoreSegmentFromValue(getRecordValue(segments, segment) || getRecordValue(segments, segment.toUpperCase()));
    return acc;
  }, {} as Record<RaiderIoScoreSegmentKey, RaiderIoScoreSegment>);
}

function normalizeRaiderIoCharacterPayload(payload: unknown): RaiderIoCharacterProfile | null {
  const record = asRecord(payload);
  if (!record) return null;
  const currentScores = normalizeCurrentScores(record);
  const gear = asRecord(record.gear);
  const equipped = positiveNumberOrNull(gear?.item_level_equipped);
  const fallback = positiveNumberOrNull(gear?.item_level_total);

  return {
    profileUrl: cleanText(record.profile_url, 500) || null,
    thumbnailUrl: cleanText(record.thumbnail_url || record.avatar_url, 500) || null,
    itemLevelEquipped: equipped ?? fallback,
    currentScore: currentScores.all.score,
    currentScores,
    updatedAt: new Date().toISOString(),
    raw: record,
  };
}

export function buildRaiderIoCharacterUrl(input: { region: BattleNetRegion | string; realmSlug: string; name: string; fields?: string }) {
  const region = cleanText(input.region, 12).toLowerCase() || "eu";
  const realm = normalizeBattleNetRealmSlug(input.realmSlug);
  const name = normalizeBattleNetNameSlug(input.name) || cleanText(input.name, 80);
  if (!realm || !name) return null;

  const url = new URL("https://raider.io/api/v1/characters/profile");
  url.searchParams.set("region", region);
  url.searchParams.set("realm", realm);
  url.searchParams.set("name", name);
  url.searchParams.set("fields", input.fields || DEFAULT_FIELDS);
  const key = raiderIoAccessKey();
  if (key) url.searchParams.set("access_key", key);
  return url;
}

export async function fetchRaiderIoCharacterProfile(input: {
  region: BattleNetRegion | string;
  realmSlug: string;
  name: string;
  fields?: string;
}): Promise<RaiderIoCharacterProfile | null> {
  const url = buildRaiderIoCharacterUrl(input);
  if (!url) return null;
  const cacheTtlMs = await raiderIoCharacterCacheTtlMs();
  const cacheKey = url.toString();
  const cached = cacheTtlMs > 0 ? profileCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const payload = await apiFetchJson(url, {
      label: `Raider.IO character ${input.name}`,
      timeoutMs: raiderIoTimeoutMs(),
      retries: raiderIoRetryCount(),
      retryMethods: ["GET", "HEAD"],
      cache: "no-store",
    });
    const normalized = normalizeRaiderIoCharacterPayload(payload);
    if (cacheTtlMs > 0) {
      profileCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: normalized });
      if (profileCache.size > 200) {
        for (const [key, entry] of profileCache) {
          if (entry.expiresAt <= Date.now()) profileCache.delete(key);
        }
      }
    }
    return normalized;
  } catch {
    return null;
  }
}

function normalizeDungeonRun(value: unknown): RaiderIoDungeonRun | null {
  const record = asRecord(value);
  if (!record) return null;

  const dungeon = cleanText(record.dungeon || record.dungeon_name || record.name, 140);
  const level = positiveNumberOrNull(record.mythic_level || record.level || record.keystone_level);
  if (!dungeon && !level) return null;

  return {
    dungeon: dungeon || "Невідомий підземелля",
    shortName: cleanText(record.short_name || record.shortName, 40) || null,
    level,
    score: numberOrNull(record.score),
    upgrades: numberOrNull(record.num_keystone_upgrades || record.upgrades),
    completedAt: timestampOrNull(record.completed_at || record.completedAt),
    url: cleanText(record.url, 700) || null,
  };
}

function normalizeDungeonRuns(value: unknown, limit = 12) {
  return arrayFromValue(value)
    .map(normalizeDungeonRun)
    .filter((item): item is RaiderIoDungeonRun => Boolean(item))
    .slice(0, Math.max(0, limit));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function newestDate(...values: Array<string | null>) {
  const timestamps = values
    .map((value) => value ? new Date(value).getTime() : NaN)
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function dungeonRunStats(runs: RaiderIoDungeonRun[]): RaiderIoDungeonRunStats {
  const levels = runs.map((run) => run.level).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const scores = runs.map((run) => run.score).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const timedRunCount = runs.filter((run) => typeof run.upgrades === "number" && run.upgrades >= 0).length;
  return {
    runCount: runs.length,
    bestLevel: levels.length ? Math.max(...levels) : null,
    bestScore: scores.length ? Math.max(...scores) : null,
    averageLevel: average(levels),
    averageScore: average(scores),
    timedRunCount,
    timedRate: runs.length ? (timedRunCount / runs.length) * 100 : null,
    lastCompletedAt: newestDate(...runs.map((run) => run.completedAt)),
  };
}

function normalizeRaidName(slug: string, value: Record<string, unknown>) {
  const explicit = cleanText(value.name || value.raid_name || value.raidName, 140);
  if (explicit) return explicit;
  return slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Рейд";
}

function normalizeRaidProgression(value: unknown): RaiderIoRaidProgress[] {
  const record = asRecord(value);
  if (!record) return [];

  return Object.entries(record).map(([slug, raw]) => {
    const raid = asRecord(raw) || {};
    return {
      slug,
      name: normalizeRaidName(slug, raid),
      summary: cleanText(raid.summary, 80) || null,
      totalBosses: numberOrNull(raid.total_bosses || raid.totalBosses),
      normalKills: numberOrNull(raid.normal_bosses_killed || raid.normalKills),
      heroicKills: numberOrNull(raid.heroic_bosses_killed || raid.heroicKills),
      mythicKills: numberOrNull(raid.mythic_bosses_killed || raid.mythicKills),
    };
  }).filter((item) => item.summary || item.totalBosses || item.normalKills || item.heroicKills || item.mythicKills);
}

export function buildRaiderIoCharacterDetails(profile: RaiderIoCharacterProfile | RaiderIoCharacterSnapshot | null | undefined): RaiderIoCharacterDetails {
  const raw = asRecord((profile as RaiderIoCharacterProfile | null | undefined)?.raw);
  const bestRuns = normalizeDungeonRuns(raw?.mythic_plus_best_runs, 12);
  const recentRuns = normalizeDungeonRuns(raw?.mythic_plus_recent_runs, 12);
  const highestRuns = normalizeDungeonRuns(raw?.mythic_plus_highest_level_runs, 12);
  const weeklyHighestRuns = normalizeDungeonRuns(raw?.mythic_plus_weekly_highest_level_runs, 10);
  const previousWeekHighestRuns = normalizeDungeonRuns(raw?.mythic_plus_previous_weekly_highest_level_runs, 10);
  const allBestRuns = normalizeDungeonRuns(raw?.mythic_plus_alternate_runs, 16);

  return {
    snapshot: stripRaiderIoRaw(profile),
    bestRuns,
    recentRuns,
    highestRuns,
    weeklyHighestRuns,
    previousWeekHighestRuns,
    allBestRuns,
    raidProgression: normalizeRaidProgression(raw?.raid_progression),
    bestRunStats: dungeonRunStats(bestRuns),
    recentRunStats: dungeonRunStats(recentRuns),
    highestRunStats: dungeonRunStats(highestRuns),
  };
}

export function stripRaiderIoRaw(snapshot: RaiderIoCharacterProfile | RaiderIoCharacterSnapshot | null | undefined): RaiderIoCharacterSnapshot | null {
  if (!snapshot) return null;
  const clean = { ...snapshot } as RaiderIoCharacterProfile;
  delete clean.raw;
  return clean;
}
