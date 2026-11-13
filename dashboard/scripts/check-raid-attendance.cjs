const assert = require('node:assert/strict');
const load = require('./lib/load-server-ts.cjs');
class Reply extends Response {
  static json(body, init = {}) { return new Reply(JSON.stringify(body), { ...init, headers: { ...init.headers, 'content-type': 'application/json' } }); }
  static redirect(url, init) { return new Reply(null, { ...init, headers: { ...init.headers, location: String(url) } }); }
}
const origin = 'https://guild.test', user = { provider: 'discord', id: '111111111111111111', profileId: 'fixture-profile' };
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('✓ ' + name); }
function fixture() {
  let session = user, rateAllowed = true, result = { ok: true, content: 'Збережено', raid: { id: 'fixture00' } }, preference = false, offline = false;
  const calls = { writes: [], reads: [], after: [] };
  const deps = {
    'next/server': { NextResponse: Reply, after: fn => calls.after.push(fn) },
    '@/lib/auth': { getSession: async () => session },
    '@/lib/security': {
      noStoreHeaders: () => ({ 'cache-control': 'no-store' }),
      verifyTrustedOrigin: req => req.headers.get('origin') === origin,
      assertRequestBodySize: () => null, checkRateLimit: () => ({ ok: rateAllowed }), getClientIp: () => 'fixture', safeErrorMessage: () => 'Помилка збереження',
    },
    '@/lib/raids': {
      handleRaidSessionAction: async input => { calls.writes.push(input); return result; },
      syncRaidDiscordSignupUpdate: async () => {}, raidLiveRevision: () => 'revision2',
    },
    '@/lib/serverToasts': { dashboardToastCookie: () => 'toast=fixture' },
    '@/lib/apiRoute': { appBaseUrl: () => origin, wantsJson: req => req.headers.get('accept') === 'application/json' },
    '@/lib/discordNotificationPreferences': { getRaidReminderPreference: async id => { calls.reads.push(id); if (offline) throw Error('offline'); return { enabled: preference }; } },
  };
  const globals = { Response, Request, URL };
  const attendance = load(process.env.MISTBLOSSOM_TEST_ATTENDANCE_SOURCE || 'src/app/api/raids/[raidId]/attendance/route.ts', deps, globals).exports;
  const reminder = load('src/app/api/raids/reminder-preference/route.ts', deps, globals).exports;
  const post = (body, source = origin) => attendance.POST(new Request(origin + '/api/raids/fixture00/attendance', {
    method: 'POST', headers: { origin: source, accept: 'application/json', ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}) }, body,
  }), { params: Promise.resolve({ raidId: 'fixture00' }) });
  return { calls, reminder, post, session: value => session = value, result: value => result = value, rateAllowed: value => rateAllowed = value, offline: value => offline = value, preference: value => preference = value };
}
(async () => {
  await check('website raid signup always responds HTTP 410', async () => {
    const f=fixture();const r=await f.post('{}');assert.equal(r.status,410);assert.equal((await r.json()).error,'discord_only');assert.equal(f.calls.writes.length,0);
  });
  await check('guest cannot submit raid signup over HTTP', async () => {
    const f=fixture();f.session(null);const r=await f.post('{"action":"going"}');assert.equal(r.status,410);assert.equal(f.calls.writes.length,0);
  });
  await check('old status aliases are retired rather than silently processed', async () => {
    for(const status of ['going','late','tentative','skipped','50/50']) {const f=fixture();const r=await f.post(JSON.stringify({action:status}));assert.equal(r.status,410);assert.equal(f.calls.writes.length,0);}
  });
  await check('CSRF and malformed requests cannot restore a website signup route', async () => {
    const f=fixture();assert.equal((await f.post('{','https://foreign.test')).status,410);assert.equal(f.calls.writes.length,0);assert.equal(f.calls.after.length,0);
  });
  await check('retired endpoint keeps no-store policy', async () => {
    const f=fixture();const r=await f.post('{}');assert.equal(r.headers.get('cache-control'),'no-store');
  });
  await check('reminder reads reject anonymous, impersonated and non-Discord sessions before storage', async () => {
    const f = fixture(); for (const session of [null, { ...user, impersonatedBy: 'admin' }, { ...user, provider: 'local' }, { ...user, id: 'invalid' }]) {
      f.session(session); assert.equal((await f.reminder.GET()).status, 401);
    } assert.equal(f.calls.reads.length, 0);
  });
  await check('reminder read is scoped to the Discord session and retains false', async () => {
    const f = fixture(); const response = await f.reminder.GET(); assert.equal((await response.json()).enabled, false); assert.deepEqual(f.calls.reads, [user.id]); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(f.calls.writes.length, 0);
  });
  await check('unavailable reminder storage cannot be mistaken for enabled notifications', async () => {
    const f = fixture(); f.offline(true); const response = await f.reminder.GET(); assert.equal(response.status, 503); assert.equal((await response.json()).enabled, undefined);
  });
  console.log(`[check-raid-attendance] OK — ${passed}/${passed}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
