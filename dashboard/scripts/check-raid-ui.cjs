const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const views = fs.readFileSync(path.join(root, "src/components/RaidViews.tsx"), "utf8");
const listPage = fs.readFileSync(path.join(root, "src/app/raids/page.tsx"), "utf8");
const detailPage = fs.readFileSync(path.join(root, "src/app/raids/[raidId]/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/raids.css"), "utf8");

const checks = [
  [listPage.includes('className="raid-list-kpis"'), "raid list exposes compact KPI overview"],
  [listPage.includes("Найближчий рейд") && listPage.includes("formatRaidDateTime"), "list shows the next raid time"],
  [views.includes('className="raid-list-primary-meta"'), "raid rows prioritize date, leader and deadline"],
  [views.includes('className="raid-list-role-summary"'), "raid rows expose role composition"],
  [views.includes('className="raid-list-progress-wrap"'), "raid rows expose fill percentage"],
  [detailPage.includes('className="raid-detail-toolbar"'), "raid detail has a compact back/Discord toolbar"],
  [views.includes('className="raid-overview-grid"'), "raid detail has four primary overview cards"],
  [views.includes("Основний склад") && views.includes("Готовність"), "overview highlights roster and readiness"],
  [views.includes('className="raid-detail-facts"'), "secondary raid settings are compact facts"],
  [views.includes('className="raid-attendance-panel"'), "attendance actions have a dedicated decision area"],
  [views.includes('raid-party-columns raid-party-columns--flat'), "parties use a flat adaptive grid"],
  [views.includes('className="raid-roster-role-summary"'), "sticky roster summarizes roles before member rows"],
  [views.includes('className="raid-roster-meter"'), "sticky roster exposes fill progress"],
  [views.includes("grouped.tentative.length ?") && views.includes("grouped.skipped.length ?"), "empty secondary attendance groups are hidden"],
  [css.includes('.raid-overview-grid') && css.includes('repeat(4, minmax(0, 1fr))'), "desktop overview is a four-card scan line"],
  [css.includes('.raid-preview-buttons--interactive') && css.includes('repeat(4, minmax(0, 1fr))'), "attendance actions are equal-width on desktop"],
  [css.includes('.raid-party-columns--flat') && css.includes('auto-fit'), "party cards adapt to available width"],
  [css.includes('@media (max-width: 620px)') && css.includes('.raid-overview-grid'), "raid UX has a phone breakpoint"],
  [css.includes('.raid-list-status-dot--published') && css.includes('.raid-list-status-dot--draft'), "list status is recognizable without reading the badge"],
  [css.includes('.raid-context-notice--warning'), "composition problems keep a dedicated warning treatment"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  console.error(`[check-raid-ui] FAILED — ${failed.length}/${checks.length} invariant(s) failed:`);
  for (const [, message] of failed) console.error(` - ${message}`);
  process.exit(1);
}

console.log(`[check-raid-ui] OK — ${checks.length}/${checks.length} raid list/detail UX invariants checked.`);
