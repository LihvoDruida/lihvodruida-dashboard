const assert=require('node:assert/strict'),path=require('node:path');
const load=require('./lib/load-server-ts.cjs'),setup=require('./lib/application-delivery-fixture.cjs');
(async()=>{
 const site=process.env.PAIRED_SITE_ROOT;if(!site)throw Error('Set PAIRED_SITE_ROOT to the source directory of Site 4.2.1 or newer.');
 const f=await setup(),jobs=[],{NextRequest,NextResponse}=require('next/server'),token='a'.repeat(64);
 const contract=load('src/lib/applicationContract.ts').exports;
 const auth=load('src/lib/siteBridgeAuth.ts',{}, {process:{env:{PUBLIC_SITE_BRIDGE_TOKEN:token}}}).exports;
 const route=load('src/app/api/site/applications/route.ts',{
  'next/server':{NextResponse,after:fn=>jobs.push(fn)},'@/lib/applicationContract':contract,'@/lib/siteBridgeAuth':auth,'@/lib/applicationsStore':f.applications,'@/lib/applicationDelivery':f.worker,
  '@/lib/security':{assertRequestBodySize:()=>null,checkRateLimit:()=>({ok:true}),getClientIp:()=>{throw Error('Service IP required');},logDashboardEvent(){},safeErrorMessage:()=> 'Safe failure'},
  '@/lib/publicSiteBridge':{isAllowedPublicSiteOrigin:r=>r.headers.get('origin')==='https://lihvodruida.pp.ua',publicSiteCorsHeaders:()=>({'Cache-Control':'no-store'})},
 },{URL}).exports;
 const globals={URL,Request,Response,Headers,AbortSignal,Error,process:{env:{NODE_ENV:'production',DASHBOARD_INTERNAL_URL:'http://dashboard:3000',PUBLIC_SITE_BRIDGE_TOKEN:token}},fetch:async(input,init)=>{
  assert.equal(String(input),'http://dashboard:3000/api/site/applications');assert.equal(new Headers(init.headers).get('cookie'),null);
  return route.POST(new NextRequest(String(input),init));
 }};
 const source=name=>path.resolve(site,'src/lib',name+'.ts');
 const config=load(source('config'),{},globals).exports,http=load(source('http'),{},globals).exports,error=load(source('bridge-error'),{},globals).exports;
 const publicContract=load(source('applicationContract'),{},globals).exports,contracts=load(source('contracts'),{'./applicationContract':publicContract},globals).exports;
 const consumer=load(source('submit-application'),{'./bridge-error':error,'./bridge':{invalidateApplications(){}},'./config':config,'./http':http,'./contracts':contracts},globals).exports;
 const body={...f.input,discord:'sebas',consent:true},request=()=>new Request('https://lihvodruida.pp.ua/site-api/v1/applications',{method:'POST',headers:{Origin:'https://lihvodruida.pp.ua','Content-Type':'application/json','X-Real-IP':'203.0.113.25',Cookie:'private=browser',Authorization:'Bearer browser-injected'},body:JSON.stringify(body)});
 try{
  const response=await consumer.submitApplication(request());assert.equal(response.status,201);const receipt=await response.json();assert.ok(receipt.tracking_number);assert.equal(receipt.discord,undefined);assert.equal(jobs.length,1);assert.equal(f.posts(),0);assert.equal((await f.status(receipt.application_number)).state,'pending');
  f.mode('lost');await jobs[0]();assert.equal((await f.status(receipt.application_number)).state,'uncertain');const before=f.posts();f.mode('');assert.equal((await f.reload().worker.processApplicationDelivery(receipt.application_number,{force:true})).state,'delivered');assert.equal(f.posts(),before);
  const repeated=await consumer.submitApplication(request());assert.equal(repeated.status,200);const duplicate=await repeated.json();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.tracking_number,receipt.tracking_number);assert.equal(jobs.length,1);
  const listing=await route.GET(new NextRequest('http://dashboard:3000/api/site/applications',{headers:{Authorization:'Bearer '+token}}));assert.equal(listing.status,200);const publicBody=JSON.stringify(await listing.json());for(const secret of [receipt.tracking_number,'private-contact','guildApplicationDeliveries','delivery_unavailable'])assert.ok(!publicBody.includes(secret));
  console.log('[check-application-site-pair] OK — site consumer → actual dashboard route → PostgreSQL outbox → Discord recovery; compatible with Site 4.2.1; no external messages');
 }finally{await f.close();}
})().catch(error=>{console.error(error);process.exit(1)});
