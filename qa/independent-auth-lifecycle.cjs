/* Standalone adversarial harness. Does NOT import project check scripts or assertions. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
let ts;
try { ts = require('../dashboard/node_modules/typescript'); }
catch { try { ts = require('typescript'); }
catch { ts = require(require('node:child_process').execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim() + '/typescript'); }}
const base = path.resolve(__dirname, '..');
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'testing-only-long-random-key-for-auth-session-signing-2026';
process.env.DISCORD_BOT_TOKEN = 'testing-token';
process.env.DISCORD_GUILD_ID = '888888888888888888';
process.env.SESSION_LIVE_ACCESS_SYNC_ENABLED = 'true';
let mode = 'valid', circuitOpen = false, cachedCalls = 0, cookieJar, ownerId='000000000000000000', bootstrapAssigned=false;
const id = '123456789012345678';
const liveRoles = ['987654321098765432'];
function newJar() {
  const values = new Map();
  return {
    values,
    get: name => values.has(name) ? { value: values.get(name) } : undefined,
    set: (name, value) => {if(value) values.set(name, value); else values.delete(name);},
  };
}
cookieJar = newJar();
function load(file, mocks, expose=[]) {
  const source = fs.readFileSync(path.join(base, file), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText + expose.map(name => `\nexports.__${name} = ${name};`).join('');
  const mod = { exports: {} };
  const context = vm.createContext({module:mod,exports:mod.exports, require: name => {
    if (Object.hasOwn(mocks,name)) return mocks[name];
    throw new Error(`Unexpected dependency ${name} in ${file}`);
  }, crypto:webcrypto, TextEncoder,TextDecoder,URL,URLSearchParams,Date,Math,console,Buffer, atob,btoa, Uint8Array,Set,Map,Promise,process,Headers,fetch:globalThis.__qaFetch});
  vm.runInContext(js,context,{filename:file,timeout:5000});
  Object.defineProperty(mod.exports, '__sandbox', {value:context});
  return mod.exports;
}
const redirects = load('dashboard/src/lib/dashboardRedirects.ts',{'server-only':{}});
const groups = {
  applyAccessGroupToSession: (s,g,isOwner) => ({...s, role:g.role, permissions:g.permissions, isServerOwner:Boolean(isOwner), groupName:g.name}),
  resolveAccessGroupFromDiscord: async (_roles, userId, ownerId) => ({group:{name:'Verified',role:ownerId===userId?'admin':'member',permissions:['dashboard.view','raids.view']},isServerOwner:ownerId===userId}),
  hasPermission:()=>true,recordSystemAudit:async()=>true,
};
const mods = {
  'next/headers': {cookies:async()=>cookieJar},
  '@/lib/discordAdmin': {
    fetchDiscordGuildMemberSnapshot:async()=> {cachedCalls++;if(mode === 'missing') throw Error('Discord API 404: missing');if(mode==='error')throw Error('Discord API 500: down');if(mode==='quota')throw Error('Quota exceeded');return {roleIds:liveRoles,displayName:'Verified Member', joinedAt:'2026-01-01'};},
    fetchDiscordGuildSnapshot:async()=>({ownerId}),
  },
  '@/lib/accessGroups':groups,
  '@/lib/profileCleanup':{deleteDashboardProfilesByDiscordUserId:async()=>({deleted:0,profileIds:[]})},
  '@/lib/profileIds':{createStableProfileId:async()=> 'id0123456789abcdef'},
  '@/lib/security':{logDashboardEvent:()=>{}},
  '@/lib/runtimeResilience':{
    isQuotaOrResourceError:e=>String(e).includes('Quota'),isTimeoutLikeError:e=>String(e).includes('timeout'),
    openRuntimeCircuit:()=>{circuitOpen=true;},runtimeCircuitOpen:()=>circuitOpen,
    singleFlight:async (_key,fn)=>fn(),withTimeout:async p=>p,
  },
  '@/lib/authAccessPolicy':{ensureAuthAccessRequiredRole:async()=>{},evaluateAuthAccessPolicy:()=>({allowed:true}),getAuthAccessPolicy:async()=>({enabled:true,allowEmergencyTokenLogin:false})},
  '@/lib/discordNewcomerBootstrap':{ensureDiscordNewcomerBootstrapRole:async()=>bootstrapAssigned?{assigned:true,roleId:'555555555555555555'}:{assigned:false}},
  '@/lib/dashboardRedirects':redirects,
  '@/lib/authCookieNames':{BNET_OAUTH_STATE_COOKIE:'__Host-mistblossom_bnet_state',LEGACY_BNET_OAUTH_STATE_COOKIE:'mistblossom_bnet_state'},
};
const auth = load('dashboard/src/lib/auth.ts',mods);
const unsignedSession = {provider:'discord',id,name:'Test User',role:'member',permissions:['dashboard.view'],discordRoleIds:liveRoles,profileId:'id0123456789abcdef'};
const elevatedSession = {...unsignedSession,role:'admin',permissions:['dashboard.view','access.groups.manage'],isServerOwner:true};
const signPayload = obj => {const raw=Buffer.from(JSON.stringify(obj)).toString('base64url');return `${raw}.${createHmac('sha256',process.env.SESSION_SECRET).update(raw).digest('base64url')}`;};
const basePayload = () => ({aud:'mistblossom-dashboard',provider:'discord',id,role:'member',name:'Tester',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});
function reset(){mode='valid';circuitOpen=false;cachedCalls=0;ownerId='000000000000000000';bootstrapAssigned=false;cookieJar=newJar();auth.__sandbox.__mistblossomLiveDiscordAccessCache=undefined;}

// Runtime isolation: each test uses a distinct user id when necessary to avoid
// stale success from a previous test's module-global verified-member cache.
let seq=100000000000000001n;
function uniqueSession(template=unsignedSession){return {...template,id:String(++seq)};}

test('session HMAC: valid token accepted; changed payload/signature rejected',async()=>{
 const tok=await auth.createSessionToken(unsignedSession);
 assert.equal((await auth.verifySessionToken(tok)).id,id);
 assert.equal(await auth.verifySessionToken(tok.slice(0,-1)+(tok.endsWith('0')?'1':'0')),null);
 assert.equal(await auth.verifySessionToken('junk'),null);
});
test('session HMAC: expiration, future issuance, invalid role/audience rejected',async()=>{
 for (const delta of [{exp:1},{iat:Math.floor(Date.now()/1000)+500},{role:'owner'},{aud:'different'}]) {
   const token=signPayload({...basePayload(),...delta});
   assert.equal(await auth.verifySessionToken(token),null);
 }
});
test('OAuth state: signed state round-trip, reject tamper and expiry',async()=>{
 const state=await auth.createOAuthStateToken('/discord/static?tab=roster');
 assert.equal((await auth.parseOAuthStateToken(state.token)).nextPath,'/discord/static?tab=roster');
 assert.equal(await auth.parseOAuthStateToken(state.token+'x'),null);
 assert.equal((await auth.createOAuthStateToken('https://evil.example')).nextPath,undefined);
 const expiredRaw=Buffer.from(JSON.stringify({aud:'mistblossom-oauth-state',n:'expired-nonce',next:'/discord',iat:Math.floor(Date.now()/1000)-700})).toString('base64url');
 assert.equal(await auth.parseOAuthStateToken(`${expiredRaw}.${createHmac('sha256',process.env.SESSION_SECRET).update(expiredRaw).digest('base64url')}`),null);
});
test('OAuth return allowlist: hostile destinations rejected',()=>{
 for(const value of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/api/auth/login', '/login']) {
   assert.equal(redirects.safeDashboardReturnPath(value,{scope:'discord-auth',fallback:''}),'',value);
 }
});
test('live guild check: valid membership returns access',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);
 assert.equal((await auth.getSession({live:true})).id,account.id);
 assert.equal(cachedCalls,1);
});
test('live guild check: missing membership denies access',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);mode='missing';
 assert.equal(await auth.getSession({live:true}),null);
});
test('live guild check: Discord 500 with no previously verified membership MUST deny',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);mode='error';
 assert.equal(await auth.getSession({live:true}),null);
});
test('live guild check: quota failure with no previously verified membership MUST deny',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);mode='quota';
 assert.equal(await auth.getSession({live:true}),null);
});
test('live guild check: open circuit with no verified membership MUST deny',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);circuitOpen=true;
 assert.equal(await auth.getSession({live:true}),null);
});
test('live guild check: missing bot credentials MUST deny in production',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);process.env.DISCORD_BOT_TOKEN='';
 try{assert.equal(await auth.getSession({live:true}),null)}finally{process.env.DISCORD_BOT_TOKEN='testing-token';}
});
test('production: disabling optional live-sync flag cannot bypass mandatory guild verification',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);
 process.env.SESSION_LIVE_ACCESS_SYNC_ENABLED='false';mode='missing';
 try {assert.equal(await auth.getSession(),null);}finally{process.env.SESSION_LIVE_ACCESS_SYNC_ENABLED='true';}
});
test('impersonation: forged/stale owner view MUST NOT bypass Discord membership check',async()=>{
 reset();const account=uniqueSession({...elevatedSession,impersonatedBy:id});account.impersonatedBy=account.id;
 await auth.setSession(account);mode='missing';
 assert.equal(await auth.getSession({live:true}),null);
});
test('impersonation: impersonated view MUST require verified server owner',async()=>{
 reset();const account=uniqueSession({...elevatedSession,impersonatedBy:id});account.impersonatedBy=account.id;
 await auth.setSession(account);mode='valid';
 assert.equal(await auth.getSession({live:true}),null);
});
test('verified member: transient outage reuses only recent positive cache, never renews trust',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);
 assert.ok(await auth.getSession({live:true}));
 const cache=auth.__sandbox.__mistblossomLiveDiscordAccessCache;
 const key=`discord:${account.id}`;
 const verified=cache.get(key);assert.ok(verified.session);
 verified.checkedAt=Date.now()-120_000;mode='error';
 assert.equal((await auth.getSession({live:true})).id,account.id);
 assert.equal(cache.get(key).checkedAt,verified.checkedAt,'outage must not refresh verification timestamp');
 verified.checkedAt=Date.now()-601_000;
 assert.equal(await auth.getSession({live:true}),null);
});
test('verified owner: elevated rights denied after 60-second outage grace',async()=>{
 reset();const account=uniqueSession(elevatedSession);ownerId=account.id;await auth.setSession(account);
 assert.equal((await auth.getSession({live:true})).isServerOwner,true);
 const cache=auth.__sandbox.__mistblossomLiveDiscordAccessCache;
 cache.get(`discord:${account.id}`).checkedAt=Date.now()-91_000;mode='error';
 assert.equal(await auth.getSession({live:true}),null);
});
test('member with custom write permission gets admin-strength outage grace',async()=>{
 reset();const account=uniqueSession();await auth.setSession(account);
 await auth.getSession({live:true});
 const entry=auth.__sandbox.__mistblossomLiveDiscordAccessCache.get(`discord:${account.id}`);
 entry.session.permissions.push('applications.manage');
 entry.checkedAt=Date.now()-91_000;mode='error';
 assert.equal(await auth.getSession({live:true}),null);
});
test('newcomer role: live session reflects a role assigned during bootstrap',async()=>{
 reset();bootstrapAssigned=true;
 const account=uniqueSession();await auth.setSession(account);
 assert.ok((await auth.getSession({live:true})).discordRoleIds.includes('555555555555555555'));
});
test('impersonation: verified guild owner may continue limited simulated-group view',async()=>{
 reset();const account=uniqueSession({...unsignedSession,impersonatedBy:id});account.impersonatedBy=account.id;ownerId=account.id;
 await auth.setSession(account);
 const current=await auth.getSession({live:true});
 assert.equal(current?.id,account.id);
 assert.equal(current?.impersonatedBy,account.id);
});
test('protected routes: application management and every OAuth-allowed private landing remain gated',()=>{
 const proxy=load('dashboard/src/proxy.ts',{
  'next/server':{NextResponse:{}},
  '@/lib/security':{
    forbiddenResponse:()=>{},getCanonicalDashboardOrigin:()=> 'https://example.invalid',getRequestHost:()=> 'example.invalid',
    isAllowedHost:()=> true,isLocalHost:()=>false,logDashboardEvent:()=>{},noStoreHeaders:()=>({}),verifyTrustedOrigin:()=>true,
  },
 },['isProtectedPagePath']);
 const guard=load('dashboard/src/components/ClientAuthGuard.tsx',{
   react:{useEffect:()=>{},useRef:()=>({current:false})},
   '@/lib/clientToasts':{dispatchDashboardToast:()=>{}},
   'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null},
 },['isProtectedPath']);
 for(const route of ['/','/applications','/applications/123','/dashboard','/admin','/guild','/profile','/profiles','/raids','/polls','/roster','/discord/static','/content']){
  assert.equal(proxy.__isProtectedPagePath(route),true,`proxy: ${route}`);
  assert.equal(guard.__isProtectedPath(route),true,`client: ${route}`);
 }
 for(const route of ['/login','/privacy','/terms','/static/accept']){
  assert.equal(proxy.__isProtectedPagePath(route),false,`public proxy: ${route}`);
  assert.equal(guard.__isProtectedPath(route),false,`public client: ${route}`);
 }
});
test('OAuth start: two browser tabs preserve both signed nonce flows',async()=>{
 reset();
 class Response {
  constructor(url,status){this.url=String(url);this.status=status;this.headers=new Headers();
   this.cookies={set:(name,value,options)=>cookieJar.set(name,options.maxAge===0?'':value)};}
  static redirect(url,status=303){return new Response(url,status);}
 }
 const start=load('dashboard/src/app/api/auth/discord/start/route.ts',{
  'next/server':{NextResponse:Response},'next/headers':{cookies:async()=>cookieJar},
  '@/lib/auth':auth,
  '@/lib/oauth':{buildDiscordOAuthUrl:state=>`https://discord.invalid/authorize?state=${encodeURIComponent(state)}`},
  '@/lib/security':{checkRateLimit:()=>({ok:true}),getClientIp:()=> '127.0.0.1',logDashboardEvent:()=>{},applyNoStoreHeaders:()=>{}},
  '@/lib/geoAccessPolicy':{checkGeoAccess:async()=>({blocked:false}),geoAccessDeniedResponse:()=>{}},
  '@/lib/dashboardRedirects':redirects,
  '@/lib/apiRoute':{appBaseUrl:()=> 'https://guild.example'},
  '@/lib/oauthNonces':load('dashboard/src/lib/oauthNonces.ts',{}),
 });
 const request={url:'https://guild.example/api/auth/discord/start?next=%2Fapplications'};
 const first=await start.GET(request);
 const second=await start.GET(request);
 const one=await auth.parseOAuthStateToken(new URL(first.url).searchParams.get('state'));
 const two=await auth.parseOAuthStateToken(new URL(second.url).searchParams.get('state'));
 assert.equal(one.nextPath,'/applications');
 assert.equal(two.nextPath,'/applications');
 assert.notEqual(one.nonce,two.nonce);
 const jarValue=cookieJar.get(auth.OAUTH_STATE_COOKIE)?.value;
 const nonces=JSON.parse(jarValue).nonces;
 assert.equal(nonces.length,2);
 assert.ok(nonces.includes(one.nonce) && nonces.includes(two.nonce));
});
test('proxy: cross-origin logout POST rejected; unauthenticated applications redirected',()=>{
 reset();
 class Response {
  constructor(url,status){this.url=String(url);this.status=status;this.headers=new Headers();this.cookies={set:()=>{}};}
  static redirect(url,status=303){return new Response(url,status);}
  static next(){return new Response('next',200);}
  static json(body,init={}){return Object.assign(new Response('',init.status||200),{body});}
 }
 const proxy=load('dashboard/src/proxy.ts',{
  'next/server':{NextResponse:Response},
  '@/lib/security':{
    forbiddenResponse:message=>({status:403,message}),getCanonicalDashboardOrigin:()=> 'https://guild.example',
    getRequestHost:()=> 'guild.example',isAllowedHost:()=>true,isLocalHost:()=>false,logDashboardEvent:()=>{},
    noStoreHeaders:()=>({}),verifyTrustedOrigin:request=>request.headers.get('origin')!=='https://attacker.invalid',
  },
 });
 const makeRequest=(p,method='GET',origin='https://guild.example')=>({
   method,url:'https://guild.example'+p,nextUrl:Object.assign(new URL('https://guild.example'+p),{clone(){return new URL(this.toString());}}),
   headers:new Headers({'origin':origin,'x-mistblossom-trusted-proxy':'cloudflare'}),cookies:{get:()=>undefined}
 });
 const redirect=proxy.proxy(makeRequest('/applications?view=pending'));
 assert.equal(redirect.status,303);
 assert.equal(new URL(redirect.url).pathname,'/login');
 assert.equal(new URL(redirect.url).searchParams.get('next'),'/applications?view=pending');
 const denied=proxy.proxy(makeRequest('/api/auth/logout','POST','https://attacker.invalid'));
 assert.equal(denied.status,403);
});
test('client session: unknown HTTP 503 is an error, not a successful login',async()=>{
 let code=503;
 globalThis.__qaFetch=async()=>({status:code,ok:code===200,json:async()=>({authenticated:true})});
 const client=load('dashboard/src/components/ClientAuthGuard.tsx',{
   react:{useEffect:()=>{},useRef:()=>({current:false})},
   '@/lib/clientToasts':{dispatchDashboardToast:()=>{}},
   'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null},
 },['checkSession']);
 try{
   await assert.rejects(()=>client.__checkSession(),/503/);
   code=401;assert.equal(await client.__checkSession(),false);
   code=200;assert.equal(await client.__checkSession(),true);
 }finally{delete globalThis.__qaFetch;}
});
test('session: production ignores legacy cookie even with correctly signed token',async()=>{
 reset();const tok=await auth.createSessionToken(uniqueSession());cookieJar.set(auth.LEGACY_SESSION_COOKIE,tok);
 assert.equal(await auth.getSession({live:false}),null);
});
test('logout route: POST expires all session and OAuth cookies; GET cannot clear session',async()=>{
 reset();const set = new Map();const fakeCookie={set:(key,value,opts)=>set.set(key,{value,opts})};
 class Response{constructor(status,body){this.status=status;this.body=body;this.headers=new Map();this.cookies=fakeCookie;}
  static json(body,init={}){const r=new Response(init.status||200,body);r.headers=new Map(Object.entries(init.headers||{}));return r;}
  static redirect(_target,status=303){return new Response(status,{});}}
 const route=load('dashboard/src/app/api/auth/logout/route.ts',{
 'next/server':{NextResponse:Response},'@/lib/session':{clearSession:auth.clearSession,SESSION_COOKIE:auth.SESSION_COOKIE,LEGACY_SESSION_COOKIE:auth.LEGACY_SESSION_COOKIE,OAUTH_STATE_COOKIE:auth.OAUTH_STATE_COOKIE,LEGACY_OAUTH_STATE_COOKIE:auth.LEGACY_OAUTH_STATE_COOKIE},
 '@/lib/authCookieNames':mods['@/lib/authCookieNames'],
 '@/lib/security':{logDashboardEvent:()=>{},noStoreHeaders:()=>({'cache-control':'no-store'}),applyNoStoreHeaders:()=>{}},
 '@/lib/apiRoute':{appBaseUrl:request=>'https://example.invalid'}
 });
 await auth.setSession(uniqueSession());const existing=await auth.getStoredSession();assert.ok(existing);
 const get=await route.GET({headers:new Map(),url:'https://example.invalid/api/auth/logout'});
 assert.equal(get.status,405);assert.ok(await auth.getStoredSession());
 const post=await route.POST({headers:new Map([['x-dashboard-action','logout'],['accept','application/json']]),url:'https://example.invalid/api/auth/logout'});
 assert.equal(post.status,200);assert.equal(post.body.signedOut,true);
 assert.equal(await auth.getStoredSession(),null);
 for(const name of [auth.SESSION_COOKIE,auth.LEGACY_SESSION_COOKIE,auth.OAUTH_STATE_COOKIE,auth.LEGACY_OAUTH_STATE_COOKIE,mods['@/lib/authCookieNames'].BNET_OAUTH_STATE_COOKIE,mods['@/lib/authCookieNames'].LEGACY_BNET_OAUTH_STATE_COOKIE]) assert.equal(set.get(name)?.opts?.maxAge,0,name);
});
