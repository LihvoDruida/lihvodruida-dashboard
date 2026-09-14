const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const component = fs.readFileSync(path.join(root, "src/components/AppLoadingScreen.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/layout.css"), "utf8");

const checks = [
  [component.includes("PortalParticleField"), "portal particle field exists"],
  [component.includes("Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.5)"), "canvas DPR is capped"],
  [component.includes("lowPower || compactQuery.matches ? 24 : 40"), "particle budget is capped"],
  [component.includes("lowPower ? 24 : 30"), "animation FPS is throttled"],
  [component.includes("visibilitychange"), "canvas pauses in background tabs"],
  [component.includes("prefers-reduced-motion: reduce") || css.includes("prefers-reduced-motion: reduce"), "reduced motion is supported"],
  [component.includes("ResizeObserver"), "canvas follows actual component size"],
  [!component.includes("setInterval("), "loader avoids interval-driven animation"],
  [!component.includes("setTimeout("), "loader never adds artificial loading delay"],
  [!css.includes("filter: blur("), "loader avoids expensive full-scene CSS blur"],
  [css.includes("contain: layout paint style"), "portal paint is contained"],
  [css.includes("will-change: transform"), "high-frequency CSS motion stays compositor-friendly"],
  [component.includes("Анімація не затримує відкриття сторінки"), "loading copy explains no artificial delay"],
  [component.includes("app-loading-step-index"), "loading stages remain informative"],
];

let failures = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { console.error(`✗ ${label}`); failures += 1; }
}
if (failures) process.exit(1);
console.log(`[check-loading-experience] OK — ${checks.length}/${checks.length}`);
