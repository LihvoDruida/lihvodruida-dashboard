const assert = require('node:assert/strict');
const loader = require('./lib/load-server-ts.cjs');
const load = (file, mocks = {}, globals = {}) => loader(file, mocks, { Error, Request, Response, Headers, TextEncoder, ...globals }).exports;
const status = load('src/lib/publicationStatus.ts');
const input = load('src/lib/publicationSyncInput.ts');
const plain = v => JSON.parse(JSON.stringify(v));
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
const channel = '111111111111111111', oldChannel = '222222222222222222', id = '900000000000000001';
function fixture(state) {
  const rows = new Map(); let queue = Promise.resolve();
  const calls = { create: 0, edit: 0, reconcile: 0, delete: 0, leases: 0 };
  let found = null, cleanupFails = false, offline = false;
  const ref = (collection, id) => ({ collection, id, get: async () => snap({ collection, id }) });
  const key = r => `${r.collection}/${r.id}`;
  const snap = r => { if (offline) throw Error('offline'); return { id: r.id, exists: rows.has(key(r)), data: () => rows.get(key(r)) }; };
  const db = { collection: c => ({ doc: id => ref(c, id), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }), runTransaction(fn) {
    const pending = queue.then(async () => {
      const writes = [];
      const out = await fn({ get: async r => snap(r), set: (r, p) => writes.push([r, p, false]), update: (r, p) => writes.push([r, p, true]) });
      for (const [r, p, merge] of writes) rows.set(key(r), { ...(merge ? rows.get(key(r)) : {}), ...p });
      return out;
    }); queue = pending.catch(() => {}); return pending;
  } };
  const publication = load('src/lib/discordPublication.ts', {
    '@/lib/documentDb': { getDocumentDb: () => db }, '@/lib/automationLease': { acquireAutomationLease: async () => ({ assertOwned: async () => {}, release: async () => {} }) },
    '@/lib/discordRest': { DiscordRestError: class extends Error {} },
  });
  const opKey = 'discordPublications/' + publication.publicationRevision(['poll-message', 'fixture00']);
  rows.set('dashboardRaidPolls/fixture00', { channelId: channel, status: 'open' });
  if (state) rows.set(opKey, { kind: 'poll-message', resourceId: 'fixture00', key: 'old-key', state, target: channel, previousId: '', revision: 'old-rev', nonce: 'fixture-nonce', startedAt: new Date().toISOString(), context: { payload: { content: '', embed: {}, components: [], mentionRoleIds: [] }, resourceUrl: 'https://guild.test/polls/fixture00' }, result: ['confirmed','complete'].includes(state) ? { id } : null });
  const admin = {
    discordMessageUrl: (c, m) => `https://discord.com/channels/333333333333333333/${c}/${m}`,
    parseDiscordMessageRef: value => { const parts = String(value).split('/'); return parts.length === 7 ? { channelId: parts[5], messageId: parts[6] } : null; },
    createDiscordRaidMessage: async () => { calls.create++; return { id, channel_id: channel }; },
    editDiscordRaidMessage: async () => { calls.edit++; },
    findDiscordPublicationMessage: async () => { calls.reconcile++; return found; },
    deleteDiscordRaidMessage: async () => { calls.delete++; if (cleanupFails) throw Error('403'); },
  };
  const messages = load('src/lib/discordMessagePublication.ts', { '@/lib/documentDb': { getDocumentDb: () => db }, '@/lib/discordAdmin': admin, '@/lib/discordPublication': publication });
  const server = load('src/lib/publicationStatusServer.ts', { '@/lib/documentDb': { getDocumentDb: () => db }, '@/lib/discordPublication': publication, '@/lib/publicationStatus': status });
  const publish = () => messages.publishDiscordResourceMessage({ kind: 'poll-message', collection: 'dashboardRaidPolls', resourceId: 'fixture00', channelId: channel, assertOwned: async () => {}, build: async () => ({ payload: { content: '', embed: {}, components: [], mentionRoleIds: [] }, resourceUrl: 'https://guild.test/polls/fixture00' }) });
  return { rows, calls, db, publication, admin, messages, server, opKey, publish, found: v => found = v, cleanupFails: v => cleanupFails = v, offline: v => offline = v };
}
(async () => {
  await check('all durable states have distinct recovery descriptions', () => {
    for (const state of ['prepared','sending','uncertain','confirmed','rejected']) {
      const view = status.describePublication({ state, context: {} }); assert.equal(view.state, state); assert.equal(view.manual, ['sending','uncertain'].includes(state));
    }
    assert.equal(status.describePublication(undefined, true).state, 'linked');
    assert.equal(status.describePublication(undefined, false).state, 'unpublished');
    assert.equal(status.unknownPublicationStatus().canAct, false);
  });
  await check('pending receipt takes priority over an existing old message reference', () => {
    const s = status.buildPublicationStatus('poll', { messageId: id, channelId: channel }, { state: 'uncertain', context: {} });
    assert.equal(s.message.state, 'uncertain'); assert.equal(s.manualAllowed, true);
  });
  await check('cleanup and legacy channel transfers are visible', () => {
    assert.equal(status.describePublication({ state: 'complete', previousId: id, target: channel, context: { previousChannelId: oldChannel } }).state, 'cleanup');
    assert.equal(status.buildPublicationStatus('poll', { messageId: id, channelId: channel, messageUrl: `https://discord.com/channels/333333333333333333/${oldChannel}/${id}` }).channelMove, true);
  });
  await check('future schedules and closed unpublished raids have no create action', () => {
    assert.equal(status.buildPublicationStatus('poll', { status: 'scheduled', channelId: channel, scheduledPublishAtMs: Date.now() + 60000 }).canAct, false);
    assert.equal(status.buildPublicationStatus('poll', { status: 'scheduled', channelId: channel, scheduledPublishAtMs: Date.now() - 1000 }).canAct, true);
    assert.equal(status.buildPublicationStatus('raid', { status: 'closed', channelId: channel }).canAct, false);
    assert.equal(status.buildPublicationStatus('raid', { status: 'closed', channelId: channel }, { state: 'uncertain', context: {} }).canAct, true);
  });
  await check('message and event receipts remain independent', () => {
    const s = status.buildPublicationStatus('raid', { messageId: id, channelId: channel }, undefined, { state: 'confirmed', context: {} });
    assert.equal(s.message.state, 'linked'); assert.equal(s.event.state, 'confirmed'); assert.match(s.actionLabel, /завершити/);
  });
  await check('GET status reads a fresh transaction without Discord or receipt secrets', async () => {
    const f = fixture('uncertain'); f.rows.get(f.opKey).error = 'secret';
    const s = await f.server.readPublicationStatus('poll', 'fixture00');
    assert.equal(s.message.state, 'uncertain'); assert.equal(JSON.stringify(s).includes('fixture-nonce'), false); assert.equal(JSON.stringify(s).includes('secret'), false);
    assert.equal(Object.values(f.calls).every(v => v === 0), true);
    f.rows.delete('dashboardRaidPolls/fixture00'); assert.equal(await f.server.readPublicationStatus('poll', 'fixture00'), null);
  });
  await check('storage failure is unknown, never unpublished', async () => {
    const f = fixture(); f.offline(true); assert.equal((await f.server.readPublicationStatus('poll','fixture00')).message.state, 'unknown');
  });
  await check('prepared operation creates once and completes durable reference', async () => {
    const f = fixture('prepared'); await f.publish(); await f.publish(); assert.equal(f.calls.create, 1); assert.equal(f.rows.get(f.opKey).state, 'complete');
  });
  for (const state of ['sending','uncertain']) await check(state + ' absence in history never creates another message', async () => {
    const f = fixture(state); await assert.rejects(f.publish(), f.publication.DiscordPublicationPendingError); assert.equal(f.calls.create, 0); assert.equal(f.calls.reconcile, 1);
  });
  await check('manual/nonce recovery confirms a pending operation without CREATE', async () => {
    const f = fixture('uncertain'); f.found({ id }); await f.publish(); assert.equal(f.calls.create, 0); assert.equal(f.rows.get(f.opKey).state, 'complete');
  });
  await check('known confirmed ID finishes without CREATE or history lookup', async () => {
    const f = fixture('confirmed'); await f.publish(); assert.equal(f.calls.create, 0); assert.equal(f.calls.reconcile, 0); assert.equal(f.rows.get('dashboardRaidPolls/fixture00').messageId, id);
  });
  await check('failed old-message cleanup retries deletion without another CREATE', async () => {
    const f = fixture('complete'); Object.assign(f.rows.get(f.opKey), { previousId: '800000000000000001', context: { previousChannelId: oldChannel } });
    Object.assign(f.rows.get('dashboardRaidPolls/fixture00'), { messageId: id, discordMessageChannelId: channel });
    f.cleanupFails(true); await assert.rejects(f.publish(), /прибрати/); assert.equal(f.calls.create, 0);
    f.cleanupFails(false); await f.publish(); assert.equal(f.calls.create, 0); assert.equal(f.calls.delete, 2); assert.equal(f.rows.get(f.opKey).cleanupDone, true);
  });
  await check('malformed and foreign recovery URLs are rejected before action', async () => {
    for (const body of ['{', '[]', 'null', '{"publicationMessageUrl":42}', '{"publicationMessageUrl":"https://evil.test/x"}', JSON.stringify({ publicationMessageUrl:'x'.repeat(301) })]) await assert.rejects(input.readPublicationSyncInput(new Request('https://guild.test', { method:'POST', body })));
    const url = `https://discord.com/channels/333333333333333333/${channel}/${id}`;
    assert.equal(await input.readPublicationSyncInput(new Request('https://guild.test', { method:'POST', body:JSON.stringify({publicationMessageUrl:url}) })), url);
  });
  function pollFixture() {
    const f = fixture('uncertain');
    let publications = 0, manual = null;
    const shared = load('src/lib/raidPollShared.ts');
    const values = load('src/lib/values.ts');
    const polls = load('src/lib/raidPolls.ts', {
      crypto: require('node:crypto'),
      '@/lib/discordPublication': { ...f.publication, withDiscordPublicationLease: async (key, fn) => { f.calls.leases++; return fn(async () => {}); } },
      '@/lib/discordMessagePublication': { publishDiscordResourceMessage: async options => { publications++; manual = options.manualRef;
        Object.assign(f.rows.get('dashboardRaidPolls/fixture00'), { messageId:id, discordMessageChannelId:channel });
        return { channelId:channel, messageId:id, messageUrl:f.admin.discordMessageUrl(channel,id), cleanupWarning:null };
      } },
      '@/lib/db/documentValues': { FieldValue: { delete: () => null } },
      '@/lib/storageAccess': { storageRead: async (_domain,_key,fn) => fn(), storageWrite: async (_domain,_key,fn) => fn(), storageUnavailableMessage: () => 'offline' },
      '@/lib/runtimeResilience': { clearRuntimeCachedValue(){}, clearRuntimeCachedValuesByPrefix(){}, getRuntimeCachedValue(){}, setRuntimeCachedValue(){} },
      '@/lib/concurrency': {}, '@/lib/documentDb': { getDocumentDb: () => f.db, hasDocumentDbConfig: () => true },
      '@/lib/discordAdmin': { ...f.admin, getDiscordDefaultChannelId: () => channel },
      '@/lib/raidCompositionAlgorithm': {}, '@/lib/raidPollShared': shared, '@/lib/values': values,
      '@/lib/discordInteractionStorage': {}, '@/lib/discordInteractionRecovery': {},
    });
    return { ...f, polls, publications: () => publications, manual: () => manual };
  }
  await check('actual poll resync enters lease and publication pipeline even with an old linked message', async () => {
    const f = pollFixture(); Object.assign(f.rows.get('dashboardRaidPolls/fixture00'), { messageId:id, discordMessageChannelId:oldChannel });
    const result = await f.polls.resyncRaidPollDiscord('fixture00', f.admin.discordMessageUrl(channel,id));
    assert.equal(f.publications(),1); assert.equal(f.calls.leases,1); assert.equal(f.calls.edit,0); assert.equal(f.manual().messageId,id); assert.equal(result.republished,false);
  });
  await check('actual scheduled poll cannot publish early or bypass an active claim', async () => {
    const f = pollFixture(); Object.assign(f.rows.get('dashboardRaidPolls/fixture00'), { status:'scheduled', scheduledPublishAtMs:Date.now()+60000 });
    await assert.rejects(f.polls.resyncRaidPollDiscord('fixture00'), /ще не настав/); assert.equal(f.publications(),0);
    Object.assign(f.rows.get('dashboardRaidPolls/fixture00'), { scheduledPublishAtMs:Date.now()-60000, scheduledPublishLockedAtMs:Date.now(), scheduledPublishLockId:'other-process' });
    await assert.rejects(f.polls.resyncRaidPollDiscord('fixture00'), /інший процес/); assert.equal(f.publications(),0);
  });
  await check('actual due scheduled poll reuses claim/commit and preserves one resource', async () => {
    const f = pollFixture(); Object.assign(f.rows.get('dashboardRaidPolls/fixture00'), { status:'scheduled', scheduledPublishAtMs:Date.now()-60000 });
    const result = await f.polls.resyncRaidPollDiscord('fixture00');
    assert.equal(f.publications(),1); assert.equal(result.poll.status,'open'); assert.equal(f.rows.get('dashboardRaidPolls/fixture00').status,'open');
    assert.equal(f.rows.get('dashboardRaidPolls/fixture00').messageId,id);
  });
  // Both real route modules with authority/transport seams replaced.
  for (const kind of ['raid','poll']) await check(kind + ' routes enforce authority, Origin, body and preserve pending result', async () => {
    let user = null, permitted = false, trusted = true, actions = 0, reads = 0, fail = false;
    const f = fixture();
    const route = load(`src/app/api/${kind}s/[${kind}Id]/discord-sync/route.ts`, {
      'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { ...init, headers:{...init.headers,'Content-Type':'application/json'} }) } },
      '@/lib/auth': { getSession: async () => user }, '@/lib/permissions': { canManageRaids: () => permitted }, '@/lib/accessGroups': { recordAdminAudit: async () => true },
      '@/lib/publicationStatusServer': { readPublicationStatus: async () => { reads++; return status.unknownPublicationStatus(); } }, '@/lib/publicationSyncInput': input, '@/lib/discordPublication': f.publication,
      ['@/lib/' + (kind==='raid'?'raids':'raidPolls')]: { [kind==='raid'?'resyncRaidDiscord':'resyncRaidPollDiscord']: async () => { actions++; if(fail) throw new f.publication.DiscordPublicationPendingError('uncertain'); return kind==='raid'?{scheduledEvent:{error:null}}:{poll:{id:'fixture00'},republished:false}; } },
      '@/lib/security': { noStoreHeaders: () => ({'Cache-Control':'no-store'}), verifyTrustedOrigin: () => trusted, assertRequestBodySize: () => null, logDashboardEvent(){}, safeErrorMessage: e => e.message },
    });
    const context = { params: Promise.resolve({ [kind+'Id']:'fixture00' }) };
    const req = body => new Request('https://guild.test/api', { method:'POST', body });
    assert.equal((await route.GET(req(''),context)).status,403); assert.equal((await route.POST(req(''),context)).status,403);
    user={id:'staff'}; assert.equal((await route.POST(req(''),context)).status,403); permitted=true; trusted=false; assert.equal((await route.POST(req(''),context)).status,403);
    trusted=true; assert.equal((await route.POST(req('{'),context)).status,400); assert.equal(actions,0); assert.equal(reads,0);
    const read = await route.GET(req(''),context); assert.equal(read.status,200); assert.equal(read.headers.get('Cache-Control'),'no-store'); assert.equal(actions,0);
    assert.equal((await route.POST(req('{}'),context)).status,200); assert.equal(actions,1);
    fail=true; assert.equal((await route.POST(req('{}'),context)).status,409); assert.equal(actions,2);
  });
  console.log(`[check-publication-workbench] ${passed}/${passed} passed`);
})().catch(e => { console.error(e); process.exitCode=1; });
