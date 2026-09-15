const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const editor = read('src/components/DiscordEmbedEditor.tsx');
const raidPicker = read('src/components/RaidRoleMentionPicker.tsx');
const roster = read('src/app/roster/page.tsx');
const pagesCss = read('src/app/styles/pages.css');
const rosterCss = read('src/app/styles/roster.css');
const componentsCss = read('src/app/styles/components.css');
const uiAudit = read('scripts/audit-ui.cjs');

const checks = [
  [editor.includes('className="discord-role-picker-list"'), 'shared picker renders the new card grid'],
  [editor.includes('className="discord-role-chip"'), 'shared picker renders removable selected-role chips'],
  [editor.includes('discord-role-picker-option__badge'), 'shared picker exposes explicit selected/unselected state'],
  [pagesCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), 'desktop role picker uses two columns'],
  [pagesCss.includes('@media (max-width: 900px)') && pagesCss.includes('.discord-role-picker-list'), 'role picker collapses responsively'],
  [pagesCss.includes('.discord-role-picker-option[data-selected="true"]'), 'selected role cards have a dedicated visual state'],
  [raidPicker.includes('<RolePicker'), 'raid role picker delegates to the shared role picker'],
  [roster.includes('<RaidRoleMentionPicker') && !roster.includes('roster-role-picker'), 'roster page uses the shared picker instead of legacy checkboxes'],
  [!rosterCss.includes('.roster-role-picker') && !rosterCss.includes('.roster-role-check'), 'legacy roster picker CSS is removed'],
  [!componentsCss.includes('.roster-role-check'), 'legacy touch override is removed'],
  [uiAudit.includes("'discord-role-chip'"), 'UI audit recognizes the selected-role chip as a semantic control'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else {
    failed += 1;
    console.error(`✗ ${label}`);
  }
}

if (failed) {
  console.error(`[check-role-picker] FAILED — ${failed}/${checks.length} invariant(s) failed.`);
  process.exit(1);
}

console.log(`[check-role-picker] OK — ${checks.length}/${checks.length} picker/layout invariants checked.`);
