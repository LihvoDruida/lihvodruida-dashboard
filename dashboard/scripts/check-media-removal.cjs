const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{
 for(const file of ['src/lib/streamers','src/components/streamers','src/app/dashboard/streamers','src/app/api/dashboard/streamers','src/app/api/site/streamers','src/app/api/integrations/twitch'])assert.ok(!fs.existsSync(path.join(root,file)),file+' remains');
 for(const file of ['src/proxy.ts','src/components/AdminTabs.tsx','src/lib/automationTaskCatalog.ts','src/app/api/site/status/route.ts','../deploy/cron/run-cron.sh','.env.example','next.config.mjs'])assert.doesNotMatch(read(file),/streamers|STREAMER_|eventsub/i,file);
 assert.match(read('src/components/LoginBackground.tsx'),/mountLoginVideoBackground/);
 for(const scene of ['Hyjal02','Zephras_01','WowF_TheBarrens_01'])for(const size of [640,1280])assert.ok(fs.statSync(path.join(root,`public/assets/video/auth/${scene}-${size}.mp4`)).size>0);
 for(const name of ['access','status','discordInteractionDedupe'])assert.ok(!fs.existsSync(path.join(root,`src/lib/${name}.ts`)));
 const db=new PGlite();
 try{
  await db.exec(read('src/lib/db/schema.sql'));
  const lease='publication_'+createHash('sha256').update(JSON.stringify('streamer:event-a')).digest('hex');
  const removed=[
   ['guildStreamers','account',{token:'fixture-only'}],['guildStreamerEvents','event-a',{}],['guildStreamerIdentities','identity',{}],['streamerProviderQuota','quota',{}],['streamerTwitchSignals','signal',{}],
   ['dashboardSettings','guildStreamers',{}],['automationLeases','guild-streamers',{}],['automationTaskRuns','guild-streamers',{}],['automationLeases',lease,{}],
   ['discordPublications','stream',{kind:'guild-streamer',resourceId:'event-a'}],
   ...['twitch','youtube','tiktok'].map(p=>['externalApiCooldowns',p+':credential',{}]),
  ];
  const kept=[['dashboardProfiles','member',{name:'Sebas'}],['dashboardSettings','discord',{}],['automationTaskRuns','guild-sync',{}],['automationLeases','guild-sync',{}],['automationLeases','publication_unrelated',{}],['discordPublications','raid',{kind:'raid',resourceId:'raid-a'}],['externalApiCooldowns','raiderio',{retryAt:123}],['externalApiCooldowns','battlenet:credential',{}],['raids','raid-a',{}],['siteContent','article',{}]];
  for(const [collection,id,data] of [...removed,...kept])await db.query('INSERT INTO documents(collection,doc_id,data) VALUES($1,$2,$3)',[collection,id,JSON.stringify(data)]);
  for(const [id,event,resource] of [['stream','streamers.check.ok','guild-streamer'],['old-stream','streamers.settings.saved',null],['auth','auth.login','profile'],['raid','raids.created','raid']])await db.query("INSERT INTO system_logs(id,level,category,event,resource_type) VALUES($1,'info','system',$2,$3)",[id,event,resource]);
  const sql=read('scripts/sql/remove-media.sql');
  await db.exec('BEGIN');await db.query(sql);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT * FROM documents')).rows.length,removed.length+kept.length,'preview must roll back');
  const summary=(await db.query(sql)).rows;
  assert.equal(summary.reduce((n,r)=>n+r.removed,0),removed.length+2);
  const remaining=(await db.query('SELECT collection,doc_id,data FROM documents ORDER BY collection,doc_id')).rows;
  assert.deepEqual(remaining,kept.map(([collection,doc_id,data])=>({collection,doc_id,data})).sort((a,b)=>a.collection.localeCompare(b.collection)||a.doc_id.localeCompare(b.doc_id)));
  assert.deepEqual((await db.query('SELECT id FROM system_logs ORDER BY id')).rows.map(r=>r.id),['auth','raid']);
  assert.equal((await db.query(sql)).rows.reduce((n,r)=>n+r.removed,0),0,'rerun must be idempotent');
  console.log('[check-media-removal] PASS: streamer module absent; video background preserved; SQL preview, scoped deletion, shared-data preservation and idempotency');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
