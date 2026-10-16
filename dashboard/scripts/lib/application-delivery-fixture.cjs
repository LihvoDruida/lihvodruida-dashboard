const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const load=require('./load-server-ts.cjs');
module.exports=async function fixture(){
 const engine=new PGlite();await engine.exec(fs.readFileSync(path.resolve(__dirname,'../../src/lib/db/schema.sql'),'utf8'));
 let fault=null,mode='',channel='111111111111111111',sequence=900000000000000000n,hold,started;
 const messages=new Map(),calls=[];
 const query=async(sql,values=[],client)=>{
  if(fault)await fault(sql,values);
  const r=await(client||engine).query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length};
 };
 const pool={pgQuery:query,pgTransaction:(run)=>engine.transaction(tx=>run({query:(sql,values)=>query(sql,values,tx)}))};
 const adapter=load('src/lib/db/documentStore.ts',{'@/lib/db/pgPool':pool}).exports;
 const store=new adapter.PgDocumentStore(),database={'@/lib/documentDb':{getDocumentDb:()=>store}};
 const globals={Error,URL,Request,Response,Headers,FormData,AbortSignal,setInterval,clearInterval,structuredClone,process:{env:{DISCORD_BOT_TOKEN:'controlled-fixture-token',DISCORD_GUILD_ID:'333333333333333333'}}};
 const concurrency=load('src/lib/concurrency.ts').exports,values=load('src/lib/values.ts').exports;
 const applications=load('src/lib/applicationsStore.ts',{...database,'@/lib/db/documentValues':adapter,'@/lib/concurrency':concurrency},globals).exports;
 const transport=async(input,init)=>{
  const url=new URL(input),route=url.pathname.replace('/api/v10',''),method=init.method||'GET';calls.push({route,method,body:init.body?JSON.parse(init.body):null});
  assert.equal(new Headers(init.headers).get('authorization'),'Bot controlled-fixture-token');
  if(route==='/users/@me')return Response.json({id:'444444444444444444'});
  if(method==='POST'){
   if(mode==='reject')return Response.json({message:'Missing permissions'},{status:403});
   if(mode==='rate')return Response.json({message:'Rate limited',retry_after:0.1},{status:429});
   const body=JSON.parse(init.body);assert.equal(body.enforce_nonce,true);assert.match(body.nonce,/^[a-f0-9]{25}$/);assert.deepEqual(body.allowed_mentions.parse,[]);
   const message={...body,id:String(++sequence),channel_id:route.split('/')[2],author:{id:'444444444444444444'},timestamp:new Date().toISOString()};messages.set(message.id,message);
   if(mode==='hold'){started();await new Promise(resolve=>hold=resolve);}
   if(mode==='lost')throw TypeError('Lost HTTP acknowledgment');
   return Response.json(message,{status:201});
  }
  if(method==='PATCH'){
   const message=messages.get(route.split('/').pop());if(!message)return Response.json({message:'Unknown message'},{status:404});
   Object.assign(message,JSON.parse(init.body));return Response.json(message);
  }
  if(method==='DELETE'){messages.delete(route.split('/').pop());return new Response(null,{status:204});}
  if(url.search){return Response.json(mode==='no-history'?[]:[...messages.values()].filter(m=>m.channel_id===route.split('/')[2]));}
  const message=messages.get(route.split('/').pop());return message?Response.json(message):Response.json({message:'Unknown message'},{status:404});
 };
 globals.fetch=transport;
 const rest=load('src/lib/discordRest.ts',{},globals).exports;
 const security={logDashboardEvent(){},getCanonicalDashboardOrigin:()=> 'https://guild.test'};
 const admin=load('src/lib/discordAdmin.ts',{'@/lib/discordRest':rest,'@/lib/concurrency':concurrency,'@/lib/rulesOnboarding':{},'@/lib/security':security,'@/lib/values':values,'@/lib/discordAvatar':{},'@/lib/discordRulesStats':{}},globals).exports;
 const discord=load('src/lib/discord.ts',{'./applicationsStore':applications,'@/lib/discordAdmin':admin,'@/lib/guildNicknamePolicy':{getGuildNicknamePolicy:async()=>({applicationsChannelId:channel})}},globals).exports;
 function reload(){
  const lease=load('src/lib/automationLease.ts',{...database,'@/lib/storageAccess':{assertStorageWriteAvailable(){}}},globals).exports;
  const publication=load('src/lib/discordPublication.ts',{...database,'@/lib/automationLease':lease,'@/lib/discordRest':rest},globals).exports;
  const worker=load('src/lib/applicationDelivery.ts',{...database,'@/lib/applicationsStore':applications,'@/lib/discord':discord,'@/lib/discordAdmin':admin,'@/lib/discordRest':rest,'@/lib/security':security,'@/lib/discordPublication':publication},globals).exports;
  return {worker,publication};
 }
 const base=reload();
 let user={id:'officer'},manage=true,origin='https://guild.test',internal=true;
 const {NextResponse}=require('next/server');
 const securityHttp={getClientIp:()=> '127.0.0.1',logDashboardEvent(){},safeErrorMessage:()=> 'Safe failure',noStoreHeaders:()=>({'Cache-Control':'no-store'}),unauthorizedResponse:()=>NextResponse.json({error:'Unauthorized'},{status:401}),forbiddenResponse:()=>NextResponse.json({error:'Forbidden'},{status:403}),verifyTrustedOrigin:r=>r.headers.get('origin')===origin,checkRateLimit:()=>({ok:true}),verifyInternalBearerToken:async()=>({ok:internal})};
 const deliveryRoute=load('src/app/api/applications/[number]/delivery/route.ts',{
  'next/server':{NextResponse},'@/lib/auth':{getSession:async()=>user},'@/lib/permissions':{canManageApplications:()=>manage},'@/lib/applicationsStore':applications,'@/lib/applicationDelivery':base.worker,'@/lib/discordAdmin':admin,'@/lib/security':securityHttp,
 },globals).exports;
 const cron=load('src/app/api/dashboard/discord/applications/automation/route.ts',{
  'next/server':{NextResponse},'../../../../../../../package.json':{version:'fixture'},'@/lib/applicationDelivery':base.worker,'@/lib/automationTaskRuns':{observeAutomationRun:async(_id,run)=>run()},'@/lib/security':securityHttp,
 },globals).exports;
 const deleteRoute=load('src/app/api/applications/[number]/route.ts',{
  'next/server':{NextResponse},'@/lib/auth':{getSession:async()=>user},'@/lib/permissions':{canViewApplications:()=>manage},'@/lib/accessGroups':{recordAdminAudit:async()=>{}},'@/lib/discord':discord,'@/lib/applicationsStore':applications,'@/lib/applicationDelivery':base.worker,'@/lib/discordPublication':base.publication,'@/lib/security':securityHttp,
 },globals).exports;
 const input={characterName:'Sebas',realm:'Terokkar',faction:'Alliance',className:'Druid',discord:'private-contact',availability:'Увечері після 19:00',sourceCreator:'Лігво Друїда',sourcePlatform:'Twitch'};
 let sequenceInput=0;
 return {engine,store,applications,admin,globals,...base,reload,messages,calls,input,
  create:(extra={})=>applications.createGuildApplication({...input,discord:'private-contact-'+(++sequenceInput),...extra}),
  fault:fn=>fault=fn,mode:value=>mode=value,channel:value=>channel=value,
  held:()=>new Promise(resolve=>started=resolve),release:()=>hold(),
  posts:()=>calls.filter(c=>c.method==='POST').length,
  status:number=>base.worker.readApplicationDelivery(number),
  close:()=>engine.close(),deliveryRoute,cron,deleteRoute,origin:value=>origin=value,auth:value=>user=value,manage:value=>manage=value,internal:value=>internal=value,
 };
};
