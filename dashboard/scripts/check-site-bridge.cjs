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
const compose = read('docker-compose.yml');
const envExample = read('.env.example');
const page = read('dashboard/src/app/applications/page.tsx');
const proxy = read('dashboard/src/proxy.ts');

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
check(compose.includes('PUBLIC_SITE_ORIGINS:'), 'dashboard container must receive the public-site origin allowlist');
check(envExample.includes('PUBLIC_SITE_ORIGINS='), 'public-site origin allowlist must be documented in env example');
check(page.includes('Main Site ↔ VPS'), 'applications UI must expose bridge health/source context');
check(page.includes('PostgreSQL source of truth'), 'applications UI must identify the server source of truth');

console.log(`[check-site-bridge] OK — ${checked}/${checked} public-site bridge, privacy, raid and application invariants checked.`);
