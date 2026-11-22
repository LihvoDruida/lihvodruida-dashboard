#!/usr/bin/env node
// Communities block of the public site: strict model, revision-checked store,
// content-manager-only editor API, bridge-token-only read, content sync coverage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib/load-server-ts.cjs');
const { NextResponse } = require('next/server');
let passed = 0;
async function check(name, fn) { await fn(); passed += 1; console.log('PASS ' + name); }
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

const model = load('src/lib/siteCommunityModel.ts').exports;
const valid = () => plain(model.DEFAULT_SITE_COMMUNITIES);

(async () => {
  await check('defaults mirror the site and pass validation', () => {
    const items = plain(model.normalizeCommunities(valid()));
    assert.deepEqual(items.map((c) => c.id), ['mistblossom', 'varta']);
    assert.equal(items[0].page, '/guild'); assert.equal(items[0].pageLabel, 'Про гільдію');
    assert.equal(items[1].links.length, 3);
  });

  await check('unsafe links, logos and pages are rejected with an editor message', () => {
    const bad = (mutate, pattern) => { const items = valid(); mutate(items[0]); assert.throws(() => model.normalizeCommunities(items), pattern); };
    bad((c) => { c.links[0].url = 'javascript:alert(1)'; }, /https/);
    bad((c) => { c.links[0].url = 'http://discord.gg/x'; }, /https/);
    bad((c) => { c.logo = 'https://evil.example/logo.png'; }, /логотип/);
    bad((c) => { c.logo = '/assets/img/../../etc/passwd.png'; }, /логотип/);
    bad((c) => { c.page = 'https://evil.example'; }, /внутрішнім/);
    bad((c) => { c.name = '  '; }, /назву/);
    bad((c) => { c.links[0].label = ''; }, /підпису/);
    assert.throws(() => model.normalizeCommunities([...valid(), ...valid()]), /уже використано/);
    assert.throws(() => model.normalizeCommunities(Array.from({ length: 7 }, (_, i) => ({ ...valid()[0], id: 'c' + i }))), /Не більше 6/);
  });

  await check('text is trimmed and bounded; empty rows are dropped; uploaded media logos are accepted', () => {
    const items = valid();
    items[0].name = '  Mist   Vanguard  '; items[0].description = 'x'.repeat(500);
    items[0].details.push({ label: 'empty', value: '   ' }); items[0].links.push({ label: '', url: '' });
    items[0].logo = '/api/site/media/' + 'a'.repeat(64); items[1].page = ''; items[1].pageLabel = 'ignored';
    const [first, second] = plain(model.normalizeCommunities(items));
    assert.equal(first.name, 'Mist Vanguard'); assert.equal(first.description.length, 300);
    assert.equal(first.details.length, 1); assert.equal(first.links.length, 1);
    assert.equal(second.pageLabel, '', 'no page means no button label');
  });

  // In-memory document store for the revision-checked save.
  const rows = new Map();
  const db = { collection: (name) => ({ doc: (id) => ({ key: name + '/' + id, get: async () => ({ exists: rows.has(name + '/' + id), data: () => plain(rows.get(name + '/' + id)) }) }) }),
    runTransaction: async (fn) => { const writes = []; const out = await fn({ get: async (ref) => ({ exists: rows.has(ref.key), data: () => (rows.has(ref.key) ? plain(rows.get(ref.key)) : undefined) }), set: (ref, value) => writes.push(() => rows.set(ref.key, value)) }); writes.forEach((w) => w()); return out; } };
  const store = load('src/lib/siteCommunities.ts', {
    'server-only': {},
    '@/lib/documentDb': { getDocumentDb: () => db, hasDocumentDbConfig: () => true },
    '@/lib/db/documentValues': { FieldValue: { serverTimestamp: () => '2026-11-22T12:00:00.000Z' } },
    '@/lib/values': { timestampToIso: (v) => (typeof v === 'string' ? v : null) },
  }).exports;

  await check('store starts from the defaults, saves with a revision and rejects stale writes', async () => {
    const initial = await store.getSiteCommunities();
    assert.equal(initial.customized, false); assert.equal(initial.revision, 0); assert.equal(initial.items.length, 2);
    const items = valid(); items.reverse();
    const saved = await store.saveSiteCommunities(items, 0, 'Sebas');
    assert.equal(saved.revision, 1);
    const reread = await store.getSiteCommunities();
    assert.equal(reread.customized, true); assert.deepEqual(plain(reread.items).map((c) => c.id), ['varta', 'mistblossom']);
    await assert.rejects(store.saveSiteCommunities(valid(), 0, 'Other tab'), /іншій вкладці/);
    const pub = plain(await store.publicSiteCommunities());
    assert.equal(pub.schema, 'mistblossom.public-communities.v1'); assert.equal(pub.revision, 1);
    assert.ok(!JSON.stringify(pub).includes('Sebas'), 'editor identity is not published');
  });

  await check('bridge route is token-only; status advertises the capability; proxy allows it', async () => {
    let allowed = false;
    const route = load('src/app/api/site/communities/route.ts', {
      'next/server': { NextResponse },
      '@/lib/siteBridgeAuth': { hasSiteBridgeToken: () => allowed },
      '@/lib/siteCommunities': { publicSiteCommunities: async () => ({ schema: 'mistblossom.public-communities.v1', items: [] }) },
      '@/lib/security': { logDashboardEvent: () => {}, safeErrorMessage: String },
    }).exports;
    assert.equal((await route.GET(new Request('http://dashboard:3000/api/site/communities'))).status, 401);
    allowed = true;
    assert.equal((await route.GET(new Request('http://dashboard:3000/api/site/communities'))).status, 200);
    assert.ok(read('src/proxy.ts').includes('pathname === "/api/site/communities"'));
    assert.ok(read('src/app/api/site/status/route.ts').includes("'communities:read:v1'"));
  });

  await check('site content sync revision covers the communities collection', () => {
    assert.match(read('src/lib/siteSync.ts'), /collection='siteCommunities'/);
  });

  await check('editor API checks origin, size, content permission and rate limit before writing', () => {
    const source = read('src/app/api/content/communities/route.ts');
    const api = source.slice(source.indexOf('export async function POST'));
    const order = ['verifyTrustedOrigin', 'assertRequestBodySize', 'canManageSiteContent', 'checkRateLimit', 'saveSiteCommunities('];
    order.reduce((last, token) => { const at = api.indexOf(token); assert.ok(at > last, token); return at; }, -1);
    assert.ok(read('src/app/content/communities/page.tsx').includes('canManageSiteContent'));
  });

  console.log(`[check-site-communities] OK — ${passed}/${passed}`);
})().catch((error) => { console.error(error); process.exit(1); });
