const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const pg = require('pg');
const load = require('./lib/load-server-ts.cjs');
const subject = require('./lib/profile-directory-subject.cjs');
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || url === process.env.POSTGRES_URL) throw Error('Set a separate TEST_DATABASE_URL; production URLs are refused.');
const schema = 'r3_' + randomBytes(12).toString('hex');
const pool = new pg.Pool({ connectionString: url, max: 4, options: '-c search_path=' + schema + ' -c statement_timeout=10000 -c lock_timeout=3000' });
pool.on('error', () => {});
let statements = [], groupsFail = false;
const db = load('src/lib/db/pgPool.ts', { pg }, { __mistblossomPgPool: pool, process: { env: { DATABASE_URL: url } } }).exports;
const monitored = { ...db, pgQuery: async (sql, values, client) => { const start = performance.now(); const result = await db.pgQuery(sql, values, client); statements.push({ sql, values, rows: result.rows.length, ms: performance.now() - start }); return result; } };
const { PgFirestore } = load('src/lib/db/documentStore.ts', { '@/lib/db/pgPool': monitored }).exports;
const store = new PgFirestore();
const groups = [
  { id: 'custom-admin', name: 'High', role: 'admin', rank: 100 },
  { id: 'admin', name: 'Admin', role: 'admin', rank: 90 },
  { id: 'moderator', name: 'Officer', role: 'moderator', rank: 50 },
  { id: 'mentor', name: 'Mentor', role: 'mentor', rank: 20 },
  { id: 'member', name: 'Member', role: 'member', rank: 10 },
];
const mod = subject(monitored, store, () => { if (groupsFail) throw Error('Groups unavailable'); return groups; });
const legacy = subject(monitored, store, groups, 'firestore');
const admin = { id: '999', provider: 'discord', role: 'admin' };
const member = { id: '999', provider: 'discord', role: 'member', groupId: 'member', groupRank: 10, permissions: ['profiles.group.view'] };
const id = i => 'id' + i.toString(16).padStart(32, '0');
let passed = 0, dataset = [];
async function check(name, run) { await run(); passed++; console.log('✓ ' + name); }
function fixture(i) {
  const characters = Array.from({ length: i % 3 }, (_, n) => ({ key: `eu:silvermoon:hero${i}-${n}`, name: `Hero${i}-${n}`, realmSlug: 'silvermoon', realmName: 'Silvermoon' }));
  return { profileId: id(i), provider: 'discord', providerUserId: String(700000000000000000n + BigInt(i)), displayName: i === 250 ? 'Target250' : `Гравець ${i % 9}`, preferredName: `Гравець ${i % 9}`, role: i % 17 === 0 ? 'admin' : i % 5 === 0 ? 'mentor' : 'member', battlenet: { linked: i % 2 === 0, accountLabel: 'PRIVATE' }, characters,
    lastLoginAt: new Date(Date.UTC(2026, 9, 1, 0, i % 7)).toISOString(), updatedAt: '2026-09-01T00:00:00Z' };
}
async function seed(count) {
  dataset = Array.from({ length: count }, (_, i) => fixture(i));
  await pool.query("DELETE FROM documents WHERE collection IN ('dashboardProfiles','guildCharacterData','externalCharacterData')");
  await pool.query("INSERT INTO documents(collection,doc_id,data) SELECT 'dashboardProfiles', x->>'profileId', x FROM jsonb_array_elements($1::jsonb) x", [JSON.stringify(dataset)]);
}
async function oracle(viewer, params = {}) {
  const profiles = dataset.map(p => mod.normalizers.applyCurrentProfileGroup(mod.normalizers.normalizeProfile(p.profileId, p), groups)).filter(p => mod.normalizers.canViewProfile(viewer, p.profileId, p));
  const hydrated = await mod.normalizers.hydrateProfilesFromCanonicalCharacterData(profiles);
  const f = mod.profileDirectoryFilters(params), q = f.query.toLocaleLowerCase('uk');
  return hydrated.filter(p => (f.role === 'all' || p.role === f.role) && (f.link !== 'linked' || p.battlenet?.linked) && (f.link !== 'unlinked' || !p.battlenet?.linked)
    && (!q || [p.displayName, p.preferredName, p.login, p.role, p.provider, p.providerUserId, mod.normalizers.getProfileSiteName(p), p.characters.map(c => c.name).join(' '), p.characters.map(c => c.realmName || c.realmSlug).join(' ')].join(' ').normalize('NFC').toLocaleLowerCase('uk').includes(q)));
}
async function traverse(params, expected) {
  let page = await mod.listDashboardProfilePage(params), all = [], cursorCount = 0, previous;
  while (true) {
    assert.equal(page.total, expected.length); assert.ok(page.profiles.length <= 20);
    assert.equal(page.characterCount, expected.reduce((s, p) => s + p.characters.length, 0));
    assert.equal(page.linkedCount, expected.filter(p => p.battlenet?.linked).length);
    assert.equal(page.start, all.length + 1); assert.equal(page.end, all.length + page.profiles.length);
    if (previous) assert.ok(page.previousCursor);
    all.push(...page.profiles.map(p => p.profileId));
    if (!page.nextCursor) break;
    previous = page; page = await mod.listDashboardProfilePage({ ...params, cursor: page.nextCursor });
    assert.ok(++cursorCount < 200, 'cursor makes forward progress');
  }
  assert.equal(new Set(all).size, expected.length); assert.deepEqual([...all].sort(), expected.map(p => p.profileId).sort());
  return all;
}

(async () => {
  await pool.query('CREATE SCHEMA ' + schema);
  await pool.query(fs.readFileSync(path.join(__dirname, '../src/lib/db/schema.sql'), 'utf8'));
  for (const count of [201, 501, 2000]) {
    await seed(count);
    await check(`${count} profiles: complete count and bounded first page`, async () => {
      const page = await mod.listDashboardProfilePage({ viewer: admin });
      assert.equal(page.total, count); assert.equal(page.profiles.length, 20); assert.equal(page.end, 20);
    });
    await check(`${count} profiles: late record searchable before LIMIT`, async () => {
      const page = await mod.listDashboardProfilePage({ viewer: admin, query: String(700000000000000000n + BigInt(count - 1)) });
      assert.equal(page.total, 1); assert.equal(page.profiles[0].profileId, id(count - 1)); assert.equal(page.nextCursor, null);
    });
  }
  await check('Target250 beyond the former 200 limit', async () => {
    assert.equal((await mod.listDashboardProfilePage({ viewer: admin, query: 'target250' })).profiles[0].profileId, id(250));
  });
  const expected = await oracle(admin);
  for (const sort of ['activity', 'name', 'characters']) await check(`2000 profiles: ${sort} traversal without duplicates or omissions`, async () => {
    const ordered = await traverse({ viewer: admin, sort }, expected);
    const collator = new Intl.Collator('uk');
    const sorted = [...expected].sort((a, b) => (sort === 'name' ? collator.compare(mod.normalizers.getProfileSiteName(a).toLocaleLowerCase('uk'), mod.normalizers.getProfileSiteName(b).toLocaleLowerCase('uk'))
      : sort === 'characters' ? b.characters.length - a.characters.length || Date.parse(b.lastLoginAt) - Date.parse(a.lastLoginAt) : Date.parse(b.lastLoginAt) - Date.parse(a.lastLoginAt)) || Buffer.compare(Buffer.from(a.profileId), Buffer.from(b.profileId)));
    assert.deepEqual(ordered, sorted.map(p => p.profileId));
  });
  await check('Backward cursors return the exact previous page', async () => {
    for (const sort of ['activity', 'name', 'characters']) {
      const a = await mod.listDashboardProfilePage({ viewer: admin, sort });
      const b = await mod.listDashboardProfilePage({ viewer: admin, sort, cursor: a.nextCursor });
      const back = await mod.listDashboardProfilePage({ viewer: admin, sort, cursor: b.previousCursor });
      assert.deepEqual(back.profiles.map(p => p.profileId), a.profiles.map(p => p.profileId)); assert.equal(back.start, 1);
    }
  });
  await check('Role, linked and search filters combine across the whole set', async () => {
    const params = { viewer: admin, query: 'ГРАВЕЦЬ', role: 'member', link: 'linked', sort: 'characters' };
    await traverse(params, await oracle(admin, params));
  });
  await check('Group permission constrains both rows and every aggregate', async () => { await traverse({ viewer: member }, await oracle(member)); });
  await check('Private staff profiles cannot be found through search/count', async () => {
    const params = { viewer: member, query: dataset[0].providerUserId };
    const page = await mod.listDashboardProfilePage(params); assert.equal(page.total, 0); assert.equal(page.characterCount, 0); assert.equal(page.linkedCount, 0);
  });
  await check('Own identity remains visible above the group rank', async () => {
    const viewer = { ...member, id: dataset[0].providerUserId };
    const page = await mod.listDashboardProfilePage({ viewer, query: dataset[0].providerUserId }); assert.equal(page.total, 1);
    const restricted = { ...viewer, groupId: 'restricted', permissions: [] };
    assert.equal((await mod.listDashboardProfilePage({ viewer: restricted })).total, 1);
  });
  await check('Current explicit group overrides a stale stored role', async () => {
    const raw = { ...fixture(2300), groupId: 'custom-admin', role: 'member' }; dataset.push(raw);
    await store.collection('dashboardProfiles').doc(raw.profileId).set(raw);
    assert.equal((await mod.listDashboardProfilePage({ viewer: member, query: raw.providerUserId })).total, 0);
    const page = await mod.listDashboardProfilePage({ viewer: admin, query: raw.providerUserId, role: 'admin' }); assert.equal(page.total, 1); assert.equal(page.profiles[0].role, 'admin');
  });
  await check('Unknown/no permission yields no rows or hidden counts', async () => {
    const page = await mod.listDashboardProfilePage({ viewer: { ...member, groupId: 'restricted', permissions: [] } }); assert.equal(page.total, 0); assert.equal(page.characterCount, 0);
  });
  await check('Cursor is reset on changed filters, identity or permissions', async () => {
    const first = await mod.listDashboardProfilePage({ viewer: admin });
    for (const params of [{ viewer: admin, role: 'member' }, { viewer: member }, { viewer: { ...admin, permissions: ['profiles.group.view'], groupId: 'member', groupRank: 10 } }]) {
      const page = await mod.listDashboardProfilePage({ ...params, cursor: first.nextCursor }); assert.ok(page.cursorReset); assert.equal(page.start, 1); assert.equal(page.total, (await oracle(params.viewer, params)).length);
    }
  });
  await check('Malformed/oversized cursors reset safely', async () => {
    for (const cursor of ['invalid!', 'x'.repeat(2000), Buffer.from('{bad').toString('base64url')]) {
      const page = await mod.listDashboardProfilePage({ viewer: admin, cursor }); assert.ok(page.cursorReset); assert.equal(page.start, 1);
    }
  });
  await check('Wildcard/SQL-like queries are literal and parameterized', async () => {
    const page = await mod.listDashboardProfilePage({ viewer: admin, query: "%_' OR 1=1 --" }); assert.equal(page.total, 0);
    assert.equal(Number((await pool.query("SELECT count(*) FROM documents WHERE collection = 'dashboardProfiles'")).rows[0].count), dataset.length);
  });
  await check('Canonical guild names/realms win and external fallback is searchable', async () => {
    const key = dataset[1999].characters[0].key;
    const hash = createHash('sha256').update(key).digest('hex');
    await store.collection('guildCharacterData').doc(hash).set({ key, name: 'ОНОВЛЕНИЙ', realmSlug: 'new', realmName: 'Новий Реалм', scope: 'guild' });
    await store.collection('externalCharacterData').doc(hash).set({ key, name: 'ExternalHidden', realmSlug: 'external', realmName: 'External Realm', scope: 'external' });
    for (const query of ['оновлений', 'новий реалм']) { const page = await mod.listDashboardProfilePage({ viewer: admin, query }); assert.equal(page.total, 1); assert.equal(page.profiles[0].characters[0].name, 'ОНОВЛЕНИЙ'); }
    assert.equal((await mod.listDashboardProfilePage({ viewer: admin, query: 'externalhidden' })).total, 0);
    await store.collection('guildCharacterData').doc(hash).delete();
    assert.equal((await mod.listDashboardProfilePage({ viewer: admin, query: 'externalhidden' })).total, 1);
  });
  await check('Malformed characters and legacy duplicate keys match normalized count', async () => {
    const raw = { ...fixture(2301), displayName: 'MalformedUnique', preferredName: 'MalformedUnique', characters: [null, 'bad', {}, { key: 'bad', name: 'Ignored', realmSlug: 'silvermoon' },
      { key: 'eu:silvermoon:test', name: 'Test', realmSlug: 'silvermoon' }, { key: 'eu:silvermoon:test:legacy-id', name: 'Duplicate', realmSlug: 'silvermoon' }], lastLoginAt: 'bad-date' };
    dataset.push(raw); await store.collection('dashboardProfiles').doc(raw.profileId).set(raw);
    const page = await mod.listDashboardProfilePage({ viewer: admin, query: 'malformedunique' }); assert.equal(page.total, 1); assert.equal(page.characterCount, 1); assert.equal(page.profiles[0].characters.length, 1);
  });
  await check('Search normalization handles NFC and Cyrillic case', async () => {
    const raw = { ...fixture(2302), preferredName: 'ІЇҐЄ Е\u0301ЛЬФ', displayName: 'ІЇҐЄ Е\u0301ЛЬФ' }; dataset.push(raw); await store.collection('dashboardProfiles').doc(raw.profileId).set(raw);
    assert.equal((await mod.listDashboardProfilePage({ viewer: admin, query: 'іїґє е\u0301льф' })).total, 1);
  });
  await check('Legacy Unicode character keys normalize before canonical lookup', async () => {
    const raw = { ...fixture(2303), displayName: 'UnicodeUnique', preferredName: 'UnicodeUnique', characters: [{ key: 'EU:Крижані Дракони:ÉLF:123', name: 'ÉLF', realmSlug: 'Крижані Дракони' }] };
    dataset.push(raw); await store.collection('dashboardProfiles').doc(raw.profileId).set(raw);
    const normalized = mod.normalizers.normalizeProfile(raw.profileId, raw);
    const key = normalized.characters[0].key, hash = createHash('sha256').update(key).digest('hex');
    await store.collection('guildCharacterData').doc(hash).set({ key, name: 'UnicodeUpdated', realmSlug: 'new-realm', realmName: 'RealmUpdated', scope: 'guild' });
    const page = await mod.listDashboardProfilePage({ viewer: admin, query: 'unicodeupdated' }); assert.equal(page.total, 1); assert.equal(page.profiles[0].profileId, raw.profileId);
  });
  await check('Invalid/infinite dates do not break catalog or cursors', async () => {
    for (const [index, value] of ['infinity', 'invalid-date', '-infinity'].entries()) {
      const raw = { ...fixture(2304 + index), preferredName: 'DateUnique', displayName: 'DateUnique', lastLoginAt: value }; dataset.push(raw); await store.collection('dashboardProfiles').doc(raw.profileId).set(raw);
    }
    const page = await mod.listDashboardProfilePage({ viewer: admin, query: 'dateunique' }); assert.equal(page.total, 3); assert.equal(page.profiles.length, 3);
  });
  await check('Deleted cursor anchor does not break next/previous boundaries', async () => {
    const first = await mod.listDashboardProfilePage({ viewer: admin });
    const anchor = first.profiles.at(-1).profileId; await store.collection('dashboardProfiles').doc(anchor).delete(); dataset = dataset.filter(p => p.profileId !== anchor);
    const next = await mod.listDashboardProfilePage({ viewer: admin, cursor: first.nextCursor }); assert.equal(next.start, 20); assert.equal(next.total, dataset.length); assert.ok(!next.profiles.some(p => p.profileId === anchor));
  });
  await check('Empty stale last-page cursor resets with a live-list notice', async () => {
    const first = await mod.listDashboardProfilePage({ viewer: admin });
    const cursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()); cursor.key.activity = -1; cursor.key.id = 'zzzz';
    const page = await mod.listDashboardProfilePage({ viewer: admin, cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url') }); assert.ok(page.cursorReset); assert.equal(page.start, 1);
  });
  await check('Permission source failure is not an empty successful search', async () => {
    groupsFail = true; try { await assert.rejects(mod.listDashboardProfilePage({ viewer: admin }), /Groups unavailable/); } finally { groupsFail = false; }
  });
  await check('Database read failure is propagated instead of cached empty results', async () => {
    const broken = subject({ ...db, pgQuery: async () => { throw Error('Database unavailable'); } }, store, groups);
    await assert.rejects(broken.listDashboardProfilePage({ viewer: admin }), /Database unavailable/);
  });
  await check('Unconfigured storage is explicit unavailable state', async () => {
    const page = await subject(db, store, groups, 'unconfigured').listDashboardProfilePage({ viewer: admin }); assert.ok(page.unavailable);
  });
  await check('Firestore compatibility scans beyond 200 with full filtered totals', async () => {
    const page = await legacy.listDashboardProfilePage({ viewer: member, query: dataset.at(-1).providerUserId });
    const expected = await oracle(member, { query: dataset.at(-1).providerUserId }); assert.equal(page.total, expected.length);
    const params = { viewer: member, query: 'Гравець', role: 'member', link: 'linked', sort: 'name' };
    const a = await legacy.listDashboardProfilePage(params), b = await legacy.listDashboardProfilePage({ ...params, cursor: a.nextCursor }), back = await legacy.listDashboardProfilePage({ ...params, cursor: b.previousCursor });
    assert.equal(a.total, (await oracle(member, params)).length); assert.deepEqual(back.profiles.map(p => p.profileId), a.profiles.map(p => p.profileId)); assert.equal(b.start, 21);
  });
  await check('Catalog SQL returns at most 20 full profile documents per request', async () => {
    const pages = statements.filter(s => s.sql.startsWith('WITH raw AS'));
    assert.ok(pages.length > 100); assert.ok(pages.every(s => s.rows === 1 && !s.sql.includes('OFFSET')));
    const start = statements.length; await mod.listDashboardProfilePage({ viewer: admin, query: 'Hero100' });
    assert.ok(statements.slice(start).filter(s => s.sql.startsWith('WITH raw AS')).every(s => s.sql.includes('LIMIT 20')));
    const timings = pages.map(s => s.ms).sort((a, b) => a - b); console.log(`[profile-directory] local 2000 fixtures SQL p50=${timings[Math.floor(timings.length * .5)].toFixed(1)}ms p95=${timings[Math.floor(timings.length * .95)].toFixed(1)}ms`);
    const planStatement = pages.find(s => s.values.includes('hero100')) || statements.slice(start).find(s => s.sql.startsWith('WITH raw AS'));
    const plan = await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + planStatement.sql, planStatement.values);
    console.log('[profile-directory] EXPLAIN ' + JSON.stringify(plan.rows[0]['QUERY PLAN'][0]));
  });
  console.log(`[test:profiles] OK — ${passed}/${passed}; native PostgreSQL ${ (await pool.query('SHOW server_version')).rows[0].server_version }; private schema`);
})().catch(error => { console.error('[test:profiles] FAILED', error); process.exitCode = 1; }).finally(async () => {
  try { await pool.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); } finally { await pool.end(); }
});
