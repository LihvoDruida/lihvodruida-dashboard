const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
function check(name, ok) {
  if (!ok) throw new Error(`[check-guild-lifecycle] FAIL — ${name}`);
  checks.push(name);
  console.log(`✓ ${name}`);
}

const onboarding = read('dashboard/src/lib/discordNewcomerOnboarding.ts');
const bootstrap = read('dashboard/src/lib/discordNewcomerBootstrap.ts');
const callback = read('dashboard/src/app/api/auth/discord/callback/route.ts');
const auth = read('dashboard/src/lib/auth.ts');
const internal = read('dashboard/src/app/api/internal/discord/member-joined/route.ts');
const gateway = read('bot/src/gateway.mjs');
const compose = read('docker-compose.yml');
const cron = read('deploy/cron/run-cron.sh');
const start = read('deploy/scripts/start.sh');
const internalAuth = read('deploy/scripts/internal-auth-check.sh');
const dockerfile = read('dashboard/Dockerfile');

check('priority member snapshot failures are retried instead of silently dropped', onboarding.includes('Priority Discord member snapshot unresolved'));
check('gateway targeted route calls priority onboarding', internal.includes('priorityUserIds: [userId]') && internal.includes('source: "gateway"'));
check('gateway route asks bot to retry lease contention', internal.includes('skippedReason === "distributed_lease"') && internal.includes('status: 202'));
check('bootstrap checks exact default role instead of rejecting any pre-existing role', bootstrap.includes('currentRoles.includes(roleId)') && !bootstrap.includes('currentRoles.length > 0'));
check('OAuth callback always attempts safe recent-member bootstrap', callback.includes('ensureDiscordNewcomerBootstrapRole') && callback.includes('Array.from(new Set([...discordRoleIds, bootstrap.roleId]))'));
check('live session access also self-heals missing default role', auth.includes('Array.from(new Set([...liveRoleIds, bootstrap.roleId]))'));
check('gateway listens for GUILD_MEMBER_ADD', gateway.includes('packet.t === "GUILD_MEMBER_ADD"'));
check('gateway prioritizes fresh joins but has starvation guard', gateway.includes('STARVATION_GUARD_MS') && gateway.includes('aStarving'));
check('gateway reconnect penalty resets on READY/RESUMED', (gateway.match(/state\.reconnects = 0;/g) || []).length >= 2);
check('bot receives Discord token and guild id in compose', compose.includes('DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN') && compose.includes('DISCORD_GUILD_ID: ${DISCORD_GUILD_ID'));
check('bot receives starvation guard configuration', compose.includes('DISCORD_GATEWAY_MEMBER_STARVATION_MS'));
check('deployment preflight requires root gateway credentials', start.includes('require_var .env DISCORD_BOT_TOKEN') && start.includes('require_var .env DISCORD_GUILD_ID'));
check('post-deploy internal auth check probes Gateway configuration/fatal intent errors', internalAuth.includes('gateway.ready') && internalAuth.includes('4014') && internalAuth.includes('DISCORD_GATEWAY_ENABLED'));
check('dashboard builder copies internal auth check used by lifecycle CI', dockerfile.includes('COPY deploy/scripts/internal-auth-check.sh /repo/deploy/scripts/internal-auth-check.sh'));
check('cron retains newcomer recovery fallback', cron.includes('/api/dashboard/discord/onboarding/automation'));
check('cron runs newcomer recovery before lower-priority sync', cron.indexOf('call "/api/dashboard/discord/onboarding/automation"') < cron.indexOf('call "/api/guild/sync"'));
check('distributed onboarding lease remains enabled', onboarding.includes('acquireOnboardingLease') && onboarding.includes('releaseOnboardingLease'));
check('default role remains first external lifecycle action', onboarding.indexOf('Lifecycle priority: role first') < onboarding.indexOf('Initial nickname check is informational'));

console.log(`[check-guild-lifecycle] OK — ${checks.length}/${checks.length} bot/site/onboarding integration invariants checked.`);
