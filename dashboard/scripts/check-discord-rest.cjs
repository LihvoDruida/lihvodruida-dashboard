const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8');
let passed = 0;
function load(text, modules = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => { if (name.startsWith('node:')) return require(name); if (name in modules) return modules[name]; throw Error('Unexpected import: ' + name); },
    process: { env: { DISCORD_BOT_TOKEN: 'test-only-token', DISCORD_REST_CONCURRENCY: '2' } },
    Response, Request, Headers, FormData, Blob, Buffer, AbortSignal, AbortController, DOMException,
    Date, Promise, Map, Set, setTimeout, clearTimeout, console, ...globals,
  });
  return exports;
}
function fixture(fetch) {
  const rest = load(source('discordRest'), {}, { fetch });
  const admin = load(source('discordAdmin'), {
    '@/lib/discordRest': rest, '@/lib/concurrency': {}, '@/lib/rulesOnboarding': {}, '@/lib/security': { logDashboardEvent() {} },
    '@/lib/values': { cleanSnowflake: value => /^\d{16,25}$/.test(String(value)) ? String(value) : '' }, '@/lib/discordAvatar': {}, '@/lib/discordRulesStats': {},
  });
  return { rest, admin, call: (route, method = 'GET', extra = {}) => rest.discordRestRequest(route, { method, ...extra }, { token: 'test-only-token', timeoutMs: 1000 }) };
}
async function test(label, run) { await run(); passed++; console.log('✓ ' + label); }
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const A = '111111111111111111'; const B = '222222222222222222';
(async () => {
  await test('major resources stay separate while minor ids and pagination share a route', async () => {
    const { rest } = fixture(() => json({}));
    assert.equal(rest.discordRouteIdentity(`/guilds/${A}/members/${A}?limit=200`, 'GET').route, rest.discordRouteIdentity(`/guilds/${A}/members/${B}?after=99`, 'GET').route);
    assert.notEqual(rest.discordRouteIdentity(`/guilds/${A}/members/${A}`, 'GET').route, rest.discordRouteIdentity(`/guilds/${B}/members/${A}`, 'GET').route);
  });
  await test('429 uses fractional retry_after before the next request', async () => {
    let count = 0; let failedAt;
    const { call } = fixture(() => { count++; if (count === 1) { failedAt = Date.now(); return json({ retry_after: .05 }, 429, { 'x-ratelimit-bucket': 'members' }); } assert.ok(Date.now() - failedAt >= 50); return json({ ok: true }); });
    assert.equal((await call(`/guilds/${A}/members/${B}`)).ok, true); assert.equal(count, 2);
  });
  await test('global 429 pauses an unrelated route even when only headers identify it', async () => {
    let count = 0; let failedAt;
    const { admin } = fixture(() => { count++; if (count === 1) { failedAt = Date.now(); return json({ retry_after: .08 }, 429, { 'x-ratelimit-scope': 'global' }); } assert.ok(Date.now() - failedAt >= 80); return json({}); });
    await assert.rejects(admin.discordApi(`/channels/${A}/messages`, { method: 'POST', body: JSON.stringify({ content: 'hello' }), retry: 'never' }), /429/);
    await admin.discordApi(`/guilds/${B}`); assert.equal(count, 2);
  });
  await test('same bucket hash has independent cooldowns on different channels', async () => {
    const calls = [];
    const { call } = fixture(url => { calls.push(url); return json({}, 200, { 'x-ratelimit-bucket': 'same-hash', 'x-ratelimit-remaining': url.includes(A) ? '0' : '5', 'x-ratelimit-reset-after': '.4' }); });
    await call(`/channels/${A}/messages`); await call(`/channels/${B}/messages`);
    const started = Date.now(); await call(`/channels/${B}/messages`); assert.ok(Date.now() - started < 300);
    const resetStart = Date.now(); await call(`/channels/${A}/messages`); assert.ok(Date.now() - resetStart >= 300); assert.equal(calls.length, 4);
  });
  await test('GET retries a temporary server failure but DELETE and PATCH do not replay uncertain changes', async () => {
    for (const method of ['GET', 'DELETE', 'PATCH', 'POST']) {
      let count = 0; const { call } = fixture(() => { count++; return count === 1 ? json({ message: 'temporary' }, 503) : json({ ok: true }); });
      if (method === 'GET') await call(`/guilds/${A}/members/${B}`, method); else await assert.rejects(call(`/guilds/${A}/members/${B}`, method), /503/);
      assert.equal(count, method === 'GET' ? 2 : 1);
    }
  });
  await test('401 stops queued and subsequent requests until bot credentials change', async () => {
    let count = 0; const { call } = fixture(() => { count++; return json({ message: 'invalid token' }, 401); });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => call(`/guilds/${A}/members/${B}`)));
    assert.ok(results.every(result => result.status === 'rejected')); assert.equal(count, 1);
    await assert.rejects(call(`/channels/${B}/messages`), /401/); assert.equal(count, 1);
  });
  await test('403 and 404 fail once without retries', async () => {
    for (const status of [403, 404]) { let count = 0; const { call } = fixture(() => { count++; return json({ message: 'forbidden or missing' }, status); }); await assert.rejects(call(`/guilds/${A}/members/${B}`), new RegExp(String(status))); assert.equal(count, 1); }
  });
  await test('JSON message retries retain the same enforced nonce', async () => {
    const bodies = []; const { admin } = fixture((url, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? json({ message: 'temporary' }, 503) : json({ id: B }); });
    await admin.discordApi(`/channels/${A}/messages`, { method: 'POST', body: JSON.stringify({ content: 'hello' }) });
    assert.equal(bodies.length, 2); assert.equal(bodies[0].nonce, bodies[1].nonce); assert.equal(bodies[0].enforce_nonce, true); assert.ok(bodies[0].nonce.length <= 25);
  });
  await test('caller-provided membership nonce reaches DM message retries unchanged', async () => {
    const bodies = []; const { admin } = fixture((url, init) => {
      if (url.endsWith('/users/@me/channels')) return json({ id: A });
      bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? json({}, 503) : json({ id: B });
    });
    await admin.sendDiscordDirectMessage({ userId: B, content: 'welcome', nonce: 'membership-welcome-nonce' });
    assert.equal(bodies.length, 2); assert.equal(bodies[0].nonce, 'membership-welcome-nonce'); assert.equal(bodies[1].nonce, bodies[0].nonce);
  });
  await test('multipart attachments share enforced nonce and let fetch choose the boundary', async () => {
    const bodies = []; const { admin } = fixture((url, init) => { assert.ok(init.body instanceof FormData); assert.equal(init.headers.has('content-type'), false); bodies.push(JSON.parse(init.body.get('payload_json'))); return bodies.length === 1 ? json({}, 503) : json({ id: B }); });
    await admin.sendDiscordChannelMessageWithAttachment({ channelId: A, fileName: 'test.png', fileBuffer: Buffer.from([1, 2, 3]) });
    assert.equal(bodies.length, 2); assert.equal(bodies[0].nonce, bodies[1].nonce); assert.equal(bodies[0].enforce_nonce, true);
  });
  await test('concurrent metadata joins one request while member checks remain fresh', async () => {
    let count = 0; const { admin } = fixture(async () => { count++; await new Promise(resolve => setTimeout(resolve, 20)); return json({}); });
    await Promise.all(Array.from({ length: 8 }, () => admin.discordApi(`/guilds/${A}/roles`))); assert.equal(count, 1);
    await Promise.all([admin.discordApi(`/guilds/${A}/members/${B}`), admin.discordApi(`/guilds/${A}/members/${B}`)]); assert.equal(count, 3);
  });
  await test('global concurrency is bounded and cancellation releases a queued slot', async () => {
    let active = 0, peak = 0; const { call } = fixture(async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 40)); active--; return json({}); });
    await Promise.all(Array.from({ length: 12 }, (_, index) => call(`/channels/${BigInt(A) + BigInt(index)}/messages`))); assert.ok(peak <= 2);
    const controller = new AbortController(); const first = call(`/guilds/${A}/members/${B}`); const queued = call(`/guilds/${A}/members/${A}`, 'GET', { signal: controller.signal }); controller.abort();
    await assert.rejects(queued); await first; await call(`/guilds/${A}/members/${B}`); assert.equal(active, 0);
  });
  await test('welcome nonce survives retries and changes for a rejoin or delivery purpose', async () => {
    const { discordMembershipMessageNonce: nonce } = load(source('discordMessageNonce'));
    const member = { guildId: A, userId: B, joinedAt: '2026-10-11T09:00:00Z' };
    assert.equal(nonce(member, 'welcome-card'), nonce({ ...member, joinedAt: '2026-10-11T09:00:00.000Z' }, 'welcome-card'));
    assert.notEqual(nonce(member, 'welcome-card'), nonce({ ...member, joinedAt: '2026-10-11T09:01:00Z' }, 'welcome-card'));
    assert.notEqual(nonce(member, 'welcome-card'), nonce(member, 'welcome-dm'));
    assert.equal(nonce({ ...member, joinedAt: null }, 'welcome-card'), undefined);
  });
  await test('failed batch stops new work and awaits work already in flight', async () => {
    const { mapConcurrent } = load(source('concurrency')); const started = []; let finished = false;
    await assert.rejects(mapConcurrent([0, 1, 2, 3], async item => { started.push(item); if (item === 0) throw Error('failed'); await new Promise(resolve => setTimeout(resolve, 30)); finished = true; }, { concurrency: 2 }), /failed/);
    assert.deepEqual(started, [0, 1]); assert.equal(finished, true);
  });
  console.log(`[check-discord-rest] OK — ${passed} behavioral scenarios`);
})().catch(error => { console.error(error); process.exitCode = 1; });
