const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/app/profile/[profileId]/page.tsx"), "utf8");
const characters = fs.readFileSync(path.join(root, "src/components/ProfileCharactersLiveSection.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/profile.css"), "utf8");
const desktop = fs.readFileSync(path.join(root, "src/app/styles/desktop.css"), "utf8");
const workspace = fs.readFileSync(path.join(root, "src/components/profile/profile-workspace.module.css"), "utf8");
const foundation = fs.readFileSync(path.join(root, "src/components/page/page-system.module.css"), "utf8");
const raids = fs.readFileSync(path.join(root, "src/components/profile/ProfileRaidSignups.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "src/components/profile/ProfileSidebar.tsx"), "utf8");
const mobileStart = css.indexOf("19. PROFILE UI NORMALIZATION");
const normalized = css.slice(mobileStart);
const polish = css.slice(css.indexOf("20. PROFILE MOBILE POLISH"));
const checks = [
  [page.includes("loadProfileOverview") && page.includes("<ProfileOverviewView"), "profile page uses server loader and shared view"],
  [foundation.includes("@media (max-width: 1000px)") && foundation.includes("grid-template-columns: minmax(0, 1fr)"), "page sidebar collapses on smaller screens"],
  [workspace.includes(".facts { grid-template-columns: repeat(2, minmax(0, 1fr))"), "mobile facts use two columns"],
  [workspace.includes(".navigation { grid-template-columns: repeat(2, minmax(0, 1fr))"), "mobile navigation has visible two-column labels"],
  [sidebar.includes('aria-current=') && sidebar.includes('overviewHref'), "profile navigation keeps current state and rules return URL"],
  [raids.includes("<DataGrid") && raids.includes("<DataCard"), "raid cards share the adaptive data grid"],
  [raids.includes("raidDifficultyLabel") && raids.includes("Роль і спеціалізація") && raids.includes("<dt>Персонаж</dt>"), "raid metadata retains difficulty, character and role"],
  [raids.includes("unavailable ? <ErrorState") && raids.includes("<EmptyState"), "failed reads and empty raid list remain distinct"],
  [normalized.includes(".profile-character-actions__row") && normalized.includes("repeat(2, minmax(0, 1fr))"), "character actions keep a touch-friendly row"],
  [characters.includes("profile-character-mobile-badge"), "character guild-state badge remains available"],
  [polish.includes(".profile-character-badges--art") && polish.includes("display: none"), "duplicate artwork badge stays hidden on mobile"],
  [polish.includes(".profile-character-title-row--stacked") && polish.includes("grid-template-columns: minmax(0, 1fr) auto"), "character title reserves badge space"],
  [polish.includes(".profile-character-mobile-badge") && polish.includes("justify-self: end"), "guild badge remains aligned to the edge"],
  [polish.includes("height: 148px"), "mobile character artwork remains compact"],
  [desktop.includes("@media (min-width: 1001px)"), "global desktop stylesheet remains scoped"],
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
  console.error(`[check-profile-mobile] FAILED — ${failed}/${checks.length} invariant(s) failed.`);
  process.exit(1);
}

console.log(`[check-profile-mobile] OK — ${checks.length}/${checks.length} profile/mobile/raid invariants checked.`);
