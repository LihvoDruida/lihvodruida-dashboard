const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const pg = require('pg');
const { fork } = require('node:child_process');
const load = require('./lib/load-server-ts.cjs');
const ts = require('typescript');
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || url === process.env.POSTGRES_URL) throw Error('Set a separate TEST_DATABASE_URL; production URLs are refused.');
const worker = process.argv[2] === '--worker';
const schema = worker ? process.argv[3] : 'r2_' + crypto.randomBytes(12).toString('hex');
if (!/^r2_[a-f0-9]{24}$/.test(schema)) throw Error('Invalid private schema');
const pool = new pg.Pool({ connectionString: url, max: 8, options: '-c search_path=' + schema + ' -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=10000' });
pool.on('error', () => {});
const dbPool = load('src/lib/db/pgPool.ts', { pg }, { __mistblossomPgPool: pool, process: { env: { DATABASE_URL: url } } }).exports;
const { PgFirestore, FieldValue } = load('src/lib/db/documentStore.ts', { '@/lib/db/pgPool': dbPool }).exports;
const store = new PgFirestore();
let fault = null;
const faultyStore = Object.create(store);
faultyStore.runTransaction = handler => store.runTransaction(tx => handler(new Proxy(tx, {
  get(target, name) {
    if (name === 'update') return (ref, data) => { if (fault) fault(ref, data); return target.update(ref, data); };
    return typeof target[name] === 'function' ? target[name].bind(target) : target[name];
  },
})));
const globals = { setInterval, clearInterval, AbortSignal, Headers, Response, Request, FormData, URL, fetch };
const rest = load('src/lib/discordRest.ts', {}, globals).exports;
let baseUrl = worker ? process.argv[4] : '';
const messages = new Map();
let postCount = 0, editCount = 0, deleteCount = 0, reconcileCount = 0;
let mode = '', releasePost = null, seenPost = null;
const channel = '111111111111111111';
const channel2 = '222222222222222222';
let sequence = 900000000000000000n;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function request(method, body) {
  const response = await fetch(baseUrl, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new rest.DiscordRestError(json.error || 'Unknown message', response.status);
  return json;
}
const discord = {
  createDiscordRaidMessage: params => request('POST', params),
  editDiscordRaidMessage: params => request('PATCH', params),
  deleteDiscordRaidMessage: params => request('DELETE', params),
  findDiscordPublicationMessage: params => request('PUT', params),
  parseDiscordMessageRef: value => { const ids = String(value).match(/channels\/\d+\/(\d+)\/(\d+)/); return ids ? { channelId: ids[1], messageId: ids[2] } : null; },
  discordMessageUrl: (c, m) => 'https://discord.com/channels/333333333333333333/' + c + '/' + m,
};
function modules() {
  const lease = load('src/lib/automationLease.ts', { '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => faultyStore }, '@/lib/firebaseAccess': { assertFirebaseWriteAvailable() {} } }, globals).exports;
  const publication = load('src/lib/discordPublication.ts', { '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => faultyStore }, '@/lib/automationLease': lease, '@/lib/discordRest': rest }, globals).exports;
  const publisher = load('src/lib/discordMessagePublication.ts', { '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => faultyStore }, '@/lib/discordAdmin': discord, '@/lib/discordPublication': publication }, globals).exports;
  return { ...publication, ...publisher };
}
let moduleSet = modules();
const ref = id => store.collection('dashboardRaids').doc(id);
const raw = async id => (await ref(id).get()).data();
const built = data => ({ resourceUrl: 'https://guild.test/raids/' + data.id, payload: { content: '', embed: { title: data.title, timestamp: new Date().toISOString() }, components: [], mentionRoleIds: [] } });
const opts = (id, target, owned) => ({ kind: 'raid-message', collection: 'dashboardRaids', resourceId: id, channelId: target, assertOwned: owned, build: async data => built(data), patch: data => ({ status: data.status === 'closed' ? 'closed' : 'published' }) });
const publish = (id, target = channel, mod = moduleSet) => mod.withDiscordPublicationLease('raid:' + id, owned => mod.publishDiscordResourceMessage(opts(id, target, owned)));
async function seed(id, data = {}) { await ref(id).set({ id, title: id, status: 'draft', channelId: channel, messageId: null, ...data }); }
const counters = () => ({ post: postCount, edit: editCount, del: deleteCount, reconcile: reconcileCount });
// Full raid/poll modules: only rendering, auth/catalog and network boundaries
// are controlled. The publisher, form save, recovery and SQL adapter are actual.
function subject(entry, publication = moduleSet) {
  const source = ts.createSourceFile(entry, fs.readFileSync(path.resolve(__dirname, '..', entry), 'utf8'), ts.ScriptTarget.Latest, true);
  const deps = {};
  for (const node of source.statements) {
    if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
    const name = node.moduleSpecifier.text;
    if (name.startsWith('node:')) continue;
    deps[name] = new Proxy({ WOW_CLASS_CATALOG: [], RAID_ALGORITHM_UTILITY_RULES: [] }, { get(object, key) {
      return key in object ? object[key] : () => { throw Error('Unexpected dependency ' + name + '.' + String(key)); };
    } });
  }
  const values = load('src/lib/values.ts').exports;
  Object.assign(deps, {
    crypto: require('node:crypto'), '@/lib/values': values,
    '@/lib/raidPollShared': load('src/lib/raidPollShared.ts').exports,
    '@/lib/db/firestoreCompat': { FieldValue }, '@/lib/discordPublication': publication,
    '@/lib/discordMessagePublication': { publishDiscordResourceMessage: publication.publishDiscordResourceMessage },
    '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => faultyStore, hasFirebaseProfileConfig: () => true },
    '@/lib/firebaseAccess': { firebaseWrite: (_domain, _key, run) => run(), firebaseRead: (_domain, _key, run) => run() },
    '@/lib/security': { getCanonicalDashboardOrigin: () => 'https://guild.test' },
    '@/lib/runtimeResilience': { clearRuntimeCachedValue() {}, clearRuntimeCachedValuesByPrefix() {} },
    '@/lib/discordAdmin': { ...discord, getDiscordDefaultChannelId: () => channel,
      parseDiscordMessageRef: () => null,
      discordScheduledEventUrl: id => 'https://discord.com/events/333333333333333333/' + id,
      discordChannelUrl: id => 'https://discord.com/channels/333333333333333333/' + id,
      async createDiscordGuildScheduledEvent(params) {
        eventCreates++; const event = { id: String(++sequence), params }; events.set(event.id, event);
        if (eventMode === 'lost') throw Error('network response lost'); return event;
      },
      async editDiscordGuildScheduledEvent(params) { if (!events.has(params.eventId)) throw new rest.DiscordRestError('Unknown guild scheduled event 10070', 404); return { id: params.eventId }; },
      async deleteDiscordGuildScheduledEvent(params) { events.delete(params.eventId); },
      async findDiscordPublicationScheduledEvent(params) { return eventMode === 'no-history' ? null : [...events.values()].find(event => event.params.description === params.description) || null; },
    },
  });
  const result = load(entry, deps, globals);
  Object.assign(result.context, {
    normalizeRaid: (id, data) => ({ id, description: '', difficulty: 'normal', date: '2030-01-01', time: '20:00', signups: [], ...data,
      createdAt: values.timestampToIso(data.createdAt), publishedAt: values.timestampToIso(data.publishedAt), closedAt: values.timestampToIso(data.closedAt) }),
    normalizeRaidPoll: (id, data) => ({ id, votes: [], ...data }),
    buildRaidDiscordPayload: raid => ({ content: '', embed: { title: raid.title, description: raid.status + ':' + raid.signups.length }, mentionRoleIds: [] }),
    buildRaidAttendanceComponents: (_id, options) => [{ type: 1, components: [{ type: 2, custom_id: 'test', disabled: options.disabled }] }],
    buildRaidPollDiscordPayload: poll => ({ content: '', embed: { title: poll.title, description: String(poll.votes.length) }, components: [], mentionRoleIds: [] }),
    loadPublishedRaidPollsForRecommendations: async () => [],
    isRaidClosed: raid => raid.status === 'closed', isRaidRegistrationFull: () => false, isRaidRegistrationLocked: () => false,
    raidDateTimeToUtcMs: () => Date.now() + 7 * 86400000,
    clearRaidRuntimeCaches() {}, clearRaidPollRuntimeCaches() {}, clearRaidPollDiscordSignatureCache() {},
    reconcileRaidLifecycleTasksForRaid: async () => {}, saveRaidEditorDefaults: async () => {},
    hasRaidStorage: () => true, formRaidPayload: form => ({ title: String(form.get('title')), channelId: String(form.get('channelId')), date: '2030-01-01', time: '20:00' }), validateRaidPayload() {},
  });
  return result;
}
const events = new Map(); let eventCreates = 0, eventMode = '';
let passed = 0;
async function test(label, run) { fault = null; mode = ''; await run(); fault = null; mode = ''; passed++; console.log('✓ ' + label); }
async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let input = ''; for await (const chunk of req) input += chunk;
      const body = JSON.parse(input);
      let output;
      if (req.method === 'POST') {
        postCount++;
        assert.equal(body.retry, 'never'); assert.match(body.nonce, /^[a-f0-9]{25}$/);
        if (mode === 'reject') { res.writeHead(403); res.end(JSON.stringify({ error: 'Missing permissions' })); return; }
        const id = String(++sequence);
        output = { id, channel_id: body.channelId, nonce: body.nonce, payload: body };
        messages.set(id, output);
        if (mode === 'hold') { seenPost.resolve(); await releasePost.promise; }
        if (mode === 'lost') { req.socket.destroy(); return; }
      } else if (req.method === 'PATCH') {
        editCount++;
        output = messages.get(body.ref.messageId);
        if (!output || output.channel_id !== body.ref.channelId) { res.writeHead(404); res.end(JSON.stringify({ error: 'Unknown message 10008' })); return; }
        output.payload = body;
      } else if (req.method === 'DELETE') {
        deleteCount++;
        if (mode === 'cleanup-fail') { res.writeHead(403); res.end(JSON.stringify({ error: 'Missing permissions' })); return; }
        const current = await raw('move');
        if (body.ref.messageId === current?.oldId) assert.notEqual(current.messageId, current.oldId, 'new ref must commit before old deletion');
        messages.delete(body.ref.messageId); output = { ok: true };
      } else {
        reconcileCount++;
        output = mode === 'no-history' ? null : [...messages.values()].find(m => m.nonce === body.nonce && m.channel_id === body.channelId) || null;
      }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(output));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  return server;
}
function childPublish(id) {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, ['--worker', schema, baseUrl, id], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: process.env });
    let result, errorText = '';
    child.on('message', message => { result = message; }); child.stderr.on('data', b => { errorText += b; });
    child.on('error', reject); child.on('exit', code => code ? reject(Error(errorText || 'child failed')) : resolve(result));
  });
}
(async () => {
  if (worker) {
    try { process.send({ ok: true, result: await publish(process.argv[5]) }); }
    catch (error) { if (error instanceof moduleSet.DiscordPublicationPendingError) process.send({ ok: false, reason: error.reason }); else throw error; }
    return;
  }
  await pool.query('CREATE SCHEMA ' + schema);
  const server = await startServer();
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../src/lib/db/schema.sql'), 'utf8'));
    console.log('[publication-pg] PostgreSQL ' + (await pool.query('SHOW server_version')).rows[0].server_version + '; real HTTP boundary; private schema');
    await test('D03: two concurrent draft publications send one POST', async () => {
      await seed('parallel'); seenPost = deferred(); releasePost = deferred(); mode = 'hold';
      const before = counters(); const first = publish('parallel'); await seenPost.promise;
      await assert.rejects(publish('parallel', channel, modules()), error => error.reason === 'busy');
      releasePost.resolve(); const result = await first;
      assert.equal(postCount - before.post, 1); assert.equal((await raw('parallel')).messageId, result.messageId);
    });
    await test('restart reloads the known publication and edits the same ID', async () => {
      const before = counters(); const known = (await raw('parallel')).messageId;
      assert.equal((await publish('parallel', channel, modules())).messageId, known);
      assert.equal(postCount, before.post); assert.equal(editCount - before.edit, 1);
    });
    await test('Discord accepted POST but response was lost: reconcile, never blind POST', async () => {
      await seed('lost'); mode = 'lost'; const before = counters();
      await assert.rejects(publish('lost'), error => error.reason === 'uncertain');
      const op = await moduleSet.getDiscordPublicationOperation('raid-message', 'lost'); assert.equal(op.state, 'uncertain');
      mode = ''; const result = await publish('lost', channel, modules());
      assert.equal(postCount - before.post, 1); assert.equal(reconcileCount - before.reconcile, 1); assert.equal((await raw('lost')).messageId, result.messageId);
    });
    await test('failure storing the Discord response leaves sending receipt; restart reconciles', async () => {
      await seed('receipt-fail'); let once = true; const before = counters();
      fault = (doc, patch) => { if (once && doc.collectionName === 'discordPublications' && patch.state === 'confirmed') { once = false; throw Error('injected receipt failure'); } };
      await assert.rejects(publish('receipt-fail'), /injected/);
      assert.equal((await moduleSet.getDiscordPublicationOperation('raid-message', 'receipt-fail')).state, 'sending');
      fault = null; await publish('receipt-fail', channel, modules()); assert.equal(postCount - before.post, 1);
    });
    await test('failure committing refs retains confirmed ID and retries without POST or GET', async () => {
      await seed('commit-fail'); let once = true; const before = counters();
      fault = (doc, patch) => { if (once && doc.collectionName === 'dashboardRaids' && patch.messageId) { once = false; throw Error('injected resource commit failure'); } };
      await assert.rejects(publish('commit-fail'), /injected/);
      assert.equal((await moduleSet.getDiscordPublicationOperation('raid-message', 'commit-fail')).state, 'confirmed');
      fault = null; await publish('commit-fail', channel, modules());
      assert.equal(postCount - before.post, 1); assert.equal(reconcileCount, before.reconcile);
    });
    await test('no history and changed channel/revision remain uncertain past nonce window', async () => {
      await seed('unknown'); mode = 'lost'; await assert.rejects(publish('unknown'));
      const op = await moduleSet.getDiscordPublicationOperation('raid-message', 'unknown');
      await moduleSet.updateDiscordPublicationOperation('raid-message', 'unknown', op.nonce, { startedAt: new Date(Date.now() - 2 * 3600000).toISOString() });
      const before = counters(); await ref('unknown').update({ title: 'changed', channelId: channel2 }); mode = 'no-history';
      await assert.rejects(publish('unknown', channel2, modules()), error => error.reason === 'uncertain');
      assert.equal(postCount, before.post); assert.equal((await moduleSet.getDiscordPublicationOperation('raid-message', 'unknown')).nonce, op.nonce);
    });
    await test('changed target recovers original operation before controlled move', async () => {
      const before = counters(); await publish('unknown', channel2);
      assert.equal(postCount - before.post, 1); assert.equal((await raw('unknown')).discordMessageChannelId, channel2);
      assert.equal((await moduleSet.getDiscordPublicationOperation('raid-message', 'unknown')).cleanupDone, true);
    });
    await test('moving channels commits new ref before deleting old; repeated cleanup is skipped', async () => {
      await seed('move'); const old = await publish('move'); await ref('move').update({ oldId: old.messageId, channelId: channel2 });
      const before = counters(); const moved = await publish('move', channel2);
      assert.notEqual(moved.messageId, old.messageId); assert.equal(postCount - before.post, 1); assert.equal(messages.has(old.messageId), false);
      const deleted = deleteCount; await publish('move', channel2); assert.equal(deleteCount, deleted);
    });
    await test('cleanup failure retains both known refs; next call retries DELETE without POST', async () => {
      await seed('cleanup'); const old = await publish('cleanup'); const before = counters(); mode = 'cleanup-fail';
      await assert.rejects(publish('cleanup', channel2), /Старе повідомлення/); assert.notEqual((await raw('cleanup')).messageId, old.messageId);
      mode = ''; await publish('cleanup', channel2); assert.equal(postCount - before.post, 1); assert.equal(messages.has(old.messageId), false);
    });
    await test('404 re-creation uses one durable operation with fresh references', async () => {
      await seed('missing'); const old = await publish('missing'); messages.delete(old.messageId); const before = counters();
      const next = await publish('missing'); assert.notEqual(next.messageId, old.messageId); assert.equal(postCount - before.post, 1);
    });
    await test('publication commit preserves fresh signup and closed status', async () => {
      await seed('fresh'); seenPost = deferred(); releasePost = deferred(); mode = 'hold'; const result = publish('fresh'); await seenPost.promise;
      await ref('fresh').update({ status: 'closed', signups: [{ discordId: 'one' }] }); releasePost.resolve(); await result;
      const data = await raw('fresh'); assert.equal(data.status, 'closed'); assert.equal(data.signups.length, 1);
    });
    await test('deleted resource cannot be resurrected; confirmed receipt retains external ID', async () => {
      await seed('deleted'); seenPost = deferred(); releasePost = deferred(); mode = 'hold'; const result = publish('deleted'); await seenPost.promise;
      await ref('deleted').delete(); releasePost.resolve(); await assert.rejects(result, /видалено/);
      assert.equal((await ref('deleted').get()).exists, false); assert.equal((await moduleSet.getDiscordPublicationOperation('raid-message', 'deleted')).state, 'confirmed');
    });
    await test('explicit 403 rejection permits a new attempt after permissions change', async () => {
      await seed('rejected'); mode = 'reject'; await assert.rejects(publish('rejected'), /Missing permissions/);
      const first = await moduleSet.getDiscordPublicationOperation('raid-message', 'rejected'); assert.equal(first.state, 'rejected');
      mode = ''; await publish('rejected'); assert.notEqual((await moduleSet.getDiscordPublicationOperation('raid-message', 'rejected')).nonce, first.nonce);
    });
    await test('expired lease cannot commit; next owner reconciles the in-flight create', async () => {
      await seed('expired'); seenPost = deferred(); releasePost = deferred(); mode = 'hold'; const before = counters();
      const first = publish('expired'); await seenPost.promise;
      const leaseKey = 'publication_' + moduleSet.publicationRevision('raid:expired'); await store.collection('automationLeases').doc(leaseKey).update({ expiresAtMs: 0 });
      mode = 'no-history'; await assert.rejects(publish('expired', channel, modules()), error => error.reason === 'uncertain');
      mode = ''; releasePost.resolve(); await assert.rejects(first, /втрачено/); await publish('expired'); assert.equal(postCount - before.post, 1);
    });
    await test('two independent Node processes share publication protection', async () => {
      await seed('processes'); const before = counters(); const results = await Promise.all([childPublish('processes'), childPublish('processes')]);
      assert.ok(results.some(r => r.ok)); assert.equal(postCount - before.post, 1); assert.ok((await raw('processes')).messageId);
    });
    await test('poll domain independently prevents concurrent creates and recovers lost response', async () => {
      const pollRef = store.collection('dashboardRaidPolls').doc('poll'); await pollRef.set({ id: 'poll', title: 'poll', channelId: channel });
      const run = mod => mod.withDiscordPublicationLease('poll:poll', owned => mod.publishDiscordResourceMessage({ ...opts('poll', channel, owned), kind: 'poll-message', collection: 'dashboardRaidPolls' }));
      const before = counters(); mode = 'lost'; await assert.rejects(run(moduleSet)); mode = ''; const result = await run(modules());
      assert.equal(postCount - before.post, 1); assert.equal((await pollRef.get()).data().messageId, result.messageId);
    });
    await test('actual raid publisher ignores stale input references and renders latest signup', async () => {
      await seed('actual'); const first = await publish('actual'); await ref('actual').update({ signups: [{ discordId: 'joined' }] });
      const before = counters(); const raids = subject('src/lib/raids.ts');
      const result = await raids.exports.publishOrUpdateRaid({ id: 'actual', messageId: null }, channel, { syncScheduledEvent: false });
      assert.equal(result.messageId, first.messageId); assert.equal(postCount, before.post);
      assert.equal(messages.get(first.messageId).payload.embed.description, 'published:1');
    });
    await test('actual raid save: duplicate new-form token creates one draft and preserves roster', async () => {
      const raids = subject('src/lib/raids.ts'); const user = { id: 'admin', provider: 'discord' };
      const form = new FormData(); form.set('creationToken', crypto.randomUUID()); form.set('title', 'token'); form.set('channelId', channel);
      const drafts = await Promise.all([raids.exports.saveRaidFromForm(form, user), raids.exports.saveRaidFromForm(form, user)]);
      assert.equal(drafts[0].id, drafts[1].id); await ref(drafts[0].id).update({ status: 'published', signups: [{ discordId: 'joined' }] });
      const next = await raids.exports.saveRaidFromForm(form, user); assert.equal(next.status, 'published'); assert.equal(next.signups.length, 1);
    });
    await test('actual raid publisher preserves the announcement channel when form moves target', async () => {
      await seed('form-move'); const first = await publish('form-move');
      const raids = subject('src/lib/raids.ts'); const form = new FormData(); form.set('raidId', 'form-move'); form.set('title', 'form-move'); form.set('channelId', channel2);
      const saved = await raids.exports.saveRaidFromForm(form, { id: 'admin', provider: 'discord' });
      assert.equal(saved.discordMessageChannelId, channel);
      const result = await raids.exports.publishOrUpdateRaid(saved, channel2, { syncScheduledEvent: false });
      assert.notEqual(result.messageId, first.messageId); assert.equal(messages.has(first.messageId), false);
    });
    await test('actual raid Scheduled Event: lost CREATE response recovers one event', async () => {
      await seed('event-lost'); const raids = subject('src/lib/raids.ts'); const before = eventCreates; eventMode = 'lost';
      const first = await raids.exports.publishOrUpdateRaid({ id: 'event-lost' }); assert.equal(first.scheduledEvent.action, 'failed');
      eventMode = ''; const next = await subject('src/lib/raids.ts', modules()).exports.publishOrUpdateRaid({ id: 'event-lost' });
      assert.equal(next.scheduledEvent.action, 'updated'); assert.ok(next.scheduledEvent.eventId); assert.equal(eventCreates - before, 1);
    });
    await test('actual Scheduled Event: commit failure retries the captured ID without CREATE', async () => {
      await seed('event-commit'); const before = eventCreates; let once = true;
      fault = (doc, patch) => { if (once && doc.collectionName === 'dashboardRaids' && patch.discordEventId) { once = false; throw Error('event commit failure'); } };
      const first = await subject('src/lib/raids.ts').exports.publishOrUpdateRaid({ id: 'event-commit' }); assert.equal(first.scheduledEvent.action, 'failed');
      fault = null; const next = await subject('src/lib/raids.ts', modules()).exports.publishOrUpdateRaid({ id: 'event-commit' });
      assert.ok(next.scheduledEvent.eventId); assert.equal(eventCreates - before, 1);
    });
    await test('disabling an uncertain event reconciles and deletes it before returning', async () => {
      await seed('event-disable'); eventMode = 'lost'; const before = eventCreates;
      await subject('src/lib/raids.ts').exports.publishOrUpdateRaid({ id: 'event-disable' });
      await ref('event-disable').update({ discordEventEnabled: false }); eventMode = '';
      const next = await subject('src/lib/raids.ts', modules()).exports.publishOrUpdateRaid({ id: 'event-disable' });
      assert.equal(next.scheduledEvent.action, 'deleted'); assert.equal(eventCreates - before, 1); assert.equal((await raw('event-disable')).discordEventId, null);
    });
    await test('actual poll publisher reads fresh refs, preventing stale snapshot duplication', async () => {
      const doc = store.collection('dashboardRaidPolls').doc('actual-poll'); await doc.set({ id: 'actual-poll', title: 'actual-poll', status: 'open', channelId: channel });
      const polls = subject('src/lib/raidPolls.ts'); const before = counters();
      const first = await polls.context.publishOrUpdatePollDiscordMessage({ id: 'actual-poll', channelId: channel, status: 'open' });
      const next = await subject('src/lib/raidPolls.ts', modules()).context.publishOrUpdatePollDiscordMessage({ id: 'actual-poll', channelId: channel, status: 'open', messageId: null });
      assert.equal(next.messageId, first.messageId); assert.equal(postCount - before.post, 1);
    });
    await test('actual scheduled poll: failed status commit keeps receipt and reuses publication', async () => {
      const id = 'scheduled-poll', lockId = 'scheduled-lock'; const doc = store.collection('dashboardRaidPolls').doc(id);
      const template = { id, title: id, description: '', status: 'scheduled', channelId: channel, closeAfterMinutes: 60, scheduledPublishAtMs: Date.now() - 1000, scheduledPublishLockId: lockId, votes: [], autoRepeatWeekly: false };
      await doc.set(template); const before = counters(); let once = true;
      fault = (document, patch) => { if (once && document.collectionName === 'dashboardRaidPolls' && patch.status === 'open') { once = false; throw Error('scheduled status commit failure'); } };
      await assert.rejects(subject('src/lib/raidPolls.ts').context.publishClaimedScheduledRaidPoll(template, lockId), /scheduled status commit/);
      const known = (await doc.get()).data().messageId; assert.ok(known); fault = null;
      await doc.update({ scheduledPublishLockId: lockId });
      await subject('src/lib/raidPolls.ts', modules()).context.publishClaimedScheduledRaidPoll(template, lockId);
      assert.equal(postCount - before.post, 1); assert.equal((await doc.get()).data().messageId, known); assert.equal((await doc.get()).data().status, 'open');
    });
    await test('actual weekly repeat: retry resumes one successor and preserves votes', async () => {
      const template = { id: 'repeat-parent', title: 'repeat', description: '', status: 'open', channelId: channel, closeAfterMinutes: 60, repeatWeeklyDay: 'mon', repeatWeeklyTime: '12:00', repeatNextAtMs: Date.now() - 1000, votes: [], days: ['mon'] };
      const polls = subject('src/lib/raidPolls.ts'); polls.context.savePollDiscordRef = async () => { throw Error('repeat post-commit failure'); };
      const before = counters(); await assert.rejects(polls.context.createRepeatedRaidPoll(template), /repeat post-commit/);
      const id = moduleSet.publicationRevision(['poll-repeat', template.id, template.repeatNextAtMs]).slice(0, 32);
      const doc = store.collection('dashboardRaidPolls').doc(id); const known = (await doc.get()).data().messageId; assert.ok(known);
      await doc.update({ votes: [{ discordId: 'voter' }] });
      const retry = subject('src/lib/raidPolls.ts', modules()); retry.context.deleteRaidPoll = async () => ({ discordDeleted: false, discordDeleteFailed: false });
      await retry.context.createRepeatedRaidPoll(template);
      assert.equal(postCount - before.post, 1); assert.equal((await doc.get()).data().messageId, known); assert.equal((await doc.get()).data().votes.length, 1);
    });
    await test('message commit preserves a target selected while the old publication is in flight', async () => {
      await seed('desired-target'); seenPost = deferred(); releasePost = deferred(); mode = 'hold';
      const first = publish('desired-target'); await seenPost.promise;
      await ref('desired-target').update({ channelId: channel2 }); releasePost.resolve(); await first;
      assert.equal((await raw('desired-target')).channelId, channel2);
      assert.equal((await raw('desired-target')).discordMessageChannelId, channel);
    });
    console.log('[publication-pg] ' + passed + '/' + passed + ' passed');
  } finally { await new Promise(resolve => server.close(resolve)); await pool.query('DROP SCHEMA ' + schema + ' CASCADE'); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
