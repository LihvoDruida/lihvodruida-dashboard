import "server-only";
import { acquireAutomationLease } from "@/lib/automationLease";
import { getDocumentDb } from "@/lib/documentDb";
import { getGuildRaidHistoryContext, loadStoredGuildRosterData, fetchRaiderGuild, normalizeRaidProgression, normalizeRaidRankings } from "@/lib/guildRoster";
import { resolveRaidSeasonSnapshot } from "@/lib/raidSeasonResolver";
import { GUILD_RAID_HISTORY_COLLECTION, readGuildRaidHistory, type GuildRaidHistoryRecord } from "@/lib/guildRaidHistoryStore";
const normalize = (value: unknown) => String(value || "").normalize("NFC").trim().toLowerCase().replace(/[\s_]+/g, "-");
/** Four explicit raid queries per tick. The checkpoint survives processes and
 * roster rewrites; absence in the default current-expansion response is unknown. */
export async function refreshGuildRaidHistory() {
    const context = await getGuildRaidHistoryContext(), lease = await acquireAutomationLease(`raid_history_${context.key}`, "guild-raid-history");
    if (!lease)
        return { skipped: true, reason: "distributed_lease", checked: 0, failed: 0, pending: 0 };
    try {
        const prior = await readGuildRaidHistory(context.key);
        const identity = { region: context.region, realm: context.realmSlug, name: context.guildName };
        const same = prior && Object.keys(identity).every(key => normalize(prior.identity[key as keyof typeof identity]) === normalize(identity[key as keyof typeof identity]));
        const base = await loadStoredGuildRosterData({ bypassCache: true });
        const record: GuildRaidHistoryRecord = same ? structuredClone(prior) : { schemaVersion: 1, identity, seasonSnapshot: null, progression: {}, rankings: {}, checks: {}, updatedAt: null, attemptedAt: new Date().toISOString() };
        record.seasonSnapshot = await resolveRaidSeasonSnapshot({ region: context.region, previous: record.seasonSnapshot || base.stats.raidSeasonSnapshot, timeoutMs: 5000, retries: 0 });
        const baseAt = base.stats.rosterUpdatedAt || base.stats.updatedAt;
        if (normalize(base.stats.guildName) === normalize(context.guildName) && normalize(base.stats.guildRealm) === normalize(context.realmSlug) && baseAt) {
            for (const raid of base.stats.raidProgression || []) {
                const observedAt = raid.observedAt || baseAt;
                if (Date.parse(observedAt) > Date.parse(record.checks[raid.slug]?.checkedAt || "1970-01-01")) {
                    record.progression[raid.slug] = raid;
                    record.checks[raid.slug] = { checkedAt: observedAt };
                    if (Date.parse(observedAt) > Date.parse(record.updatedAt || "1970-01-01"))
                        record.updatedAt = observedAt;
                }
            }
            for (const rank of base.stats.raidRankings || [])
                if (!record.rankings[rank.slug])
                    record.rankings[rank.slug] = rank;
        }
        const now = Date.now(), catalog = record.seasonSnapshot?.catalog || {};
        const eligible = Object.values(catalog).filter(raid => raid.startsAt && Date.parse(raid.startsAt) <= now).filter(raid => {
            const check = record.checks[raid.slug];
            if (check?.retryAt && check.retryAt > now)
                return false;
            const age = now - Date.parse(check?.checkedAt || "");
            return !Number.isFinite(age) || age >= (raid.currentSeason ? 21600000 : 7 * 86400000);
        }).sort((a, b) => Number(!!record.checks[a.slug]?.checkedAt) - Number(!!record.checks[b.slug]?.checkedAt) || b.expansionId - a.expansionId || a.slug.localeCompare(b.slug)).slice(0, 4);
        let cursor = 0, checked = 0, failed = 0;
        await Promise.all(Array.from({ length: Math.min(2, eligible.length) }, async () => {
            while (cursor < eligible.length) {
                const raid = eligible[cursor++];
                try {
                    await lease.assertOwned();
                    const value = await fetchRaiderGuild(context.region, context.realmSlug, context.guildName, context.settings, raid.slug);
                    if (!value || normalize(value.name) !== normalize(context.guildName) || normalize(value.realm) !== normalize(context.realmSlug) || normalize(value.region) !== normalize(context.region))
                        throw Error("Guild identity mismatch");
                    const progress = normalizeRaidProgression(value.raid_progression).find(row => row.slug === raid.slug);
                    if (!progress)
                        throw Error("Missing requested raid");
                    record.progression[raid.slug] = progress;
                    const rank = normalizeRaidRankings(value.raid_rankings).find(row => row.slug === raid.slug);
                    if (rank)
                        record.rankings[raid.slug] = rank;
                    record.checks[raid.slug] = { checkedAt: new Date().toISOString() };
                    record.updatedAt = new Date().toISOString();
                    checked++;
                }
                catch {
                    record.checks[raid.slug] = { ...record.checks[raid.slug], failed: true, retryAt: Date.now() + 300000 };
                    failed++;
                }
            }
        }));
        // An idle cron tick must not invalidate every public guild snapshot.
        const comparable = (value: GuildRaidHistoryRecord | undefined) => value && JSON.stringify({ ...value, attemptedAt: undefined }, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
        if (comparable(record) !== comparable(prior)) {
            record.attemptedAt = new Date().toISOString();
            await lease.assertOwned();
            await getDocumentDb().collection(GUILD_RAID_HISTORY_COLLECTION).doc(context.key).set(record);
        }
        return { checked, failed, pending: Object.values(catalog).filter(raid => raid.startsAt && Date.parse(raid.startsAt) <= now && !record.progression[raid.slug]).length, skipped: false };
    }
    finally {
        await lease.release();
    }
}
