// Account profile and settings: shared account header, self-contained module styles, phone layout.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const page = read("src/app/profile/[profileId]/page.tsx");
const settingsPage = read("src/app/profile/[profileId]/settings/page.tsx");
const overview = read("src/components/profile/ProfileOverviewView.tsx");
const settings = read("src/components/profile/settings/ProfileSettingsView.tsx");
const hero = read("src/components/account/AccountHero.tsx");
const card = read("src/components/account/AccountCard.tsx");
const characters = read("src/components/ProfileCharactersLiveSection.tsx");
const raids = read("src/components/profile/ProfileRaidSignups.tsx");
const css = read("src/components/account/account.module.css");
const phone = css.slice(css.indexOf("@media (max-width: 640px)"));

const checks = [
  [page.includes("loadProfileOverview") && page.includes("<ProfileOverviewView"), "profile page uses server loader and shared view"],
  [settingsPage.includes("loadProfileSettings") && settingsPage.includes("<ProfileSettingsView"), "settings is a separate page with its own loader"],
  [overview.includes("<AccountHero") && settings.includes("<AccountHero"), "profile and settings share the account header"],
  [hero.includes("<h1") && hero.includes('aria-current={tab.current ? "page" : undefined}'), "account header owns the page h1 and marks the current tab"],
  [settings.includes('current: true') && overview.includes('current: true'), "each page marks its own tab as current"],
  [["profile-name-settings", "profile-gender-settings", "profile-nickname-settings", "profile-role-settings"].every(id => settings.includes(`id="${id}"`)), "settings keep the form anchors other pages link to"],
  [settings.includes("aria-label=\"Розділи налаштувань\""), "settings have a named section navigation"],
  [card.includes("<LogoutButton") && overview.includes("canSignOut={isOwnProfile}"), "only the owner gets sign-out on the profile"],
  [characters.includes('action="/api/profile/characters/main"') && characters.includes('action="/api/profile/characters/remove"'), "character tiles keep the main / remove forms"],
  [/aria-label=\{`Зробити мейном: \$\{character\.name\}`\}/.test(characters) && /aria-label=\{`Видалити з профілю: \$\{character\.name\}`\}/.test(characters), "icon-only character actions are named for assistive tech"],
  [characters.includes("refreshOnMount: false"), "SSR-backed character list does not refetch on mount"],
  [raids.includes("<DataGrid") && raids.includes("unavailable ? <ErrorState") && raids.includes("<EmptyState"), "raid records keep distinct failed, empty and list states"],
  [!/#[0-9a-f]{3,8}\b|\brgba?\(/i.test(css), "account styles use colour tokens only"],
  [css.includes("@media (max-width: 1000px)") && css.includes(".layout, .settingsLayout { grid-template-columns: minmax(0, 1fr); }"), "two-column layouts collapse on tablets"],
  [phone.includes(".stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }") && phone.includes(".charStats { grid-template-columns: repeat(2, minmax(0, 1fr)); }"), "phone layout keeps two-column numbers on the account header and character cards"],
  [!/gradient\(/.test(css), "account styles use flat surfaces, no gradients"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { failed += 1; console.error(`✗ ${label}`); }
}
if (failed) { console.error(`[check-profile-mobile] failed: ${failed}/${checks.length}`); process.exit(1); }
console.log(`[check-profile-mobile] OK — ${checks.length}/${checks.length}`);
