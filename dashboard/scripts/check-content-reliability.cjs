const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const fixture=require('./check-site-integration.cjs');
const load=require('./lib/load-server-ts.cjs');
let passed=0;
const input={kind:'news',slug:'reliable',status:'draft',title:'Reliability fixture',description:'',body:'',categories:'',tags:'',author:'Editor',user:{id:'editor-one',name:'Editor'}};
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await check('deleting and recreating an address cannot make an old editor valid again',async()=>{
  const f=fixture(),first=await f.content.createSiteContent(input);await f.content.deleteSiteContent(first.path,first.revision);const next=await f.content.createSiteContent({...input,title:'Different article'});assert.notEqual(next.revision,first.revision);
  await assert.rejects(f.content.updateSiteContent({...input,path:first.path,expectedRevision:first.revision}),e=>e.code==='revision_conflict');await assert.rejects(f.content.deleteSiteContent(first.path,first.revision),e=>e.code==='revision_conflict');assert.equal((await f.content.getSiteContent(next.path)).title,'Different article');
 });
 await check('legacy numeric revisions remain readable and are upgraded on the next successful edit',async()=>{
  const f=fixture();f.rows.set('siteArticles/news:reliable',{...input,user:undefined,revision:7,date:'2026-10-16'});const item=await f.content.getSiteContent('_news/reliable.md');assert.equal(item.sha,'7');const updated=await f.content.updateSiteContent({...input,path:item.path,expectedRevision:'7'});assert.match(updated.revision,/^[a-f0-9-]{36}$/);await assert.rejects(f.content.deleteSiteContent(item.path,'7'),e=>e.code==='revision_conflict');
 });
 await check('simultaneous retries create one article and return the same committed receipt',async()=>{
  const f=fixture(),requestId=randomUUID();const results=await Promise.all(Array.from({length:12},()=>f.content.createSiteContent({...input,requestId})));assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(new Set(results.map(r=>r.revision)).size,1);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('siteArticles/')).length,1);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('siteContentOperations/')).length,1);
 });
 await check('operation identity is bound to the editor and exact normalized content',async()=>{
  const f=fixture(),requestId=randomUUID();await f.content.createSiteContent({...input,requestId});await assert.rejects(f.content.createSiteContent({...input,requestId,title:'Different content'}),e=>e.code==='request_mismatch');const other=await f.content.createSiteContent({...input,slug:'other',requestId,user:{id:'editor-two',name:'Other editor'}});assert.equal(other.duplicate,false);
 });
 await check('a retry after deletion or a later edit cannot resurrect or overwrite the article',async()=>{
  const f=fixture(),requestId=randomUUID(),created=await f.content.createSiteContent({...input,requestId});await f.content.updateSiteContent({...input,path:created.path,expectedRevision:created.revision,title:'Changed later'});await assert.rejects(f.content.createSiteContent({...input,requestId}),e=>e.code==='operation_superseded');const latest=await f.content.getSiteContent(created.path);await f.content.deleteSiteContent(created.path,latest.sha);await assert.rejects(f.content.createSiteContent({...input,requestId}),e=>e.code==='operation_superseded');assert.equal(await f.content.getSiteContent(created.path),null);
 });
 await check('malformed operation identifiers cannot allocate operation records',async()=>{const f=fixture();await assert.rejects(f.content.createSiteContent({...input,requestId:'../../another-record'}),e=>e.code==='invalid_request_id');assert.equal(f.rows.size,0);});
 await check('malformed list payload is rejected before replacing a valid library snapshot',()=>{
  const client=load('src/components/content/client.ts',{}, {AbortSignal,TextEncoder,crypto:require('node:crypto').webcrypto}).exports;
  assert.throws(()=>client.parseContentLibrary({items:null,checkedAt:new Date().toISOString()}));assert.throws(()=>client.parseContentLibrary({items:[{title:'broken'}],checkedAt:new Date().toISOString()}));assert.equal(client.parseContentLibrary({items:[],checkedAt:new Date().toISOString()}).items.length,0);
 });
 await check('multipart fingerprint ignores random boundaries and hashes selected image bytes',async()=>{
  const client=load('src/components/content/client.ts',{}, {AbortSignal,TextEncoder,crypto:require('node:crypto').webcrypto}).exports;
  const form=bytes=>{const f=new FormData();f.set('title','Title');f.set('image',new File([bytes],'cover.png',{type:'image/png'}));return f;};assert.equal(await client.contentCreationFingerprint(form('abc')),await client.contentCreationFingerprint(form('abc')));assert.notEqual(await client.contentCreationFingerprint(form('abc')),await client.contentCreationFingerprint(form('abd')));
 });
 console.log(`[check-content-reliability] OK — ${passed}/${passed}`);
})().catch(e=>{console.error(e);process.exit(1)});
