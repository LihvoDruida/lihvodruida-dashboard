const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const loader = require('./lib/load-server-ts.cjs');
const load = (file, mocks = {}) => loader(file, mocks, { URL, URLSearchParams, Error }).exports;
const state = load('src/lib/listViewState.ts');
const view = load('src/lib/guildRosterViewState.ts');
const location = load('src/lib/clientListLocation.ts', { '@/lib/listViewState': state });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
function guildPageFixture() {
  let allowed = true, user = { provider: 'discord', id: 'fixture', role: 'member' }, reads = 0;
  const Explorer = () => null;
  const modules = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { redirect: url => { throw Error('redirect:' + url); } },
    '@/components/AppProblemScreen': { default: () => null }, '@/components/DashboardIdentity': { default: () => null },
    '@/components/GuildRosterExplorer': { default: Explorer }, '@/components/GuildRosterLiveHeroStats': { default: () => null },
    '@/lib/auth': { getSessionUser: async () => user }, '@/lib/permissions': { canViewGuildRoster: () => allowed },
    '@/lib/guildRoster': { loadGuildRosterData: async () => { reads++; return { members: [], stats: {}, source: 'fixture' }; } },
    '@/lib/profiles': { getOwnProfilePath: async () => '/profile' }, '@/lib/seo': { buildPageMetadata: () => ({}) },
    '@/lib/dashboardApiSettings': { getDashboardApiSettings: async () => ({}) },
    '@/lib/dashboardSystemLogs': { recordDashboardSystemLog: async () => {} },
    '@/lib/listNavigationScope': { listNavigationScope: () => 'account-and-access-scope' },
    '@/lib/discordGuildLinks': { discordGuildChannelUrl: () => '#', MISTBLOSSOM_DISCORD_CHANNELS: { general: {}, rules: {}, announcements: {}, raids: {} } },
    '@/components/GuildRoster.module.css': { default: {} },
  };
  for (const adapter of Object.values(modules)) if (Object.hasOwn(adapter, 'default')) adapter.__esModule = true;
  const file = path.join(__dirname, '../src/app/guild/page.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, console, require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  const find = node => !node || typeof node !== 'object' ? null : Array.isArray(node) ? node.map(find).find(Boolean) : node.type === Explorer ? node.props : find(node.props?.children);
  return { run: async () => find(await mod.exports.default()), reads: () => reads, deny: () => { allowed = false; }, anonymous: () => { user = null; } };
}
(async () => {
  await check('guild URL retains all valid filters, page, size and expanded panel', () => {
    const input = '/guild?q=%20Друїд%20&role=healer&segment=tank&class=Druid&spec=Restoration&faction=Alliance&raid=fixture&clear=heroic-clear&link=profile&sort=ilvl-desc&rioMin=1000&rioMax=2000&ilvlMin=600&ilvlMax=700&page=3&size=50&filters=1';
    const parsed = new URL(state.listViewUrl('guild', input), 'https://test');
    assert.equal(parsed.searchParams.get('q'), 'Друїд');
    assert.equal(parsed.searchParams.size, 17);
    assert.equal(parsed.searchParams.get('page'), '3');
  });
  await check('invalid enums, numeric formats and action data cannot enter navigation memory', () => {
    assert.equal(state.listViewUrl('guild', '/guild?role=owner&sort=delete&size=200&segment=invalid&clear=invalid&link=invalid&rioMin=Infinity&rioMax=-1&ilvlMin=0x100&page=NaN&filters=true&token=secret&action=delete&selected=owner'), '/guild');
  });
  await check('guild navigation rejects external URLs, sibling paths and excessive text', () => {
    for (const input of ['//evil.test/guild', 'https://evil.test/guild', '/guild/one', '/guild/../login', '/guild?q=' + 'a'.repeat(5000)]) assert.equal(state.listViewUrl('guild', input), null);
  });
  await check('absent upper bounds remain automatic while explicit zero remains a real limit', () => {
    const automatic = view.readGuildRosterView(new URLSearchParams());
    assert.equal(automatic.rio.max, null); assert.equal(automatic.ilvl.max, null);
    assert.equal(state.listViewUrl('guild', '/guild?rioMax=0&ilvlMax=0'), '/guild?rioMax=0&ilvlMax=0');
  });
  await check('explicit limits are independent of roster maxima and invalid ranges normalize', () => {
    assert.equal(view.readGuildRosterView(new URLSearchParams('rioMax=1500&ilvlMax=650')).rio.max, 1500);
    const reversed = view.readGuildRosterView(new URLSearchParams('rioMin=3000&rioMax=1000&ilvlMax=99999999&page=99999999'));
    assert.equal(reversed.rio.min, 1000); assert.equal(reversed.rio.max, 3000); assert.equal(reversed.ilvl.max, 10000); assert.equal(reversed.page, 10000);
  });
  await check('named guild views preserve filters and size but reset the page', () => {
    const memory = state.emptyListMemory('guild'); memory.views = [{ name: 'Хіли', url: '/guild?role=healer&rioMax=1500&page=4&size=50&filters=1' }];
    const saved = state.parseListMemory('guild', JSON.stringify(memory)).views[0];
    assert.equal(saved.url, '/guild?role=healer&rioMax=1500&size=50&filters=1');
  });
  await check('return URL keeps the exact page and character identity', () => {
    const row = state.listEntryId('guild', 'eu:terokkar:Себас');
    const memory = state.rememberListPosition(state.emptyListMemory('guild'), { url: '/guild?class=Druid&page=2', row, next: '', previous: '', scroll: 500, offset: 100, opened: true, at: Date.now() });
    assert.equal(state.listReturnUrl('guild', state.parseListMemory('guild', JSON.stringify(memory))), '/guild?class=Druid&page=2#' + row);
    assert.notEqual(state.listMemoryKey('guild', 'one'), state.listMemoryKey('profiles', 'one'));
  });
  await check('URL patches reset filters explicitly without creating network actions', () => {
    assert.equal(location.patchListUrl('guild', '/guild?class=Druid&spec=Balance&page=4&size=50&token=secret', { class: 'Mage', spec: null, page: null }), '/guild?class=Mage&size=50');
  });
  await check('all six sorts have stable total ordering for tied character metrics', () => {
    const members = ['c', 'a', 'b'].map(key => ({ key, name: 'Same', realmSlug: 'terokkar', itemLevel: 650, rank: 2, scores: { all: 2000 } }));
    for (const sort of ['rio-desc', 'rio-asc', 'ilvl-desc', 'raid-desc', 'name-asc', 'rank-asc']) {
      for (const input of [members, [...members].reverse()]) assert.deepEqual([...input].sort((a, b) => view.compareGuildRosterMembers(a, b, sort, 'all')).map(m => m.key), ['a', 'b', 'c']);
    }
  });
  await check('server page denies catalog access before reading cached guild data', async () => {
    const f = guildPageFixture(); f.deny(); await assert.rejects(f.run(), /redirect:\/profile/); assert.equal(f.reads(), 0);
  });
  await check('anonymous server page denies access before reading guild data', async () => {
    const f = guildPageFixture(); f.anonymous(); await assert.rejects(f.run(), /redirect:\/login/); assert.equal(f.reads(), 0);
  });
  await check('authorized server page supplies isolated navigation scope', async () => {
    const f = guildPageFixture(); const props = await f.run(); assert.equal(props.navigationScope, 'account-and-access-scope'); assert.equal(f.reads(), 1);
  });
  console.log(`[check-guild-list-navigation] ${passed}/${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
