const assert=require('node:assert/strict');
const loader=require('./lib/load-server-ts.cjs');
const load=(file,mocks={},globals={})=>loader(file,mocks,{Error,TypeError,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,TextEncoder,FormData,fetch,...globals}).exports;
const env={BATTLENET_CLIENT_ID:'fixture-client',BATTLENET_CLIENT_SECRET:'fixture-private-secret',BATTLENET_REQUEST_RETRIES:'0'};
let transport;
const api=load('src/lib/apiHttp.ts',{}, {fetch:(...args)=>transport(...args)});
const diagnostic=load('src/lib/battleNetDiagnostics.ts',{'@/lib/apiHttp':api});
const concurrency=load('src/lib/concurrency.ts');
const values=load('src/lib/values.ts');
const bnet=load('src/lib/battlenet.ts',{
 crypto:require('node:crypto'),'@/lib/apiHttp':api,'@/lib/oauth':{getDashboardUrl:()=> 'https://guild.test'},'@/lib/concurrency':concurrency,
 '@/lib/wowCharacters':{},'@/lib/wowRoles':{},'@/lib/values':values,'@/lib/authCookieNames':{},
},{process:{env}});
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name)}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})}
function callbackFixture(failure){
 let stage='profile_upsert', saved=0, exchanges=0, scans=0;
 const events=[];
 const origin='https://guild.test';
 const route=load('src/app/api/auth/battlenet/callback/route.ts',{
  'next/server':{NextResponse:{redirect:(url,status)=>new Response(null,{status,headers:{location:String(url)}})}},'next/headers':{cookies:async()=>({get:()=>({value:'fixture.eu.nonce'}),set(){}})},
  '@/lib/auth':{getSession:async()=>({id:'staff',profileId:'fixture00'}),secureAuthCookiesEnabled:()=>true},'@/lib/oauth':{getDashboardUrl:()=>origin},
  '@/lib/battlenet':{BNET_OAUTH_STATE_COOKIE:'state',LEGACY_BNET_OAUTH_STATE_COOKIE:'oldstate',normalizeBattleNetRegion:x=>x,
   exchangeBattleNetCode:async()=>{stage='oauth_exchange';exchanges++;if(failure?.stage===stage)throw failure.error;return {access_token:'fixture-access-token'}},
   fetchBattleNetGuildCharacters:async()=>{stage='character_scan';scans++;if(failure?.stage===stage)throw failure.error;return {characters:[],region:'eu'}},fetchBattleNetUserInfo:async()=>null},
  '@/lib/accessGroups':{recordSystemAudit:async()=>{}},
  '@/lib/profiles':{upsertProfileFromSession:async()=>{},findProfileCharacterConflicts:async()=>{stage='conflict_check';if(failure?.stage===stage)throw failure.error;return []},saveBattleNetSyncState:async()=>{saved++}},
  '@/lib/security':{checkRateLimit:()=>({ok:true}),getClientIp:()=> 'fixture',logDashboardEvent:(...args)=>events.push(args),safeErrorMessage:e=>e.message,applyNoStoreHeaders:r=>r},
  '@/lib/geoAccessPolicy':{checkGeoAccess:async()=>({blocked:false})},'@/lib/dashboardRedirects':{safeDashboardReturnPath:(v,o)=>v||o.fallback},'@/lib/battleNetDiagnostics':diagnostic,
 });
 return {run:()=>route.GET(new Request(origin+'/api/auth/battlenet/callback?code=fixture-code&state=fixture.eu.nonce')),events,saved:()=>saved,exchanges:()=>exchanges,scans:()=>scans};
}
(async()=>{
 for(const status of [400,401,403,404])await check('GET HTTP '+status+' is rejected once rather than retried as network failure',async()=>{
  let calls=0;transport=async()=>{calls++;return response({error:'Rejected'},status)};await assert.rejects(api.apiFetchJson('https://eu.api.blizzard.com/profile/user/wow',{retries:2}),e=>e instanceof api.ApiHttpError&&e.status===status);assert.equal(calls,1);
 });
 await check('retryable GET 503 still recovers within retry policy',async()=>{
  let calls=0;transport=async()=>response(calls++?{ok:true}:{error:'temporarily unavailable'},calls===1?503:200);assert.equal((await api.apiFetchJson('https://guild.test/read',{retries:1})).ok,true);assert.equal(calls,2);
 });
 await check('real network failure retains bounded GET retry',async()=>{
  let calls=0;transport=async()=>{if(calls++===0)throw new TypeError('network');return response({ok:true})};await api.apiFetchJson('https://guild.test/read',{retries:1});assert.equal(calls,2);
 });
 await check('OAuth POST uses deadline and zero replay even on upstream 503',async()=>{
  let calls=0;transport=async(url,init)=>{calls++;assert.equal(init.method,'POST');assert.ok(init.signal);assert.equal(new URLSearchParams(init.body).get('code'),'fixture-code');return response({error:'unavailable'},503)};
  await assert.rejects(bnet.exchangeBattleNetCode('fixture-code','eu'),api.ApiHttpError);assert.equal(calls,1);
 });
 await check('application-token POST also has deadline and zero replay',async()=>{
  let calls=0;transport=async(_url,init)=>{calls++;assert.equal(init.method,'POST');assert.ok(init.signal);return response({error:'unavailable'},503)};await assert.rejects(bnet.checkBattleNetApplicationAccess('eu'),api.ApiHttpError);assert.equal(calls,1);
 });
 await check('valid OAuth token is returned while malformed token response is rejected',async()=>{
  transport=async()=>response({access_token:'fixture-token'});assert.equal((await bnet.exchangeBattleNetCode('fixture-code','eu')).access_token,'fixture-token');
  transport=async()=>response({access_token:42});await assert.rejects(bnet.exchangeBattleNetCode('fixture-code','eu'),/access_token/);
 });
 await check('missing optional user info remains nonfatal and bounded',async()=>{
  transport=async(_url,init)=>{assert.ok(init.signal);return response({error:'not found'},404)};assert.equal(await bnet.fetchBattleNetUserInfo('fixture-token','eu'),null);
 });
 for(const [status,expected] of [[404,'bnet_profile_unavailable'],[403,'bnet_access_denied'],[503,'bnet_unavailable']])await check('callback classifies account profile HTTP '+status+' without clearing saved data',async()=>{
  const error=new api.ApiHttpError('provider echoed fixture-private-secret',{status,url:'https://eu.api.blizzard.com/profile/user/wow?token=fixture-private-secret'});
  const f=callbackFixture({stage:'character_scan',error});const r=await f.run();assert.equal(new URL(r.headers.get('location')).searchParams.get('characterStatus'),expected);assert.equal(f.saved(),0);
  const failed=f.events.find(v=>v[1]==='auth.battlenet.callback.failed')[3];assert.equal(failed.stage,'character_scan');assert.equal(failed.upstreamStatusCode,status);assert.equal(failed.upstreamPath,'/profile/user/wow');assert.ok(!JSON.stringify(f.events).includes('fixture-private-secret'));
 });
 await check('OAuth 404 is not misclassified as a missing WoW profile',async()=>{
  const f=callbackFixture({stage:'oauth_exchange',error:new api.ApiHttpError('not found',{status:404,url:'https://eu.battle.net/oauth/token'})});const r=await f.run();assert.equal(new URL(r.headers.get('location')).searchParams.get('characterStatus'),'bnet_failed');assert.equal(f.saved(),0);assert.equal(f.scans(),0);
 });
 await check('callback timeout has explicit safe diagnostic and user status',async()=>{
  const f=callbackFixture({stage:'oauth_exchange',error:Error('Battle.net timeout after 10000ms')});const r=await f.run();assert.equal(new URL(r.headers.get('location')).searchParams.get('characterStatus'),'bnet_unavailable');assert.equal(f.saved(),0);
 });
 await check('local conflict guard failure cannot save unverified characters',async()=>{
  const f=callbackFixture({stage:'conflict_check',error:Error('guard failed')});await f.run();assert.equal(f.saved(),0);
 });
 await check('successful callback still saves once and returns the existing result',async()=>{
  const f=callbackFixture();const r=await f.run();assert.equal(new URL(r.headers.get('location')).searchParams.get('characterStatus'),'bnet_no_characters');assert.equal(f.saved(),1);assert.equal(f.exchanges(),1);
 });
 console.log(`[check-battlenet-resilience] ${passed}/${passed} passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
