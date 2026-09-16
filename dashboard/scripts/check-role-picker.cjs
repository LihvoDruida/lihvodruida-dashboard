const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const editor = read('src/components/DiscordEmbedEditor.tsx');
const raidPicker = read('src/components/RaidRoleMentionPicker.tsx');
const raidPollForm = read('src/components/RaidPollCreateClientForm.tsx');
const roster = read('src/app/roster/page.tsx');
const pagesCss = read('src/app/styles/pages.css');
const pollsCss = read('src/app/styles/polls.css');
const rosterCss = read('src/app/styles/roster.css');
const componentsCss = read('src/app/styles/components.css');
const uiAudit = read('scripts/audit-ui.cjs');

const compactRolePicker = pagesCss.slice(
  pagesCss.indexOf('.discord-role-picker {'),
  pagesCss.indexOf('/* =========================================================', pagesCss.indexOf('.discord-role-picker {')),
);

const checks = [
  [editor.includes('className="discord-role-picker-list"'), 'shared picker renders the card grid'],
  [editor.includes('className="discord-role-chip"'), 'shared picker renders removable selected-role chips'],
  [editor.includes('discord-role-picker-option__badge'), 'shared picker exposes explicit selected/unselected state'],
  [compactRolePicker.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), 'desktop/tablet role picker uses two compact columns'],
  [compactRolePicker.includes('--role-picker-card-height: 58px;'), 'desktop role cards keep a compact bounded height'],
  [compactRolePicker.includes('grid-template-areas: "control body badge";'), 'role card content stays on one stable horizontal row'],
  [compactRolePicker.includes('@media (max-width: 640px)') && compactRolePicker.includes('--role-picker-card-height: 52px;'), 'mobile role cards use the compact height variant'],
  [compactRolePicker.includes('.discord-role-picker-option__hint {\n    display: none;'), 'mobile role cards remove secondary copy instead of growing vertically'],
  [compactRolePicker.includes('.discord-role-selected {') && compactRolePicker.includes('min-height: 28px;'), 'selected-role summary is compact'],
  [compactRolePicker.includes('.discord-role-search-shell {') && compactRolePicker.includes('min-height: 40px;'), 'role search field is compact'],
  [compactRolePicker.includes('.discord-role-picker-option[data-selected="true"]'), 'selected role cards have a dedicated visual state'],
  [raidPicker.includes('<RolePicker'), 'raid role picker delegates to the shared role picker'],
  [raidPollForm.includes('<RolePicker'), 'raid poll role picker delegates to the shared role picker'],
  [roster.includes('<RaidRoleMentionPicker') && !roster.includes('roster-role-picker'), 'roster page uses the shared picker instead of legacy checkboxes'],
  [pollsCss.includes('.raid-poll-publication-option') && pollsCss.includes('min-height: 64px;'), 'similar raid-poll choice cards use compact desktop geometry'],
  [pollsCss.includes('@media (max-width: 640px)') && pollsCss.includes('min-height: 54px;'), 'similar raid-poll choice cards stay compact on mobile'],
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
