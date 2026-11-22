#!/usr/bin/env node
// Character order (main first, then the owner's saved order) and the public-site
// owner snapshot: ordered, public fields only, Raider.IO for Retail characters only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib/load-server-ts.cjs');
const { NextResponse } = require('next/server');
let passed = 0;
const names = (list) => Array.from(list, (c) => c.name);
const plain = (list) => Array.from(list);
async function check(name, fn) { await fn(); passed += 1; console.log('PASS ' + name); }
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const order = load('src/lib/profileCharacterOrder.ts').exports;
const char = (name, extra = {}) => ({ key: `eu:terokkar:${name.toLowerCase()}`, name, region: 'eu', realmSlug: 'terokkar', realmName: 'Terokkar', className: 'Druid', activeSpecName: 'Balance', raceName: 'Haranir', level: 90, itemLevel: 700.4, avatarUrl: 'https://render.worldofwarcraft.com/a.jpg', profileUrl: `https://worldofwarcraft.blizzard.com/en-gb/character/eu/terokkar/${name.toLowerCase()}`, verifiedGuild: false, ...extra });

(async () => {
  await check('main is always first; saved order next; unknown characters fall back to guild/name', () => {
    const list = [char('Zed', { verifiedGuild: true }), char('Ann'), char('Main'), char('Bob'), char('New', { verifiedGuild: true })];
    const sorted = names(order.orderProfileCharacters(list, ['eu:terokkar:bob', 'eu:terokkar:zed', 'eu:terokkar:ann'], 'eu:terokkar:main'));
    assert.deepEqual(sorted, ['Main', 'Bob', 'Zed', 'Ann', 'New']);
    // Main stays first even when the saved order lists it elsewhere.
    assert.equal(order.orderProfileCharacters(list, ['eu:terokkar:main', 'eu:terokkar:ann'], 'eu:terokkar:zed')[0].name, 'Zed');
    // No saved order: the panel's previous sort (main, guild, name).
    assert.deepEqual(names(order.orderProfileCharacters(list, null, 'eu:terokkar:main')), ['Main', 'New', 'Zed', 'Ann', 'Bob']);
  });

  await check('submitted order drops unknown, duplicate and main keys', () => {
    const known = ['a:b:c', 'a:b:d', 'a:b:main'];
    assert.deepEqual(plain(order.cleanCharacterOrder(['a:b:d', 'x:y:z', 'a:b:d', 'a:b:main', 'a:b:c', 5], known, 'a:b:main')), ['a:b:d', 'a:b:c']);
    assert.deepEqual(plain(order.cleanCharacterOrder('a:b:c', known, null)), []);
  });

  const ownerModule = (profile, env = {}) => load('src/lib/publicSiteOwner.ts', {
    'server-only': {},
    '@/lib/discordAdmin': { fetchDiscordGuildSnapshot: async () => ({ id: '1', name: 'G', ownerId: '123456789012345678', rules_channel_id: null }) },
    '@/lib/profiles': { getProfileByDiscordUserId: async (id) => (id === '123456789012345678' ? profile : null) },
  }, { process: { env } }).exports;

  await check('owner snapshot follows the saved order and hides Raider.IO for Forever', async () => {
    const forever = char('Oldie', { edition: 'forever', realmSlug: 'forever', raiderIo: { currentScore: 999, profileUrl: 'https://raider.io/x' } });
    const retail = char('Khayen', { isMain: true, raiderIo: { currentScore: 3150.6, profileUrl: 'https://raider.io/characters/eu/terokkar/Khayen' } });
    const alt = char('Krouli', { className: 'Demon Hunter', avatarUrl: 'javascript:alert(1)' });
    const profile = { characters: [forever, alt, retail], characterOrder: [forever.key, alt.key], mainCharacterKey: retail.key, battlenet: { lastSyncAt: '2026-11-22T10:00:00.000Z' }, discordRoleIds: ['secret'], preferredName: 'private' };
    const snapshot = await ownerModule(profile).buildPublicOwnerSnapshot();
    assert.equal(snapshot.schema, 'mistblossom.public-owner.v1');
    assert.deepEqual(names(snapshot.characters), ['Khayen', 'Oldie', 'Krouli']);
    const [main, old, dh] = snapshot.characters;
    assert.equal(main.isMain, true); assert.equal(main.rio, 3151); assert.equal(main.link, 'https://raider.io/characters/eu/terokkar/Khayen');
    assert.equal(old.edition, 'forever'); assert.equal(old.rio, null); assert.equal(old.realm, 'WoW Forever'); assert.ok(!old.link.includes('raider.io'));
    assert.equal(dh.avatarUrl, null, 'only https image URLs leave the panel');
    assert.deepEqual(Object.keys(main).sort(), ['avatarUrl', 'className', 'edition', 'isMain', 'itemLevel', 'level', 'link', 'name', 'raceName', 'realm', 'region', 'rio', 'specName'].sort());
    assert.ok(!JSON.stringify(snapshot).includes('secret') && !JSON.stringify(snapshot).includes('private'), 'no private profile fields');
  });

  await check('missing owner profile yields an empty list, not an error', async () => {
    const snapshot = await ownerModule(null).buildPublicOwnerSnapshot();
    assert.deepEqual(plain(snapshot.characters), []);
  });

  await check('owner route is bridge-token only and exposed through the proxy allowlist', async () => {
    let allowed = false;
    const route = load('src/app/api/site/owner/route.ts', {
      'next/server': { NextResponse },
      '@/lib/siteBridgeAuth': { hasSiteBridgeToken: () => allowed },
      '@/lib/publicSiteOwner': { buildPublicOwnerSnapshot: async () => ({ schema: 'mistblossom.public-owner.v1', characters: [] }) },
      '@/lib/security': { logDashboardEvent: () => {}, safeErrorMessage: String },
    }).exports;
    assert.equal((await route.GET(new Request('http://dashboard:3000/api/site/owner'))).status, 401);
    allowed = true;
    const response = await route.GET(new Request('http://dashboard:3000/api/site/owner'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.ok(read('src/proxy.ts').includes('pathname === "/api/site/owner"'));
    assert.ok(read('src/app/api/site/status/route.ts').includes("'owner:characters:v1'"));
  });

  await check('settings page renders the order editor posting to the order route', () => {
    const editor = read('src/components/account/CharacterOrderEditor.tsx');
    assert.ok(editor.includes('action="/api/profile/characters/order"') && editor.includes('name="order"'));
    assert.ok(read('src/components/profile/settings/ProfileCharactersManager.tsx').includes('<CharacterOrderEditor'));
    const route = read('src/app/api/profile/characters/order/route.ts');
    assert.ok(route.includes('verifyTrustedOrigin') && route.includes('session.profileId') && route.includes('invalidatePublicOwnerSnapshot'));
  });

  console.log(`[check-owner-characters] OK — ${passed}/${passed}`);
})().catch((error) => { console.error(error); process.exit(1); });
