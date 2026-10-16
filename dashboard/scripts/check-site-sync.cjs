const assert=require('node:assert/strict'),load=require('./lib/load-server-ts.cjs'),{NextResponse}=require('next/server');
(async()=>{
 let passed=0,allowed=false,calls=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 const captured=[];
 const rows=['guild','applications','content'].map(resource=>({resource,revision:'a'.repeat(32)}));
 const sync=load('src/lib/siteSync.ts',{'@/lib/db/pgPool':{pgQuery:async(sql,values)=>{calls++;captured.push({sql,values});return {rows};}}},{process:{env:{STORAGE_APPLICATIONS_COLLECTION:'customApplications'}}}).exports;
 const route=load('src/app/api/site/sync/route.ts',{'next/server':{NextResponse},'@/lib/siteBridgeAuth':{hasSiteBridgeToken:()=>allowed},'@/lib/siteSync':sync}).exports;
 await check('revision probe requires service authentication before database access',async()=>{assert.equal((await route.GET(new Request('http://dashboard:3000/api/site/sync'))).status,403);assert.equal(calls,0);allowed=true;const response=await route.GET(new Request('http://dashboard:3000/api/site/sync'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();assert.equal(body.schema,'mistblossom.public-sync.v1');assert.deepEqual(Object.keys(body.resources).sort(),['applications','content','guild']);assert.ok(!JSON.stringify(body).includes('customApplications'));});
 await check('probe binds configured application collection and never selects contact or article bodies',()=>{assert.deepEqual(Array.from(captured[0].values),['customApplications']);assert.ok(captured[0].sql.includes('xmin::text'));assert.ok(!/SELECT\s+(?:\*|data\s*,)/i.test(captured[0].sql));});
 if(process.env.SITE_SYNC_PG_MODULE){
  const {PGlite}=require(process.env.SITE_SYNC_PG_MODULE),db=new PGlite();
  try{
   await db.exec('CREATE TABLE documents(collection text NOT NULL,doc_id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(collection,doc_id));');
   await db.exec("CREATE INDEX documents_site_published_headers_idx ON documents(doc_id,updated_at) WHERE collection='siteArticles' AND COALESCE(data->>'status','published')='published';");
   const live=load('src/lib/siteSync.ts',{'@/lib/db/pgPool':{pgQuery:(sql,values)=>db.query(sql,values)}},{process:{env:{STORAGE_APPLICATIONS_COLLECTION:'customApplications'}}}).exports;
   const revision=async()=> (await live.publicSiteSync()).resources;
   let before=await revision();
   await check('actual PostgreSQL SQL excludes drafts and detects publication',async()=>{await db.query('INSERT INTO documents(collection,doc_id,data) VALUES ($1,$2,$3)', ['siteArticles','news:one',JSON.stringify({status:'draft',body:'private draft'})]);assert.equal((await revision()).content,before.content);await db.exec("UPDATE documents SET data=data||'{\"status\":\"published\"}'::jsonb WHERE collection='siteArticles';");assert.notEqual((await revision()).content,before.content);before=await revision();});
   await check('row version detects direct SQL edits even without an updated_at change',async()=>{await db.exec("UPDATE documents SET data=data||'{\"body\":\"Edited body\"}'::jsonb WHERE collection='siteArticles';");assert.notEqual((await revision()).content,before.content);before=await revision();});
   await check('custom applications and roster chunks invalidate only the relevant resource',async()=>{await db.query('INSERT INTO documents(collection,doc_id,data) VALUES ($1,$2,$3)', ['customApplications','one',JSON.stringify({discord:'must-not-leak'})]);let after=await revision();assert.notEqual(after.applications,before.applications);assert.equal(after.content,before.content);assert.ok(!JSON.stringify(await live.publicSiteSync()).includes('must-not-leak'));before=after;await db.query('INSERT INTO documents(collection,doc_id,data) VALUES ($1,$2,$3)', ['guildRosterRecords/eu-test/memberChunks','chunk-1','{}']);after=await revision();assert.notEqual(after.guild,before.guild);assert.equal(after.applications,before.applications);});
   await check('unpublish and delete cannot retain the published resource revision',async()=>{const published=await revision();await db.exec("UPDATE documents SET data=data||'{\"status\":\"draft\"}'::jsonb WHERE collection='siteArticles';");assert.notEqual((await revision()).content,published.content);await db.exec("UPDATE documents SET data=data||'{\"status\":\"published\"}'::jsonb WHERE collection='siteArticles';");const again=await revision();await db.exec("DELETE FROM documents WHERE collection='siteArticles';");assert.notEqual((await revision()).content,again.content);});
  }finally{await db.close();}
 }
 console.log(`[check-site-sync] OK — ${passed}/${passed}; ${process.env.SITE_SYNC_PG_MODULE?'PostgreSQL WASM SQL and authenticated route':'route and transport checks; SQL engine supplied separately'}`);
})().catch(e=>{console.error(e);process.exit(1)});
