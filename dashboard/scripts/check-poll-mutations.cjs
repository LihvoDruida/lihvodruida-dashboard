const assert = require('node:assert/strict');
const load = require('./lib/load-server-ts.cjs');
let response = () => new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
const calls = [];
const globals = { Error, Headers, Request, Response, URL, AbortSignal, AbortController, DOMException,
  fetch: async (url, options) => { calls.push({ url, options }); return response(url, options); } };
const http = load('src/lib/apiHttp.ts', {}, globals).exports;
const client = load('src/lib/dashboardApiClient.ts', { '@/lib/apiHttp': http }, globals).exports;
const toasts = load('src/lib/clientToasts.ts', {}, globals).exports;
const subject = load('src/lib/raidPollMutation.ts', { '@/lib/apiHttp': http, '@/lib/dashboardApiClient': client, '@/lib/clientToasts': toasts }, globals).exports;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let passed = 0;
async function check(name, run) { calls.length = 0; await run(); passed++; console.log('PASS', name); }
async function fail(outcome) { await assert.rejects(subject.requestRaidPollMutation('https://guild.test/api/polls/fixture00/close', { method: 'POST', action: 'close-raid-poll', json: { action: 'close' } }), error => subject.raidPollMutationFailure(error).outcome === outcome); assert.equal(calls.length, 1); }
(async () => {
  await check('explicit ok:true confirms exactly one POST with the original action', async () => {
    response = () => json({ ok: true }); assert.equal((await subject.requestRaidPollMutation('https://guild.test/api/polls/fixture00/close', { method: 'POST', action: 'close-raid-poll', json: { action: 'close' } })).ok, true);
    assert.equal(calls.length, 1); const { options } = calls[0]; assert.equal(options.method, 'POST'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.headers.get('x-dashboard-action'), 'close-raid-poll'); assert.deepEqual(JSON.parse(options.body), { action: 'close' }); assert.ok(options.signal instanceof AbortSignal);
  });
  for (const [name, value] of [['null', null], ['array', []], ['empty object', {}], ['string', 'ok'], ['numeric true', { ok: 1 }], ['string true', { ok: 'true' }]]) {
    await check('HTTP 200 ' + name + ' is unconfirmed without replay', async () => { response = () => json(value); await fail('unconfirmed'); });
  }
  await check('HTTP 200 HTML does not confirm or expose the raw page', async () => { response = () => new Response('<html>private sign-in page</html>', { headers: { 'content-type': 'text/html' } }); await fail('unconfirmed'); assert.equal(subject.raidPollMutationFailure(Error('private sign-in page')).message.includes('private'), false); });
  await check('malformed JSON and empty HTTP bodies are unconfirmed', async () => { for (const body of ['{bad', '']) { calls.length = 0; response = () => new Response(body, { headers: { 'content-type': 'application/json' } }); await fail('unconfirmed'); } });
  await check('explicit domain rejection retains its reason', async () => { response = () => json({ ok: false, error: 'Revision conflict' }); await assert.rejects(subject.requestRaidPollMutation('https://guild.test/api/polls/fixture00', { method: 'DELETE', action: 'delete' }), error => { const result = subject.raidPollMutationFailure(error); assert.equal(result.outcome, 'rejected'); assert.equal(result.message, 'Revision conflict'); return true; }); assert.equal(calls.length, 1); });
  for (const [status, outcome] of [[403, 'rejected'], [400, 'unconfirmed'], [409, 'unconfirmed'], [408, 'unconfirmed'], [503, 'unconfirmed']]) {
    await check('HTTP ' + status + ' is ' + outcome + ' and is sent once', async () => { response = () => json({ error: 'Controlled' }, status); await fail(outcome); });
  }
  await check('network failure never replays an uncertain operation', async () => { response = () => { throw new TypeError('Network failed'); }; await fail('unconfirmed'); });
  await check('aborting an in-flight request rejects once and removes its waiter', async () => {
    let listened = false;
    response = (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => { listened = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true }); });
    const controller = new AbortController(); const pending = subject.requestRaidPollMutation('https://guild.test/api/polls/fixture00', { method: 'DELETE', action: 'delete', signal: controller.signal }); controller.abort(); await assert.rejects(pending); assert.equal(listened, true); assert.equal(calls.length, 1);
  });
  await check('partial Discord result remains committed metadata and redirect stays local', async () => { response = () => json({ ok: true, warning: 'Check Discord', discordDeleteFailed: true, redirectTo: 'https://untrusted.test', updated: -1, failed: '3' }); const result = await subject.requestRaidPollMutation('https://guild.test/api/polls/fixture00', { method: 'DELETE', action: 'delete' }); assert.equal(result.warning, 'Check Discord'); assert.equal(result.discordDeleteFailed, true); assert.equal(result.redirectTo, undefined); assert.equal(result.updated, undefined); assert.equal(result.failed, undefined); assert.equal(calls[0].options.method, 'DELETE'); });
  console.log(`[check-poll-mutations] OK — ${passed}/${passed}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
