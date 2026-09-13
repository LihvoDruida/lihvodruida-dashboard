const fs = require('node:fs');
const path = require('node:path');

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
const enhancer = read('src/components/DashboardFormEnhancer.tsx');
const cron = read('deploy/cron/run-cron.sh', repo);
const css = read('src/app/styles/admin.css');
const management = read('src/lib/discordMemberManagement.ts');
const proxy = read('src/proxy.ts');
const legacyCleanup = read('scripts/cleanup-legacy.cjs');

assert(!exists('src/app/api/dashboard/discord/nicknames/cleanup/route.ts'), 'legacy role-changing nickname cleanup route must be removed');
assert(legacyCleanup.includes('src/app/api/dashboard/discord/nicknames/cleanup'), 'legacy cleanup must delete stale nickname cleanup routes left by archive-over-archive deploys');
assert(!management.includes('removeRolesFromMembersWithInvalidNicknames'), 'nickname mismatch must no longer mutate Discord roles');
assert(!policy.includes('roleRemoveConcurrency') && !page.includes('Авто зняття ролей'), 'legacy automatic role-removal controls must be removed completely');
assert(page.includes('Ролі, доступи й нік не змінюються.'), 'UI must state that nickname automation only warns');
assert(page.includes('action="/api/dashboard/discord/nicknames/notify"'), 'manual warning action must exist');
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
assert(warnings.includes('deliverNicknameWarning(fresh, policy, { ...input, force: true })'), 'full-sweep delivery must reuse the already-computed cooldown decision instead of reading it twice');
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

if (!process.exitCode) console.log(`[check-nickname-warnings] OK — ${checked}/${checked} warning, fallback, cooldown, logging and scheduler invariants checked.`);
