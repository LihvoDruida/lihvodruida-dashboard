const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const admin = read('src/lib/discordAdmin.ts');
const card = read('src/lib/discordWelcomeCard.ts');
const artifact = read('src/lib/discordWelcomeArtifact.ts');
const joinNumber = read('src/lib/discordMemberJoinNumber.ts');
const testing = read('src/lib/discordWelcomeCardTesting.ts');
const settings = read('src/lib/discordWelcomeCardSettings.ts');
const onboarding = read('src/lib/discordNewcomerOnboarding.ts');
const tabs = read('src/components/AdminTabs.tsx');
const page = read('src/app/dashboard/welcome/page.tsx');
const settingsRoute = read('src/app/api/dashboard/welcome-card/settings/route.ts');
const previewRoute = read('src/app/api/dashboard/welcome-card/preview/route.ts');
const publishRoute = read('src/app/api/dashboard/welcome-card/publish-test/route.ts');
const serverPage = read('src/app/dashboard/server/page.tsx');

const checks = [
  ['night-elf background asset exists', exists('public/assets/discord-welcome-card-night-elf-base.png')],
  ['multipart upload copies Buffer into ArrayBuffer-backed Uint8Array', admin.includes('const fileBytes = Uint8Array.from(params.fileBuffer)') && admin.includes('new Blob([fileBytes]')],
  ['Discord attachment content preserves line breaks', admin.includes('.replace(/\\r\\n/g, "\\n")') && admin.includes('.slice(0, 1800)')],
  ['multipart Discord upload has timeout/rate-limit retry handling', admin.includes('waitForDiscordCooldown(routeKey)') && admin.includes('discordRetryAfterMs(response, json, attempt)') && admin.includes('AbortController')],
  ['all card consumers share one server artifact pipeline', artifact.includes('createDiscordWelcomeArtifact') && onboarding.includes('createDiscordWelcomeArtifact') && previewRoute.includes('createDiscordWelcomeArtifact') && publishRoute.includes('createDiscordWelcomeArtifact')],
  ['card renderer caches preprocessed background', card.includes('__mistblossomWelcomeBackgroundPromise') && card.includes('.raw()') && card.includes('loadPreparedBackground')],
  ['card renderer caches avatar circles with bounded TTL/cache size', card.includes('__mistblossomWelcomeAvatarCache') && card.includes('AVATAR_CACHE_TTL_MS') && card.includes('AVATAR_CACHE_MAX')],
  ['card renderer supports local and standalone public layouts', card.includes('path.join(process.cwd(), "public", "assets"') && card.includes('path.join(process.cwd(), "dashboard", "public", "assets"')],
  ['card number is the real server join-order position, not a hash', !card.includes('function welcomeNumber') && !/% 9000/.test(card) && artifact.includes('resolveDiscordMemberJoinNumber(member)')],
  ['join number counts bots like Discord member counter and orders by joined_at then snowflake', joinNumber.includes('/members?limit=${PAGE_SIZE}&after=${after}') && !joinNumber.includes('user.bot') && joinNumber.includes('compareSnowflakes') && joinNumber.includes('joinedAtMs')],
  ['join timeline is cached, promise-deduplicated and refresh-bounded for join bursts', joinNumber.includes('TIMELINE_TTL_MS') && joinNumber.includes('TIMELINE_MIN_REFRESH_MS') && joinNumber.includes('cache.promise') && joinNumber.includes('mustContainUserId')],
  ['burst joins are provisionally inserted to avoid duplicate member numbers between refreshes', joinNumber.includes('timeline.entries.set(userId, target)') && joinNumber.includes('The next real refresh replaces provisional data')],
  ['test lab number defaults to the real join number', !testing.includes('|| "4086"') && !page.includes('|| "4086"') && page.includes('resolveDiscordMemberJoinNumber')],
  ['bundled WoW-style OFL fonts ship with licenses', ['SpectralSC-Bold.ttf', 'SpectralSC-ExtraBold.ttf', 'Philosopher-Bold.ttf', 'OFL-SpectralSC.txt', 'OFL-Philosopher.txt'].every((file) => exists(`assets/fonts/welcome/${file}`))],
  ['runtime image copies welcome fonts next to the standalone server', read('Dockerfile').includes('/repo/dashboard/assets/fonts/welcome ./dashboard/assets/fonts/welcome')],
  ['card text uses bundled fontfile with DejaVu fallback', card.includes('fontfile: font.fontfile') && card.includes('fallbackFamily') && card.includes('discord.welcome_card_fonts_missing')],
  ['card text has readability layers (scrim, outline, shadow) and autofit', card.includes('id="scrim"') && card.includes('strokeMask') && card.includes('shadowMask') && card.includes('style.minSize')],
  ['card text layers never rely on dilate/erode semantics', !/\.(dilate|erode)\(/.test(card)],
  ['single-band mask steps pin b-w colourspace', (card.match(/toColourspace\("b-w"\)/g) || []).length >= 4],
  ['static frame, divider and rounded mask are baked into prepared background', card.includes('{ input: FRAME_SVG },') && card.includes('{ input: ROUNDED_MASK_SVG, blend: "dest-in" },') && !card.includes('{ input: textSvg(')],
  ['user text is escaped before Pango markup', card.includes('text: escapeXml(text)')],
  ['card renderer supports server-side test overrides', card.includes('greetingOverride') && card.includes('numberOverride')],
  ['Sharp composite typing does not depend on an unavailable sharp namespace', !card.includes('sharp.OverlayOptions') && card.includes('type CompositeLayer =') && card.includes('const layers: CompositeLayer[]')],
  ['final generated PNG has 16px rounded corners', card.includes('const CARD_RADIUS = 16') && card.includes('ROUNDED_MASK_SVG') && card.includes('blend: "dest-in"')],
  ['welcome settings persist enable time and default newcomer role activation time', settings.includes('enabledAt') && settings.includes('defaultRoleId') && settings.includes('defaultRoleConfiguredAt')],
  ['channel welcome is integrated into newcomer automation', onboarding.includes('sendChannelWelcome') && onboarding.includes('channelWelcomeEligible') && onboarding.includes('channelWelcomeSentAt')],
  ['default role has isolated assignment state and retry', onboarding.includes('defaultRoleAssignedAt') && onboarding.includes('defaultRoleDue') && onboarding.includes('addGuildMemberRoles')],
  ['rejoin resets per-join welcome state instead of suppressing a second join', onboarding.includes('isRejoin') && onboarding.includes('workingRecord') && onboarding.includes('baselineRecord(member, now, settings)')],
  ['nickname is checked only when the per-join record has no previous check', onboarding.includes('if (!record.nicknameCheckedAt)')],
  ['public card/default role work even if rules role lookup is broken', onboarding.includes('needsPrivateContext') && !onboarding.includes('if (newcomers.length && !roleIds.length)')],
  ['welcome is a separate owner-only admin tab/page', tabs.includes('href: "/dashboard/welcome"') && page.includes('!user.isServerOwner') && !serverPage.includes('welcomeCardSettings')],
  ['settings page exposes channel/text/greetings/default role', page.includes('name="channelId"') && page.includes('name="greetings"') && page.includes('name="defaultRoleId"')],
  ['test lab validates nickname with shared guild validator', page.includes('explainNicknameValidation') && page.includes('name="testNickname"')],
  ['welcome page avoids duplicate Discord member lookup before preview image request', page.includes('buildDiscordWelcomeCardTestMember') && !page.includes('resolveDiscordWelcomeCardTestMember')],
  ['welcome page uses short-lived role-control UI cache', page.includes('fetchDiscordRoleControlSnapshotCachedForUi') && admin.includes('__mistblossomDiscordRoleControlUiCache')],
  ['preview is generated by an owner-only server API route', previewRoute.includes('createDiscordWelcomeArtifact') && previewRoute.includes('!session.isServerOwner') && previewRoute.includes('Uint8Array.from(artifact.buffer)')],
  ['test data can resolve a real Discord member without mutating it', testing.includes('fetchDiscordGuildMemberSnapshot') && testing.includes('resolveDiscordWelcomeCardTestMember')],
  ['generated Discord text uses the shared server artifact formatter', page.includes('buildDiscordWelcomeContent') && artifact.includes('renderDiscordWelcomeMessageTemplate')],
  ['test publish is owner-only and sends the shared generated PNG attachment', publishRoute.includes('!guard.session.isServerOwner') && publishRoute.includes('sendDiscordChannelMessageWithAttachment') && publishRoute.includes('createDiscordWelcomeArtifact')],
  ['test publish validates the selected text channel', publishRoute.includes('fetchDiscordTextChannels') && publishRoute.includes('channels.channels.some')],
  ['test publish does not call onboarding/default role mutation', !publishRoute.includes('addGuildMemberRoles') && !publishRoute.includes('markDiscordNewcomer')],
  ['settings API validates channel and default role manageability', settingsRoute.includes('fetchDiscordTextChannels') && settingsRoute.includes('fetchDiscordRoleControlSnapshot') && settingsRoute.includes('manageableRoles.some')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`[check-discord-welcome-card] failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-discord-welcome-card] OK — ${checks.length}/${checks.length}`);
