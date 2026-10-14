const assert=require('node:assert/strict');
const loader=require('./lib/load-server-ts.cjs');
const load=(file,mocks={},globals={})=>loader(file,mocks,{Error,URL,URLSearchParams,Request,Response,Headers,TextEncoder,...globals}).exports;
const privacy=load('src/lib/logPrivacy.ts');
const policy=load('src/lib/clientErrorPolicy.ts');
const origin='https://guild.test', secret='fixture-sensitive-value-123456789';
const token='eyJ'+ 'a'.repeat(80)+'.'+'b'.repeat(43);
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name)}
function assertPrivate(value){const text=JSON.stringify(value);assert.ok(!text.includes(secret),text);assert.ok(!text.includes(token.slice(0,32)),text)}
const next={NextResponse:{json:(body,init={})=>new Response(JSON.stringify(body),{...init,headers:{...init.headers,'Content-Type':'application/json'}})}};
function logsFixture(){
 const inserted=[],mirrored=[];
 const row={id:'fixture',created_at:new Date(),level:'error',category:'system',source:'dashboard',event:'client.exception',message:`failed /rules?rt=${token}`,path:`/rules?rt=${token}`,actor_name:`rt=${secret}`,details:{rt:secret,pathname:`/rules?rt=${token}`,filename:origin+`/rules?rt=${token}`,state:'uncertain',nested:{accessToken:secret}}};
 const logs=load('src/lib/structuredLogs.ts',{
  crypto:require('node:crypto'),'@/lib/db/pgPool':{hasPostgresConfig:()=>true,pgQuery:async(sql,params)=>{if(sql.startsWith('INSERT'))inserted.push(params);return {rows:[row]}}},
  '@/lib/logSettings':{getStructuredLogSettings:async()=>({queryLimit:200})},'@/lib/securityLogDiscord':{mirrorSecurityLogToDiscord:async item=>{mirrored.push(item);return true}},
 });return {logs,row,inserted,mirrored};
}
function clientRoute(){
 const events=[],systems=[];
 const route=load('src/app/api/client-errors/route.ts',{
  'next/server':next,'@/lib/clientErrorPolicy':policy,'@/lib/logPrivacy':privacy,
  '@/lib/dashboardSystemLogs':{recordDashboardSystemLog:async(...args)=>systems.push(args)},
  '@/lib/security':{verifyTrustedOrigin:()=>true,assertRequestBodySize:()=>null,getClientIp:()=> 'fixture',checkRateLimit:()=>({ok:true}),noStoreHeaders:()=>({'Cache-Control':'no-store'}),logDashboardEvent:(...args)=>events.push(args),safeErrorMessage:()=> 'safe error',forbiddenResponse:()=>new Response(null,{status:403})},
 });return {events,systems,post:body=>route.POST(new Request(origin+'/api/client-errors',{method:'POST',body:JSON.stringify(body)}))};
}
(async()=>{
 await check('plain and encoded URLs remove full queries before truncation',()=>{
  for(const value of [`/rules?rt=${token}`,origin+`/rules?rt=${token}&code=${secret}`,`/rules?%72%74=${token}`,encodeURIComponent(encodeURIComponent(`/rules?rt=${token}`)),`/profile#access_token=${secret}`])assertPrivate(privacy.redactLogText(value));
  assert.equal(privacy.safeClientLogLocation(origin+`/rules?rt=${token}`),origin+'/rules');
 });
 await check('standalone credentials and two-part rules receipts are redacted',()=>{
  for(const value of [`rt=${secret}`,`api_token=${secret}`,`client_secret=${secret}`,`code=${secret}`,`Basic ${secret}`,`Bearer ${secret}`,token])assertPrivate(privacy.redactLogText(value));
 });
 await check('useful paths, domain states and telemetry survive masking',()=>{
  assert.equal(privacy.redactLogText('HTTP 404 /profile/user/wow'),'HTTP 404 /profile/user/wow');
  assert.equal(privacy.isSensitiveLogKey('rt'),true);assert.equal(privacy.isSensitiveLogKey('state'),false);assert.equal(privacy.redactLogText('ordinary error'),'ordinary error');
 });
 await check('redaction is idempotent and bounded',()=>{
  const first=privacy.redactLogText(origin+`/rules?rt=${token}`);assert.equal(privacy.redactLogText(first),first);assert.ok(privacy.redactLogText('x'.repeat(100000)).length<=65536);
 });
 await check('long unbroken text, dotted words and slash paths avoid excessive regex work',()=>{
  const started=performance.now();
  for(const value of ['x','/','a.','a-','eyJ'])privacy.redactLogText(value.repeat(100000));
  assert.ok(performance.now()-started<5000,'Log masking exceeded generous CPU budget');
 });
 await check('new SQL records and security mirrors never receive URL credentials',async()=>{
  const f=logsFixture();await f.logs.recordStructuredLog({event:'security.fixture',category:'security',level:'error',path:f.row.path,message:f.row.message,details:f.row.details});
  assert.equal(f.inserted.length,1);assert.equal(f.mirrored.length,1);assertPrivate(f.inserted);assertPrivate(f.mirrored);assert.equal(f.mirrored[0].details.state,'uncertain');
 });
 await check('historical list reads mask old records without changing stored rows',async()=>{
  const f=logsFixture();const rows=await f.logs.listStructuredLogs();assertPrivate(rows);assert.equal(rows.length,1);assert.equal(f.row.details.rt,secret);assert.equal(rows[0].details.state,'uncertain');
 });
 await check('historical export pages independently mask old message, path and details',async()=>{
  const f=logsFixture();const page=await f.logs.listStructuredLogsExportPage();assertPrivate(page.items);assert.equal(page.items.length,1);assert.equal(f.inserted.length,0);
 });
 await check('actual streamed export masks full filter inputs before truncating metadata',async()=>{
  const route=load('src/app/api/dashboard/logs/export/route.ts',{
   'next/server':{NextResponse:Response},'@/lib/auth':{getSession:async()=>({role:'admin'})},'@/lib/permissions':{canViewAdminLogs:()=>true},
   '@/lib/structuredLogs':{listStructuredLogsExportPage:async()=>({items:[],nextCursor:null})},'@/lib/security':{noStoreHeaders:()=>({'Cache-Control':'no-store'})},
  },{ReadableStream});
  const nextUrl=new URL(origin+'/api/dashboard/logs/export');nextUrl.searchParams.set('q','eyJ'+'a'.repeat(900)+'.'+'b'.repeat(43));nextUrl.searchParams.set('category','rt='+secret);nextUrl.searchParams.set('level','token='+secret);
  const r=await route.GET({nextUrl});assert.equal(r.status,200);const body=JSON.parse(await r.text());assertPrivate(body);assert.equal(body.filters.search,'[redacted]');assert.equal(body.count,0);
 });
 await check('console security logger and safeErrorMessage use the same mask',()=>{
  const lines=[];const security=load('src/lib/security.ts',{'next/server':next,'@/lib/oauth':{getDashboardUrl:()=>origin},'@/lib/values':{envFlag:()=>false}}, {console:{log:v=>lines.push(v),warn:v=>lines.push(v),error:v=>lines.push(v)}});
  security.logDashboardEvent('error','fixture',undefined,{rt:secret,filename:origin+`/rules?rt=${token}`},{persist:false});assertPrivate(lines);assertPrivate(security.safeErrorMessage(`request failed rt=${secret}`));
 });
 await check('untrusted browser reports are scrubbed again at the server',async()=>{
  const f=clientRoute();const r=await f.post({message:`failure rt=${secret}`,source:'window-error',pathname:`/rules?rt=${token}`,filename:origin+`/rules?rt=${token}`});assert.equal(r.status,200);assertPrivate(f.events);assert.equal(f.events[0][1],'client.exception');
 });
 await check('nativeIframe signature is retained as suspected external warning',async()=>{
  const f=clientRoute();await f.post({message:"Identifier 'nativeIframe' has already been declared",source:'window-error',pathname:'/rules',filename:origin+'/rules'});
  assert.equal(f.events[0][0],'warn');assert.equal(f.events[0][1],'client.external_script_error');assert.equal(f.events[0][3].classification,'suspected_injected_script');
 });
 await check('app bundle and unknown errors are never hidden by nativeIframe classification',()=>{
  const message="Identifier 'nativeIframe' has already been declared";
  for(const [source,stack,file] of [['window-error','',origin+'/_next/static/chunk.js'],['window-error','at /_next/static/chunk.js',origin+'/rules'],['unhandled-rejection','',origin+'/rules'],['window-error','','']])assert.equal(policy.isSuspectedInjectedScriptError(message,source,stack,file,'/rules'),false);
 });
 await check('actual client reporter strips URLs before fetch and keeps application toasts',async()=>{
  const handlers={},reports=[],toasts=[];
  const window={location:new URL(origin+`/rules?rt=${token}`),addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener(){},setTimeout:()=>0};
  const client=load('src/components/ClientErrorReporter.tsx',{'react':{useRef:()=>({current:new Set()}),useEffect:fn=>fn()},'@/lib/clientErrorPolicy':policy,'@/lib/clientToasts':{dispatchDashboardToast:v=>toasts.push(v)}}, {window,navigator:{userAgent:'fixture'},fetch:async(_url,init)=>{reports.push(JSON.parse(init.body));return new Response('{}')}});
  client.default();handlers.error({message:"Identifier 'nativeIframe' has already been declared",filename:origin+`/rules?rt=${token}`});assert.equal(reports.length,1);assertPrivate(reports);assert.equal(toasts.length,0);
  handlers.error({message:'Application failed',filename:origin+'/_next/static/chunk.js'});assert.equal(reports.length,2);assert.equal(toasts.length,1);
  handlers.error({message:'eyJ'+'a'.repeat(900)+'.'+'b'.repeat(43),filename:origin+'/_next/static/chunk.js'});assertPrivate(reports);assert.equal(reports.length,3);
 });
 console.log(`[check-log-privacy] ${passed}/${passed} passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
