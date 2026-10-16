const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const load=require('./load-server-ts.cjs');
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/raid-seasons',name+'.json'),'utf8'));
module.exports=function fixture(){
 let now=Date.parse('2026-10-16T09:00:00Z'),fail=new Set(),mode='ok',active=0,maxActive=0;
 const calls=[];
 class Clock extends Date{constructor(value){super(value===undefined?now:value)}static now(){return now}}
 const globals={Error,URL,URLSearchParams,Request,Response,Headers,AbortSignal,structuredClone,setInterval,clearInterval,Date:Clock};
 const http=load('src/lib/apiHttp.ts',{},globals).exports;
 const api={...http,apiFetchJson:async(url,options)=>{
  url=new URL(url);const id=Number(url.searchParams.get('expansion_id'));
  calls.push({path:url.pathname,id,fields:url.searchParams.get('fields'),options});active++;maxActive=Math.max(maxActive,active);
  try{
   await new Promise(resolve=>setTimeout(resolve,1));
   if(mode==='rate')throw new http.ApiHttpError('Rate limited',{status:429,url:String(url),retryAfterMs:120000});
   if(fail.has(id)||mode==='outage')throw Error('Controlled provider outage');
   if(url.pathname.includes('static-data')){
    const prefix=url.pathname.includes('mythic-plus')?'seasons':'raids';
    if(id===10||id===11)return read(prefix+id);
    if(id>=6&&id<=9)return prefix==='seasons'?{seasons:[{slug:`season-exp${id}-1`,name:'First season',is_main_season:true,starts:{eu:`${2004+id*2}-09-01T00:00:00Z`},ends:{eu:`${2005+id*2}-09-01T00:00:00Z`}}]}:{raids:[{slug:`old-raid-${id}`,name:`Archive ${id}`,starts:{eu:`${2004+id*2}-08-25T00:00:00Z`},ends:{eu:`${2005+id*2}-08-25T00:00:00Z`},encounters:[{},{}]}]};
    return {seasons:[]};
   }
   const fields=url.searchParams.get('fields'),slug=fields.split(',')[0].split(':')[1];
   if(!slug)return read('guild');
   if(mode==='identity')return {name:'Different Guild',realm:'Terokkar',region:'eu',raid_progression:{[slug]:{total_bosses:8,normal_bosses_killed:0,heroic_bosses_killed:0,mythic_bosses_killed:0}}};
   return {name:'Mistblossom Vanguard',realm:'Terokkar',region:'eu',raid_progression:{[slug]:{total_bosses:8,normal_bosses_killed:0,heroic_bosses_killed:0,mythic_bosses_killed:0}},raid_rankings:{}};
  }finally{active--;}
 }};
 const battlenet={normalizeBattleNetRegion:value=>value||'eu',fetchBattleNetApplicationData:async()=>{throw Error('No Battle.net credentials in fixture')}};
 const resolver=load('src/lib/raidSeasonResolver.ts',{'@/lib/apiHttp':api,'@/lib/battlenet':battlenet},globals);
 function roster(store){
  const source=ts.createSourceFile('guildRoster.ts',fs.readFileSync(path.join(__dirname,'../../src/lib/guildRoster.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const modules=Object.fromEntries(source.statements.filter(ts.isImportDeclaration).map(node=>[node.moduleSpecifier.text,{}]));
  Object.assign(modules,{'node:crypto':require('node:crypto'),'@/lib/concurrency':load('src/lib/concurrency.ts').exports,'@/lib/battlenet':battlenet,'@/lib/apiHttp':api,'@/lib/guildRaidHistoryStore':store});
  return load('src/lib/guildRoster.ts',modules,globals);
 }
 return {read,globals,resolver:resolver.exports,resolverContext:resolver.context,roster,calls,api,clock:value=>{now+=value},fail:ids=>{fail=new Set(ids)},mode:value=>{mode=value},maxActive:()=>maxActive,now:()=>now};
};
