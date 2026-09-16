const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const explorer = fs.readFileSync(path.join(root, "src/components/GuildRosterExplorer.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/components/GuildRoster.module.css"), "utf8");

const desktopGrid = "grid-template-columns: minmax(210px, 1.35fr) minmax(180px, 1.1fr) 82px 76px 104px minmax(180px, 1.1fr) 72px 126px;";
const mobileBlock = css.slice(css.indexOf("@media (max-width: 760px)"));

const checks = [
  ["desktop table grid is unchanged", css.includes(desktopGrid)],
  ["mobile identity is rendered separately", explorer.includes("styles.mobileIdentity") && explorer.includes("styles.mobileIdentityCopy")],
  ["desktop identity cells remain in markup", explorer.includes("styles.characterCell") && explorer.includes("styles.classCell")],
  ["role cell can be hidden only on mobile", explorer.includes("styles.roleCell") && mobileBlock.includes(".roleCell")],
  ["mobile identity is hidden by default", css.includes(".mobileIdentity {\n  display: none;")],
  ["phone breakpoint enables compact mobile identity", mobileBlock.includes(".mobileIdentity {\n    display: grid;")],
  ["mobile search cancels desktop flex basis", mobileBlock.includes(".searchBox {") && mobileBlock.includes("flex: 0 0 auto;") && mobileBlock.includes("height: 46px;")],
  ["mobile metrics use horizontal swipe rail", mobileBlock.includes(".metrics {\n    display: flex;") && mobileBlock.includes("overflow-x: auto;") && mobileBlock.includes("scroll-snap-type: x proximity;")],
  ["mobile roster rows are card grids", mobileBlock.includes(".tableRow {") && mobileBlock.includes("grid-template-columns: repeat(2, minmax(0, 1fr));") && mobileBlock.includes("border-radius: 14px;")],
  ["mobile stat cells are compact tiles", mobileBlock.includes('.tableRow > div[role="cell"]:not(.mobileIdentity)') && mobileBlock.includes('content: attr(data-label);')],
  ["mobile links span the card", mobileBlock.includes(".linksCell {\n    grid-column: 1 / -1;") && mobileBlock.includes("min-height: 38px;")],
  ["mobile quick-role filters can scroll instead of overflow", mobileBlock.includes(".quickRoles {") && mobileBlock.includes("-webkit-overflow-scrolling: touch;")],
  ["advanced filters use two columns then one on narrow phones", mobileBlock.includes(".filtersPanel {\n    grid-template-columns: repeat(2, minmax(0, 1fr));") && css.includes("@media (max-width: 520px)") && css.includes(".filtersPanel {\n    grid-template-columns: minmax(0, 1fr);")],
  ["mobile footer keeps pagination touch friendly", mobileBlock.includes(".pagination button {") && mobileBlock.includes("min-height: 40px;")],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else {
    failed += 1;
    console.error(`✗ ${label}`);
  }
}

if (failed) {
  console.error(`[check-guild-mobile] FAILED — ${failed}/${checks.length} invariant(s) failed.`);
  process.exit(1);
}

console.log(`[check-guild-mobile] OK — ${checks.length}/${checks.length} mobile/desktop isolation invariants checked.`);
