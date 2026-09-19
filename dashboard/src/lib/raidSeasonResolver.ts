import { apiFetchJson } from "@/lib/apiHttp";
import {
  fetchBattleNetApplicationData,
  normalizeBattleNetRegion,
  type BattleNetRegion,
} from "@/lib/battlenet";

export type RaidSeasonCatalogEntry = {
  slug: string;
  name: string;
  shortName: string | null;
  expansion: string;
  expansionId: number;
  bosses: number;
  startsAt: string | null;
  endsAt: string | null;
  activeNow: boolean;
  currentSeason: boolean;
};

export type RaidSeasonEntry = {
  id: string;
  slug: string;
  name: string;
  label: string;
  shortName: string;
  expansion: string;
  expansionId: number;
  startsAt: string | null;
  endsAt: string | null;
  current: boolean;
  raids: string[];
};

export type RaidSeasonSnapshot = {
  detectedAt: string;
  source: "battlenet+raiderio" | "raiderio" | "cached";
  region: string;
  currentExpansionId: number | null;
  currentExpansion: string | null;
  currentSeasonId: string | null;
  currentSeasonSlug: string | null;
  battleNetExpansionId: number | null;
  battleNetExpansion: string | null;
  battleNetRaidNames: string[];
  seasons: RaidSeasonEntry[];
  catalog: Record<string, RaidSeasonCatalogEntry>;
};

type ResolverOptions = {
  region?: string | null;
  previous?: RaidSeasonSnapshot | null;
  timeoutMs?: number | null;
  retries?: number | null;
};

const KNOWN_EXPANSION_NAMES: Record<number, string> = {
  6: "Legion",
  7: "Battle for Azeroth",
  8: "Shadowlands",
  9: "Dragonflight",
  10: "The War Within",
  11: "Midnight",
};

function cleanText(value: unknown, max = 160) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, max)
    .join("");
}

function norm(value: unknown) {
  return cleanText(value, 160)
    .toLocaleLowerCase("en")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function regionValue(value: any, region: BattleNetRegion) {
  if (typeof value === "string" || typeof value === "number") {
    const direct = cleanText(value, 80);
    return direct || null;
  }
  const raw = value?.[region] ?? value?.[String(region).toUpperCase()] ?? null;
  const text = cleanText(raw, 80);
  return text || null;
}

function mainSeasons(seasons: any[]) {
  const explicitlyMain = seasons.filter((season) => season?.is_main_season === true);
  const source = explicitlyMain.length ? explicitlyMain : seasons.filter((season) => season?.is_main_season !== false);
  return source.filter((season) => season && cleanText(season.slug));
}

function timeValue(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timeNumber(value: string | null | undefined) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isInside(now: number, startsAt: string | null, endsAt: string | null) {
  const start = timeNumber(startsAt);
  const end = timeNumber(endsAt);
  return Number.isFinite(start) && start <= now && (!Number.isFinite(end) || now < end);
}

function raiderAccessKey() {
  return cleanText(
    process.env.RAIDERIO_ACCESS_KEY ||
      process.env.RAIDER_IO_ACCESS_KEY ||
      process.env.RAIDERIO_API_KEY ||
      "",
    300,
  );
}

async function fetchRaiderStatic(path: "mythic-plus" | "raiding", expansionId: number, options: ResolverOptions) {
  const url = new URL(`https://raider.io/api/v1/${path}/static-data`);
  url.searchParams.set("expansion_id", String(expansionId));
  const key = raiderAccessKey();
  if (key) url.searchParams.set("access_key", key);
  return apiFetchJson<any>(url, {
    label: `Raider.IO ${path} static data`,
    timeoutMs: Math.max(2_500, Math.min(30_000, Math.floor(Number(options.timeoutMs || 10_000)))),
    retries: Math.max(0, Math.min(3, Math.floor(Number(options.retries ?? 1)))),
    retryStatuses: [408, 425, 429, 500, 502, 503, 504],
    cache: "no-store",
    userAgent: "mistblossom-dashboard",
  });
}

function knownExpansionId(name: string) {
  const needle = norm(name);
  for (const [idText, known] of Object.entries(KNOWN_EXPANSION_NAMES)) {
    if (norm(known) === needle) return Number(idText);
  }
  return null;
}

async function fetchBattleNetExpansion(region: BattleNetRegion, options: ResolverOptions) {
  try {
    const index = await fetchBattleNetApplicationData(
      "/data/wow/journal-expansion/index",
      { namespace: `static-${region}`, locale: region === "eu" ? "en_GB" : "en_US" },
      region,
      { timeoutMs: options.timeoutMs || undefined, retries: options.retries ?? undefined },
    );
    const tiers = Array.isArray(index?.tiers) ? index.tiers : [];
    const latest = tiers
      .filter((tier: any) => Number.isFinite(Number(tier?.id)) && cleanText(tier?.name))
      .sort((a: any, b: any) => Number(a.id) - Number(b.id))
      .at(-1);
    if (!latest) return null;

    const detail = await fetchBattleNetApplicationData(
      `/data/wow/journal-expansion/${Number(latest.id)}`,
      { namespace: `static-${region}`, locale: region === "eu" ? "en_GB" : "en_US" },
      region,
      { timeoutMs: options.timeoutMs || undefined, retries: options.retries ?? undefined },
    ).catch(() => null);

    const name = cleanText(detail?.name || latest?.name) || null;
    const raids = Array.isArray(detail?.raids)
      ? detail.raids.map((raid: any) => cleanText(raid?.name)).filter(Boolean)
      : [];
    const mappedId = name ? knownExpansionId(name) : null;
    const ordinalGuess = Math.max(6, tiers.length - 1);
    return {
      journalId: Number(latest.id),
      name,
      raidNames: raids,
      raiderExpansionIdHint: mappedId || ordinalGuess,
    };
  } catch {
    return null;
  }
}

function activeMainSeason(seasons: any[], region: BattleNetRegion, now: number) {
  const main = mainSeasons(seasons);
  const started = main.filter((season) => {
    const start = timeValue(regionValue(season.starts, region));
    return Number.isFinite(timeNumber(start)) && timeNumber(start) <= now;
  });
  if (!started.length) return null;
  const live = started.filter((season) => isInside(
    now,
    timeValue(regionValue(season.starts, region)),
    timeValue(regionValue(season.ends, region)),
  ));
  const pool = live.length ? live : started;
  return pool.sort((a, b) =>
    timeNumber(timeValue(regionValue(b.starts, region))) - timeNumber(timeValue(regionValue(a.starts, region))),
  )[0] || null;
}

function expansionLabel(expansionId: number, battleNetName: string | null, activeExpansionId: number) {
  if (expansionId === activeExpansionId && battleNetName) return battleNetName;
  return KNOWN_EXPANSION_NAMES[expansionId] || `Expansion ${expansionId}`;
}

function assignRaidsToSeason(raids: any[], season: any, region: BattleNetRegion) {
  const start = timeNumber(timeValue(regionValue(season?.starts, region)));
  const end = timeNumber(timeValue(regionValue(season?.ends, region)));
  if (!Number.isFinite(start)) return [];
  return raids
    .filter((raid) => {
      const raidStart = timeNumber(timeValue(regionValue(raid?.starts, region)));
      return Number.isFinite(raidStart) && raidStart >= start && (!Number.isFinite(end) || raidStart < end);
    })
    .sort((a, b) =>
      timeNumber(timeValue(regionValue(a?.starts, region))) - timeNumber(timeValue(regionValue(b?.starts, region))),
    )
    .map((raid) => cleanText(raid?.slug))
    .filter(Boolean);
}

export async function resolveRaidSeasonSnapshot(options: ResolverOptions = {}): Promise<RaidSeasonSnapshot | null> {
  const region = normalizeBattleNetRegion(options.region || "eu");
  const now = Date.now();
  const battleNet = await fetchBattleNetExpansion(region, options);
  const hints = [
    options.previous?.currentExpansionId || null,
    battleNet?.raiderExpansionIdHint || null,
    (battleNet?.raiderExpansionIdHint || 11) + 1,
    (battleNet?.raiderExpansionIdHint || 11) - 1,
  ].filter((value): value is number => Number.isFinite(Number(value)) && Number(value) >= 6);
  const probeIds = Array.from(new Set(hints.map(Number))).slice(0, 5);

  const seasonPayloads = new Map<number, any[]>();
  const candidates: Array<{ expansionId: number; latestStart: number; seasons: any[]; active: any }> = [];
  for (const expansionId of probeIds) {
    try {
      const payload = await fetchRaiderStatic("mythic-plus", expansionId, options);
      const seasons = Array.isArray(payload?.seasons) ? payload.seasons : [];
      seasonPayloads.set(expansionId, seasons);
      const active = activeMainSeason(seasons, region, now);
      if (!active) continue;
      const latestStart = timeNumber(timeValue(regionValue(active.starts, region)));
      if (Number.isFinite(latestStart)) candidates.push({ expansionId, latestStart, seasons, active });
    } catch {}
  }

  const winner = candidates.sort((a, b) => b.latestStart - a.latestStart)[0];
  if (!winner) return options.previous ? { ...options.previous, source: "cached", detectedAt: new Date().toISOString() } : null;

  const activeExpansionId = winner.expansionId;
  const expansionIds = Array.from(new Set([activeExpansionId, activeExpansionId - 1].filter((id) => id >= 6)));
  const raidPayloads = new Map<number, any[]>();

  await Promise.all(expansionIds.map(async (expansionId) => {
    if (!seasonPayloads.has(expansionId)) {
      try {
        const payload = await fetchRaiderStatic("mythic-plus", expansionId, options);
        seasonPayloads.set(expansionId, Array.isArray(payload?.seasons) ? payload.seasons : []);
      } catch {
        seasonPayloads.set(expansionId, []);
      }
    }
    try {
      const payload = await fetchRaiderStatic("raiding", expansionId, options);
      raidPayloads.set(expansionId, Array.isArray(payload?.raids) ? payload.raids : []);
    } catch {
      raidPayloads.set(expansionId, []);
    }
  }));

  const catalog: Record<string, RaidSeasonCatalogEntry> = {};
  const seasons: RaidSeasonEntry[] = [];
  const currentSeasonSlug = cleanText(winner.active?.slug) || null;

  for (const expansionId of expansionIds) {
    const expansion = expansionLabel(expansionId, battleNet?.name || null, activeExpansionId);
    const raids = raidPayloads.get(expansionId) || [];
    const rawSeasons = mainSeasons(seasonPayloads.get(expansionId) || [])
      .sort((a, b) => timeNumber(timeValue(regionValue(b.starts, region))) - timeNumber(timeValue(regionValue(a.starts, region))));

    for (const raw of rawSeasons) {
      const slug = cleanText(raw.slug);
      const startsAt = timeValue(regionValue(raw.starts, region));
      const endsAt = timeValue(regionValue(raw.ends, region));
      const current = expansionId === activeExpansionId && slug === currentSeasonSlug;
      const raidSlugs = assignRaidsToSeason(raids, raw, region);
      const name = cleanText(raw.name || raw.short_name || slug) || slug;
      seasons.push({
        id: slug.replace(/^season-/, "") || slug,
        slug,
        name,
        label: `${expansion} · ${name}`,
        shortName: cleanText(raw.short_name || raw.name || slug) || slug,
        expansion,
        expansionId,
        startsAt,
        endsAt,
        current,
        raids: raidSlugs,
      });
    }

    for (const raid of raids) {
      const slug = cleanText(raid?.slug);
      if (!slug) continue;
      const startsAt = timeValue(regionValue(raid?.starts, region));
      const endsAt = timeValue(regionValue(raid?.ends, region));
      const matchedSeason = seasons.find((season) => season.expansionId === expansionId && season.raids.includes(slug));
      catalog[slug] = {
        slug,
        name: cleanText(raid?.name || slug) || slug,
        shortName: cleanText(raid?.short_name) || null,
        expansion,
        expansionId,
        bosses: Array.isArray(raid?.encounters) ? raid.encounters.length : 0,
        startsAt,
        endsAt,
        activeNow: isInside(now, startsAt, endsAt),
        currentSeason: Boolean(matchedSeason?.current),
      };
    }
  }

  const currentSeason = seasons.find((season) => season.current) || null;
  if (currentSeason && currentSeason.raids.length === 0) {
    const currentExpansionRaids = Object.values(catalog).filter((raid) => raid.expansionId === activeExpansionId);
    let fallback = currentExpansionRaids.filter((raid) => raid.activeNow);

    if (!fallback.length && battleNet?.raidNames?.length) {
      const battleNetNames = new Set(battleNet.raidNames.map((name: unknown) => norm(name)));
      fallback = currentExpansionRaids.filter((raid) => {
        const raidNames = [raid.name, raid.shortName].map((value) => norm(value)).filter(Boolean);
        return raidNames.some((name) => battleNetNames.has(name));
      });
    }

    if (!fallback.length) {
      const seasonStart = timeNumber(currentSeason.startsAt);
      const seasonEnd = timeNumber(currentSeason.endsAt);
      fallback = currentExpansionRaids.filter((raid) => {
        const raidStart = timeNumber(raid.startsAt);
        return Number.isFinite(raidStart) && (!Number.isFinite(seasonStart) || raidStart >= seasonStart) && (!Number.isFinite(seasonEnd) || raidStart < seasonEnd);
      });
    }

    if (!fallback.length) {
      const started = currentExpansionRaids
        .filter((raid) => Number.isFinite(timeNumber(raid.startsAt)) && timeNumber(raid.startsAt) <= now)
        .sort((a, b) => timeNumber(b.startsAt) - timeNumber(a.startsAt));
      const newestStart = started.length ? timeNumber(started[0]?.startsAt) : Number.NaN;
      if (Number.isFinite(newestStart)) {
        fallback = started.filter((raid) => Math.abs(timeNumber(raid.startsAt) - newestStart) < 7 * 24 * 60 * 60 * 1000);
      }
    }

    currentSeason.raids = Array.from(new Set(fallback.map((raid) => raid.slug).filter(Boolean)));
    for (const slug of currentSeason.raids) {
      if (catalog[slug]) catalog[slug] = { ...catalog[slug], currentSeason: true };
    }
  }

  return {
    detectedAt: new Date().toISOString(),
    source: battleNet ? "battlenet+raiderio" : "raiderio",
    region,
    currentExpansionId: activeExpansionId,
    currentExpansion: expansionLabel(activeExpansionId, battleNet?.name || null, activeExpansionId),
    currentSeasonId: currentSeason?.id || (currentSeasonSlug ? currentSeasonSlug.replace(/^season-/, "") : null),
    currentSeasonSlug,
    battleNetExpansionId: battleNet?.journalId || null,
    battleNetExpansion: battleNet?.name || null,
    battleNetRaidNames: battleNet?.raidNames || [],
    seasons: seasons.sort((a, b) => timeNumber(b.startsAt) - timeNumber(a.startsAt)),
    catalog,
  };
}
