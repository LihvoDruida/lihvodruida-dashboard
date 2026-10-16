const assert=require('node:assert/strict');
const load=require('./lib/load-server-ts.cjs');
const {NextResponse}=require('next/server');
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
function fixture(){
 const rows=new Map(),media=new Map();let queue=Promise.resolve(),inTransaction=false;
 const key=r=>r.collection+'/'+r.id;
 const snapshot=r=>({id:r.id,ref:r,exists:rows.has(key(r)),data:()=>structuredClone(rows.get(key(r)))});
 function collection(name){return {doc(id){const r={collection:name,id};return {...r,get:async()=>snapshot(r),create:async value=>{if(rows.has(key(r)))throw Error('exists');rows.set(key(r),structuredClone(value));},set:async value=>rows.set(key(r),structuredClone(value)),delete:async()=>rows.delete(key(r))}},limit(){return this},orderBy(){return this},get:async()=>({docs:[...rows.keys()].filter(k=>k.startsWith(name+'/')).map(k=>snapshot({collection:name,id:k.slice(name.length+1)}))})};}
 const db={collection,runTransaction(fn){const result=queue.then(async()=>{inTransaction=true;try{const writes=[];const tx={get:async r=>snapshot(r),set:(r,v)=>writes.push(()=>rows.set(key(r),structuredClone(v))),create:(r,v)=>writes.push(()=>{if(rows.has(key(r)))throw Error('exists');rows.set(key(r),structuredClone(v));}),delete:r=>writes.push(()=>rows.delete(key(r)))};const result=await fn(tx);const before=new Map(rows);try{for(const write of writes)write();}catch(error){rows.clear();for(const [k,v] of before)rows.set(k,v);throw error;}return result;}finally{inTransaction=false;}});queue=result.catch(()=>{});return result;}};
 const database={'@/lib/documentDb':{getDocumentDb:()=>db,documentStoreMode:()=> 'postgres'}};
 const globals={File,URL,structuredClone};
 const {exports:concurrency}=load('src/lib/concurrency.ts');
 const {exports:applications}=load('src/lib/applicationsStore.ts',{...database,'@/lib/db/documentValues':{FieldValue:{serverTimestamp:()=>new Date().toISOString()}},'@/lib/concurrency':concurrency},globals);
 const {exports:contentModel}=load('src/lib/contentModel.ts');
 const {exports:content}=load('src/lib/content.ts',{'@/lib/contentModel':contentModel,...database,'@/lib/permissions':{canManageSiteContent:()=>true},'@/lib/db/pgPool':{pgQuery:async(sql,values)=>{assert.equal(inTransaction,false,'Media cannot require a second pool connection during the article transaction');assert.match(sql,/INSERT INTO site_content_media/);media.set(values[0],{mime_type:values[1],payload:values[2]});return {rows:[]};}}},globals);
 return {rows,media,applications,content};
}
module.exports=fixture;
if(require.main===module)(async()=>{
 await check('PostgreSQL-only store fails closed even when retired credentials exist',()=>{
  const {exports:store}=load('src/lib/documentDb.ts',{'@/lib/db/pgPool':{hasPostgresConfig:()=>false},'@/lib/db/documentStore':{getPgDocumentStore:()=>{throw Error('must not select a fallback')}}},{process:{env:{FIREBASE_PROJECT_ID:'old',FIREBASE_CLIENT_EMAIL:'old',FIREBASE_PRIVATE_KEY:'old'}}});
  assert.equal(store.documentStoreMode(),'unconfigured');assert.throws(store.getDocumentDb,/PostgreSQL is required/);
 });
 await check('concurrent submissions commit one application; distinct contacts retain separate receipts',async()=>{
  const f=fixture();const input={characterName:'Sebas',realm:'Terokkar',region:'eu',faction:'Alliance',className:'Druid',discord:'sebas',sourceCreator:'Лігво Друїда',sourcePlatform:'Twitch',availability:'Увечері після 19:00'};
  const results=await Promise.all(Array.from({length:12},()=>f.applications.createGuildApplication(input)));
  assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(new Set(results.map(r=>r.item.number)).size,1);assert.equal(new Set(results.map(r=>r.item.tracking_number)).size,1);
  assert.equal([...f.rows.keys()].filter(k=>k.startsWith('guildApplications/')).length,1);
  const other=await f.applications.createGuildApplication({...input,discord:'another_person'});assert.equal(other.duplicate,false);assert.notEqual(other.item.tracking_number,results[0].item.tracking_number);
  const publicItem=f.applications.sanitizeApplicationForPublicSite(other.item);assert.equal(publicItem.discord,null);assert.equal(publicItem.battle_tag,null);assert.equal(publicItem.tracking_number,'');
 });
 await check('CMS creates, paginates and renames atomically; revisions block stale edits and deletes',async()=>{
  const f=fixture();const input={kind:'news',title:'News title',slug:'news-01',description:'Description of the news',body:'A complete body for a CMS article.',author:'Admin',categories:'Guild',tags:'WoW, Guild',user:{name:'Admin'}};
  const created=await f.content.createSiteContent(input);assert.equal(created.path,'_news/news-01.md');
  for(let i=2;i<=21;i++)await f.content.createSiteContent({...input,slug:'news-'+String(i).padStart(2,'0')});
  const first=await f.content.publicSiteContent(1),second=await f.content.publicSiteContent(2);assert.equal(first.schema,'mistblossom.public-content.v2');assert.equal(first.items.length,20);assert.equal(second.items.length,1);assert.equal(first.revision,second.revision);assert.equal(first.next_page,2);assert.equal(second.next_page,null);
  const renamed=await f.content.updateSiteContent({...input,path:created.path,slug:'news-renamed',expectedRevision:created.revision});
  assert.equal(f.rows.has('siteArticles/news:news-01'),false);assert.equal(f.rows.get('siteArticles/news:news-renamed').revision,2);
  await assert.rejects(f.content.updateSiteContent({...input,path:'_news/news-renamed.md',slug:'news-renamed',expectedRevision:created.revision}),/іншим редактором/);
  await assert.rejects(f.content.deleteSiteContent('_news/news-renamed.md',created.revision),/уже змінено/);
  await f.content.deleteSiteContent('_news/news-renamed.md',renamed.revision);assert.equal(f.rows.has('siteArticles/news:news-renamed'),false);
  await assert.rejects(f.content.createSiteContent({...input,slug:'unsafe',body:'<script>alert(1)</script> A sufficiently long body.'}),/небезпечний/);
 });
 await check('CMS cover is hashed, stored in PostgreSQL and exported as an origin-independent path',async()=>{
  const f=fixture();const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw7sAAAAASUVORK5CYII=','base64');
  const image=new File([bytes],'cover.png',{type:'image/png'});
  const result=await f.content.createSiteContent({kind:'guides',title:'Guide',slug:'guide',description:'A complete description',body:'A complete guide body goes here.',author:'Admin',categories:'',tags:'',user:{name:'Admin'},image});
  assert.match(result.image,/^\/api\/site\/media\/[a-f0-9]{64}$/);assert.equal(f.media.size,1);assert.equal((await f.content.publicSiteContent()).items[0].image,result.image);
 });
 await check('draft lifecycle hides private text, retains revisions and preserves old published records',async()=>{
  const f=fixture(),input={kind:'news',title:'Draft title',slug:'draft-one',description:'',body:'',author:'Admin',categories:'',tags:'',status:'draft',user:{name:'Admin'}};
  const created=await f.content.createSiteContent(input);assert.equal(created.item.status,'draft');assert.match(created.revision,/^[a-f0-9-]{36}$/);assert.equal((await f.content.publicSiteContent()).total,0);
  assert.equal((await f.content.getSiteContent(created.path)).body,'');
  await assert.rejects(f.content.updateSiteContent({...input,path:created.path,expectedRevision:created.revision,status:'published'}),/довжина/);
  const published=await f.content.updateSiteContent({...input,path:created.path,expectedRevision:created.revision,status:'published',body:'A complete body for publication.',description:'Complete description',date:'2026-10-16'});
  assert.notEqual(published.revision,created.revision);assert.equal((await f.content.publicSiteContent()).total,1);
  const publicRevision=(await f.content.publicSiteContent()).revision;
  await f.content.createSiteContent({...input,slug:'second-draft'});assert.equal((await f.content.publicSiteContent()).revision,publicRevision);
  const hidden=await f.content.updateSiteContent({...input,path:created.path,expectedRevision:published.revision,status:'draft'});assert.notEqual(hidden.revision,published.revision);assert.equal((await f.content.publicSiteContent()).total,0);
  const raw=f.rows.get('siteArticles/news:draft-one');delete raw.status;raw.description='Legacy description';raw.body='A complete legacy body from the previous editor.';
  assert.equal((await f.content.publicSiteContent()).total,1);assert.equal((await f.content.listSiteContent(false))[0].body,'');
  await assert.rejects(f.content.updateSiteContent({...input,path:created.path,expectedRevision:published.revision}),/іншим редактором/);
  await assert.rejects(f.content.createSiteContent({...input,slug:'bad-date',date:'2026-02-31'}),/коректну дату/);
  await assert.rejects(f.content.createSiteContent({...input,slug:'bad-status',status:'scheduled'}),/стан/);
 });
 await check('CMS does not silently lose published articles when more than 500 drafts exist',async()=>{
  const f=fixture();for(let i=0;i<505;i++)f.rows.set('siteArticles/news:draft-'+i,{kind:'news',slug:'draft-'+i,title:'Draft '+i,body:'',status:'draft'});
  f.rows.set('siteArticles/news:visible',{kind:'news',slug:'visible',title:'Visible',body:'Published content',date:'2026-10-16'});
  assert.equal((await f.content.listSiteContent(false)).length,506);assert.equal((await f.content.publicSiteContent()).items[0].slug,'visible');
 });
 await check('missing guild data cannot be advertised as a new empty live snapshot',async()=>{
  let valid=false;
  const producer=load('src/lib/publicSiteBridge.ts',{'@/lib/guildRoster':{loadStoredGuildRosterData:async()=>({members:[],source:valid?'postgres-records':'postgres-records-missing',stats:{updatedAt:valid?new Date().toISOString():null,guildName:'Fixture',guildRealm:'Terokkar',guildFaction:'Alliance',memberCount:0,raidProgression:[],raidRankings:[]}})},'@/lib/raids':{listRaids:async()=>[],raidRosterCounts:()=>({}),raidCapacity:()=>0},'@/lib/security':{splitCsv:()=>[]}}).exports;
  await assert.rejects(producer.buildPublicGuildSnapshot(),/unavailable/);valid=true;assert.equal((await producer.buildPublicGuildSnapshot()).schema,'mistblossom.public-guild.v1');
 });
 await check('bridge readiness refuses missing auth and missing database tables',async()=>{
  let allowed=false,available=false;
  const route=load('src/app/api/site/status/route.ts',{'next/server':{NextResponse},'@/lib/siteBridgeAuth':{hasSiteBridgeToken:()=>allowed},'@/lib/db/pgPool':{pgQuery:async()=>({rows:[{documents:available?'documents':null,media:available?'site_content_media':null}]})}}).exports;
  const req=new Request('http://dashboard:3000/api/site/status');assert.equal((await route.GET(req)).status,403);allowed=true;assert.equal((await route.GET(req)).status,503);available=true;const response=await route.GET(req);assert.equal(response.status,200);assert.equal((await response.json()).protocol,'mistblossom.site-bridge.v2');
 });
 console.log(`[check-site-integration] OK — ${passed}/${passed}`);
})().catch(error=>{console.error(error);process.exit(1)});
