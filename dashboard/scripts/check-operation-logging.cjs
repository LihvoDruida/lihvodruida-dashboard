const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const load = require('./lib/load-server-ts.cjs');
const globals = { Error, URL, Request, Response, Headers, crypto: webcrypto };
const privacy = load('src/lib/logPrivacy.ts', {}, globals).exports;
const secret = 'private-fixture-value-123456789';
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('✓ ' + name); }
function security() {
  const lines = [];
  const subject = load('src/lib/security.ts', { 'next/server': {}, '@/lib/oauth': { getDashboardUrl: () => 'https://guild.test' }, '@/lib/values': { envFlag: () => false } }, {
    ...globals, console: { log: value => lines.push(value), warn: value => lines.push(value), error: value => lines.push(value) },
  }).exports;
  return { ...subject, lines, events: () => lines.map(line => JSON.parse(line.slice(line.indexOf('{')))) };
}
function logStore(mirrorFails = false) {
  const consoleLines = [];
  const subject = load('src/lib/structuredLogs.ts', {
    crypto: require('node:crypto'), '@/lib/db/pgPool': { hasPostgresConfig: () => true, pgQuery: async () => { if (!mirrorFails) throw Error('password=' + secret + ' https://example.test/?rt=' + secret); return { rows: [] }; } },
    '@/lib/logSettings': {}, '@/lib/securityLogDiscord': { mirrorSecurityLogToDiscord: async () => { throw Error('Bearer ' + secret); } },
  }, { ...globals, console: { error: (...args) => consoleLines.push(args), warn: (...args) => consoleLines.push(args) } }).exports;
  return { ...subject, consoleLines };
}
class Reply extends Response {
  static json(body, init = {}) { return new Reply(JSON.stringify(body), { ...init, headers: { ...init.headers, 'content-type': 'application/json' } }); }
  static redirect(url, init) { return new Reply(null, { ...init, headers: { ...init.headers, location: String(url) } }); }
}
function attendance() {
  const events = [], after = []; let loggerFails = false, scheduleFails = false, syncResult = true, syncError = null, writeError = null, policyRejects = false, jsonMode = true, authenticated = true;
  let writes = 0, syncs = 0;
  const subject = load('src/app/api/raids/[raidId]/attendance/route.ts', {
    'next/server': { NextResponse: Reply, after: callback => { if (scheduleFails) throw Error('after unavailable'); after.push(callback); } },
    '@/lib/auth': { getSession: async () => authenticated ? ({ id: '111111111111111111', provider: 'discord' }) : null },
    '@/lib/security': { noStoreHeaders: () => ({ 'cache-control': 'no-store' }), assertRequestBodySize: () => null, verifyTrustedOrigin: () => true, checkRateLimit: () => ({ ok: true }), getClientIp: () => 'fixture', safeErrorMessage: () => 'Помилка', logDashboardEvent: (...args) => { if (loggerFails) throw Error('logger failed'); events.push(args); } },
    '@/lib/raids': { handleRaidSessionAction: async () => { writes++; if (writeError) throw writeError; return policyRejects ? { ok: false, content: 'Policy' } : { ok: true, content: 'Saved', raid: { id: 'fixture00' } }; }, raidLiveRevision: () => 'revision', syncRaidDiscordSignupUpdate: async () => { syncs++; if (syncError) throw syncError; return syncResult; } },
    '@/lib/serverToasts': { dashboardToastCookie: () => 'toast=fixture' }, '@/lib/apiRoute': { appBaseUrl: () => 'https://guild.test', wantsJson: () => jsonMode },
  }, globals).exports;
  return { events, after, formMode: () => jsonMode = false, anonymous: () => authenticated = false, post: (body = JSON.stringify({ action: 'going', characterKey: secret, reminderEnabled: false })) => subject.POST(new Request('https://guild.test/api/raids/fixture00/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), { params: Promise.resolve({ raidId: 'fixture00' }) }), loggerFails: () => loggerFails = true, scheduleFails: () => scheduleFails = true, syncResult: value => syncResult = value, syncError: value => syncError = value, writeError: value => writeError = value, policyRejects: () => policyRejects = true, writes: () => writes, syncs: () => syncs };
}
function profile(kind) {
  const events = [], workers = []; let fault = null, scheduleFails = false, workerFails = false, writes = 0;
  class DomainError extends Error { constructor(status) { super(secret); this.status = status; } }
  const state = kind === 'identity' ? { sync: { operationId: 'operation-fixture', state: 'queued', dueAtMs: 1 } } : { receipt: { operationId: 'operation-fixture', addedKeys: [], duplicateKeys: [] } };
  const read = async () => { if (fault) throw fault; return state; };
  const write = async () => { if (fault) throw fault; writes++; return state; };
  const subject = load(`src/app/api/profile/${kind === 'identity' ? 'identity' : 'characters/setup'}/route.ts`, {
    'next/server': { NextResponse: Reply, after: callback => { if (scheduleFails) throw Error(secret); workers.push(callback); } },
    '@/lib/auth': { getSession: async () => ({ profileId: 'profile-fixture' }) },
    '@/lib/security': { noStoreHeaders: () => ({}), verifyTrustedOrigin: () => true, assertRequestBodySize: () => null, checkRateLimit: () => ({ ok: true }), getClientIp: () => 'fixture', logDashboardEvent: (...args) => events.push(args) },
    [kind === 'identity' ? '@/lib/profileNicknameSync' : '@/lib/profileCharacterSetup']: kind === 'identity'
      ? { ProfileIdentityError: DomainError, getProfileIdentityState: read, saveProfileIdentity: write, requestProfileNicknameReconciliation: write, runProfileNicknameSync: async () => { if (workerFails) throw Object.assign(Error(secret), { code: 'ECONNRESET' }); } }
      : { ProfileCharacterSetupError: DomainError, getProfileCharacterSetupState: read, saveProfileCharacterSetup: write },
  }, globals).exports;
  return { events, workers, conflict: () => fault = new DomainError(409), offline: () => fault = Object.assign(Error(secret), { cause: { code: '08006' } }), scheduleFails: () => scheduleFails = true, workerFails: () => workerFails = true, writes: () => writes,
    get: () => subject.GET(new Request('https://guild.test/api/profile/fixture')),
    post: () => subject.POST(new Request('https://guild.test/api/profile/fixture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', preferredName: secret, characterKeys: [secret] }) })) };
}
function publication(kind) {
  let loggerFails = false, pending = false; const events = []; let actions = 0;
  class Pending extends Error {}
  const subject = load(`src/app/api/${kind === 'raid' ? 'raids/[raidId]' : 'polls/[pollId]'}/discord-sync/route.ts`, {
    'next/server': { NextResponse: Reply }, '@/lib/auth': { getSession: async () => ({ id: 'staff' }) }, '@/lib/permissions': { canManageRaids: () => true }, '@/lib/accessGroups': { recordAdminAudit: async () => true },
    '@/lib/publicationStatusServer': { readPublicationStatus: async () => ({ message: { state: 'linked' } }) }, '@/lib/publicationSyncInput': { readPublicationSyncInput: async () => '' }, '@/lib/discordPublication': { DiscordPublicationPendingError: Pending },
    '@/lib/security': { noStoreHeaders: () => ({}), verifyTrustedOrigin: () => true, assertRequestBodySize: () => null, safeErrorMessage: () => 'safe', logDashboardEvent: (...args) => { if (loggerFails) throw Error('logger failed'); events.push(args); } },
    [kind === 'raid' ? '@/lib/raids' : '@/lib/raidPolls']: { [kind === 'raid' ? 'resyncRaidDiscord' : 'resyncRaidPollDiscord']: async () => { actions++; if (pending) throw new Pending('private=' + secret); return kind === 'raid' ? { scheduledEvent: { error: null } } : { poll: { id: 'fixture00' }, republished: false }; } },
  }, globals).exports;
  return { events, loggerFails: () => loggerFails = true, pending: () => pending = true, actions: () => actions, post: () => subject.POST(new Request('https://guild.test/api/fixture', { method: 'POST', body: '{}' }), { params: Promise.resolve({ [kind + 'Id']: 'fixture00' }) }) };
}
(async () => {
  await check('events for one headerless request retain one correlation ID; another request is distinct', () => {
    const f = security(), request = new Request('https://guild.test/api/fixture');
    for (const event of ['fixture.start', 'fixture.end']) f.logDashboardEvent('info', event, request, {}, { persist: false });
    f.logDashboardEvent('info', 'fixture.other', new Request(request), {}, { persist: false });
    const rows = f.events(); assert.equal(rows[0].requestId, rows[1].requestId); assert.notEqual(rows[0].requestId, rows[2].requestId);
  });
  await check('valid edge IDs survive while credential-shaped IDs are replaced', () => {
    const f = security();
    assert.equal(f.requestContext(new Request('https://guild.test', { headers: { 'x-mistblossom-request-id': 'edge-correlation-123' } })).requestId, 'edge-correlation-123');
    const result = f.requestContext(new Request('https://guild.test', { headers: { 'x-mistblossom-request-id': 'Bearer ' + secret } })); assert.ok(!JSON.stringify(result).includes(secret));
  });
  await check('details cannot replace event, timestamp, request ID, HTTP path or method', () => {
    const f = security(), request = new Request('https://guild.test/api/real', { method: 'POST' });
    const id = f.requestContext(request).requestId;
    f.logDashboardEvent('info', 'real.event', request, { event: 'fake', time: 'fake', requestId: 'fake-request-id', path: '/fake', method: 'DELETE' }, { persist: false });
    const row = f.events()[0]; assert.equal(row.event, 'real.event'); assert.notEqual(row.time, 'fake'); assert.equal(row.requestId, id); assert.equal(row.path, '/api/real'); assert.equal(row.method, 'POST');
  });
  await check('SQL log-store failure returns false and masks its console fallback', async () => {
    const f = logStore(); assert.equal(await f.recordStructuredLog({ event: 'fixture.failed' }), false); assert.equal(f.consoleLines.length, 1); assert.ok(!JSON.stringify(f.consoleLines).includes(secret));
  });
  await check('mirror failure remains a committed log with a masked console fallback', async () => {
    const f = logStore(true); assert.equal(await f.recordStructuredLog({ event: 'security.fixture', category: 'security' }), true); assert.equal(f.consoleLines.length, 1); assert.ok(!JSON.stringify(f.consoleLines).includes(secret));
  });
  await check('diagnostic causes expose only bounded known codes, never messages or payloads', () => {
    for (const [input, kind] of [[{ code: '40001' }, 'transaction_conflict'], [{ code: 'ETIMEDOUT' }, 'timeout'], [{ cause: { code: '08006' } }, 'database_unavailable'], [{ code: 'ECONNRESET' }, 'network'], [{ name: 'AbortError' }, 'aborted'], [{ code: secret, message: secret }, 'unexpected']]) {
      const result = privacy.diagnosticErrorSummary(input); assert.equal(result.errorKind, kind); assert.ok(!JSON.stringify(result).includes(secret));
    }
  });
  await check('attendance commit emits one result with phase/duration and no submitted character or preference', async () => {
    const f = attendance(), response = await f.post(); assert.equal(response.status, 200); assert.equal(f.events.length, 1);
    const details = f.events[0][3]; assert.equal(details.outcome, 'committed'); assert.equal(details.discordSync, 'scheduled'); assert.equal(details.resourceId, 'fixture00'); assert.ok(details.durationMs >= 0); assert.ok(!JSON.stringify(f.events).includes(secret)); assert.equal(f.writes(), 1);
  });
  await check('logging failure cannot turn committed attendance into a failed response', async () => {
    const f = attendance(); f.loggerFails(); assert.equal((await f.post()).status, 200); assert.equal(f.writes(), 1);
  });
  await check('unavailable after scheduling retains committed attendance and reports partial follow-up', async () => {
    const f = attendance(); f.scheduleFails(); const body = await (await f.post()).json(); assert.equal(body.ok, true); assert.equal(body.toast.tone, 'warning'); assert.equal(f.writes(), 1); assert.equal(f.events[0][3].reason, 'after_unavailable'); assert.equal(f.events[0][3].outcome, 'committed');
  });
  await check('background Discord false result is unconfirmed while the saved signup remains committed', async () => {
    const f = attendance(); f.syncResult(false); await f.post(); await f.after[0](); assert.equal(f.syncs(), 1); assert.equal(f.events[1][0], 'warn'); assert.equal(f.events[1][3].phase, 'discord_sync'); assert.equal(f.events[1][3].commitState, 'committed'); assert.equal(f.events[1][3].outcome, 'unconfirmed');
  });
  await check('successful background sync is debug-only and not persisted', async () => {
    const f = attendance(); await f.post(); await f.after[0](); assert.equal(f.events[1][0], 'debug'); assert.equal(f.events[1][4].persist, false);
  });
  await check('background exceptions are classified without replay or raw sensitive errors', async () => {
    const f = attendance(); f.syncError(Object.assign(Error(secret), { code: 'ETIMEDOUT' })); await f.post(); await f.after[0](); assert.equal(f.writes(), 1); assert.equal(f.syncs(), 1); assert.equal(f.events[1][3].errorKind, 'timeout'); assert.ok(!JSON.stringify(f.events).includes(secret));
  });
  await check('bad input and policy denial log different phases and never claim commit', async () => {
    const f = attendance(); await f.post('{'); assert.equal(f.writes(), 0); assert.equal(f.events[0][3].phase, 'input'); assert.equal(f.events[0][3].reason, 'invalid_input');
    const g = attendance(); g.policyRejects(); await g.post(); assert.equal(g.events[0][3].phase, 'commit'); assert.equal(g.events[0][3].reason, 'policy_rejected');
  });
  await check('HTML form denial logs the actual redirect status while retaining its reason', async () => {
    const f = attendance(); f.formMode(); f.policyRejects(); const response = await f.post(); assert.equal(response.status, 303); assert.equal(f.events[0][3].statusCode, response.status); assert.equal(f.events[0][3].reason, 'policy_rejected');
    const g = attendance(); g.formMode(); g.anonymous(); const login = await g.post(); assert.equal(login.status, 303); assert.equal(g.events[0][3].statusCode, login.status); assert.equal(g.events[0][3].reason, 'session_required'); assert.equal(g.writes(), 0);
  });
  await check('uncertain storage failure is not described as a rejected policy or successful save', async () => {
    const f = attendance(); f.writeError(Object.assign(Error(secret), { cause: { code: '08006' } })); await f.post(); const details = f.events[0][3]; assert.equal(details.outcome, 'unconfirmed'); assert.equal(details.errorKind, 'database_unavailable'); assert.ok(!JSON.stringify(f.events).includes(secret));
  });
  for (const kind of ['identity', 'characters']) {
    await check(kind + ' normal reads stay quiet; writes log committed metadata without input values', async () => {
      const f = profile(kind); assert.equal((await f.get()).status, 200); assert.equal(f.events.length, 0);
      assert.equal((await f.post()).status, kind === 'identity' ? 202 : 200); assert.equal(f.events[0][3].outcome, 'committed'); assert.equal(f.writes(), 1); assert.ok(!JSON.stringify(f.events).includes(secret));
    });
    await check(kind + ' revision conflict is distinguished from an uncertain storage failure', async () => {
      const f = profile(kind); f.conflict(); assert.equal((await f.post()).status, 409); assert.equal(f.events[0][3].outcome, 'conflict'); assert.equal(f.events[0][3].phase, 'write'); assert.equal(f.writes(), 0);
      const g = profile(kind); g.offline(); assert.equal((await g.get()).status, 503); assert.equal(g.events[0][3].phase, 'read'); assert.equal(g.events[0][3].outcome, 'unconfirmed'); assert.equal(g.events[0][3].errorCode, '08006'); assert.ok(!JSON.stringify(g.events).includes(secret));
    });
  }
  await check('nickname scheduling failure logs deferred work but preserves the accepted durable intent', async () => {
    const f = profile('identity'); f.scheduleFails(); assert.equal((await f.post()).status, 202); assert.equal(f.writes(), 1);
    assert.equal(f.events[0][1], 'profile.identity.worker_deferred'); assert.equal(f.events[0][3].phase, 'schedule'); assert.equal(f.events[0][3].nextAction, 'check_profile_sync'); assert.ok(!JSON.stringify(f.events).includes(secret));
  });
  await check('nickname worker failure logs its operation and safe cause without replaying the write', async () => {
    const f = profile('identity'); f.workerFails(); await f.post(); await f.workers[0](); const details = f.events[1][3];
    assert.equal(details.phase, 'worker'); assert.equal(details.outcome, 'deferred'); assert.equal(details.operationId, 'operation-fixture'); assert.equal(details.errorKind, 'network'); assert.equal(f.writes(), 1); assert.ok(!JSON.stringify(f.events).includes(secret));
  });
  for (const kind of ['raid', 'poll']) {
    await check(kind + ' publication keeps its committed HTTP result if the logger fails', async () => {
      const f = publication(kind); f.loggerFails(); assert.equal((await f.post()).status, 200); assert.equal(f.actions(), 1);
    });
    await check(kind + ' pending publication emits 409/pending and a read-only recovery action', async () => {
      const f = publication(kind); f.pending(); assert.equal((await f.post()).status, 409); assert.equal(f.events[0][3].outcome, 'pending'); assert.equal(f.events[0][3].nextAction, 'read_saved_status'); assert.ok(!JSON.stringify(f.events).includes(secret));
    });
  }
  console.log(`[check-operation-logging] OK — ${passed}/${passed}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
