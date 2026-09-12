#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const shared = read('src/lib/raidPollShared.ts');
const polls = read('src/lib/raidPolls.ts');
const form = read('src/components/RaidPollCreateClientForm.tsx');
const browser = read('src/components/RaidPollBrowser.tsx');
const actions = read('src/components/RaidPollActions.tsx');
const views = read('src/components/RaidPollViews.tsx');
const lifecycle = read('src/app/api/polls/close-due/route.ts');
const createRoute = read('src/app/api/polls/route.ts');
const cron = fs.readFileSync(path.resolve(root, '..', 'deploy/cron/run-cron.sh'), 'utf8');

const lifecyclePublishIndex = polls.indexOf('const scheduled = await publishDueRaidPolls');
const lifecycleRepeatIndex = polls.indexOf('const repeated = await repeatDueRaidPolls');

const checks = [
  ['scheduled is a first-class poll state', shared.includes('"scheduled" | "open" | "paused" | "closed"')],
  ['create input has an explicit now/scheduled mode', shared.includes('RaidPollPublishMode = "now" | "scheduled"') && shared.includes('publishMode?: unknown')],
  ['scheduled create persists an absolute publish timestamp', polls.includes('scheduledPublishAtMs = publishMode === "scheduled"') && polls.includes('nextWeeklyRepeatMs(now.getTime(), scheduleDay, scheduleTime)')],
  ['nearest future occurrence is allowed even when it is less than one minute away', polls.includes('candidateMs > fromMs') && !polls.includes('candidateMs > fromMs + 60_000')],
  ['scheduled create returns before any Discord publication', polls.includes('if (publishMode === "scheduled") return basePoll;')],
  ['scheduled close timer is anchored to publication rather than creation', polls.includes('const closeBaseMs = scheduledPublishAtMs || now.getTime()')],
  ['first recurring run after a scheduled publish is moved to the following occurrence', polls.includes('nextWeeklyRepeatMs(scheduledPublishAtMs + 60_000, scheduleDay, scheduleTime)')],
  ['due scheduled polls are claimed with a persisted lock before Discord publish', polls.includes('claimScheduledRaidPoll') && polls.includes('scheduledPublishLockId') && polls.includes('scheduledPublishLockedAtMs')],
  ['failed DB commit rolls back an already-created Discord message', polls.includes('Rollback failed scheduled raid poll publish') && polls.includes('markRaidPollPublishFailed')],
  ['failed scheduled publication remains due instead of being moved a week by an unrelated edit', !polls.includes('!previous.scheduledPublishAtMs || previous.scheduledPublishAtMs <= nowMs') && polls.includes('Прострочений timestamp лишається due')],
  ['scheduled publish failures are persisted for admin diagnostics and automatic retry', shared.includes('scheduledPublishLastError?: string | null') && polls.includes('scheduledPublishLastErrorAt: failedAt.toISOString()') && views.includes('Остання спроба публікації не вдалася')],
  ['lifecycle publishes scheduled polls before close/repeat work', lifecyclePublishIndex >= 0 && lifecycleRepeatIndex > lifecyclePublishIndex],
  ['recurrence cannot create a duplicate while the initial poll is still scheduled', polls.includes('if (poll.status === "scheduled" || !poll.autoRepeatWeekly') && polls.includes('if (poll.status === "scheduled" || !poll.repeatNextAtMs')],
  ['manual Discord sync cannot publish a scheduled poll early', polls.includes('Пул заплановано на майбутнє. Discord не синхронізується до часу публікації.')],
  ['canceling a scheduled poll clears its schedule and repeat data', polls.includes('const cancelScheduled = poll.status === "scheduled"') && polls.includes('scheduledPublishAtMs: null') && polls.includes('autoRepeatWeekly: false')],
  ['create UI exposes publish-now and schedule choices', form.includes('Опублікувати зараз') && form.includes('Запланувати') && form.includes('name="publishMode"')],
  ['schedule controls work independently of weekly repeat', form.includes('publishMode === "scheduled" || autoRepeatWeekly')],
  ['scheduled polls have their own list tab and management state', browser.includes('{ key: "scheduled", label: "Заплановані" }') && actions.includes('"scheduled" | "open" | "paused" | "closed"')],
  ['scheduled detail UI shows publication deadline instead of close deadline', views.includes('state === "scheduled" ? "Публікація"') && views.includes('state === "scheduled" ? "До публікації"')],
  ['create API reports scheduled creation separately', createRoute.includes('raid_polls.scheduled') && createRoute.includes('Discord-повідомлення зʼявиться автоматично')],
  ['lifecycle degraded result preserves scheduled counters', lifecycle.includes('scheduledChecked: 0') && lifecycle.includes('scheduledPublished: 0')],
  ['VPS cron forces the five-minute lifecycle tick so cooldown cannot miss an hourly schedule', cron.includes('/api/polls/close-due?force=1')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [name] of failed) console.error(`[check-poll-scheduling:error] ${name}`);
  process.exit(1);
}

console.log(`[check-poll-scheduling] OK — ${checks.length} scheduling/publication invariants checked.`);
