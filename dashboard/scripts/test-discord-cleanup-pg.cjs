const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const pg = require('pg');
const load = require('./lib/load-server-ts.cjs');
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || url === process.env.POSTGRES_URL) throw Error('Use an isolated TEST_DATABASE_URL; application URLs refused.');
const child = process.argv[2] === '--lease-probe';
const schema = child ? process.argv[3] : 'r4_' + randomBytes(12).toString('hex');
if (!/^r4_[a-f0-9]{24}$/.test(schema)) throw Error('Invalid private schema');
const pool = new pg.Pool({ connectionString: url, max: 6, options: '-c search_path=' + schema + ' -c statement_timeout=10000 -c lock_timeout=3000' });
pool.on('error', () => {});
const db = load('src/lib/db/pgPool.ts', { pg }, { __mistblossomPgPool: pool, process: { env: { DATABASE_URL: url } } }).exports;
const { PgFirestore } = load('src/lib/db/documentStore.ts', { '@/lib/db/pgPool': db }).exports;
const store = new PgFirestore();
let clockOffset = 0;
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [Date.now() + clockOffset])); } static now() { return Date.now() + clockOffset; } }
const globals = { setInterval, clearInterval, Date: TestDate };
const access = { assertFirebaseWriteAvailable() {} };
const adminDb = { getFirebaseAdminDb: () => store };
const leases = load('src/lib/automationLease.ts', { '@/lib/firebaseAdmin': adminDb, '@/lib/firebaseAccess': access }, globals).exports;
const policy = load('src/lib/discordCleanupPolicy.ts').exports;
const guild = '111111111111111111', role = '222222222222222222';
const member = i => ({ userId: String(500000000000000000n + BigInt(i)), displayName: 'Учасник ' + i, roleIds: [role], joinedAt: '2020-01-01T12:00:00Z', bot: false });
const control = { guildId: guild, ownerId: '999999999999999999', botId: '888888888888888888', canKick: true, botTopRole: { id: '444444444444444444', position: 20 }, roles: [{ id: guild, name: '@everyone', position: 0, permissions: '0', managed: false }, { id: role, name: 'Новачок', position: 1, permissions: '0', managed: false }] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let members = [], requests = [], beforeMember, beforeControl, beforeDispatch, send, verifiedControl = control;
const transportGlobals = { ...globals, Headers, Request, Response, FormData, AbortSignal, AbortController, DOMException, process: { env: { DISCORD_BOT_TOKEN: 'isolated-test-only' } }, fetch: async (url, init) => { requests.push({ url, method: init.method }); return send ? send(url, init) : new Response(null, { status: 204 }); } };
const rest = load('src/lib/discordRest.ts', {}, transportGlobals).exports;
const actualAdmin = load('src/lib/discordAdmin.ts', { '@/lib/discordRest': rest, '@/lib/concurrency': {}, '@/lib/rulesOnboarding': {}, '@/lib/security': { logDashboardEvent() {} }, '@/lib/values': { cleanSnowflake: x => /^\d{16,25}$/.test(x) ? x : '' }, '@/lib/discordAvatar': {}, '@/lib/discordRulesStats': {} }, transportGlobals).exports;
const discord = {
  getDiscordGuildId: () => guild,
  fetchDiscordCleanupControl: async () => { await beforeControl?.(); return verifiedControl; },
  fetchDiscordCleanupMemberPage: async (after, size) => { const page = members.filter(m => BigInt(m.userId) > BigInt(after)).slice(0, size); return { members: page, after: page.at(-1)?.userId || after, complete: page.length < size }; },
  fetchDiscordGuildMemberSnapshot: async id => { await beforeMember?.(); return members.find(m => m.userId === id); },
  kickDiscordCleanupMember: async (...args) => { await beforeDispatch?.(); return actualAdmin.kickDiscordCleanupMember(...args); },
};
const service = load(process.env.TEST_CLEANUP_SOURCE || 'src/lib/discordMemberCleanup.ts', { '@/lib/automationLease': leases, '@/lib/firebaseAccess': access, '@/lib/firebaseAdmin': adminDb, '@/lib/discordAdmin': discord, '@/lib/discordCleanupPolicy': policy, '@/lib/security': { logDashboardEvent() {} } }, globals).exports;
const settingsRef = store.collection('dashboardSettings').doc('discordMemberCleanup_' + guild);
const executionRef = store.collection('dashboardSettings').doc('discordMemberCleanupControl_' + guild);
const leaseRef = store.collection('automationLeases').doc('discord-member-cleanup_' + guild);
const settings = enabled => ({ enabled, roleId: role, period: 'week' });
async function reset(count = 2) { await pool.query('DELETE FROM documents'); members = Array.from({ length: count }, (_, i) => member(i + 1)); requests = []; beforeMember = beforeControl = beforeDispatch = send = null; verifiedControl = control; await service.saveDiscordCleanupSettings(settings(true), 'owner'); }
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('✓ ' + name); }
(async () => {
  if (child) { const r = await service.runDiscordMemberCleanup(); assert.equal(r.reason, 'in_flight'); console.log('independent-process: blocked'); return; }
  await pool.query('CREATE SCHEMA ' + schema);
  await pool.query(fs.readFileSync(path.join(__dirname, '../src/lib/db/schema.sql'), 'utf8'));
  if (process.env.TEST_CLEANUP_SOURCE) {
    await reset(); const lease = await leases.acquireAutomationLease('discord-member-cleanup_' + guild, 'held');
    try { await assert.rejects(service.pauseDiscordCleanup('owner'), /Перевірка вже виконується/); assert.equal((await settingsRef.get()).data().enabled, true); console.log('R3 defect reproduced: active worker rejects pause; enabled remains true'); }
    finally { await lease.release(); }
    return;
  }
  await check('pause commits while worker lease is held; role/period/revision preserved', async () => {
    await reset(); const original = (await settingsRef.get()).data(); const lease = await leases.acquireAutomationLease('discord-member-cleanup_' + guild, 'held');
    try { await service.pauseDiscordCleanup('owner'); const paused = (await settingsRef.get()).data(); assert.equal(paused.enabled, false); for (const key of ['roleId', 'period', 'revision']) assert.equal(paused[key], original[key]); assert.equal((await executionRef.get()).data().paused, true); } finally { await lease.release(); }
  });
  await check('pause before late REST dispatch: no DELETE, receipt or uncertain counter', async () => {
    await reset(); const entered = deferred(), release = deferred(); beforeDispatch = async () => { entered.resolve(); await release.promise; };
    const work = service.runDiscordMemberCleanup(); await entered.promise; await service.pauseDiscordCleanup('owner'); release.resolve(); await work;
    assert.equal(requests.length, 0); assert.equal((await service.listDiscordCleanupMembers('uncertain')).rows.length, 0); assert.ok((await executionRef.get()).data().pauseObservedAt);
  });
  await check('pause during dispatched DELETE: finish one action; never start a second', async () => {
    await reset(); const entered = deferred(), release = deferred(); send = async () => { entered.resolve(); await release.promise; return new Response(null, { status: 204 }); };
    const work = service.runDiscordMemberCleanup(); await entered.promise;
    assert.equal((await executionRef.get()).data().inFlight.userId, member(1).userId);
    const output = execFileSync(process.execPath, [__filename, '--lease-probe', schema], { env: { ...process.env, TEST_CLEANUP_SOURCE: '' }, timeout: 15000, encoding: 'utf8' }); assert.match(output, /independent-process: blocked/);
    await service.pauseDiscordCleanup('owner'); assert.equal((await executionRef.get()).data().inFlight.userId, member(1).userId);
    release.resolve(); const result = await work; assert.equal(result.kicked, 1); assert.equal(requests.length, 1);
    const overview = await service.getDiscordCleanupOverview(); assert.equal(overview.state.kickedTotal, 1); assert.equal(overview.settings.enabled, false); assert.equal(overview.execution.inFlight, null);
  });
  await check('pause wins against an older enable request delayed in Discord validation', async () => {
    await reset(); await service.pauseDiscordCleanup('owner'); const entered = deferred(), release = deferred(); beforeControl = async () => { entered.resolve(); await release.promise; };
    const save = service.saveDiscordCleanupSettings(settings(true), 'owner'); const rejected = assert.rejects(save, /Стан очищення змінився/); await entered.promise;
    await service.pauseDiscordCleanup('owner'); release.resolve(); await rejected; assert.equal((await settingsRef.get()).data().enabled, false);
    beforeControl = null; await service.saveDiscordCleanupSettings(settings(true), 'owner'); assert.equal((await executionRef.get()).data().paused, false);
  });
  await check('lease lost in queue: no destructive request and no ambiguous receipt', async () => {
    await reset(); beforeDispatch = () => leaseRef.set({ expiresAtMs: 0 }, { merge: true }); await service.runDiscordMemberCleanup(); assert.equal(requests.length, 0); assert.equal((await service.listDiscordCleanupMembers('uncertain')).rows.length, 0);
  });
  await check('extra role and rejoin discovered immediately before action stay protected', async () => {
    for (const changed of [{ roleIds: [role, '333333333333333333'] }, { joinedAt: new Date().toISOString() }, { bot: true }]) {
      await reset(1); beforeMember = () => { members[0] = { ...members[0], ...changed }; }; await service.runDiscordMemberCleanup(); assert.equal(requests.length, 0);
    }
  });
  await check('permission loss and protected owner never reach DELETE', async () => {
    await reset(1); verifiedControl = { ...control, canKick: false }; await service.runDiscordMemberCleanup(); assert.equal(requests.length, 0);
    await reset(1); members[0].userId = control.ownerId; await service.runDiscordMemberCleanup(); assert.equal(requests.length, 0);
  });
  await check('lost DELETE response becomes uncertain once; new worker never replays it', async () => {
    await reset(1); send = async () => { throw new TypeError('fetch failed: controlled response loss'); }; await service.runDiscordMemberCleanup();
    assert.equal(requests.length, 1); assert.equal((await service.getDiscordCleanupOverview()).state.uncertainTotal, 1); assert.equal((await service.listDiscordCleanupMembers('uncertain')).rows.length, 1);
    await store.collection('dashboardSettings').doc('discordMemberCleanupState_' + guild).set({ lastScanAt: '2020-01-01T00:00:00Z' }, { merge: true });
    send = null; await service.runDiscordMemberCleanup(); assert.equal(requests.length, 1); assert.equal((await service.getDiscordCleanupOverview()).state.uncertainTotal, 1);
  });
  await check('abandoned attempt after restart stays uncertain and clears only its own in-flight signal', async () => {
    await reset(1); await service.runDiscordMemberCleanup({ source: 'manual', inspectOnly: true });
    const candidate = (await service.listDiscordCleanupMembers('candidates')).rows[0]; const old = new Date(Date.now() - 190000).toISOString();
    const id = require('node:crypto').createHash('sha256').update(candidate.userId + ':' + candidate.joinedAt).digest('hex');
    await store.collection('discordCleanupEvents_' + guild).doc(id).set({ ...candidate, id, attemptId: 'abandoned', attemptedAt: old, status: 'prepared', sortKey: 'p_abandoned' });
    await executionRef.set({ inFlight: { attemptId: 'abandoned', userId: candidate.userId, displayName: candidate.displayName, startedAt: old } }, { merge: true });
    await service.runDiscordMemberCleanup(); const overview = await service.getDiscordCleanupOverview(); assert.equal(requests.length, 0); assert.equal(overview.state.uncertainTotal, 1); assert.equal(overview.execution.inFlight, null);
  });
  await check('finalized receipt after crash clears a stale in-flight signal without recounting', async () => {
    await reset(1); await service.runDiscordMemberCleanup();
    const completed = (await store.collection('discordCleanupEvents_' + guild).get()).docs[0].data();
    await executionRef.set({ inFlight: { attemptId: completed.attemptId, operationId: completed.id, userId: completed.userId, displayName: completed.displayName, startedAt: completed.attemptedAt } }, { merge: true });
    await service.runDiscordMemberCleanup(); const overview = await service.getDiscordCleanupOverview(); assert.equal(requests.length, 1); assert.equal(overview.state.kickedTotal, 1); assert.equal(overview.execution.inFlight, null);
  });
  await check('long queue wait invalidates the membership check before any DELETE', async () => {
    await reset(1); beforeDispatch = async () => { clockOffset += 6000; }; const result = await service.runDiscordMemberCleanup();
    assert.equal(requests.length, 0); assert.equal(result.failed, 0); assert.equal((await service.listDiscordCleanupMembers('uncertain')).rows.length, 0);
  });
  console.log(`[test-discord-cleanup-pg] OK — ${passed} real PostgreSQL/worker/REST scenarios; no live Discord requests`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (!child) await pool.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => {}); await pool.end(); });
