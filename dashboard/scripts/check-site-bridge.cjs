const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
const read = (file) => fs.readFileSync(path.resolve(repo, file), 'utf8');
let checked = 0;
function check(condition, message) {
  checked += 1;
  if (!condition) throw new Error(`[check-site-bridge] ${message}`);
}

const applicationsRoute = read('dashboard/src/app/api/site/applications/route.ts');
const guildRoute = read('dashboard/src/app/api/site/guild/route.ts');
const bridge = read('dashboard/src/lib/publicSiteBridge.ts');
const applications = read('dashboard/src/lib/github.ts');
const roster = read('dashboard/src/lib/guildRoster.ts');
const raidSeasonResolver = read('dashboard/src/lib/raidSeasonResolver.ts');
const compose = read('docker-compose.yml');
const envExample = read('.env.example');
const page = read('dashboard/src/app/applications/page.tsx');
const proxy = read('dashboard/src/proxy.ts');
const discord = read('dashboard/src/lib/discord.ts');
const discordSettings = read('dashboard/src/lib/guildNicknamePolicy.ts');
const discordSettingsRoute = read('dashboard/src/app/api/dashboard/discord/settings/route.ts');
const discordPage = read('dashboard/src/app/dashboard/discord/page.tsx');
const applicationActions = read('dashboard/src/components/ApplicationStatusActions.tsx');
const applicationDeleteRoute = read('dashboard/src/app/api/applications/[number]/route.ts');
const guildSyncRoute = read('dashboard/src/app/api/guild/sync/route.ts');

check(proxy.includes('function isPublicSiteBridgePath'), 'proxy must explicitly identify public Main Site bridge routes');
check(proxy.includes('pathname === "/api/site/applications"') && proxy.includes('pathname === "/api/site/guild"'), 'both Main Site bridge routes must be public at proxy level');
check(proxy.includes('isPublicSiteBridgePath(pathname) ||'), 'public bridge routes must bypass Dashboard session protection');
check(proxy.includes('!isPublicSiteBridgeRequest &&'), 'public bridge routes must bypass Dashboard same-origin middleware and defer to route CORS policy');
check(applicationsRoute.includes('isAllowedPublicSiteOrigin'), 'application POST must enforce public-site origin allowlist');
check(applicationsRoute.includes('assertRequestBodySize'), 'application POST must enforce Content-Length body limit');
check(applicationsRoute.includes('Buffer.byteLength(rawBody, "utf8") > 16 * 1024'), 'application POST must enforce body limit after reading chunked payloads');
check(applicationsRoute.includes('checkRateLimit'), 'public applications route must be rate limited');
check(applicationsRoute.includes('validateApplication'), 'public applications must use server-side validation');
check(applicationsRoute.includes('website'), 'public applications must keep honeypot validation');
check(applicationsRoute.includes('notifyDiscordNewApplication'), 'new public applications must notify Discord');
check(applicationsRoute.includes('setApplicationDiscordMessageRef'), 'Discord message ref must be persisted for two-way status updates');
check(applicationsRoute.includes('filterStoredApplications(stored'), 'public applications GET should filter one stored snapshot instead of rereading the collection');
check(applications.includes('source_system: "public-site"'), 'public applications must be marked with their source system');
check(applications.includes('discord: null') && applications.includes('battle_tag: null'), 'public application payload must hide Discord and BattleTag');
check(applications.includes('availability: ""'), 'public application payload must not expose availability text');
check(guildRoute.includes('buildPublicGuildSnapshot'), 'public guild route must use the sanitized bridge snapshot');
check(guildRoute.includes('Cache-Control'), 'public guild snapshot should advertise short edge/browser caching');
check(bridge.includes('loadStoredGuildRosterData'), 'guild bridge must read the server-owned roster snapshot');
check(bridge.includes('listRaids(40)'), 'guild bridge must include server raid schedule');
check(bridge.includes('scheduled_raids'), 'guild bridge must expose scheduled raids');
check(bridge.includes('roster.members.map(publicRosterMember)'), 'guild bridge must sanitize roster members');
check(roster.includes('raid_progression:current-expansion:previous-expansion'), 'server roster sync must collect guild raid progression');
check(roster.includes('raid_rankings:current-expansion:previous-expansion'), 'server roster sync must collect guild raid rankings');
check(roster.includes('raidProgression: normalizeRaidProgression'), 'guild raid progression must be persisted in roster stats');
check(roster.includes('raidRankings: normalizeRaidRankings'), 'guild raid rankings must be persisted in roster stats');
check(roster.includes('resolveRaidSeasonSnapshot') && roster.includes('raidSeasonSnapshot'), 'roster sync must persist the automatic raid season snapshot');
check(bridge.includes('raid_seasons: publicRaidSeasonSnapshot'), 'public guild bridge must expose normalized raid season metadata');
check(raidSeasonResolver.includes('/data/wow/journal-expansion/index'), 'season resolver must discover the current expansion from Battle.net journal data');
check(raidSeasonResolver.includes('/data/wow/journal-expansion/${Number(latest.id)}'), 'season resolver must read Battle.net expansion raid metadata');
check(raidSeasonResolver.includes('mythic-plus') && raidSeasonResolver.includes('static-data'), 'season resolver must use Raider.IO mythic-plus static seasons');
check(raidSeasonResolver.includes('fetchRaiderStatic("raiding"'), 'season resolver must use Raider.IO raiding static data');
check(raidSeasonResolver.includes('is_main_season') && raidSeasonResolver.includes('starts') && raidSeasonResolver.includes('ends'), 'season relevance must be derived from main-season time windows rather than a manual season id');
check(raidSeasonResolver.includes('activeNow: isInside'), 'raid relevance must be derived automatically from Raider.IO raid time windows');
check(raidSeasonResolver.includes('source: "cached"'), 'automatic season resolver must preserve the last good snapshot when upstream APIs temporarily fail');
check(guildSyncRoute.includes('missingRaidSeasonSnapshot') && guildSyncRoute.includes('raidSeasonSnapshot?.detectedAt'), 'cron must seed season metadata immediately after deployment instead of waiting for the normal roster refresh TTL');
check(compose.includes('PUBLIC_SITE_ORIGINS:'), 'dashboard container must receive the public-site origin allowlist');
check(envExample.includes('PUBLIC_SITE_ORIGINS='), 'public-site origin allowlist must be documented in env example');
check(page.includes('Main Site ↔ VPS'), 'applications UI must expose bridge health/source context');
check(page.includes('PostgreSQL source of truth'), 'applications UI must identify the server source of truth');


check(discordSettings.includes('applicationsChannelId: string'), 'Discord management settings must persist a dedicated applications channel');
check(discordSettingsRoute.includes('applicationsChannelId: form.get("applicationsChannelId")'), 'Discord settings route must save the applications channel');
check(discordPage.includes('name="applicationsChannelId"') && discordPage.includes('Канал нових заявок'), 'Discord settings UI must expose applications channel selection');
check(discordPage.includes('/api/dashboard/discord/applications/test-channel'), 'applications channel must have an in-dashboard test action');
check(discord.includes('resolveApplicationsDiscordChannelId') && discord.includes('getDiscordDefaultChannelId()'), 'applications channel resolver must preserve legacy DISCORD_CHANNEL_ID fallback');
check(discord.includes('notifyDiscordNewApplication') && discord.includes('await resolveApplicationsDiscordChannelId()'), 'new applications must use the configured applications channel');
check(discord.includes('notifyDiscordStatusChange') && discord.includes('deleteDiscordApplicationMessage'), 'legacy status fallback and Discord deletion helpers must remain wired');
check(applicationDeleteRoute.includes('session.isServerOwner'), 'application deletion must be restricted to the Discord server owner');
check(applicationDeleteRoute.includes('deleteDiscordApplicationMessage(issue)') && applicationDeleteRoute.includes('deleteGuildApplication(issueNumber)'), 'owner deletion must remove Discord message before server record');
check(applicationActions.includes('canDelete?: boolean') && applicationActions.includes('method: "DELETE"'), 'applications UI must expose owner-only deletion through DELETE API');
check(page.includes('canDelete={Boolean(user.isServerOwner)}'), 'applications page must only expose delete action to server owner');

console.log(`[check-site-bridge] OK — ${checked}/${checked} public-site bridge, Discord applications, privacy, raid and application invariants checked.`);
