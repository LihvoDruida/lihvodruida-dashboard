const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

const tokens = read('src/app/styles/tokens.css');
const base = read('src/app/styles/base.css');
const backgroundApi = read('src/lib/dashboardBackgroundApi.ts');
const starfield = read('public/js/dashboard-starfield.js');
const profile = read('src/app/profile/[profileId]/page.tsx');
const content = read('src/app/content/page.tsx');
const admin = read('src/app/dashboard/page.tsx');
const roster = read('src/app/roster/page.tsx');
const autoroles = read('src/app/discord/autoroles/page.tsx');
const rulesEdit = read('src/app/discord/rules/edit/page.tsx');
const liveSync = read('src/components/DashboardLivePageSync.tsx');
const cssFiles = walk(path.join(root, 'src')).filter((file) => file.endsWith('.css'));
const css = cssFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const tsxFiles = walk(path.join(root, 'src')).filter((file) => file.endsWith('.tsx'));
const tsx = tsxFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

const checks = [
  ['global body and branded heading font stacks are centralized', tokens.includes('--font-sans: system-ui') && tokens.includes('--font-display: var(--font-guild-heading)') && tokens.includes('--font-brand: var(--font-guild-display)')],
  ['common font sizes use shared tokens', tokens.includes('--font-size-ui: 0.78rem') && css.includes('font-size: var(--font-size-ui)')],
  ['font weights are centralized', tokens.includes('--font-weight-semibold: 650') && css.includes('font-weight: var(--font-weight-bold)')],
  ['line heights are centralized', tokens.includes('--line-height-body: 1.5') && css.includes('line-height: var(--line-height-body)')],
  ['legacy semantic CSS aliases are defined', ['--shadow-sm:', '--surface-panel:', '--gap-section:', '--text:'].every((token) => tokens.includes(token))],
  ['monospace stack has no direct duplicate declaration', !css.includes('font-family: ui-monospace, SFMono-Regular, Menlo, monospace;')],
  ['background resources notify only their own subscribers', backgroundApi.includes('listeners: Set<() => void>') && backgroundApi.includes('emitRecord(record)') && backgroundApi.includes('subscribeToResource') && !backgroundApi.includes('const listeners = new Set<() => void>()')],
  ['decorative starfield honors data saver and low-memory clients', starfield.includes('connection?.saveData') && starfield.includes('navigator.deviceMemory')],
  ['decorative starfield is FPS and DPR capped', starfield.includes('desktopFps: 30') && starfield.includes('mobileFps: 24') && starfield.includes('isSmall ? 1.25 : 1.5')],
  ['decorative starfield pauses outside active page lifecycle', starfield.includes('visibilitychange') && starfield.includes('pagehide') && starfield.includes('pageshow')],
  ['mobile background avoids fixed repainting', base.includes('@media (max-width: 1000px)') && base.includes('background-attachment: scroll')],
  ['long lists use content visibility containment', css.includes('content-visibility: auto') && css.includes('contain-intrinsic-size: auto')],
  ['editor-heavy routes avoid passive full-page refreshes', liveSync.includes('isEditorHeavyPath') && liveSync.includes('allowPassiveFullRefresh')],
  ['profile independent reads are parallelized', profile.includes('query, nicknamePolicy, apiSettings] = await Promise.all') && profile.includes('[raidSignups, discordMember] = await Promise.all')],
  ['content editor independent reads are parallelized', content.includes('[params, authorIdentity, items] = await Promise.all')],
  ['admin policies load in parallel', admin.includes('[policy, geoPolicy, authPolicy, rolesResult] = await Promise.all')],
  ['roster metadata and stored formations load in parallel', roster.includes('[authorIdentity, discordMetadata, formations] = await Promise.all')],
  ['Discord autorole metadata and edit message load in parallel', autoroles.includes('[channelData, roleControl, message] = await Promise.all')],
  ['Discord rules metadata and edit message load in parallel', rulesEdit.includes('[channelData, roleData, message] = await Promise.all')],
  ['lazy images opt into async decoding', tsx.includes('loading="lazy"') && tsx.includes('decoding="async"')],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { failed += 1; console.error(`✗ ${label}`); }
}
if (failed) {
  console.error(`[check-ui-standardization-performance] FAILED — ${failed}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-ui-standardization-performance] OK — ${checks.length}/${checks.length} standardization/performance invariants checked.`);
