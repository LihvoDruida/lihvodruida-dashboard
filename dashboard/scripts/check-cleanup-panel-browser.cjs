const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const modules = [process.env.MISTBLOSSOM_QA_MODULES || root, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || root];
const { chromium } = require(require.resolve('playwright', { paths: modules }));
const esbuild = require(require.resolve('esbuild', { paths: modules }));
const output = process.env.MISTBLOSSOM_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-panel-'));
const baseline = process.env.MISTBLOSSOM_TEST_CLEANUP_SOURCE;
fs.mkdirSync(output, { recursive: true });
const role = '111111111111111111';
const member = i => ({ id: 'member' + i, userId: String(200000000000000000n + BigInt(i)), displayName: 'Member' + i, joinedAt: '2026-09-01T12:00:00Z', dueAt: '2026-11-01T12:00:00Z', roleId: role, roleName: 'Member', period: 'month', blockedReason: null, lastError: null, checkedAt: '2026-10-15T07:00:00Z', kickedAt: null, outcome: 'candidate' });
const settings = enabled => ({ enabled, roleId: role, roleName: 'Member', period: 'month', revision: 'fixture-revision', updatedAt: null, updatedBy: null });
const state = { activeScanId: 'scan0', scan: null, lastScanAt: null, checked: 100, candidates: 100, overdue: 0, blocked: 0, kickedTotal: 0, uncertainTotal: 0, lastRunAt: null, lastAutomaticRunAt: null, lastError: null, recentRuns: [], garbage: [] };
const execution = { token: 'fixture', paused: true, pauseRequestedAt: null, pauseRequestedBy: null, pauseObservedAt: null, inFlight: null };
const initial = (enabled, size) => ({ settings: settings(enabled), state, execution, page: { rows: Array.from({ length: size }, (_, i) => member(i)), cursor: 'c' + size, scanId: 'scan0' } });
fs.writeFileSync(path.join(output, 'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Panel from '@panel';const root=createRoot(document.getElementById('app'));window.unmount=()=>root.unmount();root.render(<main className="container"><button id="before">Before</button><Panel initial={window.fixture} roles={[{id:'${role}',name:'Member',blockedReason:null}]} canConfigure={true} warning={null}/><button id="after">After</button></main>);`);
let passed = 0, page, release, responseMode; const observations = {}, scenarios = [], errors = [];
async function check(name, run) { await run(); passed++; scenarios.push(name); console.log(baseline ? 'PROBE' : 'PASS', name); }
(async () => {
  await esbuild.build({ entryPoints: [path.join(output, 'entry.tsx')], outfile: path.join(output, 'app.js'), bundle: true, jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), alias: { '@panel': baseline ? path.join(baseline, 'DiscordMemberCleanupPanel.tsx') : path.join(root, 'src/components/DiscordMemberCleanupPanel.tsx') }, nodePaths: [path.join(root, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' } });
  const css = [...fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8').matchAll(/import "\.\/styles\/([^\"]+\.css)";/g)].map(m => fs.readFileSync(path.join(root, 'src/app/styles', m[1]), 'utf8')).join('\n');
  const server = http.createServer((req, res) => { if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(path.join(output, 'app.js'))); } if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); return res.end(css); } const url = new URL(req.url, 'http://qa.test'); res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="app"></div><script>window.fixture=' + JSON.stringify(initial(url.searchParams.get('enabled') === 'true', Number(url.searchParams.get('size')) || 2)) + '</script><script src="/app.js"></script></body></html>'); });
  server.unref(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ executablePath: process.env.MISTBLOSSOM_QA_CHROMIUM || undefined, args: ['--no-sandbox','--disable-gpu','--no-zygote','--disable-dev-shm-usage'], headless: true });
  let reads = 0, posts = 0, rowReads = 0;
  async function setup(mode = 'ok', enabled = false, size = 2) {
    if (page) await page.close(); page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.on('pageerror', e => errors.push(e.message)); reads = 0; posts = 0; rowReads = 0; release = null; responseMode = mode;
    let savedSettings = settings(enabled);
    await page.addInitScript(() => { const timers = new Map(), interval = window.setInterval, clear = window.clearInterval; window.setInterval = (fn, ms, ...args) => { const id = interval(fn, ms, ...args); if (ms === 10000 || ms === 30000) timers.set(id, fn); return id; }; window.clearInterval = id => { timers.delete(id); clear(id); }; window.tickCleanup = () => { for (const fn of timers.values()) fn(); }; window.inFlight = 0; const fetch = window.fetch.bind(window); window.fetch = (...args) => { window.inFlight++; return fetch(...args).finally(() => window.inFlight--); }; window.formatters = 0; const Formatter = Intl.DateTimeFormat; Intl.DateTimeFormat = class extends Formatter { constructor(...args) { super(...args); window.formatters++; } }; });
    await page.route('**/api/dashboard/discord/member-cleanup**', async route => {
      const req = route.request(), url = new URL(req.url());
      if (req.method() === 'POST') {
        posts++; const body = req.postDataJSON();
        if (responseMode === 'preempt' && body.action === 'settings') { savedSettings = { ...settings(body.enabled), period: body.period }; await new Promise(resolve => release = resolve); return route.fulfill({ json: { ok: true, settings: settings(true), execution } }); }
        if (responseMode === 'malformed') return route.fulfill({ json: { ok: true } });
        if (responseMode === 'truthy') return route.fulfill({ json: { ok: 'true', settings: settings(true), execution } });
        if (responseMode === 'denied') return route.fulfill({ status: 403, json: { error: 'Access denied' } });
        if (responseMode === 'delay') await new Promise(resolve => release = resolve);
        if (responseMode === 'lost') return route.fulfill({ status: 503, json: { error: 'response lost' } });
        if (body.action !== 'scan') savedSettings = { ...settings(body.action === 'pause' ? false : body.enabled), period: body.period || 'month' };
        return route.fulfill({ json: body.action === 'scan' ? { ok: true, result: { skipped: false, scanning: false } } : { ok: true, settings: savedSettings, execution } });
      }
      reads++; if (responseMode === 'fail') return route.fulfill({ status: 503, json: { error: 'offline' } });
      const overview = { ok: true, settings: savedSettings, state, execution };
      if (url.searchParams.get('summary') === '1') return route.fulfill({ json: overview });
      rowReads++; const start = Number((url.searchParams.get('cursor') || 'c0').slice(1)); const total = size > 25 ? size : 4; const end = Math.min(total, start + 25);
      return route.fulfill({ json: { ...overview, page: { rows: Array.from({ length: Math.max(0, end - start) }, (_, i) => member(start + i)), cursor: end < total ? 'c' + end : null, scanId: 'scan0' } } });
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/?enabled=' + enabled + '&size=' + size); await page.locator('#cleanup-role').waitFor();
  }
  const waitIdle = () => page.waitForFunction(() => window.inFlight === 0 && document.querySelector('.discord-cleanup-members').getAttribute('aria-busy') === 'false');
  const focus = () => page.evaluate(() => ({ tag: document.activeElement.tagName, result: document.activeElement.hasAttribute('data-action-result') }));
  try {
    await setup('ok', true);
    await check('pause retains a result focus after its button disappears', async () => { await page.getByRole('button', { name: 'Призупинити', exact: true }).focus(); await page.keyboard.press('Enter'); await page.getByText('Паузу прийнято. Автоматичне виключення призупинено.', { exact: true }).waitFor(); await waitIdle(); observations.pauseFocus = await focus(); if (!baseline) assert.equal(observations.pauseFocus.result, true); assert.equal(posts, 1); });
    await setup('fail');
    await check('a failed tab read is not shown as a valid empty history', async () => { await page.getByRole('tab', { name: 'Виключені', exact: true }).click(); await waitIdle(); observations.falseEmpty = await page.getByText('Виключень ще немає', { exact: true }).count(); if (!baseline) assert.equal(observations.falseEmpty, 0); });
    await check('successful background recovery clears the list error without another mutation', async () => { responseMode = 'ok'; await page.evaluate(() => window.tickCleanup()); await waitIdle(); observations.staleError = await page.getByRole('alert').filter({ hasText: 'offline' }).count(); if (!baseline) assert.equal(observations.staleError, 0); assert.equal(posts, 0); });
    await setup('ok', false, 100);
    await check('an expanded 100-row list uses one summary request per background tick', async () => { await page.evaluate(() => window.tickCleanup()); await waitIdle(); observations.expanded = { reads, rowReads, formatters: await page.evaluate(() => window.formatters), rows: await page.locator('.discord-cleanup-member').count() }; if (!baseline) { assert.equal(reads, 1); assert.equal(rowReads, 0); assert.equal(observations.expanded.rows, 100); assert.equal(observations.expanded.formatters, 1); } });
    await setup();
    await check('dirty cleanup settings pause background reads and keep the draft', async () => { await page.locator('#cleanup-period').selectOption('quarter'); await page.evaluate(() => window.tickCleanup()); await waitIdle(); observations.dirtyReads = reads; if (!baseline) assert.equal(reads, 0); assert.equal(await page.locator('#cleanup-period').inputValue(), 'quarter'); });
    await setup('lost');
    await check('uncertain settings save preserves the selected enabled flag', async () => { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Зберегти налаштування', exact: true }).click(); await page.getByText(/Збережений стан оновлено/).waitFor(); await waitIdle(); observations.recoveryDraftEnabled = await page.getByRole('checkbox').isChecked(); if (!baseline) assert.equal(observations.recoveryDraftEnabled, true); assert.equal(posts, 1); });
    await setup();
    await check('the last load-more action retains an accessible focus destination', async () => { await page.getByRole('button', { name: 'Показати ще 25', exact: true }).focus(); await page.keyboard.press('Enter'); await page.getByRole('button', { name: 'Показати ще 25', exact: true }).waitFor({ state: 'detached' }); await waitIdle(); observations.moreFocus = await focus(); if (!baseline) assert.equal(observations.moreFocus.result, true); assert.equal(posts, 0); });
    if (!baseline) {
      await setup('ok', false, 100);
      await check('explicit refresh reads the expanded snapshot once without triggering a scan', async () => { await page.getByRole('button', { name: 'Оновити показаний список', exact: true }).click(); await waitIdle(); assert.equal(reads, 4); assert.equal(rowReads, 4); assert.equal(posts, 0); assert.equal(await page.locator('.discord-cleanup-member').count(), 100); });
      await setup('fail'); await page.getByRole('tab', { name: 'Виключені', exact: true }).click(); await waitIdle();
      await check('list retry is GET-only and restores data', async () => { responseMode = 'ok'; await page.getByRole('button', { name: 'Повторити читання списку', exact: true }).click(); await waitIdle(); assert.equal(posts, 0); assert.equal(await page.getByRole('alert').filter({ hasText: 'offline' }).count(), 0); assert.equal(await page.locator('.discord-cleanup-member').count(), 4); });
      await setup('delay', true);
      await check('finishing pause does not steal a manually moved focus', async () => { await page.getByRole('button', { name: 'Призупинити', exact: true }).click(); await page.getByRole('button', { name: 'Призупиняю…', exact: true }).waitFor(); await page.locator('#after').focus(); release(); release = null; await waitIdle(); assert.equal(await page.locator('#after').evaluate(el => el === document.activeElement), true); assert.equal(posts, 1); });
      await check('invalid mutation confirmations never claim a saved setting or replay POST', async () => { for (const mode of ['malformed', 'truthy']) { await setup(mode); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Зберегти налаштування', exact: true }).click(); await page.getByText(/Збережений стан оновлено/).waitFor(); await waitIdle(); assert.equal(await page.getByText('Налаштування збережено. Автоматичне виключення увімкнено.', { exact: true }).count(), 0); assert.equal(await page.getByRole('checkbox').isChecked(), true); assert.equal(posts, 1); } });
      await setup('preempt');
      await check('pause stays available during settings save and ignores its late response', async () => { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Зберегти налаштування', exact: true }).click(); await page.getByRole('button', { name: 'Зберігаю…', exact: true }).waitFor(); await page.getByRole('button', { name: 'Призупинити', exact: true }).click(); await page.getByText('Паузу прийнято. Автоматичне виключення призупинено.', { exact: true }).waitFor(); await waitIdle(); release?.(); release = null; assert.equal(await page.getByRole('checkbox').isChecked(), false); assert.equal(posts, 2); assert.equal(await page.getByText('Налаштування збережено. Автоматичне виключення увімкнено.', { exact: true }).count(), 0); });
      await setup('denied');
      await check('successful list refresh does not erase a separate rejected action', async () => { await page.getByRole('button', { name: 'Оновити список', exact: true }).click(); await page.getByText('Access denied', { exact: true }).waitFor(); await waitIdle(); responseMode = 'ok'; await page.evaluate(() => window.tickCleanup()); await waitIdle(); assert.equal(await page.getByText('Access denied', { exact: true }).count(), 1); assert.equal(posts, 1); });
      await setup();
      await check('tab keyboard navigation keeps focus on the selected tab', async () => { await page.getByRole('tab', { name: 'Учасники', exact: true }).focus(); await page.keyboard.press('End'); await waitIdle(); assert.equal(await page.getByRole('tab', { name: 'Потребують уваги', exact: true }).getAttribute('aria-selected'), 'true'); assert.equal(await page.getByRole('tab', { name: 'Потребують уваги', exact: true }).evaluate(el => el === document.activeElement), true); });
      await check('cleanup remains responsive at nine widths without runtime errors', async () => { for (const width of [320,360,390,520,760,1024,1280,1600,1920]) { await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'overflow at ' + width); } assert.deepEqual(errors, []); });
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ baseline: Boolean(baseline), passed, failed: 0, scenarios, observations, errors, browser: await browser.version() }, null, 2));
  } finally { release?.(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
