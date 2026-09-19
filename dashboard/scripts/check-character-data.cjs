const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const store = read('dashboard/src/lib/characterDataStore.ts');
const profiles = read('dashboard/src/lib/profiles.ts');
const roster = read('dashboard/src/lib/guildRoster.ts');
const raids = read('dashboard/src/lib/characterRaidProgress.ts');
const explorer = read('dashboard/src/components/GuildRosterExplorer.tsx');
const resolver = read('dashboard/src/lib/raidSeasonResolver.ts');
const checks = [
  ['guild and external character databases are separate', store.includes('guildCharacterData') && store.includes('externalCharacterData')],
  ['guild canonical records delete parallel external copies', store.includes('batch.delete(canonicalDoc("external", member.key))')],
  ['guild roster sync writes canonical character data', roster.includes('writeGuildCharacterDataRecords')],
  ['full guild sync removes stale canonical guild records', store.includes('replaceAll') && store.includes('stale') && store.includes('cleanup.delete(item.ref)')],
  ['profile refresh reads guild canonical data first', profiles.includes('readGuildCharacterData(current.key)')],
  ['guild profile refresh avoids duplicate external API fanout', profiles.includes('if (canonicalGuild)') && profiles.indexOf('if (canonicalGuild)') < profiles.indexOf('fetchBattleNetCharacterSnapshot(current)')],
  ['non-guild characters persist to external database', profiles.includes('writeExternalCharacterData(externalRecord)')],
  ['fresh external canonical records prevent duplicate upstream fanout', profiles.includes('readExternalCharacterData(current.key)') && profiles.includes('EXTERNAL_CHARACTER_CANONICAL_TTL_MS')],
  ['profile reads hydrate character metrics from canonical databases', profiles.includes('hydrateProfilesFromCanonicalCharacterData') && profiles.includes('readCanonicalCharacterDataMany')],
  ['current season raid selection is centralized', raids.includes('currentSeasonRaidProgress') && raids.includes('primaryCurrentRaidProgress')],
  ['guild roster UI no longer uses first raid/tier heuristic directly', !explorer.includes('raids.find((raid) => /^tier-/i.test(raid.slug)) || raids[0]')],
  ['guild roster UI uses server season snapshot', explorer.includes('liveStats.raidSeasonSnapshot') && explorer.includes('primaryCurrentRaidProgress')],
  ['raid filters are limited to current season', explorer.includes('currentSeasonRaidProgress(normalizedRaidProgress(member), liveStats.raidSeasonSnapshot)')],
  ['season resolver has upstream fallback mapping', resolver.includes('battleNetNames') && resolver.includes('currentSeason.raids = Array.from(new Set(fallback.map')],
  ['raid season metadata is shared through the canonical data layer', store.includes('characterDataMeta') && store.includes('writeCharacterRaidSeasonSnapshot') && profiles.includes('readCharacterRaidSeasonSnapshot')],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`[check-character-data] OK — ${checks.length}/${checks.length}`);
