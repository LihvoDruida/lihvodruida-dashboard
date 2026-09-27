const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
const read = (file, base = root) => fs.readFileSync(path.join(base, file), 'utf8');
const exists = (file, base = root) => fs.existsSync(path.join(base, file));
let checked = 0;
function assert(ok, message) {
  checked += 1;
  if (!ok) {
    console.error(`[check-nickname-warnings] FAIL — ${message}`);
    process.exitCode = 1;
  }
}

const page = read('src/app/dashboard/discord/page.tsx');
const policy = read('src/lib/guildNicknamePolicy.ts');
const warnings = read('src/lib/discordNicknameWarnings.ts');
const discord = read('src/lib/discordAdmin.ts');
const notify = read('src/app/api/dashboard/discord/nicknames/notify/route.ts');
const automation = read('src/app/api/dashboard/discord/nicknames/automation/route.ts');
const inspect = read('src/app/api/dashboard/discord/nicknames/inspect/route.ts');
const testMessage = read('src/app/api/dashboard/discord/nicknames/test-message/route.ts');
const enhancer = read('src/components/DashboardFormEnhancer.tsx');
const cron = read('deploy/cron/run-cron.sh', repo);
const css = read('src/app/styles/admin.css');
const management = read('src/lib/discordMemberManagement.ts');
const proxy = read('src/proxy.ts');
const legacyCleanup = read('scripts/cleanup-legacy.cjs');
const interactionRoute = read('src/app/api/discord/interactions/route.ts');
const nicknameGatewayRoute = read('src/app/api/internal/discord/member-nickname/route.ts');
const sharedContract = read('shared/index.mjs', repo);
const botGateway = read('bot/src/gateway.mjs', repo);
const botClient = read('bot/src/dashboardClient.mjs', repo);

assert(!exists('src/app/api/dashboard/discord/nicknames/cleanup/route.ts'), 'legacy role-changing nickname cleanup route must be removed');
assert(legacyCleanup.includes('src/app/api/dashboard/discord/nicknames/cleanup'), 'legacy cleanup must delete stale nickname cleanup routes left by archive-over-archive deploys');
assert(!management.includes('removeRolesFromMembersWithInvalidNicknames'), 'nickname mismatch must no longer mutate Discord roles');
assert(!policy.includes('roleRemoveConcurrency') && !page.includes('Авто зняття ролей'), 'legacy automatic role-removal controls must be removed completely');
assert(page.includes('нік бот змінює лише після особистого натискання учасником кнопки'), 'UI must state that nickname changes are opt-in through the member button');
assert(page.includes('action="/api/dashboard/discord/nicknames/notify"'), 'manual warning action must exist');
assert(policy.includes('VALID_NICKNAME_STRUCTURES') && policy.includes('"{name} [{main}]"') && policy.includes('"{name} [{main}, {alt}]"') && policy.includes('"{name} [{main}, {alt}, {alt}]"'), 'exactly three global nickname structures must be defined centrally');
assert(policy.includes('const template = DEFAULT_NICKNAME_TEMPLATE;') && policy.includes('Глобальна валідація завжди приймає рівно сімейство'), 'nickname matching must use one global 1-3 character structure family regardless of stored legacy template');
assert(page.includes('Три дозволені структури') && page.includes('VALID_NICKNAME_STRUCTURES.map'), 'Discord settings UI must show the fixed global structures instead of an arbitrary template editor');
assert(management.includes('nicknameMatchesTemplate(nickname, policy.template)') && management.includes('Нік має відповідати одній із глобальних структур'), 'manual Discord nickname changes must enforce the same global structures');
assert(page.includes('/api/dashboard/discord/nicknames/test-message') && page.includes('Надіслати тест у DM'), 'owner UI must expose a private nickname-warning test button');
assert(testMessage.includes('guard.session.isServerOwner') && testMessage.includes('sendNicknameWarningTestToOwner'), 'test-message route must be owner-only and send the real warning test');
assert(warnings.includes('buildNicknameWarningMessage') && warnings.includes('testMode?: boolean') && warnings.includes('sendNicknameWarningTestToOwner'), 'test DM must reuse the production warning message builder without touching warning state');
assert(policy.includes('explainNicknameValidation') && policy.includes('Помилка в частині імені') && policy.includes('порожнє значення біля коми'), 'nickname validation must explain the exact invalid segment instead of returning only true/false');
assert(warnings.includes('👋 **Привіт!**') && warnings.includes('Discord-сервера **${safeGuildName}**'), 'private warning must greet the member and identify the Discord server');
assert(warnings.includes('### Що саме не так') && warnings.includes('explainNicknameValidation(input.nickname)'), 'private warning must include a concrete validation diagnosis');
assert(warnings.includes('Автоматична перевірка') && warnings.includes('Ручний запуск перевірки адміністратором'), 'warning text must accurately identify automatic versus manual checks');
assert(warnings.includes('### Наступна перевірка') && warnings.includes('Europe/Kyiv') && warnings.includes('automationEnabled'), 'warning text must show the real next-check schedule in Kyiv time and handle disabled automation');
assert(page.includes('nickname-policy-card') && page.includes('nickname-warning-metric') && page.includes('nickname-warning-actions'), 'Discord nickname UI must use the compact structured settings/status layout');
assert(warnings.includes('### Валідні формати') && warnings.includes('Імʼя [Мейн, Альт1, Альт2]'), 'warning text must explain all globally valid nickname structures');
assert(policy.includes('suggestNicknameFromObservedText') && policy.includes('Круглі дужки з персонажами більше не є частиною стандарту'), 'legacy parenthesized character notation must be rejected and normalized from observed text');
assert(warnings.includes('buildNicknameFixCustomId') && warnings.includes('label: "Виправити нік"'), 'nickname warning must include an opt-in fix button when a safe recommendation exists');
assert(warnings.includes('suggestedNickname(member.userId, policy.template, nickname)'), 'warning recommendation must prefer the observed malformed nickname before profile fallback');
assert(discord.includes('components?: unknown[]') && discord.includes('sendDiscordChannelUserWarning'), 'fallback channel warnings must preserve interaction components');
assert(interactionRoute.includes('decodeNicknameFixCustomId') && interactionRoute.includes('applyRecommendedNicknameFix'), 'Discord interaction route must handle nickname-fix buttons');
assert(interactionRoute.includes('userId !== nicknameFixAction.userId'), 'nickname fix button must be bound to the warned Discord user');
assert(sharedContract.includes('NICKNAME: "nickname"') && sharedContract.includes('buildNicknameFixCustomId'), 'bot/dashboard shared contract must route nickname-fix interactions');
assert(botGateway.includes('GUILD_MEMBER_UPDATE') && botGateway.includes('enqueueNicknameCheck'), 'Discord Gateway must detect member nickname changes immediately');
assert(botClient.includes('/api/internal/discord/member-nickname'), 'bot gateway must forward nickname changes to the dashboard');
assert(nicknameGatewayRoute.includes('processObservedNicknameMember') && nicknameGatewayRoute.includes('verifyInternalBearerToken'), 'gateway nickname endpoint must be authenticated and run the production warning path');
assert(warnings.includes('processObservedNicknameMember') && warnings.includes('applyRecommendedNicknameFix'), 'nickname warning service must support immediate detection and button-driven correction');
assert(automation.includes('immediatePriority') && warnings.includes('invalidDueNow: true'), 'full sweeps must make new invalid nicknames immediately eligible for bounded priority delivery');
assert(automation.includes('const priorityDelivery = immediatePriority.skipped') && automation.includes('Пріоритетну розсилку пропущено'), 'full-sweep immediate delivery must narrow skipped priority results before reading delivery metrics');
assert(page.includes('fallback-канал') && page.includes('nicknameReminderChannelId'), 'owner can choose a fallback Discord channel');
assert(page.includes('nicknameReminderCooldownHours') && page.includes('nicknameReminderBatchLimit'), 'cooldown and per-run batch controls must be exposed');
assert(policy.includes('nicknameReminderEnabled') && policy.includes('nicknameInvalidRecheckHours') && policy.includes('nicknameValidRecheckHours'), 'priority and full-sweep nickname intervals must be persisted');

assert(page.includes('name="nicknameInvalidRecheckHours"') && page.includes('name="nicknameValidRecheckHours"'), 'UI must expose separate frequent-invalid and rare-valid recheck intervals');
assert(page.includes('name="recheckAll"') && page.includes('Переперевірити всіх'), 'UI must provide an explicit full recheck that rebuilds priority state');
assert(warnings.includes('checkStatus: NicknameCheckStatus') && warnings.includes('nextCheckAtMs'), 'per-member nickname state must persist validity and next-check scheduling');
assert(warnings.includes('.where("checkStatus", "==", "invalid")'), 'automatic priority queue must query only known invalid nicknames');
assert(warnings.includes('nicknameInvalidRecheckHours') && warnings.includes('nicknameValidRecheckHours'), 'member scheduler must assign different intervals to invalid and valid nicknames');
assert(warnings.includes('persistFullNicknameCheckSnapshot') && warnings.includes('cleanupMissing: true'), 'full recheck must rebuild the queue and remove stale Discord members');
assert(warnings.includes('processPriorityNicknameWarnings') && warnings.includes('fetchDiscordGuildMemberSnapshot(target.userId)'), 'priority runs must re-read only due invalid members individually');
assert(warnings.includes('loadStoredWarningStates') && warnings.includes('storedWarningOnCooldown'), 'full sweeps must load cooldown state in bulk instead of repeating one database read per invalid member');
assert(warnings.includes('deliverNicknameWarning(fresh, policy, { ...input, force: true, guildName'), 'full-sweep delivery must reuse the already-computed cooldown decision and one shared guild snapshot');
assert(warnings.includes('status: "missing" as const') && warnings.includes('deleteMemberCheckRecords'), 'members that left Discord must be removed from the priority queue');
assert(automation.includes('nicknameFullScanDue') && automation.includes('processFullNicknameSweep') && automation.includes('processPriorityNicknameWarnings'), 'automatic route must choose between scan-only rare full sweeps and frequent priority runs');
assert(!automation.includes('sendNicknameWarnings({ limit: 0'), 'automatic full sweeps must classify members without triggering a mass warning burst');
assert(warnings.includes('processFullNicknameSweep') && warnings.includes('Чергу перебудовано без масової розсилки'), 'full sweep must rebuild scheduler state without sending warnings');
assert(!automation.includes('nicknameWarningDue(state.lastRunAt'), 'automatic route must not gate all nickname work behind one global interval');
assert(inspect.includes('acquireNicknameWarningExecution') && inspect.includes('recheckAll ? 0'), 'manual full recheck must share the execution lock and force a complete server scan');
assert(warnings.includes('sendDiscordDirectMessage') && warnings.includes('sendDiscordChannelUserWarning'), 'delivery must try DM and support channel fallback');
assert(warnings.indexOf('await sendDiscordDirectMessage') < warnings.indexOf('await sendDiscordChannelUserWarning'), 'DM must be attempted before public fallback');
assert(warnings.includes('recentMemberWarning') && warnings.includes('nicknameReminderCooldownHours'), 'per-member cooldown must prevent spam');
assert(warnings.includes('eligibleMembers.slice') && warnings.includes('deferredByBatch'), 'batch limit must apply after cooldown filtering so later members are not starved');
assert(warnings.includes('buildProfileDiscordNicknamePlan') && warnings.includes('/profile'), 'warning must include a concrete profile-based resolution path');
assert(warnings.includes('discord.nickname_warning.sent'), 'each successful warning must be logged as an action');
assert(notify.includes('auditDiscordAdmin("discord.nickname_warning.manual"'), 'manual warning runs must be audited');
assert(automation.includes('verifyInternalBearerToken') && automation.includes('nicknameReminderEnabled'), 'automatic warning route must require internal auth and saved enablement');
assert(automation.includes('discord.nickname_warning.auto_completed') && automation.includes('discord.nickname_warning.auto_failed'), 'automatic runs must be logged');
assert(inspect.includes('inspectNicknameWarnings'), 'preview must use the same nickname rules as delivery');
assert(cron.includes('/api/dashboard/discord/nicknames/automation'), 'VPS cron must tick nickname warning automation');
assert(proxy.includes('pathname === "/api/dashboard/discord/nicknames/automation"'), 'nickname automation must be allowed through the bearer-authenticated Docker host gate');
assert(enhancer.includes('/api/dashboard/discord/nicknames/notify') && !enhancer.includes('/api/dashboard/discord/nicknames/cleanup'), 'live form overlay must describe warnings, not role changes');
assert(css.includes('.nickname-warning-settings') && css.includes('.nickname-warning-flow'), 'warning settings and flow need dedicated responsive styles');

assert(policy.includes('nicknameNewcomerGateEnabled') && policy.includes('nicknameNewcomerRoleId'), 'nickname policy must persist newcomer role-gate enablement and trigger role');
assert(page.includes('name="nicknameNewcomerGateEnabled"') && page.includes('name="nicknameNewcomerRoleId"') && page.includes('Новоприбулі після Discord-ролі'), 'Discord UI must expose newcomer role-gate controls');
assert(warnings.includes('NEWCOMER_GATE_COLLECTION = "discordNicknameNewcomerGateMembers"'), 'newcomer role observation state must have its own persistent collection');
assert(warnings.includes('gateStatus: "waiting_role"') && warnings.includes('gateStatus: "qualified"'), 'newcomers must remain waiting until the trigger role is observed');
assert(warnings.includes('eligibilitySource: "newcomer_role"') && warnings.includes('invalidDueNow: true'), 'invalid newcomers must enter the existing invalid priority database immediately after role qualification');
assert(warnings.includes('eligibleUserIds') && warnings.includes('skippedPendingNewcomers'), 'full nickname sweeps must exclude newcomers that are still waiting for the trigger role');
assert(automation.includes('syncNicknameNewcomerRoleGate') && automation.includes('nicknameNewcomerGateEnabled'), 'automatic nickname cron must discover newcomer role transitions');
const rulesComplete = read('src/app/api/rules/accept/complete/route.ts');
assert(rulesComplete.includes('processNewcomerNicknameRoleGrant') && rulesComplete.includes('grantedRoleIds: roleIds'), 'rules onboarding role grants must trigger immediate newcomer nickname classification');
assert(discord.includes('joinedAt: cleanText(member?.joined_at'), 'Discord member snapshots must retain joined_at for newcomer tracking');

// Виконуємо саме production helper на прикладах legacy-ніків, а не дублюємо
// регулярку в тесті: це ловить випадок, коли `Назар(Aexe) [Aexe]` випадково
// знову почне вважатися валідним імʼям із круглими дужками.
try {
  let ts;
  try { ts = require('typescript'); }
  catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js'); }
  let policySource = policy.replace(/^import[^\n]*\n/gm, '');
  const compiled = ts.transpileModule(policySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const policyModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: policyModule,
    exports: policyModule.exports,
    require,
    process,
    console,
    setTimeout,
    clearTimeout,
    globalThis: {},
  }, { filename: 'guildNicknamePolicy.runtime-test.js' });
  const { explainNicknameValidation, suggestNicknameFromObservedText } = policyModule.exports;
  const cases = [
    ['Назар(Aexe) [Aexe]', 'Назар [Aexe]'],
    ['Назар (Aexe) [Aexe]', 'Назар [Aexe]'],
    ['Назар(Aexe)', 'Назар [Aexe]'],
    ['Назар (Aexe)', 'Назар [Aexe]'],
    ['Назар(Aexe, Nhf, Ykfdf ) [Aexe, Nhf, Ykfdf]', 'Назар [Aexe, Nhf, Ykfdf]'],
    ['Назар (Aexe, Nhf, Ykfdf) [Aexe, Nhf, Ykfdf]', 'Назар [Aexe, Nhf, Ykfdf]'],
    ['Назар(Aexe, Nhf) [Aexe, Nhf]', 'Назар [Aexe, Nhf]'],
    ['Назар (Aexe, Nhf)', 'Назар [Aexe, Nhf]'],
  ];
  for (const [nickname, expected] of cases) {
    assert(explainNicknameValidation(nickname).valid === false, `legacy nickname must be invalid: ${nickname}`);
    assert(suggestNicknameFromObservedText(nickname) === expected, `legacy nickname recommendation: ${nickname} -> ${expected}`);
  }

  for (const nickname of [
    'Назар [Aexe]',
    'Назар [Aexe, Nhf]',
    'Назар [Aexe, Nhf, Ykfdf]',
  ]) {
    assert(explainNicknameValidation(nickname).valid === true, `standard nickname must remain valid: ${nickname}`);
  }
} catch (error) {
  assert(false, `runtime nickname recommendation fixtures failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (!process.exitCode) console.log(`[check-nickname-warnings] OK — ${checked}/${checked} warning, fallback, cooldown, logging and scheduler invariants checked.`);
