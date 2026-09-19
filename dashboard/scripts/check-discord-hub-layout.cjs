const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/discord/page.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/app/styles/pages.css'), 'utf8');

const checks = [
  ['Discord hub has page-specific responsive scope', page.includes('discord-hub-page')],
  ['Primary and tool groups are separated', page.includes('discord-hub-section-group--primary') && page.includes('discord-hub-section-group--tools')],
  ['Featured actions are marked explicitly', page.includes('discord-hub-card--featured')],
  ['Tool actions are marked explicitly', page.includes('discord-hub-card--tool')],
  ['Desktop tools distribute available actions without empty columns', css.includes('.discord-hub-section-group--tools') && css.includes('repeat(auto-fit, minmax(min(260px, 100%), 1fr))')],
  ['Tablet tools collapse to two columns', css.includes('@media (max-width: 1080px)') && css.includes('.discord-hub-section-group--tools > :last-child:nth-child(odd)')],
  ['Phone hub collapses to one column', css.includes('@media (max-width: 680px)') && css.includes('grid-template-columns: minmax(0, 1fr);')],
  ['Hub buttons meet touch target minimum', css.includes('min-height: 46px;')],
  ['Keyboard focus state is explicit', css.includes('.discord-hub-card:focus-visible')],
  ['Reduced motion is supported', css.includes('@media (prefers-reduced-motion: reduce)')],
  ['Legacy single auto-fit hub grid is removed', !page.includes('discord-hub-grid--compact')],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { console.error(`✗ ${label}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`[check-discord-hub-layout] OK — ${checks.length}/${checks.length}`);
