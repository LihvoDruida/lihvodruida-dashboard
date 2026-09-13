const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
let checked = 0;

function read(relative, base = root) {
  return fs.readFileSync(path.join(base, relative), 'utf8');
}
function assert(condition, message) {
  checked += 1;
  if (!condition) {
    console.error(`[check-account-cleanup] FAIL — ${message}`);
    process.exitCode = 1;
  }
}

const scheduler = read('src/app/api/dashboard/profiles/orphan-cleanup/route.ts');
const settingsLib = read('src/lib/accountCleanupAutomation.ts');
const settingsRoute = read('src/app/api/dashboard/discord/profiles/cleanup-settings/route.ts');
const manualRoute = read('src/app/api/dashboard/discord/profiles/cleanup/route.ts');
const page = read('src/app/dashboard/discord/page.tsx');
const styles = read('src/app/styles/admin.css');
const cron = read('deploy/cron/run-cron.sh', repo);
const discord = read('src/lib/discordAdmin.ts');

assert(scheduler.includes('verifyInternalBearerToken'), 'Scheduler must require an internal bearer token.');
assert(scheduler.includes('getAccountCleanupAutomationSettings'), 'Scheduler must read persisted cleanup settings.');
assert(scheduler.includes('isAccountCleanupDue'), 'Scheduler must calculate due runs from persisted timestamps.');
assert(scheduler.includes('recordAccountCleanupRun'), 'Scheduler must persist automatic run results.');
assert(scheduler.includes('cleanupHasFreshSafetyCheck'), 'Automatic deletion must require a recent successful dry-run.');
assert(scheduler.includes('acquireAccountCleanupExecutionLock'), 'Automatic cleanup must share an execution lock with manual cleanup.');
assert(scheduler.includes('profiles.orphan_cleanup.auto_check_completed'), 'Automatic checks must be logged.');
assert(scheduler.includes('profiles.orphan_cleanup.auto_apply_completed'), 'Automatic cleanup must be logged.');
assert(scheduler.includes('{ category: "action" }'), 'Automatic maintenance events must be persisted in the action log category.');
assert(settingsLib.includes('autoCheckEnabled: true'), 'Safe automatic dry-run checks should default to enabled.');
assert(settingsLib.includes('autoCleanupEnabled: false'), 'Destructive automatic cleanup must default to disabled.');
assert(settingsLib.includes('recentRuns'), 'Cleanup state must retain recent run history.');
assert(settingsRoute.includes('guard.session.isServerOwner'), 'Only the server owner may change automatic cleanup settings.');
assert(settingsRoute.includes('discord.profiles.cleanup_settings_update'), 'Cleanup setting changes must be audited.');
assert(manualRoute.includes('source: "manual"'), 'Manual cleanup runs must be included in the same run history.');
assert(manualRoute.includes('acquireAccountCleanupExecutionLock'), 'Manual cleanup must refuse overlapping automatic cleanup runs.');
assert(page.includes('Зберегти автоматизацію'), 'Discord management UI must expose automation settings.');
assert(page.includes('Історія останніх запусків'), 'Discord management UI must show cleanup run history.');
assert(styles.includes('.account-cleanup-status-grid'), 'Cleanup automation UI must have dedicated responsive layout styles.');
assert(cron.includes('[ $((minute % 15)) -eq 0 ] && call "/api/dashboard/profiles/orphan-cleanup"'), 'Cron must tick the cleanup scheduler every 15 minutes.');
assert(!cron.includes('/api/dashboard/profiles/orphan-cleanup/apply"'), 'Cron must not bypass persisted cleanup settings with the legacy apply endpoint.');

assert(discord.includes('expectedStatuses?: number[]'), 'Discord wrapper must support explicitly expected HTTP statuses');
assert(discord.includes('members/${userId}`, { expectedStatuses: [404] }') && discord.includes('bans/${userId}`, { expectedStatuses: [404] }'), 'member/ban existence checks must classify Discord 404 as expected instead of warning');
assert(discord.includes('discord.api.expected_response') && discord.includes('logDashboardEvent("debug"'), 'expected Discord responses must be debug telemetry, not warning noise');
if (!process.exitCode) console.log(`[check-account-cleanup] OK — ${checked}/${checked} automation, safety, logging and UI invariants checked.`);
