"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const read=file=>fs.readFileSync(path.resolve(__dirname,"..",file),"utf8");
const access=require("./lib/read-ui-workspace.cjs")("src/app/dashboard/access/page.tsx");
const page=read("src/app/dashboard/page.tsx"),css=read("src/components/management/access/access.module.css"),foundation=read("src/components/page/page-system.module.css");
const checks=[
 [access.includes("canManageGroups(user)")&&access.includes("getSession({ live: true })"),"policy is permission checked with fresh authorization"],
 [page.includes("<ManagementDirectory")&&page.includes("<PageContainer"),"overview remains a task hub"],
 [access.includes('<ManagementSections variant="universal"')&&access.includes("<FormSection"),"policy uses shared tabs and form sections"],
 [access.includes('name={`roleMap:${row.roleId}`}')&&access.includes("<strong>{row.name}</strong>")&&access.includes("<small>{row.roleId}"),"role name, id and group choice remain explicit"],
 [access.includes("!rolesResult.error")&&access.includes("canEdit={canEditAuthPolicy}")&&access.includes("disabled={!canEdit || !groups.length}"),"role read failure blocks saves"],
 [access.includes("protectedMappings")&&access.includes("row.groupId && !groups.some"),"protected and unknown mappings cannot silently reset"],
 [access.includes('name="blockedCountries"')&&access.includes("policy.blockedCountries.join"),"saved geo country values remain visible and editable"],
 [css.includes(".toggle:has(input:checked)")&&css.includes("var(--accent-soft)"),"selected toggles use shared status tokens"],
 [css.includes(".roleRow[hidden]")&&css.includes("@container (max-width: 640px)"),"filtered roles hide visually and layout adapts"],
 [foundation.includes("repeat(auto-fit")&&foundation.includes("--data-grid-min"),"data grids adapt to content width"],
];
for(const [ok,label]of checks)assert.ok(ok,label);console.log(`[check-admin-overview] ${checks.length}/${checks.length} policy/overview invariants`);
