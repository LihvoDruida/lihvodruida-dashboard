const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pagePath = path.join(root, "src/app/profiles/page.tsx");
const cssPath = path.join(root, "src/app/styles/directory.css");
const page = fs.readFileSync(pagePath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

const checks = [
  ["profiles use dedicated roster rows", page.includes('className="profile-directory-row"')],
  ["profile avatar is visible", page.includes('className="profile-directory-avatar"')],
  ["search supports Battle.net filter", page.includes('name="link"') && page.includes('value="linked"')],
  ["search supports role filter", page.includes('name="role"') && page.includes('value="moderator"')],
  ["search supports sorting", page.includes('name="sort"') && page.includes('value="characters"')],
  ["pagination preserves filters", page.includes("paginationState") && page.includes("buildProfilesHref")],
  ["dangerous cleanup removed from directory", !page.includes('action="/api/dashboard/discord/profiles/cleanup"')],
  ["maintenance links to management page", page.includes('/dashboard/discord#discord-profiles')],
  ["hero statistics are compact", page.includes('className="profile-directory-hero-metrics"')],
  ["desktop profile grid has explicit columns", css.includes(".profile-directory-head,") && css.includes("minmax(230px, 1.65fr)")],
  ["profile cards have hover state", css.includes(".profile-directory-row:hover")],
  ["tablet layout exists", css.includes("@media (max-width: 860px)") && css.includes(".profile-directory-user,")],
  ["mobile layout exists", css.includes("@media (max-width: 560px)")],
  ["mobile search becomes single column", css.includes(".profile-directory-hero-metrics,") && css.includes(".profile-directory-search,")],
  ["empty state is dedicated", page.includes('className="profile-directory-empty"') && css.includes(".profile-directory-empty")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
if (failed.length) {
  console.error(`[check-profiles-page] failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-profiles-page] OK — ${checks.length}/${checks.length}`);
