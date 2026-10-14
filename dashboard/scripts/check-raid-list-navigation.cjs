const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const loader = require('./lib/load-server-ts.cjs');
const load = (file,mocks={},globals={}) => loader(file,mocks,{URL,URLSearchParams,Error,...globals}).exports;
const state = load('src/lib/listViewState.ts');
const location = load('src/lib/clientListLocation.ts',{'@/lib/listViewState':state});
const search = load('src/lib/raidListSearch.ts');
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name)}
function pageFixture(){
 let manager=false,allowed=true,reads=0;
 const user={provider:'discord',id:'fixture00',role:'member'};
 const cards=[{id:'active00',title:'Вечірній рейд',date:'2026-10-15',time:'19:00',status:'published'},{id:'draft000',title:'Приватна чернетка',status:'draft'},{id:'closed00',title:'Минулий рейд',date:'2026-10-01',status:'closed'}];
 const Card=()=>null;
 const mocks={
  'react/jsx-runtime':require('react/jsx-runtime'),
  'next/navigation':{redirect:href=>{throw Error('redirect:'+href)}},
  '@/components/ListViewMemory':{default:()=>null},'@/lib/listNavigationScope':{listNavigationScope:()=> 'scope'},'@/lib/listViewState':state,'@/lib/raidListSearch':search,
  '@/lib/auth':{getSession:async()=>user},'@/lib/permissions':{canManageRaids:()=>manager,canViewRaidDirectory:()=>allowed},'@/lib/profiles':{getOwnProfilePath:async()=>'/profile'},
  '@/lib/discordAdmin':{hasDiscordEmbedConfig:()=>true},'@/lib/raids':{hasRaidStorage:()=>true,isRaidClosed:r=>r.status==='closed',listRaids:async()=>{reads++;return cards}},
  '@/components/RaidViews':{RaidListCard:Card,RaidPageShell:()=>null,StatusNotice:()=>null,formatRaidDateTime:()=>''},'@/lib/seo':{buildPageMetadata:()=>({})},'@/lib/dashboardSystemLogs':{recordDashboardSystemLog:async()=>{}},'@/components/RaidArchiveLoadMore':{default:()=>null},
 };
 const source=fs.readFileSync(path.join(__dirname,'../src/app/raids/page.tsx'),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mod={exports:{}};vm.runInNewContext(js,{module:mod,exports:mod.exports,require:name=>{if(Object.hasOwn(mocks,name))return mocks[name];throw Error('unexpected:'+name)},URL,URLSearchParams,Error,console});
 const ids=node=>{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(ids);return [...(node.type===Card?[node.props.raid.id]:[]),...ids(node.props?.children)]};
 return {run:async p=>ids(await mod.exports.default({searchParams:Promise.resolve(p)})),manager:v=>manager=v,allowed:v=>allowed=v,reads:()=>reads};
}
(async()=>{
 await check('raid URLs retain only valid filters and bounded archive count',()=>{
  assert.equal(state.listViewUrl('raids','/raids?q=%20Рейд%20&state=closed&archive=999999&selected=secret&token=secret&view=all'),'/raids?q=%D0%A0%D0%B5%D0%B9%D0%B4&state=closed&archive=120');
  for(const archive of ['Infinity','NaN','-1','0','6'])assert.equal(state.listViewUrl('raids','/raids?state=owner&archive='+archive),'/raids');
 });
 await check('poll URLs accept all four states while excluding selection and action data',()=>{
  for(const tab of ['scheduled','open','paused','closed'])assert.equal(state.listViewUrl('polls',`/polls?tab=${tab}&selected=id&action=delete`),`/polls?tab=${tab}`);
  assert.equal(state.listViewUrl('polls','/polls?tab=all&archive=20&cursor=private'),'/polls?tab=all');
 });
 await check('new list kinds reject external or sibling paths',()=>{
  for(const kind of ['raids','polls'])for(const url of [`https://evil.test/${kind}`,`//evil.test/${kind}`,`/${kind}/one`,`/${kind}/../login`,`/${kind}\\..\\login`])assert.equal(state.listViewUrl(kind,url),null);
 });
 await check('named raid views discard archive expansion and hidden selection',()=>{
  const memory=state.emptyListMemory('raids');memory.views=[{name:'Архів',url:'/raids?state=closed&archive=24&selected=id'}];
  assert.equal(state.parseListMemory('raids',JSON.stringify(memory)).views[0].url,'/raids?state=closed');
 });
 await check('return URL retains exact raid card and expanded archive',()=>{
  const row=state.listEntryId('raids','closed00');const memory=state.rememberListPosition(state.emptyListMemory('raids'),{url:'/raids?state=closed&archive=24',row,next:'',previous:'',offset:20,scroll:400,at:Date.now(),opened:true});
  assert.equal(state.listReturnUrl('raids',state.parseListMemory('raids',JSON.stringify(memory))),'/raids?state=closed&archive=24#'+row);
  assert.notEqual(state.listMemoryKey('raids','scope'),state.listMemoryKey('polls','scope'));
 });
 await check('native query patch preserves filters and drops unknown/transient parameters',()=>{
  assert.equal(location.patchListUrl('raids','/raids?state=closed&q=raid&token=secret',{archive:'18'}),'/raids?q=raid&state=closed&archive=18');
  assert.equal(location.patchListUrl('polls','/polls?tab=closed&q=raid',{tab:null,q:''}),'/polls');
 });
 await check('raid search supports Ukrainian case, name, date and ID',()=>{
  const raid={id:'Fixture00',title:'ВЕЧІРНІЙ рейд',date:'2026-10-15',time:'19:00'};
  for(const q of ['вечірній','fixture','2026-10-15','19:00',''])assert.equal(search.matchesRaidListSearch(raid,q),true);
  assert.equal(search.matchesRaidListSearch(raid,'зовсім інше'),false);
 });
 await check('actual raid page keeps drafts hidden from members under every filter',async()=>{
  const f=pageFixture();assert.deepEqual(await f.run({}),['active00','closed00']);assert.deepEqual(await f.run({state:'draft'}),[]);assert.deepEqual(await f.run({q:'Приватна'}),[]);
 });
 await check('actual raid page applies state and search after permission selection',async()=>{
  const f=pageFixture();f.manager(true);assert.deepEqual(await f.run({state:'draft'}),['draft000']);assert.deepEqual(await f.run({state:'closed',q:'минулий'}),['closed00']);assert.deepEqual(await f.run({state:'active',q:'2026-10-15'}),['active00']);
 });
 await check('actual raid page denies directory access before reading data',async()=>{
  const f=pageFixture();f.allowed(false);await assert.rejects(f.run({state:'draft'}),/redirect:\/profile/);assert.equal(f.reads(),0);
 });
 console.log(`[check-raid-list-navigation] ${passed}/${passed} passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
