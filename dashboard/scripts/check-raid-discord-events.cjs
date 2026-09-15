const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const raids = read('src/lib/raids.ts');
const discord = read('src/lib/discordAdmin.ts');
const views = read('src/components/RaidViews.tsx');
const publishRoute = read('src/app/api/raids/publish/route.ts');
const deleteRoute = read('src/app/api/raids/[raidId]/delete/route.ts');
const pkg = JSON.parse(read('package.json'));

let checked = 0;
function ok(condition, label) {
  checked += 1;
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${label}`);
  }
}

ok(raids.includes('discordEventEnabled?: boolean') && raids.includes('discordEventId?: string'), 'raid model stores scheduled-event state');
ok(raids.includes('discordEventDurationMinutes?: number') && raids.includes('DEFAULT_RAID_DISCORD_EVENT_DURATION_MINUTES = 180'), 'raid model stores a bounded event duration');
ok(raids.includes('form.get("discordEventEnabled")') && raids.includes('form.get("discordEventDurationMinutes")'), 'raid form persists scheduled-event settings');
ok(discord.includes('/scheduled-events`') && discord.includes('entity_type: 3') && discord.includes('privacy_level: 2'), 'Discord API creates EXTERNAL guild scheduled events');
ok(discord.includes('scheduled_start_time') && discord.includes('scheduled_end_time') && discord.includes('entity_metadata: { location }'), 'scheduled event has explicit start/end/location');
ok(discord.includes('editDiscordGuildScheduledEvent') && discord.includes('method: "PATCH"'), 'Discord scheduled event can be updated');
ok(discord.includes('deleteDiscordGuildScheduledEvent') && discord.includes('method: "DELETE"'), 'Discord scheduled event can be deleted');
ok(raids.includes('syncRaidDiscordScheduledEvent') && raids.includes('syncRaidDiscordScheduledEvent('), 'publishing a raid also synchronizes its scheduled event');
ok(raids.includes('syncScheduledEvent: false') && raids.includes('options?.syncScheduledEvent === false'), 'background message refreshes do not PATCH scheduled events unnecessarily');
ok(raids.includes('isMissingDiscordScheduledEventError') && raids.includes('Raid scheduled event recreated'), 'missing scheduled event is recreated without duplicating healthy events');
ok(raids.includes('discordEventLastError') && raids.includes('action: "failed"'), 'scheduled-event failure is persisted diagnostically instead of aborting raid publication');
ok(raids.includes('Rollback orphan raid scheduled event') && raids.includes('if (action === "created")'), 'new event is rolled back if its Discord ID cannot be persisted, preventing duplicates');
ok(raids.includes('deleteDiscordGuildScheduledEvent({') && raids.includes('discordEventDeleteFailed'), 'manual raid deletion also cleans up the scheduled event');
ok(views.includes('name="discordEventEnabled"') && views.includes('name="discordEventDurationMinutes"'), 'raid editor exposes scheduled-event controls');
ok(views.includes('Відкрити Discord-подію') && views.includes('discordEventUrl'), 'raid UI exposes the Discord event link');
ok(publishRoute.includes('raids.discord_event.${scheduledEvent.action}') && publishRoute.includes('scheduledEventError'), 'publish route logs scheduled-event synchronization result');
ok(deleteRoute.includes('discordEventDeleteFailed') && deleteRoute.includes('discordCleanupFailed'), 'delete route reports partial Discord cleanup failures');
ok(String(pkg.scripts['build:ci'] || '').includes('check:raid-discord-events'), 'production CI runs the raid scheduled-event regression check');

if (process.exitCode) {
  console.error(`[check-raid-discord-events] FAILED — ${checked} invariant(s) checked.`);
  process.exit(process.exitCode);
}
console.log(`[check-raid-discord-events] OK — ${checked}/${checked}`);
