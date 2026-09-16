const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/app/profile/[profileId]/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/profile.css"), "utf8");
const desktop = fs.readFileSync(path.join(root, "src/app/styles/desktop.css"), "utf8");
const mobileStart = css.indexOf("19. PROFILE UI NORMALIZATION — v3.8.19");
const normalized = mobileStart >= 0 ? css.slice(mobileStart) : "";

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
