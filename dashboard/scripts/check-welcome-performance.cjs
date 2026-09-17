const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const onboarding = read('src/lib/discordNewcomerOnboarding.ts');
const card = read('src/lib/discordWelcomeCard.ts');
const admin = read('src/lib/discordAdmin.ts');
const testing = read('src/lib/discordWelcomeCardTesting.ts');
const preview = read('src/app/api/dashboard/welcome-card/preview/route.ts');

const checks = [
  ['Firestore state reads fail closed', !onboarding.includes('get().catch(() => null)') && !onboarding.includes('getAll(...refs).catch(() => [])')],
  ['missing Firestore documents are not normalized as existing members', onboarding.includes('doc.exists === false')],
  ['cross-run onboarding record cache exists', onboarding.includes('__mistblossomOnboardingRecordCache') && onboarding.includes('RECORD_CACHE_TTL_MS')],
  ['record cache is invalidated across dashboard processes', onboarding.includes('recordVersion') && onboarding.includes('cache.version === expectedVersion')],
  ['distributed Firestore lease prevents cross-instance duplicate runs', onboarding.includes('acquireOnboardingLease') && onboarding.includes('leaseUntilMs') && onboarding.includes('releaseOnboardingLease')],
  ['onboarding work uses bounded adaptive concurrency', onboarding.includes('mapConcurrent(') && onboarding.includes('DISCORD_ONBOARDING_CONCURRENCY')],
  ['onboarding burst size is configurable and bounded', onboarding.includes('DISCORD_ONBOARDING_BATCH_LIMIT') && onboarding.includes('Math.min(max, Math.floor(parsed))')],
  ['only processed newcomer records are persisted each normal run', onboarding.includes('await writeRecord(record)') && !onboarding.includes('for (const member of members) {\n    if (currentIds.has(member.userId)) continue;')],
  ['onboarding exports runtime/cache metrics', onboarding.includes('durationMs') && onboarding.includes('recordCacheHits') && onboarding.includes('recordDbReads')],
  ['role hierarchy lookup uses short cache', onboarding.includes('fetchDiscordRoleControlSnapshotCachedForUi(120_000)')],
  ['card renderer uses Discord-efficient 1280x720 source', card.includes('WELCOME_CARD_WIDTH = 1280') && card.includes('WELCOME_CARD_HEIGHT = 720')],
  ['static background resize/glow is precomputed once', card.includes('__mistblossomWelcomeBackgroundPromise') && card.includes('.composite([{ input: GLOW_SVG }])')],
  ['avatar fetches are promise-deduplicated and bounded', card.includes('promise: Promise<Buffer>') && card.includes('AVATAR_CACHE_MAX = 128')],
  ['render requests are promise-deduplicated and bounded', card.includes('__mistblossomWelcomeRenderCache') && card.includes('RENDER_CACHE_MAX = 8')],
  ['heavy Sharp composites use a global bounded semaphore', card.includes('__mistblossomWelcomeRenderActive') && card.includes('WELCOME_CARD_RENDER_CONCURRENCY') && card.includes('withRenderSlot')],
  ['avatar is composited directly after local circular mask', card.includes('{ input: avatarPng, top: AVATAR_TOP_Y') && !card.includes('{ input: avatarLayer }')],
  ['old undefined avatarLayer renderer bug is absent', !card.includes('{ input: avatarLayer },') && !card.includes('async function buildAvatarLayer')],
  ['final PNG still has 16px rounded corners', card.includes('CARD_RADIUS = 16') && card.includes('blend: "dest-in"')],
  ['test-member lookup is short-lived and promise-deduplicated', testing.includes('__mistblossomWelcomeTestMemberCache') && testing.includes('fetchCachedTestMember')],
  ['owner preview endpoint has CPU-abuse rate limiting', preview.includes('checkRateLimit') && preview.includes('welcome-preview:')],
  ['Discord transport proactively observes bucket limits', admin.includes('observeDiscordRateLimit') && admin.includes('x-ratelimit-remaining')],
  ['Discord transport handles global rate limits', admin.includes('__mistblossomDiscordGlobalCooldownUntil') && admin.includes('json?.global === true')],
  ['Discord cooldown waits until deadline instead of sleeping only once', admin.includes('for (;;)') && admin.includes('Math.max(routeUntil, globalUntil)')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`[check-welcome-performance] failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-welcome-performance] OK — ${checks.length}/${checks.length}`);
