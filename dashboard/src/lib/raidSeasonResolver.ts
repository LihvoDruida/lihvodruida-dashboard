import { ApiHttpError, apiFetchJson } from "@/lib/apiHttp";
import { fetchBattleNetApplicationData, normalizeBattleNetRegion, type BattleNetRegion, } from "@/lib/battlenet";
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
export const RAID_SEASON_SNAPSHOT_VERSION = 2;
export type RaidSeasonSnapshot = {
    schemaVersion?: number;
    checkedAt?: string;
    partial?: boolean;
    expansionChecks?: Record<string, string>;
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
    signal?: AbortSignal;
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
    if (!text)
        return null;
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
    return cleanText(process.env.RAIDERIO_ACCESS_KEY ||
        process.env.RAIDER_IO_ACCESS_KEY ||
        process.env.RAIDERIO_API_KEY ||
        "", 300);
}
async function fetchRaiderStatic(path: "mythic-plus" | "raiding", expansionId: number, options: ResolverOptions) {
    // Share the provider pause with roster/profile collection in this process.
    const block = globalThis.__mistblossomRaiderIoRateLimitState;
    if (block && block.blockedUntil > Date.now())
        throw new Error("Raider.IO cooldown");
    const url = new URL(`https://raider.io/api/v1/${path}/static-data`);
    url.searchParams.set("expansion_id", String(expansionId));
    const key = raiderAccessKey();
    if (key)
        url.searchParams.set("access_key", key);
    try {
        return await apiFetchJson<any>(url, {
            label: `Raider.IO ${path} static data`,
            signal: options.signal,
            timeoutMs: Math.max(2500, Math.min(30000, Math.floor(Number(options.timeoutMs || 10000)))),
            retries: Math.max(0, Math.min(3, Math.floor(Number(options.retries ?? 1)))),
            retryStatuses: [408, 425, 429, 500, 502, 503, 504],
            cache: "no-store",
            userAgent: "mistblossom-dashboard",
        });
    }
    catch (error) {
        if (error instanceof ApiHttpError && error.status === 429) {
            globalThis.__mistblossomRaiderIoRateLimitState = {
                blockedUntil: Math.max(Date.now() + Math.max(60000, error.retryAfterMs || 900000), globalThis.__mistblossomRaiderIoRateLimitState?.blockedUntil || 0),
                reason: "Raider.IO static metadata rate limit",
            };
        }
        throw error;
    }
}
function knownExpansionId(name: string) {
    const needle = norm(name);
    for (const [idText, known] of Object.entries(KNOWN_EXPANSION_NAMES)) {
        if (norm(known) === needle)
            return Number(idText);
    }
    return null;
}
async function fetchBattleNetExpansion(region: BattleNetRegion, options: ResolverOptions) {
    try {
        const index = await fetchBattleNetApplicationData("/data/wow/journal-expansion/index", { namespace: `static-${region}`, locale: region === "eu" ? "en_GB" : "en_US" }, region, { timeoutMs: options.timeoutMs || undefined, retries: options.retries ?? undefined });
        const tiers = Array.isArray(index?.tiers) ? index.tiers : [];
        const latest = tiers
            .filter((tier: any) => Number.isFinite(Number(tier?.id)) && cleanText(tier?.name))
            .sort((a: any, b: any) => Number(a.id) - Number(b.id))
            .at(-1);
        if (!latest)
            return null;
        const detail = await fetchBattleNetApplicationData(`/data/wow/journal-expansion/${Number(latest.id)}`, { namespace: `static-${region}`, locale: region === "eu" ? "en_GB" : "en_US" }, region, { timeoutMs: options.timeoutMs || undefined, retries: options.retries ?? undefined }).catch(() => null);
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
    }
    catch {
        return null;
    }
}
function activeMainSeason(seasons: any[], region: BattleNetRegion, now: number) {
    const main = mainSeasons(seasons);
    const started = main.filter((season) => {
        const start = timeValue(regionValue(season.starts, region));
        return Number.isFinite(timeNumber(start)) && timeNumber(start) <= now;
    });
    if (!started.length)
        return null;
    const live = started.filter((season) => isInside(now, timeValue(regionValue(season.starts, region)), timeValue(regionValue(season.ends, region))));
    const pool = live.length ? live : started;
    return pool.sort((a, b) => timeNumber(timeValue(regionValue(b.starts, region))) - timeNumber(timeValue(regionValue(a.starts, region))))[0] || null;
}
function expansionLabel(expansionId: number, battleNetName: string | null, activeExpansionId: number) {
    if (expansionId === activeExpansionId && battleNetName)
        return battleNetName;
    return KNOWN_EXPANSION_NAMES[expansionId] || `Expansion ${expansionId}`;
}
/** Raid access commonly opens before the M+ season. Membership uses interval
 * overlap when the API supplies an end, and a bounded launch lead otherwise. */
export function assignRaidsToSeason(raids: any[], season: any, region: BattleNetRegion) {
    const start = timeNumber(timeValue(regionValue(season?.starts, region)));
    const end = timeNumber(timeValue(regionValue(season?.ends, region)));
    if (!Number.isFinite(start))
        return [];
    return raids.filter(raid => {
        const raidStart = timeNumber(timeValue(regionValue(raid?.starts, region)));
        const raidEnd = timeNumber(timeValue(regionValue(raid?.ends, region)));
        if (!Number.isFinite(raidStart))
            return false;
        return Number.isFinite(raidEnd)
            ? raidStart < (Number.isFinite(end) ? end : Infinity) && raidEnd > start
            : raidStart >= start - 14 * 86400000 && (!Number.isFinite(end) || raidStart < end);
    }).sort((a, b) => timeNumber(timeValue(regionValue(a.starts, region))) - timeNumber(timeValue(regionValue(b.starts, region))))
        .map(raid => cleanText(raid.slug)).filter(Boolean);
}
async function boundedMap<T>(items: T[], run: (item: T) => Promise<void>, limit = 3) {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length)
            await run(items[cursor++]);
    }));
}
const pending = new Map<string, Promise<RaidSeasonSnapshot | null>>();
export async function resolveRaidSeasonSnapshot(options: ResolverOptions = {}): Promise<RaidSeasonSnapshot | null> {
    const region = normalizeBattleNetRegion(options.region || "eu"), previous = options.previous;
    const now = Date.now(), at = Date.parse(previous?.checkedAt || previous?.detectedAt || "");
    const expired = Date.parse(previous?.seasons.find(season => season.current)?.endsAt || "") <= now;
    const rollover = previous?.seasons.some(season => !season.current && Date.parse(season.startsAt || "") <= now && Date.parse(season.startsAt || "") > Date.parse(previous?.detectedAt || ""));
    if (previous?.schemaVersion === RAID_SEASON_SNAPSHOT_VERSION && previous.region === region && !rollover && !expired && Number.isFinite(at) && now >= at && now - at < (previous.partial ? 300000 : 21600000))
        return previous;
    const key = region;
    const current = pending.get(key);
    if (current)
        return current;
    const task = resolveSnapshot({ ...options, region, timeoutMs: Math.min(5000, options.timeoutMs || 5000), retries: 0, signal: options.signal || AbortSignal.timeout(22000) }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
}
async function resolveSnapshot(options: ResolverOptions): Promise<RaidSeasonSnapshot | null> {
    const region = normalizeBattleNetRegion(options.region || "eu"), now = Date.now();
    const previous = options.previous?.region === region ? options.previous : null;
    const battleNet = await fetchBattleNetExpansion(region, options);
    const hint = battleNet?.raiderExpansionIdHint || previous?.currentExpansionId || 11;
    const probes = Array.from(new Set([previous?.currentExpansionId || hint, hint, hint + 1, hint - 1])).filter(id => id >= 6 && id <= 16);
    const seasonPayloads = new Map<number, any[]>(), raidPayloads = new Map<number, any[]>();
    await boundedMap(probes, async (id) => { try {
        const data = await fetchRaiderStatic("mythic-plus", id, options);
        if (Array.isArray(data?.seasons))
            seasonPayloads.set(id, data.seasons);
    }
    catch { } ; });
    const candidates = [...seasonPayloads].map(([expansionId, seasons]) => ({ expansionId, active: activeMainSeason(seasons, region, now) })).filter(item => item.active)
        .sort((a, b) => timeNumber(timeValue(regionValue(b.active.starts, region))) - timeNumber(timeValue(regionValue(a.active.starts, region))));
    const winner = candidates[0];
    // A partial provider outage must not roll the current selector back to an
    // older expansion merely because that expansion's endpoint still works.
    const previousCurrent = previous?.seasons.find(season => season.id === previous.currentSeasonId);
    if (winner && previous && previousCurrent && timeNumber(previousCurrent.startsAt) <= now && timeNumber(previousCurrent.startsAt) > timeNumber(timeValue(regionValue(winner.active.starts, region)))) {
        return {...previous, source: "cached", checkedAt: new Date(now).toISOString(), partial: true};
    }

    if (!winner)
        return previous ? { ...previous, source: "cached", checkedAt: new Date(now).toISOString(), partial: true } : null;
    const activeExpansionId = winner.expansionId, ids = Array.from({ length: activeExpansionId - 5 }, (_, i) => i + 6);
    const checks = { ...(previous?.expansionChecks || {}) }, failed = new Set<number>();
    const refresh = ids.filter(id => id === activeExpansionId || !previous?.schemaVersion || now - Date.parse(checks[id] || "") >= 7 * 86400000 || !checks[id]);
    await boundedMap(refresh, async (id) => {
        try {
            const [seasonData, raidData] = await Promise.all([
                seasonPayloads.has(id) ? Promise.resolve({ seasons: seasonPayloads.get(id) }) : fetchRaiderStatic("mythic-plus", id, options),
                fetchRaiderStatic("raiding", id, options),
            ]);
            if (!Array.isArray(seasonData?.seasons) || !Array.isArray(raidData?.raids) || !mainSeasons(seasonData.seasons).length || !raidData.raids.length)
                throw Error("incomplete static data");
            seasonPayloads.set(id, seasonData.seasons);
            raidPayloads.set(id, raidData.raids);
            checks[id] = new Date(now).toISOString();
        }
        catch {
            failed.add(id);
        }
    });
    const catalog: Record<string, RaidSeasonCatalogEntry> = Object.fromEntries(Object.entries(previous?.catalog || {}).map(([slug, raid]) => [slug, { ...raid }]));
    let seasons: RaidSeasonEntry[] = (previous?.seasons || []).map(season => ({ ...season, current: false }));
    const currentSeasonSlug = cleanText(winner.active.slug);
    const battleNetName = battleNet?.raiderExpansionIdHint === activeExpansionId ? battleNet.name : null;
    for (const id of refresh) {
        if (failed.has(id))
            continue;
        const raids = raidPayloads.get(id) || [], expansion = expansionLabel(id, battleNetName, activeExpansionId);
        seasons = seasons.filter(season => season.expansionId !== id);
        for (const [slug, raid] of Object.entries(catalog))
            if (raid.expansionId === id)
                delete catalog[slug];
        for (const raw of mainSeasons(seasonPayloads.get(id) || [])) {
            const slug = cleanText(raw.slug), startsAt = timeValue(regionValue(raw.starts, region));
            if (!startsAt || Date.parse(startsAt) > now)
                continue;
            const name = cleanText(raw.name || raw.short_name || slug), current = id === activeExpansionId && slug === currentSeasonSlug;
            seasons.push({ id: slug.replace(/^season-/, "") || slug, slug, name, label: `${expansion} · ${name}`, shortName: cleanText(raw.short_name || raw.name || slug), expansion, expansionId: id, startsAt, endsAt: timeValue(regionValue(raw.ends, region)), current, raids: assignRaidsToSeason(raids, raw, region) });
        }
        for (const raid of raids) {
            const slug = cleanText(raid.slug);
            if (!slug)
                continue;
            const startsAt = timeValue(regionValue(raid.starts, region)), endsAt = timeValue(regionValue(raid.ends, region));
            catalog[slug] = { slug, name: cleanText(raid.name || slug), shortName: cleanText(raid.short_name) || null, expansion, expansionId: id, bosses: Array.isArray(raid.encounters) ? raid.encounters.length : 0, startsAt, endsAt, activeNow: isInside(now, startsAt, endsAt), currentSeason: seasons.some(season => season.current && season.raids.includes(slug)) };
        }
    }
    seasons = seasons.map(season => ({ ...season, current: season.expansionId === activeExpansionId && season.slug === currentSeasonSlug }));
    const currentSeason = seasons.find(season => season.current);
    for (const raid of Object.values(catalog)) {
        raid.currentSeason = !!currentSeason?.raids.includes(raid.slug);
        raid.activeNow = isInside(now, raid.startsAt, raid.endsAt);
    }
    return { schemaVersion: RAID_SEASON_SNAPSHOT_VERSION, checkedAt: new Date(now).toISOString(), partial: failed.size > 0, expansionChecks: checks, detectedAt: new Date(now).toISOString(), source: battleNet ? "battlenet+raiderio" : "raiderio", region, currentExpansionId: activeExpansionId, currentExpansion: expansionLabel(activeExpansionId, battleNetName, activeExpansionId), currentSeasonId: currentSeason?.id || currentSeasonSlug.replace(/^season-/, ""), currentSeasonSlug, battleNetExpansionId: battleNet?.journalId || null, battleNetExpansion: battleNet?.name || null, battleNetRaidNames: battleNet?.raidNames || [], seasons: seasons.sort((a, b) => timeNumber(b.startsAt) - timeNumber(a.startsAt)), catalog };
}
