const assert = require('node:assert/strict');
const load = require('./lib/load-server-ts.cjs');
const policy = load('src/lib/discordCleanupPolicy.ts').exports;
const row = i => ({ id: 'm' + i, userId: String(i), displayName: 'Member' + i, roleName: 'Member', checkedAt: '2026-10-15T07:00:00Z' });
const page = (start, count, cursor = null, scanId = 'scan0') => ({ rows: Array.from({ length: count }, (_, i) => row(start + i)), cursor, scanId });
const summary = { ok: true, settings: { enabled: false, roleId: 'role', roleName: 'Member', period: 'month', revision: 'revision' }, state: { checked: 100, candidates: 100, overdue: 0, blocked: 0, kickedTotal: 0, uncertainTotal: 0, recentRuns: [] } };
let calls = [], respond;
const subject = load('src/lib/discordCleanupView.ts', {
  '@/lib/discordCleanupPolicy': policy,
  '@/lib/dashboardApiClient': { dashboardApiJson: async (url, options) => { calls.push({ url: new URL(url, 'https://guild.test'), options }); return respond(calls.length, calls.at(-1)); } },
}, { URLSearchParams, Error }).exports;
const signal = new AbortController().signal;
let passed = 0;
async function check(name, run) { calls = []; await run(); passed++; console.log('PASS', name); }
(async () => {
  await check('1000 expanded rows use one metadata request and retain their snapshot', async () => { const previous = page(0, 1000, 'c1000'); respond = () => summary; const result = await subject.readCleanupView('candidates', signal, previous, 'background'); assert.equal(calls.length, 1); assert.equal(calls[0].url.searchParams.get('summary'), '1'); assert.equal(result.page, previous); assert.equal(result.listUpdated, false); });
  await check('a small background view still updates its actual member rows', async () => { respond = () => ({ ...summary, page: page(1, 2) }); const result = await subject.readCleanupView('candidates', signal, page(0, 2), 'background'); assert.equal(result.listUpdated, true); assert.equal(result.page.rows[0].id, 'm1'); assert.equal(calls.length, 1); });
  await check('load-more de-duplicates old and repeated new rows without mutating either page', async () => { const previous = page(0, 2, 'c2'); const next = page(1, 3); next.rows.push(row(2)); respond = () => ({ ...summary, page: next }); const result = await subject.readCleanupView('candidates', signal, previous, 'more'); assert.equal(result.page.rows.map(r => r.id).join(','), 'm0,m1,m2,m3'); assert.equal(previous.rows.length, 2); assert.equal(next.rows.length, 4); });
  await check('stale cursor restarts once and does not mix scans', async () => { respond = n => ({ ...summary, page: n === 1 ? { ...page(0, 0, null, 'scan1'), stale: true } : page(10, 2, null, 'scan1') }); const result = await subject.readCleanupView('candidates', signal, page(0, 2, 'c2'), 'more'); assert.equal(calls.length, 2); assert.equal(result.reset, true); assert.equal(result.page.rows.map(r => r.id).join(','), 'm10,m11'); });
  await check('manual refresh reconstructs 100 rows over four pages with one upstream signal', async () => { respond = n => ({ ...summary, page: page((n - 1) * 25, 25, n < 4 ? 'c' + n * 25 : null) }); const result = await subject.readCleanupView('candidates', signal, page(0, 100), 'refresh'); assert.equal(result.page.rows.length, 100); assert.equal(calls.length, 4); assert.ok(calls.every(c => c.options.signal === signal && c.options.retries === 0)); });
  await check('repeated cursor cannot cause an unbounded refresh loop', async () => { respond = n => ({ ...summary, page: page((n - 1) * 25, 25, 'same') }); await assert.rejects(subject.readCleanupView('candidates', signal, page(0, 100), 'refresh'), /не просувається/); assert.ok(calls.length <= 3); });
  await check('duplicate-only page is rejected even if the cursor changes', async () => { respond = n => ({ ...summary, page: page(0, 25, 'c' + n) }); await assert.rejects(subject.readCleanupView('candidates', signal, page(0, 100), 'refresh'), /не просувається/); assert.equal(calls.length, 2); });
  await check('a scan change mid-refresh discards partial rows and restarts at the new head', async () => { respond = n => ({ ...summary, page: n === 1 ? page(0, 25, 'c25') : n === 2 ? { ...page(0, 0, null, 'scan1'), stale: true } : page(200, 25, null, 'scan1') }); const result = await subject.readCleanupView('candidates', signal, page(0, 100), 'refresh'); assert.equal(calls.length, 3); assert.equal(result.reset, true); assert.equal(result.page.rows[0].id, 'm200'); assert.equal(result.page.rows.length, 25); });
  await check('a second stale head stops rather than retrying indefinitely', async () => { respond = () => ({ ...summary, page: { ...page(0, 0), stale: true } }); await assert.rejects(subject.readCleanupView('candidates', signal, page(0, 2, 'old'), 'more')); assert.equal(calls.length, 2); });
  await check('an unchanged load-more cursor is reported as a read error', async () => { respond = () => ({ ...summary, page: page(2, 2, 'same') }); await assert.rejects(subject.readCleanupView('candidates', signal, page(0, 2, 'same'), 'more'), /Курсор/); assert.equal(calls.length, 1); });
  await check('malformed or unconfirmed read payloads never become a valid empty list', async () => { for (const data of [null, '<html>login</html>', { ...summary, ok: 'true' }, { ...summary, page: {} }, { ...summary, state: { ...summary.state, checked: '100' } }, { ...summary, state: { ...summary.state, recentRuns: [null] } }]) { calls = []; respond = () => data; await assert.rejects(subject.readCleanupView('candidates', signal, page(0, 2), 'replace')); assert.equal(calls.length, 1); } });
  await check('merging 10000 prior rows and 100 new rows has bounded ID reads', () => { let reads = 0; const measured = (start, count) => Array.from({ length: count }, (_, i) => ({ get id() { reads++; return 'm' + (start + i); } })); const result = subject.mergeCleanupRows(measured(0, 10000), measured(10000, 100)); assert.equal(result.length, 10100); assert.ok(reads < 50000, 'quadratic membership work: ' + reads); });
  await check('cleanup settings require a boolean flag and a known calendar period', () => { assert.equal(subject.isCleanupSettings(summary.settings), true); assert.equal(subject.isCleanupSettings({ ...summary.settings, enabled: 'true' }), false); assert.equal(subject.isCleanupSettings({ ...summary.settings, period: 'century' }), false); });

  let user = null, overviewReads = 0, rowReads = 0, args;
  const route = load('src/app/api/dashboard/discord/member-cleanup/route.ts', {
    'next/server': { NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), init) } },
    '@/lib/auth': { getSession: async () => user }, '@/lib/permissions': { canManageDiscordMembers: who => who.allowed },
    '@/lib/dashboardDiscordRoute': {}, '@/lib/security': { noStoreHeaders: () => ({ 'cache-control': 'no-store' }), safeErrorMessage: () => 'Unavailable' },
    '@/lib/discordMemberCleanup': { getDiscordCleanupOverview: async () => { overviewReads++; return summary; }, listDiscordCleanupMembers: async (...input) => { rowReads++; args = input; return page(0, 2); } },
  }, { Response, Error }).exports;
  const get = query => route.GET({ nextUrl: new URL('https://guild.test/api/dashboard/discord/member-cleanup?' + query) });
  await check('metadata-only endpoint enforces authentication and permissions before reads', async () => { assert.equal((await get('summary=1')).status, 401); user = { allowed: false }; assert.equal((await get('summary=1')).status, 403); assert.equal(overviewReads + rowReads, 0); });
  await check('authorized summary reads no row page and remains no-store', async () => { user = { allowed: true }; const result = await get('summary=1&tab=candidates'); assert.equal(result.status, 200); assert.match(result.headers.get('cache-control'), /no-store/); assert.equal((await result.json()).page, undefined); assert.equal(overviewReads, 1); assert.equal(rowReads, 0); });
  await check('ordinary paged endpoint retains tab, cursor and scan parameters', async () => { const result = await get('tab=kicked&cursor=k_old&scanId=scan0'); assert.equal(result.status, 200); assert.equal(rowReads, 1); assert.equal(args.join(','), 'kicked,k_old,scan0'); });
  await check('invalid tab never invokes row reads even in summary mode', async () => { const before = overviewReads + rowReads; assert.equal((await get('summary=1&tab=invalid')).status, 503); assert.equal(overviewReads + rowReads, before); });
  console.log(`[check-cleanup-view] OK — ${passed}/${passed}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
