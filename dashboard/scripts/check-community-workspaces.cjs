"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript"),React=require("react");
const {renderToStaticMarkup}=require("react-dom/server");
const load=require("./lib/load-server-ts.cjs");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;async function test(name,run){await run();passed++;console.log("PASS "+name);}
function dependencies(file){const ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);return Object.fromEntries(ast.statements.filter(node=>(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier).map(node=>[node.moduleSpecifier.text,new Proxy({}, {get:(_,name)=>()=>{throw Error("Unexpected external dependency: "+node.moduleSpecifier.text+"."+String(name));}})]));}
const globals={structuredClone,TextEncoder,URL,URLSearchParams,Error};
const algorithm=load("src/lib/raidCompositionAlgorithm.ts").exports;
const party=load("src/lib/raidPartyShared.ts",{"@/lib/raidCompositionAlgorithm":algorithm}).exports;
const shared=load("src/lib/raidPollShared.ts").exports;
const raids=load("src/lib/raids.ts",{...dependencies("src/lib/raids.ts"),"@/lib/raidCompositionAlgorithm":algorithm,"@/lib/raidPartyShared":party,"@/lib/values":load("src/lib/values.ts").exports,"@/lib/raidThumbnailAssets":load("src/lib/raidThumbnailAssets.ts").exports},globals).exports;
const polls=load("src/lib/raidPolls.ts",{...dependencies("src/lib/raidPolls.ts"),crypto:require("node:crypto"),"@/lib/raidCompositionAlgorithm":algorithm,"@/lib/raidPollShared":shared},globals).exports;
const pollPresentation=load("src/lib/raidPollPresentation.ts",{"@/lib/raidPolls":polls},globals).exports;
const raidPresentation=load("src/lib/raidPresentation.ts",{"@/lib/raids":raids},globals).exports;
const applicationStore=load("src/lib/applicationsStore.ts",dependencies("src/lib/applicationsStore.ts"),globals).exports;
const state=load("src/lib/listViewState.ts").exports;
const search=load("src/lib/raidListSearch.ts").exports;
const stop=href=>{throw Error("REDIRECT:"+href);};
const noop=()=>null;
function renderer(extra={}){
 const overrides={
  "@/lib/raids":raids,"@/lib/raidPolls":polls,"@/lib/raidPollPresentation":pollPresentation,"@/lib/raidPresentation":raidPresentation,
  "@/lib/listViewState":state,"@/lib/wowCharacters":{pickWowAvatarImageUrl:()=>null},
  "@/components/DiscordMarkdown":{DiscordMarkdown:({value})=>React.createElement("div",null,value)},
  "@/components/ClientErrorReporter":{sendClientErrorReport(){}},
  "@/components/DashboardIdentity":{__esModule:true,default:noop},"@/components/ListViewMemory":{__esModule:true,default:noop},
  "@/components/ApplicationDelivery":{__esModule:true,default:noop},"@/components/ApplicationStatusActions":{__esModule:true,default:noop},"@/components/ApplicationModerationQueue":{ApplicationSelection:noop,ApplicationStatusBadge:noop},
  "@/hooks/useRaidPollMutation":{useRaidPollMutation:()=>({scopeRef:React.createRef(),pending:false,message:"",unconfirmed:false,run(){throw Error("Unexpected UI mutation in SSR");}})},
  "@/lib/dashboardLiveRefresh":{notifyDashboardDataChanged(){}},
  "next/navigation":{useRouter:()=>({push(){},refresh(){}})},...extra,
 };
 const cache=new Map();
 function component(file){if(cache.has(file))return cache.get(file);const absolute=path.join(root,file),mod={exports:{}};cache.set(file,mod.exports);
  const source=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:absolute}).outputText;
  function resolve(name){if(Object.hasOwn(overrides,name)&&overrides[name]!==undefined)return overrides[name];if(name==="react"||name==="react/jsx-runtime")return require(name);
   if(name==="next/link")return {__esModule:true,default:({children,prefetch,...props})=>React.createElement("a",props,children)};
   if(name.endsWith(".css"))return {__esModule:true,default:new Proxy({}, {get:(_,key)=>String(key)})};
   if(name.startsWith("@/")||name.startsWith(".")){const base=name.startsWith("@/")?path.join(root,"src",name.slice(2)):path.resolve(path.dirname(absolute),name);const target=[base,base+".ts",base+".tsx"].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());if(!target)throw Error("Unresolved SSR import "+name);return component(path.relative(root,target));}
   throw Error("Unexpected SSR import "+name);
  }
  new Function("require","module","exports",source)(resolve,mod,mod.exports);cache.set(file,mod.exports);return mod.exports;
 }
 return {component,html:(file,props,exportName="default")=>renderToStaticMarkup(React.createElement(component(file)[exportName],props))};
}
const raid={id:"fixture00",title:"Вечірній рейд",difficulty:"normal",date:"2099-01-01",time:"20:00",description:"Умови участі",consumables:"own",lootMode:"free-roll",composition:{tanks:2,healers:2,dps:6},status:"published",maxPlayers:10,createdByDiscordId:"private-owner",createdByName:"Leader",signups:[{discordId:"one",discordName:"Player",characterName:"Себас",className:"Druid",activeSpecName:"Restoration",role:"healer",status:"tentative",itemLevel:987,signupNumber:2,verifiedGuild:true}]};
const poll={id:"poll0000",title:"Вихідні",description:"Час рейду",difficulty:"normal",status:"open",days:["mon","sat"],closesAtMs:Date.now()+86400000,autoRepeatWeekly:false,votes:[{discordId:"private-discord-id",discordName:"Учасник",role:"tank",schedule:{mon:"20:00",sat:"absent"},updatedAt:"2026-11-14T20:00:00Z"}],updatedAt:"2026-11-14T20:00:00Z"};
(async()=>{
 await test("public archive excludes overdue unpublished drafts under every filter",async()=>{
  const input=[raid,{...raid,id:"draft000",title:"Secret draft",status:"draft"},{...raid,id:"closed00",status:"closed"}];
  const subject=load("src/services/raidDirectoryWorkspace.ts",{"next/navigation":{redirect:stop},"@/lib/auth":{getSession:async()=>null},"@/lib/permissions":{canManageRaids:()=>false},"@/lib/discordAdmin":{hasDiscordEmbedConfig:()=>true},"@/lib/raids":{hasRaidStorage:()=>true,listRaids:async()=>input,isRaidClosed:value=>value.id!==raid.id},"@/lib/listViewState":state,"@/lib/raidListSearch":search,"@/lib/dashboardSystemLogs":{recordDashboardSystemLog(){}}},globals).exports;
  for(const params of [{},{state:"closed"},{q:"Secret"},{state:"draft"}]){const model=await subject.loadRaidDirectoryWorkspace({searchParams:Promise.resolve(params)});assert.ok(!model.visibleCurrent.some(x=>x.id==="draft000"));assert.ok(!model.visibleArchive.some(x=>x.id==="draft000"));}
 });
 await test("raid directory distinguishes a failed storage read from an empty successful result",async()=>{
  let fail=false;
  const subject=load("src/services/raidDirectoryWorkspace.ts",{"next/navigation":{redirect:stop},"@/lib/auth":{getSession:async()=>null},"@/lib/permissions":{canManageRaids:()=>false},"@/lib/discordAdmin":{hasDiscordEmbedConfig:()=>true},"@/lib/raids":{hasRaidStorage:()=>true,listRaids:async()=>{if(fail)throw Error("offline");return [];},isRaidClosed:()=>false},"@/lib/listViewState":state,"@/lib/raidListSearch":search,"@/lib/dashboardSystemLogs":{recordDashboardSystemLog(){}}},globals).exports;
  const input={searchParams:Promise.resolve({})};assert.equal((await subject.loadRaidDirectoryWorkspace(input)).unavailable,false);fail=true;assert.equal((await subject.loadRaidDirectoryWorkspace(input)).unavailable,true);
 });
 await test("raid detail masks draft data and respects independent roster permission",async()=>{
  let manager=false,current=raid;
  const subject=load("src/services/raidDetailsWorkspace.ts",{"@/lib/auth":{getSession:async()=>({role:"member"})},"@/lib/permissions":{canManageRaids:()=>manager,canViewRaidRoster:()=>false,canViewRaidDirectory:()=>true},"@/lib/raids":{hasRaidStorage:()=>true,getRaid:async()=>current}},globals).exports;
  const input={params:Promise.resolve({raidId:raid.id})};assert.equal((await subject.loadRaidDetailsWorkspace(input)).canSeeRoster,false);current={...raid,status:"draft"};assert.equal((await subject.loadRaidDetailsWorkspace(input)).raid,null);manager=true;assert.equal((await subject.loadRaidDetailsWorkspace(input)).raid.id,raid.id);
 });
 await test("poll authorization runs before reading any private record",async()=>{
  let reads=0;const subject=load("src/services/pollWorkspace.ts",{"next/navigation":{redirect:stop},"@/lib/auth":{getSession:async()=>({role:"member"})},"@/lib/permissions":{canViewRaidDirectory:()=>false,canManageRaids:()=>false},"@/lib/profiles":{getOwnProfilePath:async()=>"/profile/own"},"@/lib/discordAdmin":{},"@/lib/raidPolls":{getRaidPoll:async()=>{reads++;},listRaidPolls:async()=>{reads++;}}},globals).exports;
  await assert.rejects(subject.loadPollDetailsWorkspace({params:Promise.resolve({pollId:poll.id})}),/REDIRECT:\/profile\/own/);assert.equal(reads,0);
 });
 await test("guest poll lists and details never expose unpublished schedules",async()=>{
  const privatePoll={...poll,id:"private",status:"scheduled"},publicPoll={...poll,channelId:"channel",messageId:"message"};
  const subject=load("src/services/pollWorkspace.ts",{"next/navigation":{redirect:stop},"@/lib/auth":{getSession:async()=>null},"@/lib/permissions":{canManageRaids:()=>false},"@/lib/profiles":{},"@/lib/discordAdmin":{hasDiscordEmbedConfig:()=>true},"@/lib/raidPolls":{hasRaidPollStorage:()=>true,listRaidPolls:async()=>[privatePoll,publicPoll],getRaidPoll:async()=>privatePoll,raidPollStateKey:shared.raidPollStateKey}},globals).exports;
  const directory=await subject.loadPollDirectoryWorkspace();assert.deepEqual(plain(directory.visiblePolls.map(x=>x.id)),[poll.id]);const detail=await subject.loadPollDetailsWorkspace({params:Promise.resolve({pollId:"private"})});assert.equal(detail.poll,null);assert.equal(detail.relatedPolls.length,0);
 });
 await test("related-poll outage is explicit instead of generating apparently unique days",async()=>{
  const subject=load("src/services/pollWorkspace.ts",{"next/navigation":{redirect:stop},"@/lib/auth":{getSession:async()=>null},"@/lib/permissions":{canManageRaids:()=>false},"@/lib/profiles":{},"@/lib/discordAdmin":{},"@/lib/raidPolls":{hasRaidPollStorage:()=>true,getRaidPoll:async()=>({...poll,channelId:"c",messageId:"m"}),listRaidPolls:async()=>{throw Error("offline");}}},globals).exports;
  const detail=await subject.loadPollDetailsWorkspace({params:Promise.resolve({pollId:poll.id})});assert.equal(detail.relatedUnavailable,true);assert.equal(detail.unavailable,false);assert.equal(detail.poll.id,poll.id);
  const html=renderer().html("src/components/polls/PollRecommendations.tsx",{poll,relatedPolls:[poll],unavailable:true});assert.match(html,/Рекомендації тимчасово недоступні/);assert.doesNotMatch(html,/class="dataCard"/);
 });
 await test("applications deny unauthorized access before queue or filter reads",async()=>{
  let reads=0;const subject=load("src/services/applicationWorkspace.ts",{"@/lib/auth":{getSessionUser:async()=>({role:"member"})},"next/navigation":{redirect:stop},"@/lib/permissions":{canViewApplications:()=>false,canManageApplications:()=>false,canViewApplicationBattleTag:()=>false},"@/lib/profiles":{getOwnProfilePath:async()=>"/profile/own"},"@/lib/applicationsStore":{listApplications:async()=>{reads++;},listApplicationFilterOptions:async()=>{reads++;}},"@/lib/listViewState":state},globals).exports;
  await assert.rejects(subject.loadApplicationWorkspace({searchParams:Promise.resolve({})}),/REDIRECT:/);assert.equal(reads,0);
 });
 await test("mentor receives only the sanitized application model before rendering",async()=>{
  const raw={number:1,status_key:"review",state:"open",discord:"private-discord",battle_tag:"private-btag",html_url:"https://private.invalid",raider_io:null};let sanitized=0;
  const subject=load("src/services/applicationWorkspace.ts",{"@/lib/auth":{getSessionUser:async()=>({role:"mentor"})},"next/navigation":{redirect:stop},"@/lib/permissions":{canViewApplications:()=>true,canManageApplications:()=>false,canViewApplicationBattleTag:()=>false},"@/lib/profiles":{},"@/lib/applicationsStore":{listApplications:async()=>[raw],listApplicationFilterOptions:async()=>({classes:[]}),sanitizeApplicationsForMentorViewer:items=>{sanitized++;return applicationStore.sanitizeApplicationsForMentorViewer(items);}},"@/lib/listViewState":state},globals).exports;
  const model=await subject.loadApplicationWorkspace({searchParams:Promise.resolve({})});assert.equal(sanitized,1);assert.equal(model.mayManageApplications,false);assert.doesNotMatch(JSON.stringify(model.items),/private-/);
  const html=renderer().html("src/components/applications/ApplicationCard.tsx",{item:raw,canManage:false,canViewSensitive:false,isOwner:false});assert.doesNotMatch(html,/private-discord|private-btag|private\.invalid/);assert.match(html,/Відстеження/);
 });
 await test("failed application reads preserve filters and report unavailability",async()=>{
  const subject=load("src/services/applicationWorkspace.ts",{"@/lib/auth":{getSessionUser:async()=>({role:"admin"})},"next/navigation":{redirect:stop},"@/lib/permissions":{canViewApplications:()=>true,canManageApplications:()=>true,canViewApplicationBattleTag:()=>true},"@/lib/profiles":{},"@/lib/applicationsStore":{listApplications:async()=>{throw Error("offline");},listApplicationFilterOptions:async()=>({classes:[]})},"@/lib/listViewState":state},globals).exports;
  const model=await subject.loadApplicationWorkspace({searchParams:Promise.resolve({q:"Hero",status:"review"})});assert.equal(model.unavailable,true);assert.match(model.currentUrl,/q=Hero/);assert.equal(model.items.length,0);
 });
 await test("public guild data comes from the stored service without requiring a login",async()=>{
  let reads=0;const subject=load("src/services/guildWorkspace.ts",{"@/lib/auth":{getSessionUser:async()=>null},"@/lib/guildRoster":{loadGuildRosterData:async()=>{reads++;return {members:[],stats:{},source:"stored"};}},"@/lib/dashboardApiSettings":{getDashboardApiSettings:async()=>({})},"@/lib/dashboardSystemLogs":{recordDashboardSystemLog(){}}},globals).exports;
  const result=await subject.loadGuildWorkspace();assert.equal(result.user,null);assert.equal(reads,1);assert.equal(result.roster.source,"stored");
 });
 await test("real roster renderer retains 50/50, character, signup order and item-level privacy",()=>{
  const html=renderer().html("src/components/raids/RaidRoster.tsx",{raid,showItemLevel:false,showBenchPriorityMarkers:false},"RosterSideList");
  assert.match(html,/50\/50/);assert.match(html,/Себас/);assert.match(html,/Порядковий номер запису: 2/);assert.doesNotMatch(html,/987/);assert.match(html,/<progress/);
 });
 await test("real overview keeps consumables, loot and full-width bench composition",()=>{
  const html=renderer().html("src/components/raids/RaidOverview.tsx",{raid,showRosterDetails:true,showMemberItemLevels:false});assert.match(html,/Розхідники/);assert.match(html,/Лут/);assert.match(html,/Паті рейду/);assert.match(html,/Участь через Discord/);assert.doesNotMatch(html,/style=/);
 });
 await test("public cards expose primary navigation without management forms",()=>{
  const html=renderer().html("src/components/raids/RaidDirectoryCard.tsx",{raid,canManage:false});assert.match(html,/href="\/raids\/fixture00"/);assert.doesNotMatch(html,/\/delete|\/close|\/edit/);assert.match(html,/data-list-entry="raids"/);
 });
 await test("poll card DTO excludes raw votes and private delivery/schedule errors",()=>{
  const model=pollPresentation.buildRaidPollCardModel({...poll,scheduledPublishLastError:"secret-error"},[poll]);assert.equal(model.votes,1);assert.doesNotMatch(JSON.stringify(model),/private-discord-id|secret-error/);assert.equal(Object.hasOwn(model,"votes")&&typeof model.votes,"number");
 });
 await test("real poll matrix uses shared-scale native progress and retains absent voters",()=>{
  const html=renderer().html("src/components/polls/PollAvailabilityMatrix.tsx",{poll,counts:polls.pollVoteCounts(poll)});assert.match(html,/Понеділок/);assert.match(html,/Субота/);assert.match(html,/Учасник/);assert.match(html,/Не можуть: 1/);assert.match(html,/<progress/);assert.doesNotMatch(html,/style=/);
 });
 await test("poll votes retain all day schedules and do not emit provider identity IDs",()=>{
  const html=renderer().html("src/components/polls/PollVotes.tsx",{poll});assert.match(html,/<table/);assert.match(html,/Учасник/);assert.doesNotMatch(html,/private-discord-id/);assert.match(html,/Пн/);assert.match(html,/Сб/);
 });
 await test("application status badge uses confirmed queue state instead of stale server props",()=>{
  const client=load("src/lib/applicationModerationClient.ts").exports;
  const render=renderer({"@/components/ApplicationModerationQueue":undefined,"@/lib/dashboardApiClient":{},"@/lib/clientToasts":{},"@/lib/applicationModerationClient":client,"@/hooks/useActionFocus":{useActionFocus:()=>({scopeRef:React.createRef(),beginActionFocus(){}})}});
  const queue=render.component("src/components/ApplicationModerationQueue.tsx");
  const html=renderToStaticMarkup(React.createElement(queue.ApplicationModerationProvider,{items:[{issueNumber:1,status:"accepted",state:"closed"}],canModerate:false},React.createElement(queue.ApplicationStatusBadge,{issueNumber:1,initialStatus:"review"})));
  assert.match(html,/Прийнято/);assert.doesNotMatch(html,/На розгляді/);
 });
 await test("all six routes use local shared loading and safe error boundaries",()=>{
  for(const route of ["guild","applications","raids","raids/[raidId]","polls","polls/[pollId]"]){assert.match(read(`src/app/${route}/loading.tsx`),/PageSkeleton/);assert.match(read(`src/app/${route}/error.tsx`),/PageRouteError/);}
 });
 await test("new workspace presentation has no inline styles or literal color/spacing drift",()=>{
  const walk=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(dir+"/"+entry.name):[dir+"/"+entry.name]);
  for(const folder of ["community","guild","applications","raids","polls"])for(const file of walk("src/components/"+folder)){const source=read(file);if(file.endsWith(".tsx"))assert.doesNotMatch(source,/\bstyle\s*=/,file);if(file.endsWith(".css")){assert.doesNotMatch(source,/#[a-f\d]{3,8}\b|\b(?:rgb|hsl)a?\(/i,file);for(const m of source.matchAll(/(?:^|[;{])\s*((?:padding|margin|gap|row-gap|column-gap)[\w-]*)\s*:\s*([^;{}]+)/g))assert.doesNotMatch(m[2],/\d+(?:px|rem|em)\b/,file);}}
 });
 console.log(`[check-community-workspaces] ${passed}/${passed}; actual server loaders, algorithms and React SSR; no live integrations`);
})().catch(error=>{console.error(error);process.exit(1);});
