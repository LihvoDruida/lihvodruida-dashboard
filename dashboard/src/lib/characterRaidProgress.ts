import type { RaidSeasonSnapshot } from "@/lib/raidSeasonResolver";

export type CharacterRaidProgressLike = {
  slug: string;
  name: string;
  summary?: string | null;
  totalBosses: number;
  normalKills: number;
  heroicKills: number;
  mythicKills: number;
};

export type CharacterRaidProgressInput = {
  slug?: unknown;
  name?: unknown;
  summary?: unknown;
  totalBosses?: number | null;
  normalKills?: number | null;
  heroicKills?: number | null;
  mythicKills?: number | null;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function raidCounter(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

export function normalizeCharacterRaidProgress(raids: readonly CharacterRaidProgressInput[] | null | undefined): CharacterRaidProgressLike[] {
  if (!Array.isArray(raids)) return [];
  return raids.map((raid) => ({
    slug: clean(raid?.slug),
    name: clean(raid?.name),
    summary: clean(raid?.summary) || null,
    totalBosses: raidCounter(raid?.totalBosses),
    normalKills: raidCounter(raid?.normalKills),
    heroicKills: raidCounter(raid?.heroicKills),
    mythicKills: raidCounter(raid?.mythicKills),
  })).filter((raid) => Boolean(raid.slug));
}

function progressWeight(raid: CharacterRaidProgressLike) {
  return raid.mythicKills * 1_000_000 + raid.heroicKills * 10_000 + raid.normalKills * 100 + raid.totalBosses;
}

export function currentRaidSeason(snapshot: RaidSeasonSnapshot | null | undefined) {
  if (!snapshot) return null;
  return snapshot.seasons.find((season) => season.current) ||
    snapshot.seasons.find((season) => season.slug === snapshot.currentSeasonSlug) ||
    null;
}

export function currentSeasonRaidSlugs(snapshot: RaidSeasonSnapshot | null | undefined) {
  const season = currentRaidSeason(snapshot);
  const result = new Set<string>();
  for (const slug of season?.raids || []) {
    if (clean(slug)) result.add(clean(slug));
  }
  for (const [slug, raid] of Object.entries(snapshot?.catalog || {})) {
    if (raid?.currentSeason) result.add(slug);
  }
  return Array.from(result);
}

function catalogStart(snapshot: RaidSeasonSnapshot | null | undefined, slug: string) {
  const raw = snapshot?.catalog?.[slug]?.startsAt;
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function isActive(snapshot: RaidSeasonSnapshot | null | undefined, slug: string) {
  return Boolean(snapshot?.catalog?.[slug]?.activeNow);
}

export function currentSeasonRaidProgress<T extends CharacterRaidProgressLike>(
  raids: readonly T[] | null | undefined,
  snapshot: RaidSeasonSnapshot | null | undefined,
): T[] {
  const source = Array.isArray(raids) ? raids : [];
  if (!source.length) return [];
  const slugs = new Set(currentSeasonRaidSlugs(snapshot));
  if (!slugs.size) {
    // Cached/temporarily unavailable season metadata: Raider.IO tier aggregate is
    // safer than arbitrarily selecting the first historical raid.
    const tier = source.filter((raid) => /^tier-/i.test(clean(raid.slug)));
    return tier.length ? tier : source.slice(0, 1);
  }

  const exact = source.filter((raid) => slugs.has(clean(raid.slug)));
  if (exact.length) {
    return [...exact].sort((a, b) =>
      Number(isActive(snapshot, b.slug)) - Number(isActive(snapshot, a.slug)) ||
      catalogStart(snapshot, b.slug) - catalogStart(snapshot, a.slug) ||
      progressWeight(b) - progressWeight(a),
    );
  }

  // Raider.IO sometimes exposes the current tier only as tier-* for a short
  // period after raid/season rollover. Keep it only as a fallback, never ahead
  // of exact current-season raid slugs.
  return source.filter((raid) => /^tier-/i.test(clean(raid.slug))).slice(0, 1);
}

export function primaryCurrentRaidProgress<T extends CharacterRaidProgressLike>(
  raids: readonly T[] | null | undefined,
  snapshot: RaidSeasonSnapshot | null | undefined,
): T | null {
  return currentSeasonRaidProgress(raids, snapshot)[0] || null;
}

export function raidProgressBelongsToCurrentSeason(
  slug: string,
  snapshot: RaidSeasonSnapshot | null | undefined,
) {
  return currentSeasonRaidSlugs(snapshot).includes(clean(slug));
}
