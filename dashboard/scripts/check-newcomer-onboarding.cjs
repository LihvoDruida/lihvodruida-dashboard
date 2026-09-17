const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readRepo = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`[check-newcomer-onboarding] FAIL — ${message}`);
    process.exitCode = 1;
  }
};

const onboarding = read('src/lib/discordNewcomerOnboarding.ts');
const dmApi = read('src/lib/discordAdmin.ts');
const route = read('src/app/api/dashboard/discord/onboarding/automation/route.ts');
const rulesComplete = read('src/app/api/rules/accept/complete/route.ts');
const proxy = read('src/proxy.ts');
const guildPage = read('src/app/guild/page.tsx');
const guildLinks = read('src/lib/discordGuildLinks.ts');
const cron = readRepo('deploy/cron/run-cron.sh');

assert(onboarding.includes('discordNewcomerOnboardingMembers'), 'persistent per-member onboarding state must exist');
assert(onboarding.includes('if (!state.initializedAt)') && onboarding.includes('baseline: true'), 'first scan must establish a baseline instead of messaging existing members');
assert(onboarding.includes('buildRulesAcceptCustomId') && onboarding.includes('custom_id: buildRulesAcceptCustomId(roleIds)') && onboarding.includes('label: "Прийняти правила"'), 'welcome DM must reuse the existing rules interaction contract');
assert(rulesComplete.includes('markDiscordNewcomerRulesAccepted'), 'rules completion must update newcomer onboarding state');
assert(onboarding.includes('nicknameMatchesTemplate') && onboarding.includes('nicknameCheckedAt'), 'nickname must be checked and recorded once in newcomer onboarding');
assert(onboarding.includes('listRulesEmbedMessages') && onboarding.includes('nicknameNewcomerRoleId'), 'role resolution must reuse existing rules/newcomer configuration');
assert(dmApi.includes('components?: unknown[]') && dmApi.includes('body.components = params.components.slice(0, 5)'), 'DM transport must support Discord buttons without changing existing callers');
assert(route.includes('verifyInternalBearerToken') && route.includes('__mistblossomDiscordNewcomerOnboardingInFlight'), 'automation route must be bearer-protected and guarded against overlap');
assert(proxy.includes('pathname === "/api/dashboard/discord/onboarding/automation"'), 'internal Docker host gate must allow the onboarding scheduler route');
assert(cron.includes('call "/api/dashboard/discord/onboarding/automation"'), 'self-hosted cron must scan for newcomers every tick');
assert(guildPage.includes('Що доступно учаснику гільдії') && guildPage.includes('guildGuideGrid'), 'guild panel must expose the quick Discord guide');
for (const id of ['1449768498397057064', '1449767282195562568', '1449767282195562569', '1449768050076291111']) {
  assert(guildLinks.includes(id), `guild Discord quick links must include channel ${id}`);
}

if (!process.exitCode) {
  console.log('[check-newcomer-onboarding] OK — baseline, private welcome, one-time nickname check, rules handoff and guild links verified.');
}
