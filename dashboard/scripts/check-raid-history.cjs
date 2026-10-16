const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=require('./lib/load-server-ts.cjs'),fixture=require('./lib/raid-season-fixture.cjs');
const {PGlite}=require('@electric-sql/pglite');
let passed=0;async function test(name,run){await run();passed++;console.log('PASS',name)}
(async()=>{
 let snapshot;
 await test('real API fixtures: raid launch week belongs to the M+ season; no future or event seasons',async()=>{
  const f=fixture();snapshot=await f.resolver.resolveRaidSeasonSnapshot();
  assert.ok(snapshot.seasons.find(s=>s.id==='mn-1').raids.includes('tier-mn-1'));
  assert.ok(snapshot.seasons.find(s=>s.id==='tww-1').raids.includes('nerubar-palace'));
  assert.equal(snapshot.seasons.filter(s=>s.current).length,1);assert.equal(snapshot.currentSeasonId,'mn-2');
  assert.ok(snapshot.seasons.every(s=>Date.parse(s.startsAt)<=f.now()));
  assert.ok(!snapshot.seasons.some(s=>s.slug.includes('break-the-meta')));assert.equal(snapshot.partial,false);
  assert.ok(f.maxActive()<=6);const count=f.calls.length;
  assert.equal(await f.resolver.resolveRaidSeasonSnapshot({previous:snapshot}),snapshot);assert.equal(f.calls.length,count);
 });
 await test('partial metadata outage retains a previous expansion without mutating it',async()=>{
  const f=fixture(),prior=structuredClone(snapshot);f.clock(8*86400000);f.fail([10]);
  const result=await f.resolver.resolveRaidSeasonSnapshot({previous:prior});
  assert.equal(result.partial,true);assert.ok(result.catalog['nerubar-palace']);assert.ok(result.seasons.find(s=>s.id==='tww-1'));
  assert.equal(JSON.stringify(prior),JSON.stringify(snapshot));
 });
 await test('current-expansion outage never downgrades the current season to a working old endpoint',async()=>{
  const f=fixture();f.clock(8*86400000);f.fail([11]);const result=await f.resolver.resolveRaidSeasonSnapshot({previous:snapshot});
  assert.equal(result.currentExpansionId,11);assert.equal(result.currentSeasonId,'mn-2');assert.equal(result.source,'cached');assert.equal(result.partial,true);
 });
 await test('total outage preserves detection age and all historical metadata',async()=>{
  const f=fixture();f.clock(8*86400000);f.mode('outage');
  const result=await f.resolver.resolveRaidSeasonSnapshot({previous:snapshot});
  assert.equal(result.source,'cached');assert.equal(result.detectedAt,snapshot.detectedAt);assert.equal(result.partial,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.catalog)),JSON.parse(JSON.stringify(snapshot.catalog)));
 });
 await test('429 pauses queued static requests and shares the roster provider cooldown',async()=>{
  const f=fixture();f.mode('rate');const result=await f.resolver.resolveRaidSeasonSnapshot({previous:{...snapshot,checkedAt:'2020-01-01'}});
  assert.equal(result.partial,true);assert.ok(f.calls.length<=3);assert.ok(f.resolverContext.__mistblossomRaiderIoRateLimitState.blockedUntil>f.now());
 });
 const engine=new PGlite();await engine.exec(fs.readFileSync(path.join(__dirname,'../src/lib/db/schema.sql'),'utf8'));
 try{
  const query=async(sql,values=[],client)=>{const r=await(client||engine).query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length}};
  const pool={pgQuery:query,pgTransaction:run=>engine.transaction(tx=>run({query:(sql,values)=>query(sql,values,tx)}))};
  const adapter=load('src/lib/db/documentStore.ts',{'@/lib/db/pgPool':pool}).exports,db=new adapter.PgDocumentStore();
  const database={'@/lib/documentDb':{getDocumentDb:()=>db}};
  const f=fixture(),store=load('src/lib/guildRaidHistoryStore.ts',database,f.globals).exports,roster=f.roster(store);
  let base={members:[],source:'postgres-records',stats:{updatedAt:new Date(f.now()-8*86400000).toISOString(),rosterUpdatedAt:new Date(f.now()-8*86400000).toISOString(),guildName:'Mistblossom Vanguard',guildRealm:'Terokkar',raidProgression:[],raidRankings:[],raidSeasonSnapshot:snapshot,memberCount:0}};
  const old={slug:'tier-mn-1',name:'Tier',totalBosses:9,normalKills:9,heroicKills:7,mythicKills:2};
  await test('partial default guild response retains archive rows and original observation dates',()=>{
   const prior={...base.stats,raidProgression:[old,{...old,slug:'nerubar-palace'}]};
   const result=roster.context.buildStats({guildSummary:{},raiderGuild:f.read('guild'),previousStats:prior,members:[],updatedAt:new Date(f.now()).toISOString(),configuredGuildName:'Mistblossom Vanguard',configuredRealmSlug:'terokkar'});
   assert.ok(result.raidProgression.some(row=>row.slug==='nerubar-palace'));assert.equal(result.raidProgression.find(row=>row.slug==='nerubar-palace').observedAt,prior.rosterUpdatedAt);
   assert.equal(result.raidProgression.find(row=>row.slug==='tier-mn-1').mythicKills,2);
  });
  await test('invalid/missing/fractional counts are unknown; explicit zero is valid',()=>{
   const raw={total_bosses:8,normal_bosses_killed:0,heroic_bosses_killed:0,mythic_bosses_killed:0};
   assert.equal(roster.exports.normalizeRaidProgression({r:raw})[0].mythicKills,0);
   for(const change of [{mythic_bosses_killed:undefined},{mythic_bosses_killed:null},{mythic_bosses_killed:-1},{mythic_bosses_killed:1.5},{mythic_bosses_killed:9},{total_bosses:0}])assert.equal(roster.exports.normalizeRaidProgression({r:{...raw,...change}}).length,0);
  });
  const lease=load('src/lib/automationLease.ts',{...database,'@/lib/storageAccess':{assertStorageWriteAvailable(){}}},f.globals).exports;
  const context={key:'fixture-guild',region:'eu',realmSlug:'terokkar',guildName:'Mistblossom Vanguard',settings:{raiderIoRequestMinDelayMs:0}};
  const worker=()=>load('src/lib/guildRaidHistory.ts',{...database,'@/lib/automationLease':lease,'@/lib/guildRoster':{...roster.exports,getGuildRaidHistoryContext:async()=>context,loadStoredGuildRosterData:async()=>base},'@/lib/raidSeasonResolver':{resolveRaidSeasonSnapshot:async()=>snapshot},'@/lib/guildRaidHistoryStore':store},f.globals).exports;
  const sync=load('src/lib/siteSync.ts',{'@/lib/db/pgPool':pool},f.globals).exports;
  await test('PostgreSQL checkpoint limits each tick to four single-raid requests; public revision changes',async()=>{
   const before=await sync.publicSiteSync();const result=await worker().refreshGuildRaidHistory();
   assert.equal(result.checked,4);const calls=f.calls.filter(c=>c.fields);assert.equal(calls.length,4);
   assert.ok(calls.every(c=>/^raid_progression:[^,:]+,raid_rankings:[^,:]+$/.test(c.fields)));assert.ok(calls.every(c=>c.options.retries===0));
   const after=await sync.publicSiteSync();assert.notEqual(before.resources.guild,after.resources.guild);
   assert.equal(before.resources.content,after.resources.content);assert.equal(before.resources.applications,after.resources.applications);
   const chunks=await query("SELECT * FROM documents WHERE collection LIKE '%memberChunks%'");assert.equal(chunks.rows.length,0);
  });
  await test('worker reload resumes missing raids without re-fetching verified rows',async()=>{
   const initial=await store.readGuildRaidHistory(context.key),count=f.calls.length;await worker().refreshGuildRaidHistory();
   const queried=f.calls.slice(count).filter(c=>c.fields).map(c=>c.fields.split(',')[0].split(':')[1]);assert.ok(queried.length>0&&queried.length<=4);
   assert.ok(queried.every(slug=>!initial.progression[slug]));
  });
  await test('guild identity mismatch never stores another guild progress and obeys retry cooldown',async()=>{
   await db.collection('guildRaidHistory').doc(context.key).delete();f.mode('identity');
   const result=await worker().refreshGuildRaidHistory();assert.equal(result.failed,4);
   const record=await store.readGuildRaidHistory(context.key);assert.equal(Object.keys(record.progression).length,0);
   const failed=new Set(Object.keys(record.checks)),count=f.calls.length;await worker().refreshGuildRaidHistory();
   assert.ok(f.calls.slice(count).every(c=>!failed.has(c.fields.split(',')[0].split(':')[1])));
  });
  await test('failed recheck preserves 2/9M and observation age; duplicate roster cannot hide staleness',async()=>{
   const checkedAt=new Date(f.now()-8*86400000).toISOString();
   await db.collection('guildRaidHistory').doc(context.key).set({schemaVersion:1,identity:{region:'eu',realm:'terokkar',name:'Mistblossom Vanguard'},seasonSnapshot:{...snapshot,catalog:{'tier-mn-1':snapshot.catalog['tier-mn-1']}},progression:{'tier-mn-1':old},rankings:{},checks:{'tier-mn-1':{checkedAt}},updatedAt:checkedAt,attemptedAt:checkedAt});
   base={...base,stats:{...base.stats,raidProgression:[{...old,observedAt:checkedAt}]}};
   f.mode('outage');await worker().refreshGuildRaidHistory();
   const record=await store.readGuildRaidHistory(context.key),merged=store.applyGuildRaidHistory(base,record);
   assert.equal(merged.stats.raidProgression.find(r=>r.slug==='tier-mn-1').mythicKills,2);assert.equal(merged.stats.raidProgression.find(r=>r.slug==='tier-mn-1').observedAt,checkedAt);assert.equal(merged.stats.raidProgression.find(r=>r.slug==='tier-mn-1').stale,true);
  });
  await test('distributed lease rejects concurrent history workers',async()=>{
   const held=await lease.acquireAutomationLease('raid_history_'+context.key,'test');try{const result=await worker().refreshGuildRaidHistory();assert.equal(result.skipped,true);assert.equal(result.reason,'distributed_lease')}finally{await held.release()}
  });
  await test('idle successful tick does not write history or invalidate public guild data',async()=>{
   f.mode('ok');for(let i=0;i<20;i++)await worker().refreshGuildRaidHistory();
   // Failed entries have a deliberate retry delay; expire it before draining.
   f.clock(301000);for(let i=0;i<20;i++)await worker().refreshGuildRaidHistory();
   const before=await sync.publicSiteSync(),count=f.calls.length,result=await worker().refreshGuildRaidHistory(),after=await sync.publicSiteSync();
   assert.equal(result.checked,0);assert.equal(f.calls.length,count);assert.equal(before.resources.guild,after.resources.guild);
  });
 }finally{await engine.close()}
 console.log(`[check-raid-history] ${passed}/${passed} behavioral regressions passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
