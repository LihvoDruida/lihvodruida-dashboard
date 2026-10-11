const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
let clock = Date.parse('2026-10-10T12:00:00Z');
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
function load(relative, modules, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: (name) => { if (name === 'server-only') return {}; if (name === 'node:crypto') return crypto; if (!(name in modules)) throw new Error(`Unexpected import: ${name}`); return modules[name]; }, Date: TestDate, setInterval, clearInterval, console, Map, Set, Promise, ...globals }, { filename: relative });
  return exports;
}
function memoryStore() {
  const collections = new Map();
  let transactionTail = Promise.resolve();
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function coll(name) { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name); }
  function snapshot(ref) { const value = coll(ref.collection).get(ref.id); return { id: ref.id, ref, exists: value !== undefined, data: () => clone(value), get: (field) => value?.[field] }; }
  function ref(name, id) { return { collection: name, id, get: async () => snapshot(ref(name, id)), set: async (data, options) => { const current = options?.merge ? coll(name).get(id) || {} : {}; coll(name).set(id, clone({ ...current, ...data })); }, delete: async () => { coll(name).delete(id); } }; }
  function query(name, filters = [], order = null, limit = 1e9, cursor = null) {
    return { doc: (id) => ref(name, id), where: (f, op, value) => query(name, [...filters, [f, op, value]], order, limit, cursor), orderBy: (field, direction = 'asc') => query(name, filters, [field, direction], limit, cursor), limit: (size) => query(name, filters, order, size, cursor), startAfter: (value) => query(name, filters, order, limit, value), get: async () => {
      let rows = [...coll(name)].filter(([, row]) => filters.every(([f, op, value]) => op === '==' ? row[f] === value : op === '<' ? row[f] < value : op === '<=' ? row[f] <= value : op === '>' ? row[f] > value : row[f] >= value));
      if (order) rows.sort((a, b) => (a[1][order[0]] < b[1][order[0]] ? -1 : a[1][order[0]] > b[1][order[0]] ? 1 : 0) * (order[1] === 'desc' ? -1 : 1));
      if (cursor && order) rows = rows.filter(([, row]) => order[1] === 'desc' ? row[order[0]] < cursor : row[order[0]] > cursor);
      const docs = rows.slice(0, limit).map(([id]) => snapshot(ref(name, id))); return { docs, size: docs.length, empty: docs.length === 0 };
    } };
  }
  return { collections, collection: (name) => query(name), batch: () => { const tasks = []; return { set: (...args) => tasks.push(() => args[0].set(args[1], args[2])), delete: (r) => tasks.push(() => r.delete()), commit: async () => { for (const task of tasks) await task(); } }; }, runTransaction: (handler) => {
    const task = transactionTail.then(async () => { const writes = []; const value = await handler({ get: (r) => r.get(), set: (...args) => writes.push(() => args[0].set(args[1], args[2])) }); for (const write of writes) await write(); return value; }); transactionTail = task.catch(() => {}); return task;
  } };
}
const policy = load('src/lib/discordCleanupPolicy.ts', {});
const guildId = '111111111111111111', roleId = '222222222222222222';
const extraId = '333333333333333333';
const control = { guildId, ownerId: '999999999999999999', botId: '888888888888888888', canKick: true, botTopRole: { id: '444444444444444444', position: 20 }, roles: [{ id: guildId, name: '@everyone', position: 0, permissions: '0', managed: false }, { id: roleId, name: 'Новачок', position: 1, permissions: '0', managed: false }] };
const member = (i, roles = [], joinedAt = '2026-01-01T12:00:00Z') => ({ userId: String(500000000000000000n + BigInt(i)), displayName: `Учасник ${i}`, roleIds: roles, joinedAt, bot: false });
const evaluate = (m, c = control, period = 'week') => policy.evaluateCleanupMember(m, roleId, period, c, clock);
async function fixture(members) {
  const db = memoryStore(); let writable = true; let liveControl = control; let kickError = null; let readMutation = null; let pageFailure = null; const kicks = [];
  const access = { assertFirebaseWriteAvailable: () => { if (!writable) throw new Error('read-only'); } };
  const leases = load('src/lib/automationLease.ts', { '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => db }, '@/lib/firebaseAccess': access });
  const discord = {
    getDiscordGuildId: () => guildId,
    fetchDiscordCleanupControl: async () => liveControl,
    fetchDiscordCleanupMemberPage: async (after, size) => { if (pageFailure) throw new Error(pageFailure); const page = members.filter((m) => BigInt(m.userId) > BigInt(after)).slice(0, size); return { members: page, after: page.at(-1)?.userId || after, complete: page.length < size }; },
    fetchDiscordGuildMemberSnapshot: async (id) => { const m = members.find((value) => value.userId === id); if (!m) throw new Error('Discord API 404: Unknown Member'); return readMutation ? readMutation(m) : m; },
    kickDiscordCleanupMember: async (guild, id, reason) => { check(guild === guildId && reason.includes('Guild cleanup'), 'kick guild and audit reason'); kicks.push(id); if (kickError) throw new Error(kickError); members = members.filter((m) => m.userId !== id); },
  };
  const service = load('src/lib/discordMemberCleanup.ts', { '@/lib/automationLease': leases, '@/lib/firebaseAccess': access, '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => db }, '@/lib/discordAdmin': discord, '@/lib/discordCleanupPolicy': policy, '@/lib/security': { logDashboardEvent: () => {} } });
  await service.saveDiscordCleanupSettings({ enabled: false, roleId, period: 'week' }, 'owner');
  return { db, service, leases, kicks, writable: (v) => { writable = v; }, control: (v) => { liveControl = v; }, kickError: (v) => { kickError = v; }, readMutation: (v) => { readMutation = v; }, pageFailure: (v) => { pageFailure = v; }, enable: () => service.saveDiscordCleanupSettings({ enabled: true, roleId, period: 'week' }, 'owner') };
}
async function main() {
  check(evaluate(member(1)).eligible, 'no roles qualifies');
  check(evaluate(member(1, [roleId])).eligible, 'exactly selected role qualifies');
  check(evaluate(member(1, [guildId, roleId])).eligible, '@everyone does not count');
  for (const roles of [[roleId, extraId], [extraId], [roleId, roleId]]) check(!evaluate(member(1, roles)).matches, 'strict role cardinality');
  check(!evaluate({ ...member(1), bot: true }).matches, 'bots excluded');
  check(!evaluate({ ...member(1), userId: control.ownerId }).eligible, 'owner protected');
  check(!evaluate(member(1), { ...control, canKick: false }).eligible, 'permission loss fails closed');
  check(!evaluate(member(1, [roleId]), { ...control, botTopRole: { position: 1 } }).eligible, 'equal hierarchy protected');
  check(!evaluate(member(1, [roleId]), { ...control, roles: control.roles.map((r) => r.id === roleId ? { ...r, permissions: '8' } : r) }).eligible, 'admin protected');
  check(!evaluate(member(1, [], null)).eligible, 'missing join date protected');
  check(!evaluate(member(1, [], 'not-a-date')).eligible, 'invalid join date protected');
  check(!evaluate(member(1, [], '2027-01-01T00:00:00Z')).eligible, 'future join date protected');
  check(!evaluate(member(1, [], '2026-10-03T12:00:00Z')).eligible, 'equal deadline is not exceeded');
  check(policy.cleanupDeadline('2024-01-31T18:19:20Z', 'month') === '2024-02-29T18:19:20.000Z', 'leap month clamped');
  check(policy.cleanupDeadline('2023-01-31T18:19:20Z', 'month') === '2023-02-28T18:19:20.000Z', 'common month clamped');
  check(policy.cleanupDeadline('2024-02-29T18:19:20Z', 'year') === '2025-02-28T18:19:20.000Z', 'calendar year clamped');
  check(policy.cleanupDeadline('2026-07-31T00:00:00Z', 'quarter') === '2026-10-31T00:00:00.000Z', 'three calendar months');
  check(policy.cleanupDeadline('2026-08-31T00:00:00Z', 'halfYear') === '2027-02-28T00:00:00.000Z', 'six calendar months');
  let f = await fixture([member(1), member(2, [roleId]), member(3, [roleId, extraId]), { ...member(4), bot: true }, member(5, [], '2026-10-09T00:00:00Z')]);
  await f.service.runDiscordMemberCleanup();
  check(f.kicks.length === 0, 'disabled automation never kicks');
  check((await f.service.listDiscordCleanupMembers('candidates')).rows.length === 3, 'only exact eligible role sets listed');
  await f.enable(); await f.service.runDiscordMemberCleanup();
  check(f.kicks.length === 2, 'only old eligible humans kicked');
  check((await f.service.listDiscordCleanupMembers('kicked')).rows.length === 2, 'confirmed history persisted');
  check((await f.service.listDiscordCleanupMembers('candidates')).rows.length === 1, 'kicked moved out of candidates');
  await f.service.runDiscordMemberCleanup(); check(f.kicks.length === 2, 'successful actions never replayed');
  check((await f.service.getDiscordCleanupOverview()).state.kickedTotal === 2, 'exact persistent count');
  f = await fixture([member(1)]); await f.enable(); f.readMutation((m) => ({ ...m, roleIds: [roleId, extraId] })); await f.service.runDiscordMemberCleanup(); check(!f.kicks.length, 'role changed before kick protected');
  f = await fixture([member(1)]); await f.enable(); f.readMutation((m) => ({ ...m, joinedAt: '2026-10-10T00:00:00Z' })); await f.service.runDiscordMemberCleanup(); check(!f.kicks.length, 'rejoin resets eligibility');
  f = await fixture([member(1, [roleId])]); await f.enable(); f.readMutation((m) => ({ ...m, roleIds: [] })); await f.service.runDiscordMemberCleanup();
  check((await f.service.listDiscordCleanupMembers('kicked')).rows[0].roleName === 'Без ролей', 'history records fresh role at kick time');
  f = await fixture([member(1)]); await f.enable(); f.kickError('Discord API timeout after 14000ms'); await f.service.runDiscordMemberCleanup();
  check((await f.service.listDiscordCleanupMembers('uncertain')).rows.length === 1, 'ambiguous result visible');
  clock += 61 * 60_000; await f.service.runDiscordMemberCleanup(); check(f.kicks.length === 1, 'ambiguous destructive request not replayed after rescan');
  check((await f.service.listDiscordCleanupMembers('kicked')).rows.length === 0, 'ambiguous result never presented as confirmed kick');
  f = await fixture([member(1)]); await f.enable(); f.kickError('Discord API 429: rate limited'); await f.service.runDiscordMemberCleanup();
  check((await f.service.listDiscordCleanupMembers('uncertain')).rows.length === 0, '429 is safe deferred work');
  f.kickError(null); clock += 16 * 60_000; await f.service.runDiscordMemberCleanup(); check(f.kicks.length === 2, 'definite rejection retried later');
  f = await fixture(Array.from({ length: 260 }, (_, i) => member(i + 1)));
  await f.service.runDiscordMemberCleanup(); let overview = await f.service.getDiscordCleanupOverview();
  check(overview.state.scan.checked === 200 && overview.state.activeScanId === null, 'large scan saves cursor without publishing incomplete list');
  f.pageFailure('API unavailable'); await assert.rejects(f.service.runDiscordMemberCleanup()); f.pageFailure(null); await f.service.runDiscordMemberCleanup();
  overview = await f.service.getDiscordCleanupOverview(); check(overview.state.checked === 260 && !overview.state.scan, 'scan resumes after failure');
  let first = await f.service.listDiscordCleanupMembers('candidates'); check(first.rows.length === 25 && first.cursor, 'bounded first page');
  let ids = first.rows.map((r) => r.id), next = first;
  while (next.cursor) { next = await f.service.listDiscordCleanupMembers('candidates', next.cursor, first.scanId); ids.push(...next.rows.map((r) => r.id)); }
  check(ids.length === 260 && new Set(ids).size === 260, 'cursor pagination no duplicates or omissions for equal join dates');
  await f.service.saveDiscordCleanupSettings({ enabled: false, roleId, period: 'year' }, 'owner');
  check((await f.service.listDiscordCleanupMembers('candidates', first.cursor, first.scanId)).stale, 'settings change invalidates old cursor');
  f.writable(false); await assert.rejects(f.service.runDiscordMemberCleanup()); check(!f.kicks.length, 'unavailable write storage prevents moderation'); f.writable(true);
  const [leaseA, leaseB] = await Promise.all([f.leases.acquireAutomationLease('test', 'a'), f.leases.acquireAutomationLease('test', 'b')]);
  check(Boolean(leaseA) !== Boolean(leaseB), 'one shared lease across independent callers');
  const lease = leaseA || leaseB; clock += 180001; const replacement = await f.leases.acquireAutomationLease('test', 'replacement');
  check(Boolean(replacement), 'expired worker recovered'); await assert.rejects(lease.assertOwned()); await lease.release();
  check((await f.db.collection('automationLeases').doc('test').get()).data().owner === replacement.owner, 'old release cannot unlock new owner'); await replacement.release();
  f = await fixture([member(1)]); await f.enable(); await f.service.runDiscordMemberCleanup({ source: 'manual', inspectOnly: true }); check(!f.kicks.length, 'manual refresh only inspects');
  await f.service.pauseDiscordCleanup('owner'); check(!(await f.service.getDiscordCleanupOverview()).settings.enabled, 'pause saved durably');
  let viewer = { id: 'staff', isServerOwner: false }, permitted = true, guarded = true, bearer = false, mutations = 0;
  const json = (body, options = {}) => ({ ...body, status: options.status || 200 });
  const routes = {
    'next/server': { NextResponse: { json } },
    '@/lib/auth': { getSession: async () => viewer },
    '@/lib/permissions': { canManageDiscordMembers: () => permitted },
    '@/lib/dashboardDiscordRoute': { requireDiscordAdmin: async () => guarded ? { session: viewer } : { error: json({ ok: false }, { status: 403 }) }, auditDiscordAdmin: async () => true },
    '@/lib/discordMemberCleanup': { getDiscordCleanupOverview: async () => ({ settings: {}, state: {} }), listDiscordCleanupMembers: async () => ({ rows: [] }), saveDiscordCleanupSettings: async () => { mutations++; return {}; }, pauseDiscordCleanup: async () => { mutations++; return {}; }, runDiscordMemberCleanup: async () => { mutations++; return { skipped: false }; } },
    '@/lib/security': { noStoreHeaders: () => ({ 'Cache-Control': 'no-store' }), safeErrorMessage: (e) => e.message, logDashboardEvent: () => {}, verifyInternalBearerToken: async () => ({ ok: bearer }), unauthorizedResponse: () => json({ ok: false }, { status: 401 }) },
  };
  const route = load('src/app/api/dashboard/discord/member-cleanup/route.ts', routes);
  const request = (body) => ({ json: async () => body, nextUrl: new URL('https://guild.example/api/dashboard/discord/member-cleanup') });
  check((await route.POST(request({ action: 'settings' }))).status === 403 && mutations === 0, 'staff cannot change automatic kicks');
  check((await route.POST(request({ action: 'pause' }))).status === 403 && mutations === 0, 'staff cannot pause owner rule');
  guarded = false; check((await route.POST(request({ action: 'scan' }))).status === 403 && mutations === 0, 'CSRF/auth guard blocks mutations'); guarded = true;
  viewer = null; check((await route.GET(request({}))).status === 401, 'anonymous cannot read member data'); viewer = { id: 'staff', isServerOwner: false }; permitted = false;
  check((await route.GET(request({}))).status === 403, 'unprivileged member cannot read cleanup'); permitted = true;
  check((await route.GET(request({}))).status === 200, 'authorized staff can read cleanup'); viewer.isServerOwner = true;
  check((await route.POST(request({ action: 'settings' }))).status === 200 && mutations === 1, 'owner can configure cleanup');
  const automatic = load('src/app/api/dashboard/discord/member-cleanup/automation/route.ts', routes);
  check((await automatic.POST(request({}))).status === 401 && mutations === 1, 'scheduler requires internal bearer'); bearer = true;
  check((await automatic.POST(request({}))).status === 200 && mutations === 2, 'authorized scheduler executes service');
  let calls = 0, responseStatus = 429;
  const discordModules = { '@/lib/concurrency': {}, '@/lib/rulesOnboarding': {}, '@/lib/security': { logDashboardEvent: () => {} }, '@/lib/values': { cleanSnowflake: (id) => /^\d{16,25}$/.test(id) ? id : '' }, '@/lib/discordAvatar': {}, '@/lib/discordRulesStats': {} };
  const actualDiscord = load('src/lib/discordAdmin.ts', discordModules, { process: { env: { DISCORD_BOT_TOKEN: 'controlled-test-token' } }, Headers, AbortController, setTimeout, clearTimeout, fetch: async () => { calls++; return responseStatus === 204 ? new Response(null, { status: 204 }) : Response.json({ message: 'controlled rejection', retry_after: 65, global: true }, { status: responseStatus }); } });
  await assert.rejects(actualDiscord.kickDiscordCleanupMember(guildId, member(1).userId, 'test audit'));
  check(calls === 1, 'cleanup DELETE never automatically retries 429');
  clock += 40_000; await assert.rejects(actualDiscord.discordApi('/users/@me'));
  check(calls === 1, 'long global Retry-After respected in seconds without early requests');
  clock += 26_000; responseStatus = 500; await assert.rejects(actualDiscord.kickDiscordCleanupMember(guildId, member(1).userId, 'test audit'));
  check(calls === 2, 'ambiguous 500 never automatically retries cleanup DELETE');
  responseStatus = 204; await actualDiscord.kickDiscordCleanupMember(guildId, member(1).userId, 'test audit'); check(calls === 3, 'single confirmed DELETE returns after 204');
  // Real shell worker execution with a controlled HTTP stub proves independent paths and retry deadlines.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-cron-check-'));
  try {
    const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\necho "$*" >> "$TEST_CALLS"\necho "${TEST_HTTP:-200}"\n'); fs.chmodSync(path.join(bin, 'curl'), 0o755);
    const worker = path.resolve(root, '../deploy/cron/run-job.sh');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CRON_STATE_DIR: path.join(temp, 'state'), INTERNAL_CRON_TOKEN: 'test-token-never-output', TEST_CALLS: path.join(temp, 'calls') };
    execFileSync('sh', [worker, '/api/test-a', '900', 'a'], { env });
    execFileSync('sh', [worker, '/api/test-a', '900', 'a'], { env });
    execFileSync('sh', [worker, '/api/test-b', '60', 'b'], { env });
    check(fs.readFileSync(env.TEST_CALLS, 'utf8').trim().split('\n').length === 2, 'each task has independent deadline and no duplicate tick');
    execFileSync('sh', [worker, '/api/test-fail', '900', 'fail'], { env: { ...env, TEST_HTTP: '503' } });
    check(fs.readFileSync(path.join(env.CRON_STATE_DIR, 'fail.failures'), 'utf8').trim() === '1', 'failure backoff persisted');
    check(!fs.existsSync(path.join(env.CRON_STATE_DIR, 'fail.lock')), 'worker lock released after failed HTTP');
    execFileSync('sh', [worker, '/api/raids/lifecycle', '60', 'raid-lifecycle'], { env });
    check(fs.readFileSync(env.TEST_CALLS, 'utf8').includes('sweep=1'), 'startup raid reconciliation scheduled independently');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  console.log(`[check-discord-member-cleanup] OK — ${checks} behavioral policy, storage, pagination, lease and cron checks.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
