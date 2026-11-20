// Owner-only runtime settings: schema, .env overlay, storage revision guard and the real route.
const assert = require('node:assert/strict'), load = require('./lib/load-server-ts.cjs');
const schema = load('src/lib/systemSettingsSchema.ts').exports;
const realPermissions = load('src/lib/permissions.ts', { '@/lib/accessGroupSchema': { DASHBOARD_PERMISSION_KEYS: ['dashboard.view', 'groups.manage'] } }).exports;
let passed = 0;
const plain = value => JSON.parse(JSON.stringify(value)); // modules run in their own vm realm
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }

const OWNER = { id: '100000000000000001', provider: 'discord', isServerOwner: true, name: 'Owner' };
const ADMIN = { id: '100000000000000002', provider: 'discord', isServerOwner: false, permissions: ['dashboard.view', 'groups.manage'], role: 'admin' };
const EMERGENCY = { id: 'emergency-token', provider: 'token', role: 'admin', permissions: ['dashboard.view', 'groups.manage'] };
const VIEW_AS = { ...OWNER, impersonatedBy: OWNER.id };

function memoryDb(initial = null, options = {}) {
  let doc = initial;
  const writes = [];
  const ref = { get: async () => { if (options.offline) throw Error('password=fixture-db-secret'); return { exists: Boolean(doc), data: () => doc }; } };
  return {
    writes, current: () => doc,
    db: {
      collection: () => ({ doc: () => ref }),
      runTransaction: async handler => handler({ get: async () => ({ exists: Boolean(doc), data: () => doc }), set: (_ref, data) => { doc = { ...data, updatedAt: '2026-11-20T18:00:00.000Z' }; writes.push(data); } }),
    },
  };
}

function rig({ session = OWNER, stored = null, offline = false, csrf = false, json = true, env = {} } = {}) {
  const store = memoryDb(stored, { offline });
  const audits = [];
  const fakeEnv = { DATABASE_URL: 'postgresql://u:fixture-db-secret@db/x', SESSION_SECRET: 's'.repeat(64), DISCORD_BOT_TOKEN: 'b'.repeat(72), ...env };
  const globals = { process: { ...process, env: fakeEnv } };
  const settings = load('src/lib/systemSettings.ts', {
    '@/lib/db/documentValues': { FieldValue: { serverTimestamp: () => 'now' } },
    '@/lib/documentDb': { getDocumentDb: () => store.db, hasDocumentDbConfig: () => true },
    '@/lib/runtimeResilience': { withTimeout: promise => promise },
    '@/lib/security': { logDashboardEvent() {} },
    '@/lib/values': { timestampToIso: value => (typeof value === 'string' ? value : null) },
    '@/lib/systemSettingsSchema': schema,
  }, globals).exports;
  const response = { json: (body, init = {}) => ({ body, status: init.status || 200 }) };
  const route = load('src/app/api/dashboard/system-settings/route.ts', {
    'next/server': { NextResponse: response },
    '@/lib/auth': { getSession: async () => session },
    '@/lib/accessGroups': { recordAdminAudit: async (event, actor, details) => { audits.push({ event, actor: actor.id, details }); } },
    '@/lib/permissions': realPermissions,
    '@/lib/security': { assertRequestBodySize: () => null, checkRateLimit: () => ({ ok: true }), getClientIp: () => '127.0.0.1', noStoreHeaders: () => ({}), verifyTrustedOrigin: () => !csrf },
    '@/lib/systemSettings': settings,
    '@/lib/systemSettingsSchema': schema,
  }, globals).exports;
  const post = body => route.POST({ headers: new Headers({ 'content-type': json ? 'application/json' : 'text/plain' }), json: async () => body });
  return { route, post, store, audits, env: fakeEnv };
}

(async () => {
  await check('schema normalizes valid values and explains invalid ones', () => {
    const ok = schema.normalizeSystemSettings({ WOW_GUILD_REALM: 'terokkar', GUILD_ROSTER_REGION: 'EU', BATTLENET_ENABLED_REGIONS: 'eu, us,eu', STORAGE_ECO_MODE: 'on', RAID_TIME_ZONE: 'Europe/Kyiv', GUILD_ROSTER_FULL_REFRESH_SECONDS: '3600', RAID_RULES_URL: 'https://lihvodruida.pp.ua/rules', WOW_GUILD_NAME: '' });
    assert.deepEqual(plain(ok.values), { WOW_GUILD_REALM: 'terokkar', GUILD_ROSTER_REGION: 'eu', BATTLENET_ENABLED_REGIONS: 'eu,us', STORAGE_ECO_MODE: 'true', RAID_TIME_ZONE: 'Europe/Kyiv', GUILD_ROSTER_FULL_REFRESH_SECONDS: '3600', RAID_RULES_URL: 'https://lihvodruida.pp.ua/rules' });
    const bad = schema.normalizeSystemSettings({ WOW_GUILD_REALM: 'Terokkar EU', GUILD_ROSTER_REGION: 'ru', RAID_TIME_ZONE: 'Mars/Base', GUILD_ROSTER_FULL_REFRESH_SECONDS: '60', RAID_RULES_URL: 'http://x.test', BATTLENET_LOCALE: 'uk', SESSION_SECRET: 'x', DASHBOARD_DEBUG_LOGS: 'maybe' });
    assert.deepEqual(plain(Object.keys(bad.errors).sort()), ['BATTLENET_LOCALE', 'DASHBOARD_DEBUG_LOGS', 'GUILD_ROSTER_FULL_REFRESH_SECONDS', 'GUILD_ROSTER_REGION', 'RAID_RULES_URL', 'RAID_TIME_ZONE', 'SESSION_SECRET', 'WOW_GUILD_REALM']);
    assert.equal(bad.errors.SESSION_SECRET, 'Невідомий параметр.');
  });

  await check('no secret, bootstrap, build-time or fail-closed security variable is editable', () => {
    for (const key of schema.SYSTEM_SETTINGS.map(s => s.key)) assert.ok(!/SECRET|TOKEN|PASSWORD|KEY$|DATABASE_URL|NEXT_PUBLIC_|SECURITY_REQUIRE|STRICT_ORIGIN|ALLOWED_HOSTS|GEO_ACCESS|AUTH_ACCESS/.test(key), key);
  });

  await check('overlay applies overrides, and clearing one restores the .env value or removes it', () => {
    const env = { WOW_GUILD_NAME: 'From Env' }, base = {};
    schema.applySystemSettingsToEnv({ WOW_GUILD_NAME: 'Override', STORAGE_ECO_MODE: 'true' }, env, base);
    assert.equal(env.WOW_GUILD_NAME, 'Override'); assert.equal(env.STORAGE_ECO_MODE, 'true');
    schema.applySystemSettingsToEnv({}, env, base);
    assert.equal(env.WOW_GUILD_NAME, 'From Env'); assert.ok(!('STORAGE_ECO_MODE' in env));
  });

  await check('settings permission: only the live Discord owner, never groups, emergency token or view-as', () => {
    assert.equal(realPermissions.canManageSettings(OWNER), true);
    for (const session of [ADMIN, EMERGENCY, VIEW_AS, null, undefined]) assert.equal(realPermissions.canManageSettings(session), false);
  });

  for (const [name, session, status] of [['anonymous', null, 401], ['group admin', ADMIN, 403], ['emergency token', EMERGENCY, 403], ['owner viewing as a group', VIEW_AS, 403]]) {
    await check(`${name} can neither read nor change system settings (${status})`, async () => {
      const x = rig({ session });
      assert.equal((await x.route.GET()).status, status);
      assert.equal((await x.post({ revision: 0, values: { WOW_GUILD_NAME: 'Hijack' } })).status, status);
      assert.equal(x.store.writes.length, 0); assert.equal(x.audits.length, 0);
    });
  }

  await check('owner reads overrides, .env fallbacks and secret status without any secret value', async () => {
    const x = rig({ stored: { values: { WOW_GUILD_NAME: 'Stored' }, revision: 3 }, env: { WOW_GUILD_REALM: 'terokkar' } });
    const r = await x.route.GET();
    assert.equal(r.status, 200); assert.equal(r.body.revision, 3);
    const byKey = Object.fromEntries(r.body.settings.map(s => [s.key, s]));
    assert.equal(byKey.WOW_GUILD_NAME.override, 'Stored'); assert.equal(byKey.WOW_GUILD_REALM.envValue, 'terokkar');
    const text = JSON.stringify(r.body);
    for (const secret of ['fixture-db-secret', 's'.repeat(64), 'b'.repeat(72)]) assert.ok(!text.includes(secret));
    assert.equal(r.body.env.find(e => e.key === 'SESSION_SECRET').state, 'set');
    assert.equal(r.body.env.find(e => e.key === 'DISCORD_OAUTH_CLIENT_SECRET').state, 'missing');
  });

  await check('owner save is applied immediately, audited with the changed keys and bumps the revision', async () => {
    const x = rig({ stored: { values: { WOW_GUILD_NAME: 'Old' }, revision: 1 } });
    const r = await x.post({ revision: 1, values: { WOW_GUILD_NAME: 'New Name', STORAGE_ECO_MODE: 'true' } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.revision, 2);
    assert.equal(x.env.WOW_GUILD_NAME, 'New Name'); assert.equal(x.env.STORAGE_ECO_MODE, 'true');
    assert.deepEqual(plain(x.store.current().values), { WOW_GUILD_NAME: 'New Name', STORAGE_ECO_MODE: 'true' });
    assert.equal(x.audits[0].event, 'system.settings.update');
    assert.deepEqual(plain(x.audits[0].details.changed.map(c => c.key).sort()), ['STORAGE_ECO_MODE', 'WOW_GUILD_NAME']);
  });

  await check('a stale revision is a 409 and writes nothing', async () => {
    const x = rig({ stored: { values: {}, revision: 5 } });
    const r = await x.post({ revision: 4, values: { WOW_GUILD_NAME: 'Late' } });
    assert.equal(r.status, 409); assert.equal(x.store.writes.length, 0);
  });

  await check('invalid values, unknown keys, CSRF, non-JSON and storage outage write nothing', async () => {
    let x = rig();
    let r = await x.post({ revision: 0, values: { SESSION_SECRET: 'x', WOW_GUILD_REALM: 'Bad Realm' } });
    assert.equal(r.status, 422); assert.ok(r.body.errors.SESSION_SECRET && r.body.errors.WOW_GUILD_REALM);
    x = rig({ csrf: true }); assert.equal((await x.post({ revision: 0, values: {} })).status, 403);
    x = rig({ json: false }); assert.equal((await x.post({ revision: 0, values: {} })).status, 415);
    x = rig(); assert.equal((await x.post({ revision: -1, values: {} })).status, 400);
    x = rig({ offline: true });
    r = await x.post({ revision: 0, values: { WOW_GUILD_NAME: 'X' } });
    assert.equal(r.status, 503); assert.ok(!JSON.stringify(r.body).includes('fixture-db-secret'));
    assert.equal((await x.route.GET()).status, 503);
    for (const y of [x]) assert.equal(y.store.writes.length, 0);
  });

  console.log(`[check-system-settings] OK — ${passed}/${passed}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
