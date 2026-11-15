"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const page = require("./lib/read-ui-workspace.cjs")("src/app/profiles/page.tsx");
const navigation = read("src/lib/profileDirectoryNavigation.ts");
const css = read("src/components/profile/directory/directory.module.css");
const checks = [
  [page.includes("listDashboardProfilePage") && !page.includes("filteredProfiles.slice"), "catalog loads the full permitted server result"],
  [page.includes("result.previousCursor") && page.includes("result.nextCursor") && navigation.includes('params.set("cursor", cursor)'), "cursor navigation preserves filters"],
  [page.includes("result.unavailable ? <ErrorState") && page.includes("<EmptyState"), "unavailable and empty states differ"],
  [page.includes("<DataTable") && page.includes('<th scope="row"') && !page.includes('role="row"'), "directory has native table semantics"],
  [page.includes("<ProfileAvatar") && page.includes("liveDiscordAvatars"), "avatar uses the live cache and fallback"],
  [page.includes('name="link"') && page.includes('value="linked"'), "Battle.net filter retained"],
  [page.includes('name="role"') && page.includes('value="moderator"'), "role filter retained"],
  [page.includes('name="sort"') && page.includes('value="characters"'), "sort filter retained"],
  [page.includes("paginationState") && page.includes("buildProfilesHref"), "pagination shares the filter state"],
  [!page.includes('action="/api/dashboard/discord/profiles/cleanup"') && page.includes('/dashboard/profiles'), "destructive cleanup stays on its dedicated page"],
  [page.includes("<PageHeader") && page.includes('label: "Персонажі"'), "header uses shared semantic metrics"],
  [css.includes("table-layout: fixed") && css.includes("@container (max-width: 800px)") && css.includes("content: attr(data-label)"), "table adapts to labelled rows in narrow containers"],
  [page.includes("<FilterNavigationForm") && page.includes("router.push") && page.includes("scroll: false"), "filters navigate without a full reload"],
  [page.includes("data-list-entry=\"profiles\"") && page.includes("<ListViewMemory"), "row and filter return state retained"],
];
for(const [ok,label] of checks)assert.ok(ok,label);
console.log(`[check-profiles-page] ${checks.length}/${checks.length} directory structure invariants`);
