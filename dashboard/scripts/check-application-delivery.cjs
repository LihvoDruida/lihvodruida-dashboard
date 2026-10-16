const assert=require('node:assert/strict');
const {NextRequest,NextResponse}=require('next/server');
const load=require('./lib/load-server-ts.cjs');
const fixture=require('./check-site-integration.cjs');
const input={characterName:'Sebas',realm:'Terokkar',region:'eu',faction:'Alliance',className:'Druid',discord:'sebas',sourceCreator:'Лігво Друїда',sourcePlatform:'Twitch',availability:'Увечері після 19:00',consent:true};
function setup(deliver,failLog=false){
 const store=fixture(),jobs=[],events=[];
 const contract=load('src/lib/applicationContract.ts').exports;
 const route=load('src/app/api/site/applications/route.ts',{
  'next/server':{NextResponse,after:fn=>jobs.push(fn)},
  '@/lib/applicationContract':contract,
  '@/lib/siteBridgeAuth':{hasSiteBridgeToken:()=>true,siteBridgeClientIp:()=> '203.0.113.25'},
  '@/lib/applicationsStore':store.applications,
  '@/lib/applicationDelivery':{processApplicationDelivery:deliver},
  '@/lib/security':{assertRequestBodySize:()=>null,checkRateLimit:()=>({ok:true}),getClientIp:()=> '203.0.113.25',logDashboardEvent:(level,event)=>{if(failLog)throw Error('Log unavailable');events.push(event);},safeErrorMessage:()=> 'safe-error'},
  '@/lib/publicSiteBridge':{isAllowedPublicSiteOrigin:()=>true,publicSiteCorsHeaders:()=>({'Cache-Control':'no-store'})},
 },{URL}).exports;
 const submit=()=>route.POST(new NextRequest('http://dashboard:3000/api/site/applications',{method:'POST',headers:{Origin:'https://lihvodruida.pp.ua','Content-Type':'application/json'},body:JSON.stringify(input)}));
 return {...store,jobs,events,submit};
}
(async()=>{
 let count=0;async function check(name,fn){await fn();count++;console.log('PASS '+name);}
 await check('committed application returns its receipt while Discord is still blocked',async()=>{
  let release,deliveries=0;const f=setup(()=>{deliveries++;return new Promise(resolve=>release=resolve);});
  let timer;const response=await Promise.race([f.submit(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Receipt is blocked by Discord')),250))]).finally(()=>clearTimeout(timer));
  assert.equal(response.status,201);const receipt=await response.json();assert.ok(receipt.tracking_number);assert.equal(f.jobs.length,1);assert.equal(deliveries,0);
  const job=f.jobs[0]();await Promise.resolve();assert.equal(deliveries,1);release({state:'retry'});await job;
  const repeated=await f.submit();assert.equal(repeated.status,200);assert.equal((await repeated.json()).tracking_number,receipt.tracking_number);assert.equal(f.jobs.length,1);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('guildApplications/')).length,1);
 });
 await check('Discord rejection after commit never becomes an application creation error',async()=>{
  const f=setup(async()=>{throw Error('Discord configuration unavailable');});
  const response=await f.submit();assert.equal(response.status,201);await f.jobs[0]();assert.ok(f.events.includes('public_site.applications.discord_notify_failed'));assert.ok(!f.events.includes('public_site.applications.create_failed'));
 });
 await check('logging outages cannot undo a committed receipt or reject background completion',async()=>{
  const f=setup(async()=>({ok:false,reason:'unavailable'}),true);
  const first=await f.submit();assert.equal(first.status,201);const receipt=await first.json();await f.jobs[0]();const second=await f.submit();assert.equal(second.status,200);assert.equal((await second.json()).tracking_number,receipt.tracking_number);
 });
 console.log(`[check-application-delivery] OK — ${count}/${count}; controlled store and Discord, no external sends`);
})().catch(error=>{console.error(error);process.exit(1);});
