const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loader = require('./lib/load-server-ts.cjs');
const load = (file, mocks = {}, globals = {}) => loader(file, mocks, { Error, URL, URLSearchParams, Request, Response, Headers, ...globals });
const catalog = load('src/lib/automationTaskCatalog.ts').exports;
const { status, loadOverview } = require('./lib/automation-status-subject.cjs');
class Reply extends Response { static json(data, init = {}) { return new Reply(JSON.stringify(data), { ...init, headers: { ...init.headers, 'content-type': 'application/json' } }); } }
const now = Date.parse('2026-10-15T00:00:00Z'), iso = value => new Date(value).toISOString();
const run = overrides => ({ version: 1, runId: 'private-run-id', startedAt: iso(now - 10_000), finishedAt: iso(now - 5000), status: 'ok', counters: { processed: 3 }, ...overrides });
const task = (data = {}, id = 'raid-lifecycle', enabled = true) => status.observedAutomationStatus(id, data, now, enabled);
function routeFixture(kind, fileOverride) {
  let calls = 0, auth = true, release;
  const work = new Promise(resolve => { release = resolve; });
  const keys = { raids: 'src/app/api/raids/lifecycle/route.ts', polls: 'src/app/api/polls/close-due/route.ts', guild: 'src/app/api/guild/sync/route.ts' };
  const modules = {
    'next/server': { NextResponse: Reply }, '@/lib/automationTaskRuns': { observeAutomationRun: async (_id, operation) => operation() },
    '@/lib/security': { verifyInternalBearerToken: async () => ({ ok: auth }), logDashboardEvent() {}, noStoreHeaders: () => ({ 'cache-control': 'no-store' }), safeErrorMessage: () => 'safe', unauthorizedResponse: () => new Reply(null, { status: 401 }) },
    '@/lib/apiRoute': { envFlag: () => false, integerParam: (_value, fallback) => fallback },
    '@/lib/raids': { syncRaidLifecycleBatch: async () => { calls++; return work; } },
    '@/lib/raidPolls': { closeDueRaidPolls: async () => { calls++; return work; } },
    '@/lib/dashboardSystemLogs': { recordDashboardSystemLog: async () => {} },
    '@/lib/guildRaidHistory': {refreshGuildRaidHistory: async()=>({checked:0,failed:0})},
    '@/lib/guildRoster': { loadStoredGuildRosterData: async () => null, refreshGuildRosterApiBatch: async () => {
      calls++; await work;
      return { members: [], stats: {}, source: 'fixture', refresh: { sync: { status: 'completed' }, battleNet: {}, raiderIo: {} } };
    } },
  };
  const subject = load(fileOverride || keys[kind], modules);
  const globalKey = kind === 'raids' ? '__mistblossomRaidLifecycleRouteGuard' : kind === 'polls' ? '__mistblossomRaidPollCloseDueRouteGuard' : '__mistblossomGuildRosterCronGuard';
  return { calls: () => calls, release: value => release(value || { failed: 0, skipped: false }), deny: () => { auth = false; },
    setGuard: value => { subject.context[globalKey] = value; },
    post: async (force = true) => subject.exports.POST(new Request('http://dashboard:3000/api/fixture' + (force ? '?force=1' : ''), { method: 'POST' })),
  };
}
function storage() {
  const rows = new Map(); let tail = Promise.resolve();
  const db = { collection: c => ({ doc: id => ({ key: c + '/' + id }) }), runTransaction(fn) {
    const current = tail.then(async () => { const writes = []; const value = await fn({ get: async ref => ({ data: () => structuredClone(rows.get(ref.key)) }), set: (ref, data, options) => writes.push(() => rows.set(ref.key, { ...(options?.merge ? rows.get(ref.key) : {}), ...structuredClone(data) })) }); writes.forEach(write => write()); return value; });
    tail = current.catch(() => {}); return current;
  } };
  return { rows, db };
}
function observation(store, globals = {}) {
  return load('src/lib/automationTaskRuns.ts', { '@/lib/documentDb': { hasDocumentDbConfig: () => true, getDocumentDb: () => store.db } }, globals).exports;
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
(async () => {
  for (const kind of ['raids', 'polls']) await check(`${kind}: force bypasses cooldown but never starts parallel work`, async () => {
    const f = routeFixture(kind); const first = f.post(); await new Promise(resolve => setTimeout(resolve, 0));
    const skipped = await (await f.post()).json(); assert.equal(f.calls(), 1); assert.equal(skipped.skipped, true); assert.equal(skipped.reason, 'in_flight');
    f.release(); await first;
    const next = await f.post(); assert.equal(next.status, 200); assert.equal(f.calls(), 2);
  });
  for (const kind of ['raids', 'polls', 'guild']) await check(`${kind}: prior result cannot overwrite in-flight marker`, async () => {
    const f = routeFixture(kind); f.setGuard({ inFlight: new Promise(() => {}), lastStartedAt: 0, lastResult: { skipped: false, reason: 'old', ok: false } });
    const result = await (await f.post()).json(); assert.equal(result.skipped, true); assert.equal(result.reason, 'in_flight'); assert.equal(result.ok, true); assert.equal(f.calls(), 0);
  });
  for (const kind of ['raids', 'polls']) await check(`${kind}: cooldown marker survives an old success payload`, async () => {
    const f = routeFixture(kind); f.setGuard({ lastStartedAt: Date.now(), lastResult: { skipped: false, reason: 'old' } });
    const result = await (await f.post(false)).json(); assert.equal(result.skipped, true); assert.equal(result.reason, 'cooldown'); assert.equal(f.calls(), 0);
  });
  await check('unauthorized request does not invoke a task or telemetry', async () => { const f = routeFixture('raids'); f.deny(); assert.equal((await f.post()).status, 401); assert.equal(f.calls(), 0); });
  await check('missing observations are waiting without claiming a configured scheduler', () => { const card = task(); assert.equal(card.state, 'waiting'); assert.equal(card.nextAt, null); assert.match(card.reason, /не підтверджує/); });
  await check('unfinished observation expires into attention without inventing a success', () => {
    assert.equal(task(run({ finishedAt: null, status: 'running', deadlineAtMs: now + 10_000 })).state, 'running');
    const expired = task(run({ finishedAt: null, status: 'running', deadlineAtMs: now - 1 })); assert.equal(expired.state, 'attention'); assert.equal(expired.lastAt, null); assert.equal(expired.nextAt, null);
  });
  await check('malformed dates, versions, backwards completion and future results are not healthy', () => {
    for (const change of [{ version: 2 }, { startedAt: 'bad' }, { startedAt: iso(now - 1000), finishedAt: iso(now - 5000) }, { finishedAt: iso(now + 120_000) }]) assert.equal(task(run(change)).state, 'attention');
  });
  await check('partial provider, onboarding and retention failures are visible warnings', () => {
    for (const result of [{ sync: { status: 'failed' } }, { sync: { errors: ['private-details'] } }, { persistenceFailed: 1 }, { channelFailed: 1 }, { securityRetention: { failed: 1 } }]) {
      const safe = catalog.automationRunResult(result); assert.ok(['error', 'warning'].includes(safe.status)); assert.equal(task(run(safe)).state, 'attention');
    }
  });
  await check('disabled jobs have no promised next call while missed deadlines remain overdue', () => {
    assert.equal(task(run(), 'guild-sync', false).nextAt, null); assert.equal(task(run({ reason: 'disabled' }), 'guild-sync').state, 'paused');
    const old = task(run({ startedAt: iso(now - 600_000), finishedAt: iso(now - 599_000) })); assert.equal(old.state, 'attention'); assert.ok(Date.parse(old.nextAt) < now);
  });
  await check('result projection whitelists counters without saving personal or credential fields', () => {
    const safe = catalog.automationRunResult({ processed: 3, failed: -5, sent: Infinity, email: 'private@example.test', token: 'private-token', errors: ['private-error'], roleIds: ['private-id'] });
    const text = JSON.stringify(safe); assert.ok(!text.includes('private-')); assert.ok(!text.includes('@')); assert.equal(safe.counters.processed, 3); assert.equal(safe.counters.failed, undefined);
  });
  await check('task intervals match the actual cron registry', () => {
    const cron = fs.readFileSync(path.resolve(__dirname, '../../deploy/cron/run-cron.sh'), 'utf8');
    for (const id of catalog.AUTOMATION_TASK_IDS) assert.ok(cron.includes(`interval=${catalog.AUTOMATION_TASKS[id].intervalSeconds}; key=${id}`), id);
  });
  await check('successful run stores one completion without replaying its business action', async () => {
    const store = storage(), monitor = observation(store); let calls = 0;
    const result = await monitor.observeAutomationRun('polls', async () => { calls++; return { closed: 2 }; }); assert.equal(result.closed, 2); assert.equal(calls, 1);
    const saved = store.rows.get('automationTaskRuns/polls'); assert.equal(saved.status, 'ok'); assert.equal(saved.counters.closed, 2); assert.ok(saved.finishedAt); assert.ok(saved.contextHash);
  });
  await check('failed business operation retains original error and records no success', async () => {
    const store = storage(), monitor = observation(store), error = Error('private-error'); let calls = 0;
    await assert.rejects(monitor.observeAutomationRun('polls', async () => { calls++; throw error; }), value => value === error);
    assert.equal(calls, 1); assert.equal(store.rows.get('automationTaskRuns/polls').status, 'error'); assert.ok(!JSON.stringify(store.rows.get('automationTaskRuns/polls')).includes('private-error'));
  });
  await check('telemetry connection failure never blocks or repeats an authorized operation', async () => {
    const monitor = observation({ db: { collection: () => { throw Error('offline'); } } }); let calls = 0;
    assert.equal(await monitor.observeAutomationRun('polls', async () => { calls++; return 42; }), 42); assert.equal(calls, 1);
  });
  await check('hung telemetry has a deadline and does not hang business work', async () => {
    const monitor = observation({ db: { collection: () => ({ doc: () => ({}) }), runTransaction: () => new Promise(() => {}) } }); let calls = 0;
    const started = Date.now(); assert.equal(await monitor.observeAutomationRun('polls', async () => { calls++; return 42; }), 42); assert.ok(Date.now() - started < 2500); assert.equal(calls, 1);
  });
  await check('older completion cannot overwrite a newer run observation', async () => {
    const store = storage(); let clock = now, release;
    class Clock extends Date { constructor(value) { super(value === undefined ? clock : value); } static now() { return clock; } }
    const monitor = observation(store, { Date: Clock });
    const first = monitor.observeAutomationRun('polls', () => new Promise(resolve => { release = resolve; }));
    await new Promise(resolve => setTimeout(resolve, 0)); clock += 1000;
    await monitor.observeAutomationRun('polls', async () => ({ closed: 5 })); release({ closed: 1 }); await first;
    assert.equal(store.rows.get('automationTaskRuns/polls').counters.closed, 5);
  });
  await check('overview ignores observations from a different guild/configuration context', async () => {
    const db = { collection: c => ({ doc: id => ({ collection: c, id }) }), getAll: async (...refs) => refs.map(ref => ({ data: () => ref.collection === 'automationTaskRuns' ? run({ contextHash: 'other-context' }) : {} })) };
    const overview = await loadOverview(db, '111111111111111111')(); assert.equal(overview.cards.length, 11);
    assert.ok(overview.cards.slice(3).every(card => card.lastAt === null)); assert.ok(!JSON.stringify(overview).includes('other-context'));
  });
  await check('configured raid cooldown does not cause a false overdue scheduler warning', () => {
    const monitor = observation(storage(), { process: { env: { RAID_LIFECYCLE_MIN_INTERVAL_MS: '3600000' } } });
    const interval = monitor.automationExpectedIntervalSeconds('raid-lifecycle'); assert.equal(interval, 3600);
    const card = status.observedAutomationStatus('raid-lifecycle', run({ startedAt: iso(now - 600_000), finishedAt: iso(now - 599_000) }), now, true, interval);
    assert.equal(card.state, 'waiting'); assert.equal(card.nextAt, iso(now + 3_000_000));
    assert.equal(monitor.automationExpectedIntervalSeconds('polls'), 300);
  });
  console.log(`[check-automation-observability] ${passed}/${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
