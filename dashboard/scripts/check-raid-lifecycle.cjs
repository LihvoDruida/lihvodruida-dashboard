const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const raids = fs.readFileSync(path.join(root, 'dashboard/src/lib/raids.ts'), 'utf8');
const views = fs.readFileSync(path.join(root, 'dashboard/src/components/RaidViews.tsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'dashboard/src/app/api/raids/lifecycle/route.ts'), 'utf8');
const cron = fs.readFileSync(path.join(root, 'deploy/cron/run-cron.sh'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'dashboard/src/lib/db/schema.sql'), 'utf8');
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
ok(raids.includes('status: "closed"') && raids.includes('closedReason: "auto"'), 'automatic close must persist closed state');
ok(raids.includes('reminderChannelId?: string | null') && raids.includes('reminderMessageId?: string | null'), 'raid records must persist reminder message identity');
ok(raids.includes('reminderScheduleChanged') && raids.includes('remove stale reminder'), 'editing raid date/time/channel must invalidate an already-sent stale reminder');
ok(raids.includes('discordCloseSyncedAt') && raids.includes('will retry'), 'closed raids must retain Discord close retry state');
ok(raids.includes('disabled: activeJoinDisabled') && views.includes('const skipDisabled = closed || registrationLocked'), 'all signup buttons, including skip, must disable at registration close');
ok(raids.includes('Запис закрито') && !raids.includes('RAID_DISCORD_DELETE_AFTER_CLOSE_MINUTES'), 'closed UI must say signup is closed and old close-relative deletion must be gone');

ok(raids.includes('RAID_LIFECYCLE_TASK_COLLECTION = "dashboardRaidLifecycleTasks"'), 'raid lifecycle must use a dedicated per-record task collection');
ok(raids.includes('type RaidLifecycleTaskType =') && raids.includes('"registration_close"') && raids.includes('"discord_delete"'), 'task queue must model explicit lifecycle actions');
ok(raids.includes('scheduledAtMs: number') && raids.includes('dueAtMs: number'), 'each lifecycle task must persist its exact logical schedule and next execution time');
ok(raids.includes('raidLifecycleTaskPlan(raid: RaidItem)'), 'each raid must have a deterministic task plan');
ok(raids.includes('type: "registration_close"') && raids.includes('scheduledAtMs: registrationCloseAtMs'), 'registration close must be a concrete task at the exact signup deadline');
ok(raids.includes('type: "reminder_send"') && raids.includes('scheduledAtMs: reminderAtMs'), 'reminder send must have its own concrete deadline');
ok(raids.includes('type: "reminder_delete"') && raids.includes('RAID_REMINDER_DELETE_AFTER_START_HOURS'), 'reminder cleanup must have its own task');
ok(raids.includes('type: "discord_delete"') && raids.includes('RAID_DISCORD_MESSAGE_RETENTION_HOURS'), 'primary Discord cleanup must have its own task');
ok(raids.includes('type: "discord_close_sync"') && raids.includes('!raid.discordCloseSyncedAt'), 'Discord button disable retry must be represented by a separate task');
ok(raids.includes('.where("dueAtMs", "<=", nowMs)') && raids.includes('.orderBy("dueAtMs", "asc")'), 'normal lifecycle ticks must query only due tasks ordered by deadline');
ok(schema.includes("documents_due_at_idx") && schema.includes("data ->> 'dueAtMs'"), 'PostgreSQL document store must index lifecycle dueAtMs');
ok(raids.includes('claimRaidLifecycleTask') && raids.includes('RAID_LIFECYCLE_TASK_LOCK_MS'), 'due tasks must be claimed with a persisted lock before execution');
ok(raids.includes('releaseRaidLifecycleTaskWithError') && raids.includes('raidLifecycleRetryDelayMs'), 'failed per-record tasks must be retried with bounded backoff');
ok(raids.includes('completeRaidLifecycleTask') && raids.includes('transaction.delete(ref)'), 'completed tasks must be removed independently');
ok(raids.includes('reconcileRaidLifecycleTasksForRaid(savedRaid)'), 'saving/editing a raid must rebuild only that raid task plan');
ok(raids.includes('reconcileRaidLifecycleTasksForRaid(publishedRaid)'), 'publishing a raid must build its concrete lifecycle tasks');
ok(raids.includes('deleteRaidLifecycleTasks(raid.id)'), 'deleting a raid must remove its queued tasks');
ok(raids.includes('scheduleRaidAutoCloseSync(raid, "discord-action-deadline")') && !raids.includes('const lifecycle = await syncRaidLifecycleAfterRead(raid)'), 'Discord button clicks must not execute lifecycle side effects; they only ensure tasks');
ok(raids.includes('Reads/interactions no longer execute lifecycle side effects themselves'), 'read path must explicitly remain separate from lifecycle execution');
ok(raids.includes('RaidLifecycleScanMode = "tasks" | "recovery"'), 'runtime lifecycle must distinguish task processing from recovery reconciliation');
ok(route.includes('syncRaidLifecycleBatch(limit, { fullSweep })') && route.includes('1, 100'), 'lifecycle route must support bounded recovery and up to 100 per-record tasks');
ok(cron.includes('call "/api/raids/lifecycle?sweep=1&limit=100"') && cron.indexOf('call "/api/raids/lifecycle?sweep=1&limit=100"') < cron.indexOf('last_tick=""'), 'cron startup must immediately recover task plans before waiting for an hourly sweep');
ok(/\n\s*call "\/api\/raids\/lifecycle"\n/.test(cron), 'cron must process due raid tasks every minute');
ok(cron.includes('dueAtMs') && cron.includes('task queue'), 'cron documentation must describe the per-record due task model');
ok(cron.includes('last_tick=""') && cron.includes('current_tick=$(date -u'), 'cron loop must catch up immediately when a slow task crosses a minute boundary');
const lifecycleCallIndex = cron.indexOf('call "/api/raids/lifecycle');
const guildSyncCallIndex = cron.indexOf('call "/api/guild/sync"');
ok(lifecycleCallIndex >= 0 && guildSyncCallIndex >= 0 && lifecycleCallIndex < guildSyncCallIndex, 'time-critical raid lifecycle must run before guild sync');
ok(pkg.scripts['check:raid-lifecycle'] === 'node scripts/check-raid-lifecycle.cjs', 'package scripts must expose raid lifecycle regression check');
ok(pkg.scripts['build:ci']?.includes('check:raid-lifecycle'), 'build:ci must run raid lifecycle regression check');

if (process.exitCode) process.exit(process.exitCode);
console.log(`[check-raid-lifecycle] OK — ${checks}/${checks} lifecycle invariants checked.`);
