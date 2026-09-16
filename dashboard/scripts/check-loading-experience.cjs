const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const component = fs.readFileSync(path.join(root, "src/components/AppLoadingScreen.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/layout.css"), "utf8");
const pageState = fs.readFileSync(path.join(root, "src/lib/pageState.ts"), "utf8");

const checks = [
  [component.includes("PortalParticleField"), "portal particle field exists"],
  [component.includes("Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.5)"), "canvas DPR is capped"],
  [component.includes("lowPower || compactQuery.matches ? 22 : 38"), "particle budget is capped"],
  [component.includes("lowPower ? 24 : 30"), "animation FPS is throttled"],
  [component.includes("visibilitychange"), "canvas pauses in background tabs"],
  [component.includes("ResizeObserver"), "canvas follows actual component size"],
  [!component.includes("setInterval("), "loader avoids interval-driven animation"],
  [component.includes("STAGE_DELAYS = [0, 420, 980, 1600]"), "loader has bounded staged visual delays"],
  [component.includes("window.setTimeout") && component.includes("window.clearTimeout"), "staged timers are cleaned up"],
  [component.includes("useClientTelemetry"), "loader reports real client device/network/viewport state"],
  [component.includes("MISTBLOSSOM WAYGATE"), "loader uses guild/lore presentation"],
  [component.includes("--app-loading-progress"), "progress is determinate and stage-driven"],
  [css.includes("@media (max-width: 560px)"), "dedicated mobile loader layout exists"],
  [css.includes("@media (max-width: 380px)"), "very narrow phone fallback exists"],
  [css.includes("prefers-reduced-motion: reduce"), "reduced motion is supported"],
  [!css.includes("filter: blur("), "loader avoids expensive full-scene CSS blur"],
  [css.includes("contain: layout paint style"), "portal paint is contained"],
  [css.includes("will-change: transform"), "high-frequency motion stays compositor-friendly"],
  [component.includes("Готовий маршрут не утримується"), "visual staging does not claim to block a ready route"],
  [!pageState.includes('label: "Firebase"'), "loading stages no longer expose stale Firebase wording"],
  [component.includes("app-loading-step-index"), "loading stages remain informative"],
];

let failures = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { console.error(`✗ ${label}`); failures += 1; }
}
if (failures) process.exit(1);
console.log(`[check-loading-experience] OK — ${checks.length}/${checks.length}`);
