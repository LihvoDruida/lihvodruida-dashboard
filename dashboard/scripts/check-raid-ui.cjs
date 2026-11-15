"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const read=p=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");
const ui=require("./lib/read-ui-workspace.cjs");const list=ui("src/app/raids/page.tsx"),detail=ui("src/app/raids/[raidId]/page.tsx"),overview=read("src/components/raids/RaidOverview.tsx"),roster=read("src/components/raids/RaidRoster.tsx"),css=read("src/components/raids/raid-workspace.module.css");
const checks=[
 [list.includes("<PageHeader")&&list.includes('label:"Найближчий рейд"'),"shared header includes upcoming raid time"],
 [list.includes("<FilterToolbar")&&list.includes("<FilterNavigationForm"),"search and state filters navigate without a full reload"],
 [list.includes("<DataCard")&&list.includes("raid.raidLeaderName")&&list.includes("lock.label"),"list cards retain title, date, leader and deadline"],
 [list.includes("counts.tanks")&&list.includes("counts.healers")&&list.includes("counts.dps"),"list cards retain role composition"],
 [list.includes("<Progress")&&list.includes("layout.bench.members.length"),"list cards retain fill and bench data without inline width"],
 [detail.includes("<ListReturnLink")&&detail.includes("raid.messageUrl"),"detail retains filtered-list return and Discord access"],
 [overview.includes("Основний склад")&&overview.includes("Готовність")&&overview.includes("Розхідники")&&overview.includes("Лут"),"overview retains readiness and all participation settings"],
 [overview.includes('title="Участь через Discord"')&&!overview.includes('action="/api/raids/attendance'),"signup remains Discord-only"],
 [overview.includes('<DataGrid label="Паті рейду" columns="two">')&&overview.includes("<BenchCard"),"parties use two adaptive columns and a separate full-width bench"],
 [roster.includes("<Progress")&&roster.includes("layoutCounts.roster")&&roster.includes("grouped.tentative.length ?")&&roster.includes("grouped.skipped.length ?"),"roster retains fill and conditionally visible attendance groups"],
 [detail.includes("showRosterDetails={canSeeRoster}")&&detail.includes("showItemLevel={canManage}"),"roster and individual item levels obey their permissions"],
 [detail.includes("<ErrorState")&&detail.includes("<EmptyState"),"failed reads differ from unavailable records"],
 [css.includes("var(--panel-padding)")&&!/\bstyle\s*=/.test(overview),"presentation uses shared tokens and native progress"],
];
for(const[ok,label]of checks)assert.ok(ok,label);console.log(`[check-raid-ui] ${checks.length}/${checks.length} raid list/detail invariants`);
