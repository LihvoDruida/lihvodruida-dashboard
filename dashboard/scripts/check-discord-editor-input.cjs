const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'src/components/DiscordEmbedEditor.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/app/discord/embed/page.tsx'), 'utf8');

const checks = [
  [editor.includes('const defaultAutoroleButtonsKey = JSON.stringify(normalizeAutoroleButtonList(defaultAutoroleButtons));'), 'autorole defaults are reduced to a semantic key'],
  [editor.includes('const normalizedDefaultAutoroleButtons = useMemo<DiscordAutoroleButtonOption[]>('), 'autorole default snapshot is memoized by semantic content'],
  [editor.includes('[defaultAutoroleButtonsKey],'), 'memoization depends on semantic key rather than raw array identity'],
  [editor.includes('setAutoroleButtons(normalizedDefaultAutoroleButtons);'), 'reset effect restores the stable semantic snapshot'],
  [editor.includes('fallbackAuthorName, normalizedDefaultAutoroleButtons]);'), 'reset effect depends on stable autorole snapshot'],
  [!editor.includes('fallbackAuthorName, defaultAutoroleButtons]);'), 'raw defaultAutoroleButtons array is not a reset dependency'],
  [page.includes('mode="general"') && !page.includes('defaultAutoroleButtons='), 'general embed editor intentionally omits autorole defaults'],
  [editor.includes('value={content}') && editor.includes('onChange={(event) => setContent(event.currentTarget.value)}'), 'message content is a normal controlled textarea'],
  [editor.includes('value={titleValue}') && editor.includes('setTitleValue(event.currentTarget.value)'), 'title input preserves controlled typing'],
  [editor.includes('value={descriptionValue}') && editor.includes('setDescriptionValue(event.currentTarget.value)'), 'description textarea preserves controlled typing'],
  [editor.includes('value={authorName}') && editor.includes('setAuthorName(event.currentTarget.value)'), 'author input preserves controlled typing'],
  [editor.includes('value={footerText}') && editor.includes('setFooterText(event.currentTarget.value)'), 'footer input preserves controlled typing'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else {
    failed += 1;
    console.error(`✗ ${label}`);
  }
}

// Prove the exact identity trap independently of React: two omitted-array defaults
// have different identities even though their semantic payload is identical.
function omittedArrayDefault(value = []) { return value; }
const renderA = omittedArrayDefault();
const renderB = omittedArrayDefault();
const rawIdentityChanges = renderA !== renderB;
const semanticIdentityStays = JSON.stringify(renderA) === JSON.stringify(renderB);
if (rawIdentityChanges && semanticIdentityStays) {
  console.log('✓ regression model reproduces raw-array identity churn with stable semantic content');
} else {
  failed += 1;
  console.error('✗ regression model failed to reproduce raw-array identity churn');
}

if (failed) {
  console.error(`[check-discord-editor-input] FAILED — ${failed}/${checks.length + 1} invariant(s) failed.`);
  process.exit(1);
}

console.log(`[check-discord-editor-input] OK — ${checks.length + 1}/${checks.length + 1} input/reset invariants checked.`);
