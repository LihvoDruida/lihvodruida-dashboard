const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/app/profile/[profileId]/page.tsx"), "utf8");
const characters = fs.readFileSync(path.join(root, "src/components/ProfileCharactersLiveSection.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/profile.css"), "utf8");
const desktop = fs.readFileSync(path.join(root, "src/app/styles/desktop.css"), "utf8");
const mobileStart = css.indexOf("19. PROFILE UI NORMALIZATION — v3.8.19");
const normalized = mobileStart >= 0 ? css.slice(mobileStart) : "";
const polishStart = css.indexOf("20. PROFILE MOBILE POLISH — v3.8.20");
const polish = polishStart >= 0 ? css.slice(polishStart) : "";

const checks = [
  [mobileStart >= 0, "profile normalization layer exists"],
  [normalized.includes("@media (max-width: 760px)"), "phone/tablet breakpoint is explicit"],
  [normalized.includes("grid-template-columns: 56px minmax(0, 1fr);"), "mobile sidebar identity keeps avatar beside account data"],
  [normalized.includes(".profile-account-sidebar__facts") && normalized.includes("repeat(2, minmax(0, 1fr))"), "mobile profile facts use a compact two-column grid"],
  [normalized.includes(".profile-account-header__actions") && normalized.includes("repeat(2, minmax(0, 1fr))"), "profile header actions are normalized for mobile"],
  [normalized.includes(".profile-character-artwork") && normalized.includes("height: 172px;"), "mobile character artwork height is reduced"],
  [normalized.includes(".profile-character-actions__row") && normalized.includes("repeat(2, minmax(0, 1fr))"), "character actions use a touch-friendly two-column row"],
  [page.includes('className="profile-raid-meta-item__detail"'), "raid metadata detail has dedicated markup"],
  [page.includes('className="profile-raid-card__difficulty"'), "raid difficulty has dedicated markup"],
  [normalized.includes("grid-template-columns: minmax(230px, 0.82fr) minmax(0, 1.55fr);"), "profile raid cards have a dedicated desktop split layout"],
  [normalized.includes(".profile-raid-card__meta") && normalized.includes("minmax(180px, 1.55fr)"), "desktop raid metadata uses a structured grid"],
  [normalized.includes(".profile-raid-meta-item") && normalized.includes("display: grid;"), "raid labels and values cannot concatenate inline"],
  [normalized.includes(".profile-raid-card {\n    grid-template-columns: minmax(0, 1fr);"), "raid cards collapse to one column on mobile"],
  [normalized.includes(".profile-raid-meta-item--character {\n    grid-column: 1 / -1;"), "mobile character metadata gets full card width"],
  [desktop.includes("@media (min-width: 1001px)"), "global desktop stylesheet remains independently scoped"],
  [polishStart >= 0, "v3.8.20 profile mobile polish layer exists"],
  [characters.includes('profile-character-mobile-badge'), "character markup exposes a dedicated mobile guild-state badge"],
  [polish.includes('.profile-character-badges--art {\n    display: none;'), "art-overlay guild badge is removed on mobile"],
  [polish.includes('.profile-character-title-row--stacked') && polish.includes('grid-template-columns: minmax(0, 1fr) auto;'), "mobile character title reserves the far-right badge column"],
  [polish.includes('.profile-character-mobile-badge {\n    display: inline-flex;') && polish.includes('justify-self: end;'), "guild/other badge is visible at the right edge on mobile"],
  [polish.includes('.profile-account-sidebar__nav {') && polish.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), "mobile profile menu is an explicit 2-column grid"],
  [polish.includes('.profile-account-sidebar__nav a .profile-account-sidebar__nav-label') && polish.includes('position: static;'), "mobile profile menu labels are always visible"],
  [polish.includes('.profile-account-sidebar__nav-count {\n    position: static;'), "mobile profile menu counter no longer floats over invisible controls"],
  [polish.includes('.profile-character-artwork {\n    height: 148px;'), "mobile character artwork is compacted further"],
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
