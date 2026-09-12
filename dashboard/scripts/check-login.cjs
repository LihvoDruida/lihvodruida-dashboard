const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("src/app/login/page.tsx");
const css = read("src/app/styles/pages.css");
const layout = read("src/app/styles/layout.css");
const redirects = read("src/lib/dashboardRedirects.ts");
const discordStart = read("src/app/api/auth/discord/start/route.ts");

const checks = [
  ["login remains a centered single-shell layout", page.includes('className="login-screen"') && page.includes('className="login-shell"') && css.includes("place-items: center")],
  ["WoW-inspired frame stays compact and single-surface", page.includes("login-shell__corner--tl") && page.includes("login-title-divider") && css.includes(".login-shell__corner") && css.includes("width: min(500px, 100%)") && !css.includes(".login-shell::before")],
  ["login no longer renders a second decorative backdrop layer", !page.includes("login-screen__backdrop") && !page.includes("login-glow") && !page.includes("login-grid") && !page.includes("login-ornament")],
  ["redundant feature and explanatory rows are removed", !page.includes("login-feature-list") && !page.includes("login-note")],
  ["guild crest remains dynamic branding", page.includes("src={guild.iconUrl}") && page.includes("{guild.name}")],
  ["Discord stays the primary sign-in action", page.includes("Увійти через Discord") && page.includes("login-discord-button") && page.includes("Безпечна перевірка ролей і членства")],
  ["login security state remains visible in one compact row", page.includes("Discord SSO") && page.includes("Role Sync") && page.includes("серверна сесія") && css.includes(".login-trust-row") && css.includes("display: flex")],
  ["logged out state is explicit", page.includes("loggedOut?: string") && page.includes("Сесію завершено.")],
  ["session-required error has purpose-specific copy", page.includes("session_required:") && page.includes("Після перевірки ролей повернемо тебе")],
  ["login uses the shared safe return-path validator", page.includes('safeDashboardReturnPath(params.next') && page.includes('scope: "discord-auth"')],
  ["Discord auth can return to management pages", redirects.includes("dashboard|raids|profile|profiles") && redirects.includes("applications|polls|content|discord|admin")],
  ["rate-limit redirect cannot leak an internal Docker origin in production", discordStart.includes('new URL("/login?error=rate_limit", appBaseUrl(request))')],
  ["legacy layout login hero no longer injects a second min-height", !layout.includes("/* ---------- Лендинг-герой (сторінка входу) ---------- */")],
  ["mobile login layout has a compact dedicated breakpoint", css.includes("@media (max-width: 640px)") && css.includes(".login-trust-row small") && css.includes("display: none")],
  ["short desktop view has an explicit compact-height treatment", css.includes("@media (max-height: 700px) and (min-width: 641px)")],
  ["reduced-motion treatment exists", css.includes("@media (prefers-reduced-motion: reduce)") && css.includes(".login-discord-button::before")],
  ["global footer is replaced by compact legal links on login", page.includes('className="login-legal"') && css.includes(".login-screen + .app-footer--site-wide")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
if (failed.length) {
  console.error(`[check-login] failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-login] OK — ${checks.length}/${checks.length}`);
