const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/app/dashboard/page.tsx"), "utf8");
const access = fs.readFileSync(path.join(root, "src/app/dashboard/access/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/admin.css"), "utf8");

const checks = [
  [page.includes('href: "/dashboard/access"') && access.includes('canManageGroups(user)'), "security settings are separate and permission checked"],
  [page.includes('href: "/dashboard/profiles"'), "profile maintenance is a dedicated task"],
  [page.includes('className="management-hub__grid"'), "overview uses a task hub"],
  [access.includes('className="admin-policy-layout admin-policy-layout--auth"'), "auth policy has a desktop layout wrapper"],
  [access.includes('className="admin-policy-layout admin-policy-layout--geo"'), "geo policy has a desktop layout wrapper"],
  [access.includes('className="auth-access-role-option__copy"'), "role option keeps name and id in one copy block"],
  [access.includes('className="admin-policy-current-state"'), "policy cards expose a compact current-state summary"],
  [access.includes('className="geo-country-summary"'), "geo country selection has a compact summary"],
  [css.includes(".integration-status-grid"), "integration status has explicit grid styling"],
  [css.includes("grid-template-columns: repeat(5, minmax(0, 1fr));"), "desktop integration status uses horizontal capacity"],
  [css.includes(".auth-access-role-option:has(input:checked)"), "selected Discord roles are visually distinct"],
  [css.includes(".admin-policy-toggle:has(input:checked)"), "selected policy toggles are visually distinct"],
  [css.includes("@media (max-width: 560px)"), "small mobile breakpoint exists"],
  [css.includes(".admin-policy-footer .btn") && css.includes("width: 100%;"), "mobile save actions can expand to full width"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  console.error(`[check-admin-overview] FAILED — ${failed.length}/${checks.length} invariant(s) failed:`);
  for (const [, message] of failed) console.error(` - ${message}`);
  process.exit(1);
}

console.log(`[check-admin-overview] OK — ${checks.length} layout/interaction invariants checked.`);
