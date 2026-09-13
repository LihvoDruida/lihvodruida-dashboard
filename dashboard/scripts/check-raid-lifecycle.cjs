const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const raids = fs.readFileSync(path.join(root, 'dashboard/src/lib/raids.ts'), 'utf8');
const views = fs.readFileSync(path.join(root, 'dashboard/src/components/RaidViews.tsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'dashboard/src/app/api/raids/lifecycle/route.ts'), 'utf8');
const cron = fs.readFileSync(path.join(root, 'deploy/cron/run-cron.sh'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'dashboard/package.json'), 'utf8'));
let checks = 0;
function ok(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`[check-raid-lifecycle] FAIL — ${message}`);
    process.exitCode = 1;
  }
}

ok(raids.includes('RAID_REMINDER_BEFORE_START_MINUTES = 15'), 'raid reminder must be scheduled 15 minutes before start');
ok(raids.includes('RAID_REMINDER_DELETE_AFTER_START_HOURS = 4'), 'reminder must be deleted 4 hours after start');
ok(raids.includes('RAID_DISCORD_MESSAGE_RETENTION_HOURS = 24'), 'primary Discord raid message must stay 24 hours after start');
ok(raids.includes('return startsAt - (minutesBefore || 0) * 60 * 1000'), 'registration deadline must fall back to raid start when no pre-close setting is enabled');
ok(raids.includes('status: "closed"') && raids.includes('closedReason: "auto"'), 'lifecycle must persist automatic closed status');
ok(raids.includes('reminderChannelId?: string | null') && raids.includes('reminderMessageId?: string | null'), 'raid records must persist reminder message identity');
ok(raids.includes('syncRaidReminder(lifecycleRaid)') && raids.includes('syncRaidReminderDeletion(reminderRaid)'), 'single lifecycle pass must send and clean reminders');
ok(raids.includes('reminderScheduleChanged') && raids.includes('remove stale reminder'), 'editing raid date/time/channel must invalidate an already-sent stale reminder');
ok(raids.includes('syncRaidDiscordDeletionAfterStart(lifecycleRaid)'), 'single lifecycle pass must clean the primary Discord message');
ok(raids.includes('disabled: activeJoinDisabled') && views.includes('const skipDisabled = closed || registrationLocked'), 'all signup buttons, including skip, must disable at registration close');
ok(raids.includes('Запис закрито') && !raids.includes('RAID_DISCORD_DELETE_AFTER_CLOSE_MINUTES'), 'closed UI must say signup is closed and old close-relative deletion must be gone');
ok(route.includes('export async function POST') && route.includes('return GET(request)'), 'cron POST must be handled by raid lifecycle route');
ok(route.includes('const fallback = eco ? 60_000 : 45_000'), 'lifecycle route must allow minute-level scheduling');
ok(raids.includes('RaidLifecycleScanMode = "window" | "sweep"') && raids.includes('.where("date", ">=", fromDate)') && raids.includes('.where("date", "<=", toDate)'), 'minute lifecycle scans must use a bounded indexed date window');
ok(route.includes('wantsFullSweep') && route.includes('syncRaidLifecycleBatch(limit, { fullSweep })'), 'lifecycle route must support explicit recovery sweeps');
ok(cron.includes('/api/raids/lifecycle?sweep=1&limit=100'), 'cron must run a bounded full lifecycle recovery sweep hourly');
ok(/\n\s*call "\/api\/raids\/lifecycle"\n/.test(cron), 'cron must execute raid lifecycle every minute');
ok(!cron.includes('minute % 10)) -eq 0 ] && call "/api/raids/lifecycle"'), 'old 10-minute raid lifecycle cadence must be removed');
ok(pkg.scripts['check:raid-lifecycle'] === 'node scripts/check-raid-lifecycle.cjs', 'package scripts must expose raid lifecycle regression check');
ok(pkg.scripts['build:ci']?.includes('check:raid-lifecycle'), 'build:ci must run raid lifecycle regression check');

if (process.exitCode) process.exit(process.exitCode);
console.log(`[check-raid-lifecycle] OK — ${checks}/${checks} lifecycle invariants checked.`);
