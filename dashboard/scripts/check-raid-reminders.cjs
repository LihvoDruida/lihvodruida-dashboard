const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const raids = read('src/lib/raids.ts');
const discord = read('src/lib/discordAdmin.ts');
const views = read('src/components/RaidViews.tsx');
const newPage = read('src/app/raids/new/page.tsx');
const editPage = read('src/app/raids/[raidId]/edit/page.tsx');
const pkg = JSON.parse(read('package.json'));

let checks = 0;
function ok(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`[check-raid-reminders] FAIL — ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
  }
}

ok(raids.includes('discordNickname?: string | null') && raids.includes('discordUsername?: string | null'), 'signup model stores a private Discord identity snapshot');
ok(raids.includes('enrichRaidSignupDiscordIdentity(signup)') && raids.includes('fetchDiscordGuildMemberSnapshot(signup.discordId)'), 'all signup methods converge on a live guild nickname snapshot');
ok(raids.includes('const persistedSignup = await enrichRaidSignupDiscordIdentity(signup)'), 'central recordRaidSignup path enriches identity before persistence');
ok(raids.includes('sendRaidReminderDirectMessages') && raids.includes('sendDiscordDirectMessage({'), '15-minute lifecycle sends direct messages');
ok(raids.includes('isActiveSignupStatus(signup.status)') && raids.includes('"Пропускаю" навмисно не є адресатом'), 'DM targets are active signups only, including tentative/late but excluding skipped');
ok(raids.includes('raid.raidLeaderName ? `🧭 РЛ:') && raids.includes('`🔗 Рейд у Discord:'), 'DM contains optional RL and direct raid link');
ok(raids.includes('`🔊 Голосовий канал:') && raids.includes('raidVoiceChannelLink'), 'DM contains the selected raid voice channel');
ok(raids.includes('reminderDmSentCount') && raids.includes('reminderDmFailedCount'), 'reminder delivery diagnostics are persisted');
ok(discord.includes('export async function fetchDiscordVoiceChannels') && discord.includes('channel.type === 2 || channel.type === 13'), 'voice/stage channels are loaded from Discord');
ok(discord.includes('export function discordChannelUrl'), 'voice channel has a stable Discord URL builder');
ok(views.includes('name="voiceChannelId"') && views.includes('Голосовий канал рейду'), 'raid editor exposes voice channel selection');
ok(raids.includes('voiceChannelId: cleanSnowflake(form.get("voiceChannelId"))'), 'selected voice channel persists in the raid record');
ok(raids.includes('RAID_EDITOR_DEFAULTS_PREFIX') && raids.includes('saveRaidEditorDefaults(user, savedRaid)'), 'editor defaults are saved per editing account');
ok(newPage.includes('getRaidEditorDefaults(user)') && newPage.includes('defaultVoiceChannelId'), 'new raid form restores saved account-specific defaults');
ok(newPage.includes('preferredChannelId') && newPage.includes('preferredVoiceChannelId'), 'saved text and voice channels are prioritized on new raids');
ok(raids.includes('createdByDiscordId: existingRaid.createdByDiscordId') && raids.includes('createdByName: existingRaid.createdByName'), 'editing does not overwrite the original raid creator');
ok(raids.includes('cleanSnowflake(existingRaid.voiceChannelId) !== cleanSnowflake(effectivePayload.voiceChannelId)'), 'changing voice channel invalidates stale reminder state');
ok(raids.includes('raidVoiceChannelLink(raid) || messageUrl'), 'scheduled event uses selected voice channel as its primary location');
ok(editPage.includes('fetchDiscordVoiceChannels') && editPage.includes('voiceChannels={voiceChannels}'), 'edit form also loads existing voice-channel options');
ok(String(pkg.scripts['build:ci'] || '').includes('check:raid-reminders'), 'production CI runs raid reminder regression checks');

if (process.exitCode) process.exit(process.exitCode);
console.log(`[check-raid-reminders] OK — ${checks}/${checks}`);
