const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const views = fs.readFileSync(path.join(root, "src/components/RaidViews.tsx"), "utf8");
const enhancer = fs.readFileSync(path.join(root, "src/components/RaidEditorFormEnhancer.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/raids.css"), "utf8");
const raids = fs.readFileSync(path.join(root, "src/lib/raids.ts"), "utf8");
const imagePicker = fs.readFileSync(path.join(root, "src/components/RaidImagePicker.tsx"), "utf8");
const newPage = fs.readFileSync(path.join(root, "src/app/raids/new/page.tsx"), "utf8");
const editPage = fs.readFileSync(path.join(root, "src/app/raids/[raidId]/edit/page.tsx"), "utf8");

const checks = [
  [views.includes('id="raid-editor-main"') && views.includes('id="raid-editor-rules"'), "form is split into main and signup-policy sections"],
  [views.includes('id="raid-editor-discord"') && views.includes('id="raid-editor-content"'), "Discord and visual sections are separate"],
  [views.includes('id="raid-editor-publish"') && views.includes('data-raid-save-state'), "publish area exposes a save-state indicator"],
  [views.includes('className="raid-editor-jump-nav"'), "long form has quick section navigation"],
  [views.includes('className="raid-setting-card raid-setting-card--deadline"'), "registration deadline is a dedicated setting card"],
  [views.includes('min={Math.max(1, activeSignupCount || 1)}'), "max-player client minimum respects active signups"],
  [views.includes('maxLength={4096}') && views.includes('maxLength={120}'), "client limits match server payload limits"],
  [views.includes('isInternalRaidThumbnail(raid.thumbnailUrl)') && views.includes('Залиш порожнім для автоматичної мініатюри'), "default thumbnail follows selected difficulty unless a custom URL is set"],
  [imagePicker.includes('dispatchEvent(new Event("input", { bubbles: true }))'), "image picker notifies live preview and dirty-state handlers"],
  [enhancer.includes('minRequired.disabled = !enabled') && enhancer.includes('minRequired.checked = false'), "ilvl block toggle cannot stay active without a threshold"],
  [enhancer.includes('lockSelect.disabled = !enabled') && enhancer.includes('querySelector<HTMLElement>("[data-raid-registration-deadline]")'), "registration timing is dependency-controlled"],
  [enhancer.includes('window.addEventListener("beforeunload"'), "dirty raid edits warn before accidental unload"],
  [enhancer.includes('new Intl.DateTimeFormat("uk-UA"'), "registration deadline is explained in local UI"],
  [raids.includes('Щоб блокувати запис за item level, спочатку вкажи мінімальний item level.'), "server rejects contradictory ilvl policy"],
  [css.includes('.raid-editor-layout') && css.includes('grid-template-columns: minmax(0, 1.32fr) minmax(360px, 0.68fr);'), "desktop editor uses an explicit form/preview grid"],
  [css.includes('.raid-editor-layout > .raid-preview-column') && css.includes('position: sticky;'), "desktop preview stays visible while editing"],
  [css.includes('@media (max-width: 1180px)') && css.includes('position: static;'), "preview unsticks when the screen becomes narrow"],
  [css.includes('.raid-form-section--rules') && css.includes('repeat(3, minmax(0, 1fr))'), "signup rules use compact setting cards on desktop"],
  [css.includes('.raid-publish-panel') && css.includes('.raid-form-panel.is-dirty .raid-save-state'), "publish area and dirty state have dedicated styling"],
  [newPage.includes('className="raid-editor-layout"') && editPage.includes('className="raid-editor-layout"'), "create and edit share the same editor layout"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  console.error(`[check-raid-editor] FAILED — ${failed.length}/${checks.length} invariant(s) failed:`);
  for (const [, message] of failed) console.error(` - ${message}`);
  process.exit(1);
}

console.log(`[check-raid-editor] OK — ${checks.length} layout/interaction invariants checked.`);
