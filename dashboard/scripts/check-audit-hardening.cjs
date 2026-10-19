const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const path=require('node:path');
const loadServer=require('./lib/load-server-ts.cjs');
const {NextRequest,NextResponse}=require('next/server');
const globals={Error,TypeError,URL,URLSearchParams,Request,Response,Headers,FormData,AbortController,AbortSignal,TextDecoder,TextEncoder,DOMException,ReadableStream};
const load=(file,modules={},extra={})=>loadServer(file,modules,{...globals,...extra}).exports;
const uid='234567890123456789',gid='999999999999999999';
const env={DISCORD_GUILD_ID:gid,DISCORD_BOT_TOKEN:'fixture-bot',DISCORD_OAUTH_CLIENT_ID:'client',DISCORD_OAUTH_CLIENT_SECRET:'secret',DASHBOARD_URL:'https://guild.example'};
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
const hang=signal=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
function oauthFixture(fetch,fast=false){return load('src/lib/oauth.ts',{}, {process:{env},fetch,...(fast?{AbortSignal:{timeout:()=>AbortSignal.timeout(15),any:AbortSignal.any.bind(AbortSignal)}}:{})});}
function adminFixture(transport){
 const rest=load('src/lib/discordRest.ts',{}, {fetch:transport});
 const admin=load('src/lib/discordAdmin.ts',{
  '@/lib/discordRest':rest,'@/lib/concurrency':{},'@/lib/rulesOnboarding':{},'@/lib/security':{logDashboardEvent(){}},
  '@/lib/values':{cleanSnowflake:v=>/^\d{16,25}$/.test(String(v))?String(v):''},'@/lib/discordAvatar':{},'@/lib/discordRulesStats':{},
 },{process:{env}});
 return {rest,admin};
}
function callbackFixture(oauth,admin,extra={}){
 let deletes=0;const audits=[];
 const modules=Object.fromEntries(['authAccessPolicy','discordNewcomerBootstrap','profiles','guildNicknamePolicy'].map(k=>['@/lib/'+k,{}]));
 const route=load('src/app/api/auth/discord/callback/route.ts',{
  ...modules,'next/server':{NextRequest,NextResponse},'next/headers':{cookies:async()=>({get:()=>({value:'nonce'})})},
  '@/lib/accessGroups':{recordSystemAudit:async(...args)=>audits.push(args)},'@/lib/discordAdmin':admin,
  '@/lib/auth':{OAUTH_STATE_COOKIE:'oauth',LEGACY_OAUTH_STATE_COOKIE:'old',SESSION_COOKIE:'session',LEGACY_SESSION_COOKIE:'oldsession',secureAuthCookiesEnabled:()=>true,createStableProfileId:async()=> 'id'+'a'.repeat(16),parseOAuthStateToken:async()=>({nonce:'nonce',nextPath:''})},
  '@/lib/session':{},'@/lib/oauth':oauth,'@/lib/discordAvatar':{},
  '@/lib/security':{checkRateLimit:()=>({ok:true}),getClientIp:()=> 'fixture',logDashboardEvent:()=>{},applyNoStoreHeaders:()=>{}},
  '@/lib/geoAccessPolicy':{checkGeoAccess:async()=>({blocked:false})},'@/lib/rulesOnboarding':{normalizeRulesAcceptPath:()=>'',parseRulesRoleIdsFromUrl:()=>[]},
  '@/lib/profileCleanup':{deleteDashboardProfilesByDiscordUserId:async()=>{deletes++;return {deleted:1,profileIds:['fixture']}}},
  '@/lib/dashboardRedirects':{safeDashboardReturnPath:()=>''},'@/lib/oauthNonces':{MAX_PARALLEL_OAUTH_FLOWS:5,parseRememberedOAuthNonces:()=>['nonce'],serializeRememberedOAuthNonces:()=>''},
 },{process:{env},...extra});
 return {run:()=>route.GET(new NextRequest('https://guild.example/api/auth/discord/callback?code=fixture&state=nonce')),deletes:()=>deletes,audits};
}
function oauthTransport(member){return async(url,init)=>{
 assert.ok(init.signal,'every OAuth fetch must have a deadline');
 if(url.endsWith('/oauth2/token'))return json({access_token:'fixture',token_type:'Bearer',expires_in:3600,scope:'identify email guilds.members.read'});
 if(url.endsWith('/users/@me'))return json({id:uid,username:'Sebas'});
 return member(url,init);
};}
(async()=>{
 for(const status of [401,403,429,500])await check(`real OAuth callback preserves profile on member HTTP ${status}`,async()=>{
  const oauth=oauthFixture(oauthTransport(()=>json({message:'Missing Access access_denied',code:50001},status)));
  const f=callbackFixture(oauth,{fetchDiscordGuildBanSnapshot:async()=>null,confirmDiscordMemberDeparture:async()=>{throw Error('must not attempt deletion confirmation')}});
  const response=await f.run();assert.equal(response.status,303);assert.equal(f.deletes(),0);assert.ok(!response.headers.get('location').includes('not_guild_member'));
 });
 await check('generic OAuth 404 never authorizes deletion',async()=>{
  const f=callbackFixture(oauthFixture(oauthTransport(()=>json({message:'Unknown Member'},404))),{fetchDiscordGuildBanSnapshot:async()=>null,confirmDiscordMemberDeparture:async()=>{throw Error('must not run')}});
  await f.run();assert.equal(f.deletes(),0);
 });
 for(const [status,code] of [[200,0],[403,50001],[404,0],[404,10004],[429,0]])await check(`OAuth Unknown Member plus bot ${status}/${code} preserves profile`,async()=>{
  const {admin}=adminFixture(async url=>url.endsWith('/'+gid)?json({id:gid}):json(status===200?{user:{id:uid}}:{code},status));
  const oauth=oauthFixture(oauthTransport(()=>json({code:10007},404)));
  const f=callbackFixture(oauth,{...admin,fetchDiscordGuildBanSnapshot:async()=>null});await f.run();assert.equal(f.deletes(),0);
 });
 await check('explicit departure requires fresh guild access and bot Unknown Member, and logs evidence',async()=>{
  const calls=[];const {admin}=adminFixture(async url=>{calls.push(url);return url.endsWith('/'+gid)?json({id:gid}):json({code:10007,message:'Unknown Member'},404);});
  const f=callbackFixture(oauthFixture(oauthTransport(()=>json({code:10007},404))),{...admin,fetchDiscordGuildBanSnapshot:async()=>null});
  const r=await f.run();assert.equal(f.deletes(),1);assert.ok(r.headers.get('location').includes('not_guild_member'));assert.equal(calls.length,2);assert.equal(f.audits[0][1].evidenceSource,'discord_bot_unknown_member_10007');
 });
 for(const stage of ['token','user','member'])await check(`hanging OAuth ${stage} aborts without POST replay or profile deletion`,async()=>{
  let posts=0;const oauth=oauthFixture(oauthTransport((url,init)=>hang(init.signal)),true);
  const original=stage==='member'?oauth:oauthFixture(async(url,init)=>{
   if(url.endsWith('/oauth2/token')){posts++;if(stage==='token')return hang(init.signal);return json({access_token:'fixture',token_type:'Bearer',scope:'identify guilds.members.read',expires_in:3600});}
   return hang(init.signal);
  },true);
  const f=callbackFixture(original,{fetchDiscordGuildBanSnapshot:async()=>null});const start=Date.now();const timer=setTimeout(()=>{},1000);try{const r=await f.run();assert.ok(r.headers.get('location').includes('discord_timeout'));assert.equal(f.deletes(),0);assert.ok(posts<=1);assert.ok(Date.now()-start<500);}finally{clearTimeout(timer);}
 });
 await check('token/user/member share one callback deadline instead of resetting the budget',async()=>{
  const oauth=oauthFixture(async(url,init)=>{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,25);init.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(init.signal.reason)},{once:true});});if(url.endsWith('/oauth2/token'))return json({access_token:'fixture',token_type:'Bearer',expires_in:3600,scope:'identify guilds.members.read'});return json({id:uid,username:'Sebas'});});
  const f=callbackFixture(oauth,{fetchDiscordGuildBanSnapshot:async()=>null},{AbortSignal:{timeout:()=>AbortSignal.timeout(40)}});const keeper=setTimeout(()=>{},1000);try{const r=await f.run();assert.ok(r.headers.get('location').includes('discord_timeout'));assert.equal(f.deletes(),0);}finally{clearTimeout(keeper);}
 });
 await check('OAuth rejects oversized responses, HTML and malformed success schemas safely',async()=>{
  for(const transport of [()=>new Response('x'.repeat(131073)),()=>new Response('<html>secret</html>'),()=>json({id:uid,username:123}),()=>json({id:'bad',username:'x'})]){
   const oauth=oauthFixture(transport);await assert.rejects(oauth.fetchDiscordUser('fixture'),e=>e instanceof oauth.DiscordOAuthError&&!e.message.includes('secret'));
  }
 });
 await check('OAuth requires granted membership scope and valid member roles',async()=>{
  const oauth=oauthFixture(()=>json({access_token:'secret',token_type:'Bearer',expires_in:3600,scope:'identify'}));await assert.rejects(oauth.exchangeDiscordCode('once'),e=>e.reason==='scope');
  const reader=oauthFixture(()=>json({roles:['not-a-role'],joined_at:new Date().toISOString()}));await assert.rejects(reader.fetchDiscordGuildMember('fixture'),e=>e.reason==='schema');
 });
 for(const header of ['600',new Date(Date.now()+600000).toUTCString()])await check(`long Retry-After ${header==='600'?'seconds':'HTTP-date'} defers once with full retryAt`,async()=>{
  let calls=0;const api=load('src/lib/apiHttp.ts',{}, {fetch:async()=>{calls++;return json({message:'limited'},429,{'Retry-After':header});}});const start=Date.now();
  await assert.rejects(api.apiFetchJson('https://provider.example/read',{retries:3}),e=>e.status===429&&e.retryAfterMs>598000&&e.retryAt>start+598000);assert.equal(calls,1);assert.ok(Date.now()-start<500);
 });
 await check('cancellation interrupts Retry-After backoff immediately and prevents retry',async()=>{
  let calls=0;const controller=new AbortController();const api=load('src/lib/apiHttp.ts',{}, {fetch:async()=>{calls++;setTimeout(()=>controller.abort(),15);return json({},429,{'Retry-After':'2'});}});
  const start=Date.now();await assert.rejects(api.apiFetchJson('https://provider.example/read',{retries:2,signal:controller.signal}));assert.equal(calls,1);assert.ok(Date.now()-start<500);
 });
 await check('pre-aborted API request makes no network call',async()=>{
  let calls=0;const controller=new AbortController();controller.abort();const api=load('src/lib/apiHttp.ts',{}, {fetch:async()=>{calls++;return json({})}});await assert.rejects(api.apiFetchJson('https://provider.example/read',{signal:controller.signal}));assert.equal(calls,0);
 });
 await check('Raider.IO cooldown survives module restart in the real guild reader',async()=>{
  const stored=new Map();const ref={get:async()=>({data:()=>stored.get('pause')})};const db={collection:()=>({doc:()=>ref}),runTransaction:async fn=>fn({get:ref.get,set:(_r,data)=>stored.set('pause',data)})};
  let calls=0;const api=load('src/lib/apiHttp.ts',{}, {fetch:async()=>{calls++;return json({},429,{'Retry-After':'600'});}});
  function roster(){const file='src/lib/guildRoster.ts';const source=fs.readFileSync(path.join(__dirname,'../',file),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const mocks=Object.fromEntries([...compiled.matchAll(/require\("(@[^\"]+)"\)/g)].map(m=>[m[1],{}]));return load(file,{...mocks,'@/lib/apiHttp':api,'@/lib/concurrency':{readIntegerEnv:(_n,d)=>d},'@/lib/documentDb':{hasDocumentDbConfig:()=>true,getDocumentDb:()=>db},'@/lib/dashboardSystemLogs':{recordDashboardSystemLog:async()=>true}});}
  await roster().fetchRaiderGuild('eu','terokkar','mistblossom');assert.equal(calls,1);assert.ok(stored.get('pause').retryAt>Date.now()+598000);
  await roster().fetchRaiderGuild('eu','terokkar','mistblossom');assert.equal(calls,1,'a new process/module must read the saved pause before fetch');
 });
 console.log(`[check-audit-hardening] ${count}/${count} passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
