const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const admin = read('src/lib/discordAdmin.ts');
const card = read('src/lib/discordWelcomeCard.ts');
const settings = read('src/lib/discordWelcomeCardSettings.ts');
const onboarding = read('src/lib/discordNewcomerOnboarding.ts');
const page = read('src/app/dashboard/server/page.tsx');
const route = read('src/app/api/dashboard/server/discord-welcome-card/route.ts');

const checks = [
  ['night-elf background asset exists', exists('public/assets/discord-welcome-card-night-elf-base.png')],
  ['multipart upload copies Buffer into ArrayBuffer-backed Uint8Array', admin.includes('const fileBytes = Uint8Array.from(params.fileBuffer)') && admin.includes('new Blob([fileBytes]')],
  ['card renderer supports local and standalone public layouts', card.includes('path.join(process.cwd(), "public", "assets"') && card.includes('path.join(process.cwd(), "dashboard", "public", "assets"')],
  ['card contains avatar, greeting and Murloc/member label rendering', card.includes('circleAvatar') && card.includes('settings.labelPrefix') && card.includes('renderDiscordWelcomeCard')],
  ['welcome settings persist enable time to prevent historical backfill', settings.includes('enabledAt') && settings.includes('current.enabled ? current.enabledAt || now : now')],
  ['channel welcome is integrated into newcomer automation', onboarding.includes('sendChannelWelcome') && onboarding.includes('channelWelcomeEligible') && onboarding.includes('channelWelcomeSentAt')],
  ['disabled/old members are marked handled instead of retried forever', onboarding.includes('channelWelcomeSkippedAt') && onboarding.includes('record.channelWelcomeSkippedAt = now')],
  ['owner-only settings page exposes channel/text/greetings controls', page.includes('welcomeCardSettings') && page.includes('name="channelId"') && page.includes('name="greetings"')],
  ['settings API is server-owner only', route.includes('!guard.session.isServerOwner') && route.includes('setDiscordWelcomeCardSettings')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`[check-discord-welcome-card] failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-discord-welcome-card] OK — ${checks.length}/${checks.length}`);
