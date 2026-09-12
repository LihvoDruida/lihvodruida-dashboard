const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
const footerPath = path.join(root, "src/components/AppFooter.tsx");
const cssPath = path.join(root, "src/app/styles/layout.css");
const botPath = path.join(repoRoot, "bot/src/server.mjs");
const sitePkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const botPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "bot/package.json"), "utf8"));
const footer = fs.readFileSync(footerPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const bot = fs.readFileSync(botPath, "utf8");

const checks = [
  ["footer imports dashboard version", footer.includes('dashboardPackage from "../../package.json"')],
  ["footer imports bot version", footer.includes('botPackage from "../../../bot/package.json"')],
  ["site version label exists", footer.includes('app-footer__version-label">Сайт')],
  ["bot version label exists", footer.includes('app-footer__version-label">Бот')],
  ["version styles exist", css.includes(".app-footer__versions") && css.includes(".app-footer__version")],
  ["mobile version layout exists", css.includes(".app-footer__meta") && css.includes("@media (max-width: 640px)")],
  ["bot health exposes version", bot.includes('version: String(botPackage.version || "unknown")')],
  ["site version is valid semver-like", /^\d+\.\d+\.\d+/.test(String(sitePkg.version || ""))],
  ["bot version is valid semver-like", /^\d+\.\d+\.\d+/.test(String(botPkg.version || ""))],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
if (failed.length) {
  console.error(`[check-footer-version] failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-footer-version] OK — ${checks.length}/${checks.length}`);
