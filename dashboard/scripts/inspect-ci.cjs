#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Resolve from the script location, not the caller's cwd.
const root = path.resolve(__dirname, '..');
const failures = [];
const warnings = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(dir, files = []) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return files;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(relative, files);
    else files.push(relative.replaceAll(path.sep, '/'));
  }
  return files;
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

const sourceFiles = walk('src').filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file));
const textFiles = [
  ...sourceFiles,
  ...walk('scripts').filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)),
  'package.json',
  'vercel.json',
  'next.config.mjs',
  'tsconfig.json',
  'tsconfig.typecheck.json',
].filter((file, index, array) => exists(file) && array.indexOf(file) === index);

assert(!(exists('src/middleware.ts') && exists('src/proxy.ts')), 'Next 16 conflict: src/middleware.ts and src/proxy.ts cannot exist together. Keep proxy.ts only.');
assert(!exists('middleware.ts'), 'Stale root middleware.ts detected. Keep src/proxy.ts only.');
assert(!exists('src/src/middleware.ts'), 'Stale nested src/src/middleware.ts detected.');
assert(!exists('src/src/proxy.ts'), 'Stale nested src/src/proxy.ts detected.');

const combined = textFiles.map((file) => `\n/* ${file} */\n${read(file)}`).join('\n');
const runtimeCombined = [
  ...sourceFiles,
  '.env.example',
  'package.json',
  'next.config.mjs',
  'vercel.json',
].filter((file, index, array) => exists(file) && array.indexOf(file) === index)
  .map((file) => `\n/* ${file} */\n${read(file)}`)
  .join('\n');

assert(!/Warcraft\s*Logs|warcraftLogs|WCL_|GUILD_ROSTER_WCL_|WARCRAFTLOGS_/i.test(runtimeCombined), 'Warcraft Logs/WCL reference detected in source/config after WCL removal.');
assert(!/\.collection\((['"])dashboardAdminAudit\1\)/.test(combined), 'Legacy dashboardAdminAudit storage detected. Structured logs must use PostgreSQL system_logs.');
assert(!/\.collection\((['"])dashboardProfiles\1\)\s*\.limit\(1000\)/.test(combined), 'Heavy dashboardProfiles LIMIT 1000 scan detected. Use dashboardProfileCharacterLinks or bounded fallback.');
assert(!/guildRuntimeCache[\s\S]{0,300}\.collection\((['"])members\1\)/.test(combined), 'Deprecated guildRuntimeCache/*/members read/write detected. Use guildRosterRecords/memberChunks.');

if (exists('package-lock.json')) {
  const lock = JSON.parse(read('package-lock.json'));
  const packages = lock.packages || {};
  for (const [name, meta] of Object.entries(packages)) {
    if (name.endsWith('node_modules/uuid')) {
      assert(/^11\./.test(String(meta.version || '')), `Deprecated uuid version in package-lock: ${meta.version || 'unknown'}.`);
    }
    if (name.endsWith('node_modules/node-domexception')) {
      assert(String(meta.resolved || '').includes('vendor/node-domexception'), 'node-domexception must resolve to the native DOMException shim to avoid npm deprecated warnings.');
    }
    const resolved = String(meta.resolved || '');
    if (/^https?:\/\//.test(resolved)) {
      assert(resolved.startsWith('https://registry.npmjs.org/'), `package-lock contains a non-public npm registry URL: ${resolved}`);
    }
  }
}

function hasOnlyVercelCrons() {
  if (!exists('vercel.json')) return false;
  try {
    const parsed = JSON.parse(read('vercel.json'));
    const keys = Object.keys(parsed);
    return keys.length === 1 && Array.isArray(parsed.crons);
  } catch {
    return false;
  }
}

const packageJsonText = read('package.json');
warn(!exists('vercel.json') || hasOnlyVercelCrons(), 'vercel.json should contain only crons; keep framework/build/output auto-detected by Vercel.');
warn(!exists('.nvmrc') && !exists('.node-version'), 'Node version should be selected in Vercel Project Settings, not pinned by .nvmrc or .node-version.');
warn(!/"engines"\s*:/.test(packageJsonText), 'package.json should not pin engines when the project intentionally follows Vercel Project Settings Node.js version.');
warn(!/"packageManager"\s*:/.test(packageJsonText), 'package.json should not pin packageManager when Vercel should auto-select npm from package-lock.json.');
if (exists('.npmrc')) warn(/prefer-offline=true/.test(read('.npmrc')), '.npmrc should keep prefer-offline=true so local and Vercel installs reuse cache.');
warn(/"prebuild"\s*:\s*"node scripts\/remove-legacy-middleware\.cjs"/.test(packageJsonText), 'prebuild should run the middleware cleanup before the default Vercel npm run build.');
warn(/"build"\s*:\s*"node scripts\/next-build\.cjs"/.test(packageJsonText), 'build should use scripts/next-build.cjs to disable telemetry consistently and keep Vercel builds deterministic.');
warn(exists('scripts/next-build.cjs'), 'scripts/next-build.cjs should exist because package.json build points to it.');
warn(!/"build:vercel"\s*:/.test(packageJsonText), 'build:vercel should be removed; Vercel should use the default npm run build script.');
warn(/"build:ci"\s*:\s*"npm run cleanup:legacy && npm run typecheck && npm run check:actions && npm run check:site && npm run check:rules-accept && npm run check:login && npm run check:poll-scheduling && npm run check:admin-overview && npm run check:footer-version && npm run check:raid-editor && npm run check:discord-management && npm run check:account-cleanup && npm run check:imports && npm run audit:styles && npm run audit:ui && npm run inspect:ci && npm run build"/.test(packageJsonText), 'build:ci should clean stale overlay files before typecheck, API-action, site-navigation, rules-onboarding, login, poll-scheduling, admin-overview, footer-version, raid-editor, Discord-management, account-cleanup, import, style/UI, inspect-ci and build gates.');
warn(/"typecheck"\s*:\s*"node scripts\/typecheck\.cjs"/.test(read('package.json')), 'Typecheck should use scripts/typecheck.cjs for progress and timeout diagnostics.');

if (exists('src/proxy.ts')) {
  const proxyText = read('src/proxy.ts');
  const requiredInternalBearerPaths = [
    '/api/profile/discord-lookup',
    '/api/dashboard/profiles/refresh-external-data',
    '/api/dashboard/profiles/orphan-cleanup',
    '/api/dashboard/profiles/orphan-cleanup/apply',
    '/api/raids/lifecycle',
    '/api/polls/close-due',
    '/api/dashboard/logs/maintenance',
    '/api/dashboard/logs/ingest',
    '/api/guild/sync',
  ];
  for (const routePath of requiredInternalBearerPaths) {
    assert(proxyText.includes(routePath), `Proxy must allow internal Bearer access before session checks: ${routePath}.`);
  }
  assert(/\^\\\/api\\\/raids\\\/\[\^\/\]\+\\\/discord-action\$/.test(proxyText), 'Proxy must allow internal Bearer access to /api/raids/[raidId]/discord-action.');
  assert(/\^\\\/api\\\/polls\\\/\[\^\/\]\+\\\/vote\$/.test(proxyText), 'Proxy must allow internal Bearer access to /api/polls/[pollId]/vote.');
  assert(proxyText.includes('/api/calendar/raids.ics'), 'Public calendar feed /api/calendar/raids.ics must bypass session checks so Google Calendar/webcal imports work.');
  assert(proxyText.includes('DASHBOARD_INTERNAL_HOSTS'), 'Proxy must keep a dedicated allowlist for Docker-internal service hosts.');
  assert(proxyText.includes('!isAllowedHost(host) && !isInternalServiceRequest'), 'Internal Bearer requests from Docker service hosts must bypass only the public Host gate.');
  assert(/isInternalServiceRequest[\s\S]{0,100}\? \"off\"/.test(proxyText), 'Docker-internal Bearer requests must bypass the Cloudflare edge requirement.');
}




if (exists('src/app/page.tsx')) {
  const rootPageText = read('src/app/page.tsx');
  assert(/redirect\(user \? "\/profile" : "\/login"\)/.test(rootPageText), 'Root route must remain a redirect-only entry point after removing the legacy home page.');
  assert(!/Home(?:DashboardLiveSync|LocalTime|UpcomingRaidList)/.test(rootPageText), 'Root route must not reintroduce legacy home-page UI components.');
}
assert(!exists('src/components/HomeDashboardLiveSync.tsx'), 'Legacy HomeDashboardLiveSync component must stay removed.');
assert(!exists('src/components/HomeLocalTime.tsx'), 'Legacy HomeLocalTime component must stay removed.');
assert(!exists('src/components/HomeUpcomingRaidList.tsx'), 'Legacy HomeUpcomingRaidList component must stay removed.');
if (exists('src/lib/raiderIo.ts')) {
  const raiderIoText = read('src/lib/raiderIo.ts');
  assert(!raiderIoText.includes('https://raider.io/api/v1/periods'), 'Home-only Raider.IO periods integration must stay removed with the legacy home calendar.');
  assert(!raiderIoText.includes('fetchRaiderIoRegionPeriods'), 'Home-only Raider.IO period fetcher must stay removed.');
}


const LIST_STYLE_SOURCE = 'src/app/styles/components.css';
const listStyleText = exists(LIST_STYLE_SOURCE) ? read(LIST_STYLE_SOURCE) : '';
assert(/dashboard-list-panel/.test(listStyleText) && /dashboard-list-row/.test(listStyleText), `Global dashboard list styles must stay centralized in ${LIST_STYLE_SOURCE}.`);
const listUnifiedFiles = {
  'src/components/RaidViews.tsx': ['dashboard-list-row', 'dashboard-list-actions'],
  'src/components/RaidPollBrowser.tsx': ['dashboard-list-panel', 'dashboard-list-head', 'dashboard-list', 'dashboard-list-row', 'dashboard-list-actions'],
  'src/app/raids/page.tsx': ['dashboard-list-panel', 'dashboard-list-head', 'dashboard-list'],
  'src/app/content/page.tsx': ['dashboard-list-panel', 'dashboard-list-row', 'dashboard-list-actions'],
  'src/app/discord/rules/page.tsx': ['dashboard-list-panel', 'dashboard-list-row', 'dashboard-list-actions'],
  'src/app/profiles/page.tsx': ['dashboard-list', 'dashboard-list-row'],
};
for (const [file, requiredClasses] of Object.entries(listUnifiedFiles)) {
  if (!exists(file)) continue;
  const fileText = read(file);
  for (const requiredClass of requiredClasses) {
    assert(fileText.includes(requiredClass), `${file} must use the unified dashboard list class: ${requiredClass}.`);
  }
}

if (exists('src/components/GuildRosterExplorer.tsx')) {
  const rosterText = read('src/components/GuildRosterExplorer.tsx');
  assert(rosterText.includes('GuildRoster.module.css'), 'Guild roster must keep its page-specific layout in GuildRoster.module.css.');
  assert(/useState\(25\)/.test(rosterText), 'Guild roster must default to 25 characters per page.');
  assert(rosterText.includes('pagedMembers'), 'Guild roster must paginate filtered members before rendering rows.');
  assert(rosterText.includes('raidProgression'), 'Guild roster must expose raid progression/clear data.');
  assert(rosterText.includes('raidClearFilter'), 'Guild roster must keep the raid-clear filter.');
}

if (exists('src/lib/guildRoster.ts')) {
  const guildRosterText = read('src/lib/guildRoster.ts');
  assert(guildRosterText.includes('mythic_plus_scores_by_season:current,raid_progression'), 'Guild roster Raider.IO requests must include current M+ scores and raid_progression.');
  assert(!guildRosterText.includes('gear,mythic_plus_scores_by_season:current,raid_progression'), 'Guild roster must not request Raider.IO gear: Battle.net is authoritative for item level/character data.');
  assert(guildRosterText.includes('season.scores'), 'Guild roster must read Raider.IO M+ values from mythic_plus_scores_by_season[].scores.');
  assert(guildRosterText.includes('scoreFromCurrentSeason'), 'Guild roster must keep scores-first Raider.IO parsing with segments fallback.');
  assert(guildRosterText.includes('error instanceof ApiHttpError && error.status === 404'), 'Only Raider.IO 404 may become an empty character result; transport/auth/server errors must stay visible and retryable.');
  assert(!guildRosterText.includes('mythic_plus_scores_by_season:current,raid_progression:current-expansion'), 'Character raid progression must use Raider.IO field raid_progression without an unsupported suffix.');
}

assert(exists('src/app/api/guild/sync/route.ts'), 'Self-hosted guild roster sync endpoint must exist.');
if (exists('src/app/api/guild/sync/route.ts')) {
  const guildSyncText = read('src/app/api/guild/sync/route.ts');
  assert(guildSyncText.includes('verifyInternalBearerToken'), 'Guild auto-sync endpoint must require an internal bearer token.');
  assert(guildSyncText.includes('GUILD_ROSTER_AUTO_SYNC_ENABLED'), 'Guild auto-sync endpoint must keep its server-side feature switch.');
}

if (exists('src/app/profiles/page.tsx')) {
  const profilesText = read('src/app/profiles/page.tsx');
  assert(profilesText.includes('dashboard-table-card--profiles'), 'Profiles page must use the compact dashboard table layout.');
  assert(/const PROFILE_PAGE_SIZE = 20/.test(profilesText), 'Profiles page must keep 20 profiles per page.');
  assert(profilesText.includes('buildProfilesHref'), 'Profiles page must preserve pagination links with active search query.');
}

if (exists('src/components/RaidViews.tsx')) {
  const raidViewsText = read('src/components/RaidViews.tsx');
  assert(raidViewsText.includes('raid-list-action-open'), 'Raid cards must keep a full-width open action at the top of the action column.');
  assert(raidViewsText.includes('raid-list-action-tools'), 'Raid cards must group edit/delete actions in one compact row.');
  assert(raidViewsText.includes('raid-list-icon-action--edit') && raidViewsText.includes('aria-label={`Редагувати рейд'), 'Raid edit action must be icon-only visually but accessible by aria-label.');
  assert(raidViewsText.includes('raid-list-icon-action--delete') && raidViewsText.includes('aria-label={raid.status === "draft"'), 'Raid delete action must be icon-only visually but accessible by aria-label.');
  assert(raidViewsText.includes('raid-list-archive-note'), 'Raid cards must keep the archive/draft/state note below action buttons.');
}


assert(!exists('src/components/SectionIcon.tsx'), 'SectionIcon registry must be removed: the dashboard is intentionally iconless.');
assert(!exists('public/ui-icons'), 'Generated SVG dashboard icons must be removed from public assets.');
assert(!/SectionIcon|dashboard-section-icon|ui-icons/.test(runtimeCombined), 'Icon-system references detected after iconless UI rebuild.');


if (exists('src/app/theme.css')) {
  const themeText = read('src/app/theme.css');
  assert(/\.raid-page \.raid-manager-list[\s\S]{0,220}repeat\(2, minmax/.test(themeText), 'Raid list must stay forced to two desktop columns.');
  assert(/\.raid-list-title-row strong[\s\S]{0,260}white-space: normal/.test(themeText), 'Raid card titles must wrap instead of truncating with ellipsis.');
  assert(/\.raid-list-facts small[\s\S]{0,380}overflow: visible/.test(themeText), 'Raid fact chips must not clip or ellipsize core data.');
  assert(/\.dashboard-nav-more__menu a strong[\s\S]{0,260}white-space: normal/.test(themeText), 'Overflow menu item titles must wrap instead of being clipped.');
  assert(/\.raid-list-actions[\s\S]{0,260}grid-template-columns:\s*1fr/.test(themeText), 'Raid card actions must use a single fixed action column to avoid button overlap.');
  assert(/\.raid-list-action-tools[\s\S]{0,220}repeat\(2, minmax\(0, 1fr\)\)/.test(themeText), 'Edit/delete raid actions must share one row below the open button.');
  assert(/\.raid-list-icon-action--edit[\s\S]{0,220}rgba\(187, 137, 44/.test(themeText), 'Edit raid action must keep the muted matte yellow treatment.');
  assert(/\.raid-list-icon-action--delete[\s\S]{0,220}rgba\(160, 48, 43/.test(themeText), 'Delete raid action must keep the muted matte red treatment.');
  assert(/\.raid-list-archive-note[\s\S]{0,260}text-transform:\s*uppercase/.test(themeText), 'Archive marker must stay as a full-width bottom note.');
}



// Structured logging v3: PostgreSQL is the source of truth, retention is local,
// and only Security is allowed to mirror to Discord.
assert(exists('src/lib/structuredLogs.ts'), 'Structured PostgreSQL logger must exist.');
assert(exists('src/lib/securityLogDiscord.ts'), 'Security-only Discord log mirror must exist.');
assert(!exists('src/lib/dashboardAuditNotifications.ts'), 'Legacy Discord-as-log-storage module must stay removed.');
if (exists('src/lib/db/schema.sql')) {
  const schemaText = read('src/lib/db/schema.sql');
  assert(schemaText.includes('CREATE TABLE IF NOT EXISTS system_logs'), 'PostgreSQL system_logs table must exist.');
  assert(schemaText.includes('CREATE TABLE IF NOT EXISTS system_log_settings'), 'Structured log settings must live in PostgreSQL.');
}
if (exists('src/lib/structuredLogs.ts')) {
  const structuredLogsText = read('src/lib/structuredLogs.ts');
  assert(structuredLogsText.includes("interval '3 days'"), 'Structured logs must retain at most three days.');
  assert(structuredLogsText.includes('maxStorageMb') && structuredLogsText.includes('maxRows'), 'Structured logs must enforce both storage and row budgets.');
}
if (exists('src/lib/securityLogDiscord.ts')) {
  const securityMirrorText = read('src/lib/securityLogDiscord.ts');
  assert(securityMirrorText.includes('SECURITY_MIRROR_DEDUPE_MS'), 'Security Discord mirror must retain anti-spam dedupe.');
}
if (exists('src/lib/logSettings.ts')) {
  const logSettingsText = read('src/lib/logSettings.ts');
  assert(logSettingsText.includes('system_log_settings'), 'Structured log settings must use PostgreSQL system_log_settings.');
  assert(!/firebaseRead|firebaseWrite|dashboardSettings/.test(logSettingsText), 'Structured log settings must not depend on the legacy Firebase settings path.');
}
assert(!/listAdminAuditLogsFromDiscord|publishAdminAuditToDiscord|ADMIN_AUDIT_(?:READ|DEDUPE|MAX|POLICY)/.test(runtimeCombined), 'Legacy Discord audit-storage code/config detected.');


// Self-hosted internal service auth must use one canonical token. This prevents
// cron/bot/dashboard from silently drifting into 421/401/token_mismatch loops.
const composePath = '../docker-compose.yml';
if (exists(composePath)) {
  const composeText = read(composePath);
  assert(/dashboard:[\s\S]{0,2600}INTERNAL_API_TOKEN:\s*\$\{INTERNAL_API_TOKEN/.test(composeText), 'dashboard must receive canonical root INTERNAL_API_TOKEN from docker-compose.');
  assert(/dashboard:[\s\S]{0,2800}DISCORD_PUBLIC_KEY:\s*\$\{DISCORD_PUBLIC_KEY/.test(composeText), 'dashboard must receive canonical root DISCORD_PUBLIC_KEY from docker-compose.');
  assert(/bot:[\s\S]{0,2600}INTERNAL_API_TOKEN:\s*\$\{INTERNAL_API_TOKEN/.test(composeText), 'bot must receive canonical root INTERNAL_API_TOKEN from docker-compose.');
  assert(/cron:[\s\S]{0,1800}INTERNAL_CRON_TOKEN:\s*\$\{INTERNAL_API_TOKEN/.test(composeText), 'cron must map INTERNAL_CRON_TOKEN from canonical INTERNAL_API_TOKEN.');
}
assert(exists('src/app/api/internal/health/route.ts'), 'Internal bearer health endpoint must exist for service-to-service auth checks.');
if (exists('src/proxy.ts')) {
  const proxyText = read('src/proxy.ts');
  assert(proxyText.includes('pathname === "/api/internal/health"'), 'Internal health route must be allowed through bearer-only internal host handling.');
  assert(proxyText.includes('pathname === "/api/discord/interactions"'), 'Bot-forwarded Discord interactions must be allowed on the internal dashboard host.');
  assert(proxyText.includes('pathname === "/api/guild/sync"'), 'Guild auto-sync must be allowed through bearer-only internal host handling.');
  assert(proxyText.includes('DASHBOARD_INTERNAL_HOSTS || "dashboard,dashboard:3000"'), 'Internal Docker host dashboard:3000 must stay allowlisted only for bearer-authenticated internal APIs.');
}
if (exists('src/lib/structuredLogs.ts')) {
  const logText = read('src/lib/structuredLogs.ts');
  assert(/value === null \|\| value === undefined \|\| value === ""/.test(logText), 'Structured logs must preserve missing numeric telemetry as null instead of fabricating HTTP 100 / 0 ms.');
}

// Discord buttons are mutations and must not interpret a stale/null page cache as
// "resource deleted". Keep their backing reads authoritative and preserve the
// public Discord message reference so already-published messages can self-heal
// after resource recreation or the Firestore -> PostgreSQL migration.
if (exists('src/app/api/discord/interactions/route.ts')) {
  const interactionsText = read('src/app/api/discord/interactions/route.ts');
  assert(/handleRosterFormationDiscordAction\([\s\S]{0,500}messageRef:\s*getInteractionMessageRef\(interaction\)/.test(interactionsText), 'Roster Discord interactions must pass the public messageRef to authoritative storage lookup.');
  assert(/handleRosterFormationDiscordAction\([\s\S]{0,650}interactionMessage:\s*interaction\?\.message/.test(interactionsText), 'Roster Discord interactions must pass message payload for orphan recovery.');
  assert(/handleRaidPollDiscordVote\([\s\S]{0,500}messageRef/.test(interactionsText), 'Raid-poll Discord interactions must pass messageRef to authoritative storage lookup.');
  assert(/handleRaidPollDiscordVote\([\s\S]{0,650}interactionMessage:\s*interaction\?\.message/.test(interactionsText), 'Raid-poll Discord interactions must pass message payload for orphan recovery.');
  assert(/handleRaidDiscordAction\([\s\S]{0,500}messageRef:\s*getInteractionMessageRef\(interaction\)/.test(interactionsText), 'Raid Discord interactions must pass messageRef to authoritative storage lookup.');
  assert(/handleRaidDiscordAction\([\s\S]{0,650}interactionMessage:\s*interaction\?\.message/.test(interactionsText), 'Raid Discord interactions must pass message payload for orphan recovery.');
  assert(interactionsText.includes('getProfileByDiscordUserIdForInteraction'), 'Discord rules/raid signup must use authoritative profile lookup rather than the page cache.');
}
if (exists('src/lib/discordInteractionStorage.ts')) {
  const discordStorageText = read('src/lib/discordInteractionStorage.ts');
  assert(discordStorageText.includes('resolveDiscordInteractionDocument'), 'Missing authoritative Discord resource resolver.');
  assert(discordStorageText.includes('legacy-message') && discordStorageText.includes('backfillLegacyDocument'), 'Discord resource resolver must retain legacy Firestore read-through/backfill support.');
  assert(discordStorageText.includes('resolveDiscordInteractionProfileDocument'), 'Discord interaction profile lookup must bypass the shared page-read circuit.');
  assert(discordStorageText.includes('scanStoreForResource') && discordStorageText.includes('discordMessageId'), 'Discord resource resolver must keep compatibility scan for legacy message-reference field names.');
  assert(discordStorageText.includes('assertDiscordInteractionStore') && discordStorageText.includes('DISCORD_INTERACTION_REQUIRE_POSTGRES'), 'Production Discord interactions must reject old Firestore-only runtimes.');
}
if (exists('src/lib/raids.ts')) {
  const raidsText = read('src/lib/raids.ts');
  assert(raidsText.includes('getRaidForDiscordInteraction'), 'Raid Discord actions must resolve the raid authoritatively.');
  assert(raidsText.includes('recoverEmptyRaidFromDiscordMessage'), 'Empty orphan raid Discord messages must keep safe self-recovery.');
  assert(/recordRaidSignup\(raid\.id, signup, \{ interaction: true \}\)/.test(raidsText), 'Discord raid signup writes must be allowed to probe past a stale write circuit.');
}
if (exists('src/lib/raidPolls.ts')) {
  const pollsText = read('src/lib/raidPolls.ts');
  assert(/raid_polls\.vote_failed", bypassCircuit: true/.test(pollsText), 'Discord raid-poll mutations must probe past a stale write circuit.');
  assert(pollsText.includes('recoverEmptyRaidPollFromDiscordMessage'), 'Empty orphan raid-poll Discord messages must keep safe self-recovery.');
}
if (exists('src/lib/rosterFormation.ts')) {
  const rosterFormationText = read('src/lib/rosterFormation.ts');
  assert(/roster\.mutate_failed", bypassCircuit: true/.test(rosterFormationText), 'Discord roster mutations must probe past a stale write circuit.');
  assert(rosterFormationText.includes('recoverEmptyRosterFromDiscordMessage'), 'Empty orphan roster Discord messages must keep safe self-recovery.');
  assert(rosterFormationText.indexOf('roster:create:${id}') < rosterFormationText.indexOf('publishRosterMessage(draft, channelId)'), 'Roster backing document must be persisted before publishing Discord message.');
}

assert(exists('tsconfig.typecheck.json'), 'Missing tsconfig.typecheck.json. Typecheck must avoid generated/cache directories.');
if (exists('tsconfig.typecheck.json')) {
  const typecheckConfig = read('tsconfig.typecheck.json');
  assert(/"src\/\*\*\/\*\.ts"/.test(typecheckConfig) && /"src\/\*\*\/\*\.tsx"/.test(typecheckConfig), 'tsconfig.typecheck.json must include only source TypeScript files.');
  assert(/"\.next"/.test(typecheckConfig), 'tsconfig.typecheck.json must exclude .next to avoid Vercel cache scans.');
}


for (const message of warnings) console.warn(`[inspect-ci:warn] ${message}`);
if (failures.length > 0) {
  for (const message of failures) console.error(`[inspect-ci:error] ${message}`);
  process.exit(1);
}

console.log(`[inspect-ci] OK — checked ${textFiles.length} files, ${failures.length} blocking issues.`);
