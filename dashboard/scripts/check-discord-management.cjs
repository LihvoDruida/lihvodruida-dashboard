const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/app/dashboard/discord/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/styles/admin.css"), "utf8");
const importer = fs.readFileSync(path.join(root, "src/lib/legacyProfileImport.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "src/app/api/dashboard/discord/profiles/import-firestore/route.ts"), "utf8");

const checks = [
  [page.includes('className="discord-management-jump-nav"'), "long Discord page has quick task navigation"],
  [page.includes('className="discord-management-health-grid"'), "connection state and role hierarchy share a dedicated health grid"],
  [page.includes('className="discord-member-actions-grid"'), "single-member actions are grouped separately"],
  [page.includes('className="discord-automation-grid"'), "bulk Discord automation has its own workspace"],
  [page.includes('className="discord-profile-maintenance-grid"'), "profile import and cleanup are grouped together"],
  [page.includes('action="/api/dashboard/discord/profiles/import-firestore"'), "Firestore profile import is exposed in the owner workflow"],
  [page.includes('roles={manageableRoles}') && !page.includes('RoleCheckboxes roles={roles}'), "working role pickers expose only actually manageable roles"],
  [page.includes('className="discord-role-option__copy"'), "role name, position and id have structured non-overlapping markup"],
  [route.includes('if (!guard.session.isServerOwner)'), "profile import is server-owner only"],
  [route.includes('protectedOwnerDiscordId') && route.includes('protectedOwnerProfileId'), "route passes mandatory owner protection identifiers"],
  [importer.includes('documentStoreMode()') && importer.includes('storeMode === "postgres"'), "legacy import only targets PostgreSQL"],
  [importer.includes('isProtectedOwnerProfile') && importer.includes('ownerSkipped'), "owner documents are forcibly excluded by importer"],
  [importer.includes('"safe"') && importer.includes('"firestore-priority"'), "import provides safe and Firestore-priority merge strategies"],
  [importer.includes('syncCharacterProfileLinksForProfileId'), "changed profiles repair the character-link index after import"],
  [css.includes('.discord-role-option__copy') && css.includes('word-break: break-all;'), "long Discord ids cannot collide with role labels"],
  [css.includes('@media (max-width: 700px)') && css.includes('max-height: none;'), "mobile role lists avoid nested scroll containers"],
  [css.includes('.discord-management-health-grid') && css.includes('.discord-profile-maintenance-grid'), "new Discord workspace has explicit desktop grids"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  console.error(`[check-discord-management] FAILED — ${failed.length}/${checks.length} invariant(s) failed:`);
  for (const [, message] of failed) console.error(` - ${message}`);
  process.exit(1);
}

console.log(`[check-discord-management] OK — ${checks.length} Discord import/layout invariants checked.`);
