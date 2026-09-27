const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const layout = read("src/app/layout.tsx");
const layoutCss = read("src/app/styles/layout.css");
const pagesCss = read("src/app/styles/pages.css");
const liveSync = read("src/components/DashboardLivePageSync.tsx");
const authGuard = read("src/components/ClientAuthGuard.tsx");
const background = read("src/lib/dashboardBackgroundApi.ts");
const embed = read("src/app/discord/embed/page.tsx");
const desktopNav = read("src/components/DashboardDesktopNav.tsx");
const identity = read("src/components/DashboardIdentity.tsx");
const terms = read("src/app/terms/page.tsx");
const privacy = read("src/app/privacy/page.tsx");
const profileLive = read("src/components/ProfileCharactersLiveSection.tsx");
const guildLive = read("src/components/GuildRosterExplorer.tsx");
const raidLive = read("src/components/RaidLiveSync.tsx");
const pollLive = read("src/components/RaidPollLiveSync.tsx");

const checks = [
  [!exists("src/app/loading.tsx") && !exists("src/components/AppLoadingScreen.tsx"), "global loading page/component are removed"],
  [!layoutCss.includes("app-loading-") && !pagesCss.includes("app-loading-"), "loader CSS is fully removed"],
  [!layout.includes('export const dynamic = "force-dynamic"') && !layout.includes("export const revalidate = 0"), "root layout no longer forces every route dynamic"],
  [layout.includes('strategy="lazyOnload"') && layout.includes('/js/dashboard-starfield.js'), "decorative starfield no longer competes with initial hydration"],
  [!terms.includes("force-dynamic") && !privacy.includes("force-dynamic"), "static legal pages are cacheable again"],
  [liveSync.includes("5 * 60_000") && liveSync.includes("15 * 60_000") && liveSync.includes("30_000"), "global full-page refresh cadence is throttled"],
  [!authGuard.includes('verify("mount", true)') && authGuard.includes("server has already authenticated"), "hydration no longer duplicates the initial auth request"],
  [background.includes("DASHBOARD_BACKGROUND_RESOURCE_RETAIN_MS") && background.includes("releaseRecord(record)"), "targeted API resource data survives short navigation gaps"],
  [profileLive.includes("refreshOnMount: false") && guildLive.includes("refreshOnMount: false") && raidLive.includes("refreshOnMount: false") && pollLive.includes("refreshOnMount: false"), "SSR-backed live widgets do not immediately refetch on mount"],
  [embed.includes("const [params, authorIdentity] = await Promise.all") && embed.includes("const [channelData, roleData, message] = await Promise.all"), "Discord editor data loads in parallel"],
  [desktopNav.includes('import Link from "next/link"') && identity.includes('import Link from "next/link"'), "primary navigation uses Next client transitions"],
  [desktopNav.includes("prefetch={false}") && identity.includes("prefetch={false}"), "navigation avoids eager dynamic-route data prefetch fanout"],
  [!liveSync.includes("DASHBOARD_BACKGROUND_API_REFRESHED_EVENT"), "targeted API refreshes no longer trigger a duplicate full RSC refresh"],
];
let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { failed += 1; console.error(`✗ ${label}`); }
}
if (failed) { console.error(`[check-page-performance] FAILED — ${failed}/${checks.length}`); process.exit(1); }
console.log(`[check-page-performance] OK — ${checks.length}/${checks.length} loading/navigation/data invariants checked.`);
