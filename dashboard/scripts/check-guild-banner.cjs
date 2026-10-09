const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let ts;
try { ts = require('typescript'); }
catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js'); }

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const utils = read('src/lib/wowWeeklyReset.ts');
const client = read('src/components/GuildStatusBanner.tsx');
const identity = read('src/components/DashboardIdentity.tsx');
const css = read('src/app/styles/guild-banner.css');
const layout = read('src/app/layout.tsx');
const tokens = read('src/app/styles/tokens.css');

const compiled = ts.transpileModule(utils, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
if (compiled.diagnostics?.length) throw new Error('Weekly reset module does not transpile');
const sandbox = { module: { exports: {} }, exports: {}, Date, console };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled.outputText, sandbox, { timeout: 1000 });
const { nextRetailEuWeeklyReset: next, splitResetCountdown: parts } = sandbox.module.exports;

const checks = [
  ['before Wednesday reset', next(Date.parse('2026-10-07T03:59:59Z')) === Date.parse('2026-10-07T04:00:00Z')],
  ['at reset switches to next Wednesday', next(Date.parse('2026-10-07T04:00:00Z')) === Date.parse('2026-10-14T04:00:00Z')],
  ['Sunday before DST ends stays on UTC boundary', next(Date.parse('2026-10-25T01:00:00Z')) === Date.parse('2026-10-28T04:00:00Z')],
  ['January year rollover stays correct', next(Date.parse('2026-12-31T23:59:59Z')) === Date.parse('2027-01-06T04:00:00Z')],
  ['countdown parts display correct 4 numbers', JSON.stringify(parts(86400000 + 2*3600000 + 3*60000 + 4000)) === JSON.stringify({days:1,hours:2,minutes:3,seconds:4})],
  ['no negative countdown', parts(-5000).seconds === 0],
  ['timer uses real clock instead of decreasing a stale counter', /Date\.now\(\)/.test(client) && /setInterval\(tick, 1_000\)/.test(client)],
  ['down-scroll hides ribbon, up-scroll reveals', /current > lastScrollY \+ SCROLL_DELTA/.test(client) && /current < lastScrollY - SCROLL_DELTA/.test(client)],
  ['scroll listener passive and cleaned up', /scroll", onScroll, \{ passive: true \}/.test(client) && /removeEventListener\("scroll", onScroll\)/.test(client)],
  ['progress is guild aggregate not members progress', /roster\?\.stats\.raidProgression/.test(identity) && /primaryCurrentRaidProgress/.test(identity)],
  ['current season filter prevents old raid title', /currentSeasonRaidSlugs/.test(identity) && /currentSlugs\.length/.test(identity)],
  ['cached-only load avoids Raider.IO requests on nav render', /loadStoredGuildRosterData/.test(identity)],
  ['central guild title and real three-difficulty counters', /guild-status-banner__brand/.test(client) && /raid\.mythicKills/.test(client) && /raid\.heroicKills/.test(client) && /raid\.normalKills/.test(client)],
  ['ribbon is before main nav and nav remains intact', identity.indexOf('<GuildStatusBanner') < identity.indexOf('<header className="dashboard-topbar"')],
  ['mobile pinned nav adjusts while banner visible', /html\.guild-banner-collapsed body:has\(\.guild-status-banner\) \.site-nav \{ top: 0; \}/.test(css)],
  ['desktop nav stays pinned and slides under ribbon', /body:has\(\.guild-status-banner\) \.dashboard-topbar/.test(css) && /top: 12px/.test(css)],
  ['reduced motion respected', /prefers-reduced-motion: reduce/.test(css)],
  ['existing background remains: ribbon reuses forest asset only', /profile-hero-bg.png/.test(css) && /background-attachment: fixed/.test(read('src/app/styles/base.css'))],
  ['fonts use pre-bundled local OFL resources', /next\/font\/local/.test(layout) && /SpectralSC-Bold\.ttf/.test(layout) && /Philosopher-Bold\.ttf/.test(layout)],
  ['global typography tokens updated', /--font-brand: var\(--font-guild-display\)/.test(tokens) && /--font-display: var\(--font-guild-heading\)/.test(tokens)],
  ['style file globally imported after desktop geometry', layout.indexOf('"./styles/desktop.css"') < layout.indexOf('"./styles/guild-banner.css"')],
];
for (const [name, pass] of checks) {
  if (!pass) throw new Error(`[check-guild-banner] FAIL — ${name}`);
  console.log(`✓ ${name}`);
}
console.log(`[check-guild-banner] OK — ${checks.length}/${checks.length}`);
