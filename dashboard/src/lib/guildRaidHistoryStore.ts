import "server-only";
import { getDocumentDb } from "@/lib/documentDb";
import type { GuildRaidProgress, GuildRaidRanking, GuildRosterLoadResult } from "@/lib/guildRoster";
import type { RaidSeasonSnapshot } from "@/lib/raidSeasonResolver";
export const GUILD_RAID_HISTORY_COLLECTION = "guildRaidHistory";
export type RaidHistoryCheck = {
    checkedAt?: string;
    retryAt?: number;
    failed?: boolean;
};
export type GuildRaidHistoryRecord = {
    schemaVersion: 1;
    identity: {
        region: string;
        realm: string;
        name: string;
    };
    seasonSnapshot: RaidSeasonSnapshot | null;
    progression: Record<string, GuildRaidProgress>;
    rankings: Record<string, GuildRaidRanking>;
    checks: Record<string, RaidHistoryCheck>;
    updatedAt: string | null;
    attemptedAt: string;
};
export function mergeRaidRows<T extends {
    slug: string;
}>(previous: T[] = [], incoming: T[] = []): T[] {
    return [...new Map([...previous, ...incoming].map(row => [row.slug, row])).values()];
}
export async function readGuildRaidHistory(key: string) {
    return (await getDocumentDb().collection(GUILD_RAID_HISTORY_COLLECTION).doc(key).get()).data() as GuildRaidHistoryRecord | undefined;
}
export function applyGuildRaidHistory(base: GuildRosterLoadResult, history?: GuildRaidHistoryRecord): GuildRosterLoadResult {
    const snapshot = [history?.seasonSnapshot, base.stats.raidSeasonSnapshot].filter((item): item is RaidSeasonSnapshot => !!item).sort((a, b) => Number(b.schemaVersion === 2) - Number(a.schemaVersion === 2) || Date.parse(b.checkedAt || b.detectedAt) - Date.parse(a.checkedAt || a.detectedAt))[0] || null;
    const rows = new Map<string, GuildRaidProgress>();
    for (const raid of Object.values(history?.progression || {})) {
        const check = history?.checks[raid.slug], observedAt = check?.checkedAt;
        rows.set(raid.slug, { ...raid, observedAt, stale: !!check?.failed || !observedAt || Date.now() - Date.parse(observedAt) >= (snapshot?.catalog[raid.slug]?.currentSeason ? 21600000 : 7 * 86400000) });
    }
    for (const raid of base.stats.raidProgression || []) {
        const at = Date.parse(history?.checks[raid.slug]?.checkedAt || "");
        const observedAt = raid.observedAt || base.stats.rosterUpdatedAt || base.stats.updatedAt || undefined, sourceAt = Date.parse(observedAt || "");
        if (!rows.has(raid.slug) || Number.isFinite(sourceAt) && (!Number.isFinite(at) || sourceAt > at))
            rows.set(raid.slug, { ...raid, observedAt, stale: !Number.isFinite(sourceAt) || Date.now() - sourceAt > 86400000 });
    }
    const catalog = snapshot?.catalog || {}, now = Date.now();
    const known = Object.values(catalog).filter(raid => raid.startsAt && Date.parse(raid.startsAt) <= now).map(raid => raid.slug);
    const pending = known.filter(slug => !rows.has(slug)).length;
    const failed = Object.values(history?.checks || {}).filter(check => check.failed).length;
    const rankings = new Map(Object.values(history?.rankings || {}).map(rank => [rank.slug, rank]));
    for (const rank of base.stats.raidRankings || [])
        if (!rankings.has(rank.slug) || Date.parse(rank.observedAt || base.stats.rosterUpdatedAt || "") >= Date.parse(history?.checks[rank.slug]?.checkedAt || "1970-01-01"))
            rankings.set(rank.slug, rank);
    return { ...base, stats: { ...base.stats, raidSeasonSnapshot: snapshot, raidProgression: [...rows.values()], raidRankings: [...rankings.values()], raidHistory: { state: !snapshot ? "unavailable" : pending || failed || snapshot.partial ? "partial" : history ? "ready" : "pending", known: known.length, pending, failed, updatedAt: history?.updatedAt || null } } };
}
