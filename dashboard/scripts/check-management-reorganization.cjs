const readUiWorkspace = require("./lib/read-ui-workspace.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const overview = read("src/app/dashboard/page.tsx");
const access = readUiWorkspace("src/app/dashboard/access/page.tsx");
const profiles = readUiWorkspace("src/app/dashboard/profiles/page.tsx");
const discord = read("src/app/dashboard/discord/page.tsx");
const nav = read("src/components/AdminTabs.tsx");
const cleanupRoute = read("src/app/api/dashboard/discord/profiles/cleanup/route.ts");
const directory = readUiWorkspace("src/app/profiles/page.tsx");
const cleanupState = read("src/lib/accountCleanupAutomation.ts");
const attendance = read("src/app/api/raids/[raidId]/attendance/route.ts");
const catalog = fs.readFileSync(path.join(root, "src/lib/navigation/management.ts"), "utf8");
const checks = [
  [!overview.includes('name={`roleMap:') && !overview.includes('name="blockedCountries"'), "overview does not render edit forms"],
  [access.includes('canManageGroups(user)') && access.includes('getSession({ live: true })'), "role/geo policy has live authorization"],
  [access.includes('disabled={!canEdit || !groups.length}') && access.includes('!rolesResult.error') && access.includes('canEdit={canEditAuthPolicy}'), "role map cannot be saved after Discord API failure"],
  [profiles.includes('!user.isServerOwner') && profiles.includes('getSession({ live: true })'), "cleanup page is owner-only"],
  [profiles.includes('name="confirmDeletion"') && cleanupRoute.includes('form.get("confirmDeletion") !== "DELETE_STALE_PROFILES"'), "cleanup requires an explicit server-checked confirmation"],
  [cleanupRoute.includes('if (apply && !guard.session.isServerOwner)') && cleanupRoute.includes('acquireAccountCleanupExecutionLock'), "destructive endpoint is owner-only and locked"],
  [cleanupRoute.includes('preview?.scopeLimit !== requestedLimit') && cleanupRoute.includes('now - previewAt <= 15 * 60_000'), "apply requires a recent preview with the exact same scope"],
  [!discord.includes('action="/api/dashboard/discord/profiles/cleanup"') && discord.includes('href="/dashboard/profiles"'), "destructive controls no longer clutter Discord member tools"],
  [catalog.includes('href: "/dashboard/access"') && catalog.includes('href: "/dashboard/profiles"') && !nav.includes('if (active !== "logs")'), "navigation is grouped consistently for every section"],
  [directory.indexOf('if (!canManageGroups(user))') < directory.indexOf('listDashboardProfilePage({ viewer: user') && directory.includes('getSession({ live: true })'), "profile catalog checks live admin role before DB reads"],
  [cleanupState.includes('scopeLimit?: number | null') && cleanupState.includes('scopeLimit: input.scopeLimit'), "cleanup preview scope persists in durable run history"],
  [cleanupState.includes('actorId?: string | null') && cleanupRoute.includes('run.actorId === guard.session.id') && cleanupRoute.includes('actorId: guard.session.id'), "only the same owner who completed the preview can apply deletion"],
  [attendance.includes('410') || attendance.includes('GONE') || attendance.includes('Gone'), "retired website signup route remains disabled"],
];
for (const [ok, description] of checks) assert.ok(ok, description);
console.log(`[check-management-reorganization] OK — ${checks.length}/${checks.length} safety/navigation invariants`);
