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
  await check('foreign origin cannot call the attendance mutation', async () => {
    const f = fixture(); assert.equal((await f.post('{}', 'https://foreign.test')).status, 403); assert.equal(f.calls.writes.length, 0);
  });
  await check('expired session returns a login destination without changing attendance', async () => {
    const f = fixture(); f.session(null); const response = await f.post('{}'); const body = await response.json();
    assert.equal(response.status, 401); assert.equal(new URL(body.loginUrl).pathname, '/login'); assert.equal(new URL(body.loginUrl).searchParams.get('next'), '/raids/fixture00'); assert.equal(f.calls.writes.length, 0);
  });
  await check('rate-limited attendance cannot run the mutation or schedule Discord', async () => {
    const f = fixture(); f.rateAllowed(false); assert.equal((await f.post('{}')).status, 429); assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.after.length, 0);
  });
  await check('manual selection and explicit opt-out are passed together under the real session', async () => {
    const f = fixture(), form = new FormData(); for (const [key, value] of Object.entries({ action: 'late', classKey: 'druid', specKey: 'restoration', reminderEnabled: 'false' })) form.set(key, value);
    const response = await f.post(form); const body = await response.json(), input = f.calls.writes[0];
    assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(body.revision, 'revision2'); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(input.user, user); assert.equal(input.action, 'late'); assert.equal(input.manual.classKey, 'druid'); assert.equal(input.manual.specKey, 'restoration'); assert.equal(input.reminderPreference, false); assert.equal(input.syncDiscord, false); assert.equal(f.calls.after.length, 1);
  });
  await check('JSON character selection cannot replace the authenticated user with a supplied user', async () => {
    const f = fixture(); await f.post(JSON.stringify({ action: 'tentative', characterKey: 'eu:realm:character', signupRole: 'healer', reminderEnabled: false, user: { id: 'foreign' } }));
    const input = f.calls.writes[0]; assert.equal(input.user, user); assert.equal(input.characterKey, 'eu:realm:character'); assert.equal(input.signupRole, 'healer'); assert.equal(input.reminderPreference, false);
  });
  await check('business rejection never claims a successful revision or schedules Discord', async () => {
    const f = fixture(); f.result({ ok: false, content: 'Рейд закрито' }); const response = await f.post('{"action":"going"}'), body = await response.json();
    assert.equal(response.status, 400); assert.equal(body.ok, false); assert.equal(body.revision, null); assert.equal(body.toast.message, 'Рейд закрито'); assert.equal(f.calls.after.length, 0);
  });
  await check('malformed request body does not call the mutation', async () => {
    const f = fixture(); const response = await f.post('{'); assert.equal((await response.json()).ok, false); assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.after.length, 0);
  });
  await check('missing and unknown attendance actions never become going by default', async () => {
    for (const body of ['null', '[]', '42', '{}', '{"action":"unknown"}']) {
      const f = fixture(); const response = await f.post(body); assert.equal((await response.json()).ok, false); assert.equal(f.calls.writes.length, 0);
    }
    const f = fixture(), form = new FormData(); form.set('action', 'unknown');
    assert.equal((await (await f.post(form)).json()).ok, false); assert.equal(f.calls.writes.length, 0);
  });
  await check('supported legacy attendance aliases retain their intended status', async () => {
    for (const [action, expected] of [['maybe', 'tentative'], ['50/50', 'tentative'], ['5050', 'tentative'], ['half', 'tentative'], ['skip', 'skipped'], ['late', 'late'], ['going', 'going']]) {
      const f = fixture(); await f.post(JSON.stringify({ action })); assert.equal(f.calls.writes[0].action, expected);
    }
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
