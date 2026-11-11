const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite'),load=require('./lib/load-server-ts.cjs');
const now=Date.now();let count=0,requests=0,mode='';
class Clock extends Date{constructor(v){super(v===undefined?now:v)}static now(){return now;}}
const json=(v,status=200,headers={})=>Response.json(v,{status,headers});
const globals={Date:Clock,Error,process:{env:{}},fetch:async()=>{
 requests++;
 if(mode==='large429')return json({error:'SECRET'},429,{'retry-after':'600'});
 return new Response('<html>SECRET</html>',{headers:{'content-type':'text/html'}});
}};
async function check(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
 const engine=new PGlite();await engine.exec(fs.readFileSync('src/lib/db/schema.sql','utf8'));
 const pool={hasPostgresConfig:()=>true,pgQuery:async(sql,values=[],client)=>{const r=await (client||engine).query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length};}};
 const body=load('src/lib/httpBody.ts',{},globals).exports;
 const api=load('src/lib/apiHttp.ts',{'@/lib/httpBody':body},globals).exports;
 const cd=load('src/lib/providerCooldown.ts',{'@/lib/apiHttp':api,'@/lib/db/pgPool':pool},globals).exports;
 const http=load('src/lib/providerHttp.ts',{'@/lib/apiHttp':api,'@/lib/providerCooldown':cd},globals).exports;
 try{
 await check('reader limits UTF-8 bytes and declared body size',async()=>{
  await assert.rejects(body.readResponseJson(json({x:'Ї'.repeat(20)}),{maxBytes:16}),e=>e.code==='body_limit');
  await assert.rejects(body.readResponseText(new Response('x',{headers:{'content-length':'100'}}),{maxBytes:10}),e=>e.code==='body_limit');
 });
 await check('HTML, malformed JSON and schema failures have safe typed codes',async()=>{
  for(const [r,code] of [[new Response('SECRET'),'content_type'],[new Response('{SECRET',{headers:{'content-type':'application/json'}}),'invalid_json'],[json([]),'schema']])await assert.rejects(body.readResponseJson(r,{validate:v=>!Array.isArray(v)}),e=>e.code===code&&!e.message.includes('SECRET'));
 });
 await check('abort stops a stalled stream without waiting for its hanging cancel',async()=>{
  const r=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}));const c=new AbortController();const started=performance.now();const pending=body.readResponseText(r,{signal:c.signal});setTimeout(()=>c.abort(Error('cancelled')),15);await assert.rejects(pending,/cancelled/);assert.ok(performance.now()-started<500);
 });
 await check('generic API never retries schema failure or exposes raw error bodies',async()=>{const start=requests;await assert.rejects(api.apiFetchJson('https://test.example/html',{retries:2}),e=>e.code==='content_type'&&!e.message.includes('SECRET'));assert.equal(requests,start+1);});
 await check('full 600 second cooldown survives module reload and prevents another consumer dispatch',async()=>{
  mode='large429';const url='https://raider.io/api/v1/test';await assert.rejects(http.providerFetchJson(url),e=>e.status===429);const start=requests;
  const reloaded=load('src/lib/providerCooldown.ts',{'@/lib/apiHttp':api,'@/lib/db/pgPool':pool},globals).exports;
  for(const gate of [cd,reloaded])await assert.rejects(gate.checkProviderPause({provider:'raiderio',key:'raiderio'}),e=>e.retryAt===now+600000);
  await assert.rejects(http.providerFetchJson(url));assert.equal(requests,start);mode='';
 });
 await check('concurrent durable writes never shorten the existing deadline',async()=>{
  const scope={provider:'test',key:'test'};await Promise.all([cd.storeProviderPause(scope,now+900000),cd.storeProviderPause(scope,now+30000)]);await assert.rejects(cd.checkProviderPause(scope),e=>e.retryAt===now+900000);
 });
 await check('cooldown storage failure blocks dispatch and exposes a safe storage error',async()=>{
  const failed=load('src/lib/providerCooldown.ts',{'@/lib/apiHttp':api,'@/lib/db/pgPool':{hasPostgresConfig:()=>true,pgQuery:async()=>{throw Error('SECRET-DB-URL');}}},globals).exports;await assert.rejects(failed.checkProviderPause({provider:'battlenet',key:'fail'}),e=>e.status===503&&!e.message.includes('SECRET'));
 });
 console.log(`[check-provider-resilience] ${count}/${count} passed`);
 }finally{await engine.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
