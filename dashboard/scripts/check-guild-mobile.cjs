"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const read=p=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");
const explorer=read("src/components/GuildRosterExplorer.tsx"),table=read("src/components/guild/GuildRosterTable.tsx"),css=read("src/components/guild/guild-workspace.module.css");
const checks=[
 [explorer.includes("<FilterToolbar")&&explorer.includes("<FormSection"),"search and advanced filters use shared primitives"],
 [table.includes("<DataTable")&&table.includes('<th scope="row"')&&!table.includes('role="cell"'),"one native table replaces duplicated mobile/desktop identity markup"],
 [css.includes("table-layout: fixed")&&css.includes("@container (max-width: 1100px)"),"native table adapts to its available container width"],
 [css.includes("content: attr(data-label)")&&css.includes(".table tr { display: grid"),"narrow rows retain labelled fields"],
 [table.includes('data-label="RIO"')&&table.includes('data-label="Рейд"')&&table.includes('data-label="Клас / спек"'),"rating, raid progress and class/spec remain visible on all widths"],
 [css.includes(".actions")&&css.includes("flex-wrap: wrap"),"filters and navigation wrap without a horizontal rail"],
 [explorer.includes('aria-pressed={roleFilter === item.value}'),"quick role filters expose their current selection"],
 [css.includes(".filtersPanel")&&css.includes("repeat(auto-fit"),"advanced filters adapt without fixed field widths"],
 [table.includes("onKeyDown")&&table.includes("event.key !== \"Enter\"")&&table.includes("?from=guild"),"row navigation and the profile return source are preserved"],
 [table.includes("data-wow-class")&&!table.includes("style="),"class colors use central tokens, no inline styling"],
 [explorer.includes("<ErrorState")&&explorer.includes("<EmptyState"),"empty roster and failed load are distinct states"],
];
for(const[ok,label]of checks)assert.ok(ok,label);console.log(`[check-guild-mobile] ${checks.length}/${checks.length} responsive/structure invariants`);
