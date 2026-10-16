const assert=require('node:assert/strict');
const setup=require('./lib/application-delivery-fixture.cjs');
(async()=>{
 const f=await setup();let count=0;
 async function check(name,run){f.fault(null);f.mode('');await run();count++;console.log('PASS '+name);}
 try{
  await check('application and outbox commit atomically; a failed queue insert leaves no application',async()=>{
   const before=(await f.store.collection('guildApplications').get()).size;
   f.fault((sql,values)=>{if(sql.startsWith('INSERT')&&values[0]==='guildApplicationDeliveries')throw Error('Queue unavailable');});
   await assert.rejects(f.create());f.fault(null);assert.equal((await f.store.collection('guildApplications').get()).size,before);
  });
  await check('duplicate submission returns one receipt and one durable job',async()=>{
   const first=await f.applications.createGuildApplication(f.input),second=await f.applications.createGuildApplication(f.input);
   assert.equal(second.duplicate,true);assert.equal(second.item.number,first.item.number);
   const jobs=await f.store.collection('guildApplicationDeliveries').get();assert.equal(jobs.docs.filter(d=>d.data().number===first.item.number).length,1);
  });
  await check('restart before after callback is recovered by the scheduled drain',async()=>{
   const a=await f.create();const fresh=f.reload();await fresh.worker.processApplicationDeliveryQueue();assert.equal((await f.status(a.item.number)).state,'delivered');
   assert.ok((await f.applications.getIssue(a.item.number)).discord_message_ref?.message_id);
  });
  await check('concurrent workers create one Discord message under a PostgreSQL lease',async()=>{
   const a=await f.create(),before=f.posts();f.mode('hold');const seen=f.held();const first=f.worker.processApplicationDelivery(a.item.number);await seen;
   const second=await f.reload().worker.processApplicationDelivery(a.item.number);assert.equal(second.state,'processing');f.release();assert.equal((await first).state,'delivered');assert.equal(f.posts(),before+1);
  });
  await check('lost Discord acknowledgment is reconciled after reload without another POST',async()=>{
   const a=await f.create(),before=f.posts();f.mode('lost');assert.equal((await f.worker.processApplicationDelivery(a.item.number)).state,'uncertain');f.mode('');
   assert.equal((await f.reload().worker.processApplicationDelivery(a.item.number,{force:true})).state,'delivered');assert.equal(f.posts(),before+1);
  });
  await check('missing history stays uncertain; a valid manual message link recovers without CREATE',async()=>{
   const a=await f.create(),before=f.posts();f.mode('lost');await f.worker.processApplicationDelivery(a.item.number);const message=[...f.messages.values()].at(-1);f.mode('no-history');
   assert.equal((await f.reload().worker.processApplicationDelivery(a.item.number,{force:true})).state,'uncertain');assert.equal(f.posts(),before+1);
   f.mode('');const ref={channelId:message.channel_id,messageId:message.id};assert.equal((await f.worker.processApplicationDelivery(a.item.number,{force:true,manualRef:ref})).state,'delivered');assert.equal(f.posts(),before+1);
  });
  await check('foreign-channel manual reference cannot bind a receipt or cause another CREATE',async()=>{
   const a=await f.create();f.mode('lost');await f.worker.processApplicationDelivery(a.item.number);f.mode('');const before=f.posts();
   const result=await f.worker.processApplicationDelivery(a.item.number,{force:true,manualRef:{channelId:'222222222222222222',messageId:'900000000000000001'}});assert.notEqual(result.state,'delivered');assert.equal(f.posts(),before);
  });
  await check('known message ID survives failed resource commit and resumes without another CREATE',async()=>{
   const a=await f.create(),before=f.posts();f.fault((sql,values)=>{if(sql.startsWith('UPDATE')&&values[0]==='guildApplications'&&String(values[2]).includes('discord_message_ref'))throw Error('Commit failed');});
   await f.worker.processApplicationDelivery(a.item.number);f.fault(null);const previous=await f.publication.getDiscordPublicationOperation('application-message:guildApplications',a.item.id);assert.equal(previous.state,'confirmed');
   assert.equal((await f.reload().worker.processApplicationDelivery(a.item.number,{force:true})).state,'delivered');assert.equal(f.posts(),before+1);
  });
  await check('explicit Discord rejection is persisted with backoff and can retry after correction',async()=>{
   const a=await f.create();f.mode('reject');assert.equal((await f.worker.processApplicationDelivery(a.item.number)).state,'blocked');const before=f.posts();assert.equal((await f.worker.processApplicationDelivery(a.item.number)).state,'blocked');assert.equal(f.posts(),before);f.mode('');
   assert.equal((await f.worker.processApplicationDelivery(a.item.number,{force:true})).state,'delivered');assert.equal(f.posts(),before+1);
  });
  await check('channel changes after delivery commit cannot produce another message on job retry',async()=>{
   const a=await f.create(),before=f.posts();f.fault((sql,values)=>{if(sql.startsWith('UPDATE')&&values[0]==='guildApplicationDeliveries'&&String(values[2]).includes('"state":"delivered"'))throw Error('Job completion lost');});
   await f.worker.processApplicationDelivery(a.item.number);f.fault(null);f.channel('222222222222222222');assert.equal((await f.worker.processApplicationDelivery(a.item.number,{force:true})).state,'delivered');assert.equal(f.posts(),before+1);f.channel('111111111111111111');
  });
  await check('moderation during CREATE is rendered from the latest database state',async()=>{
   const a=await f.create();f.mode('hold');const seen=f.held(),work=f.worker.processApplicationDelivery(a.item.number);await seen;
   await f.store.collection('guildApplications').doc(a.item.id).update({status_key:'accepted',status:'accepted'});f.release();await work;
   const message=[...f.messages.values()].at(-1);assert.ok(message.embeds[0].description.includes('Прийнято'));assert.equal(message.components.length,0);
  });
  await check('deleted application cancels its durable job; uncertain publication blocks deletion',async()=>{
   const a=await f.create(),before=f.posts();await f.applications.deleteGuildApplication(a.item.number);assert.equal((await f.worker.processApplicationDelivery(a.item.number)).state,'cancelled');assert.equal(f.posts(),before);
   const b=await f.create();f.mode('lost');await f.worker.processApplicationDelivery(b.item.number);await assert.rejects(f.worker.assertApplicationDeliveryDeletable(b.item.number,b.item.id));
  });
  await check('read-only delivery status contains no private contacts, payload, nonce or tracking number',async()=>{
   const a=await f.create(),result=JSON.stringify(await f.status(a.item.number));for(const value of ['private-contact','nonce','tracking','availability'])assert.ok(!result.includes(value));assert.equal((await f.worker.readApplicationDelivery(999999)).state,'untracked');
  });
  await check('missing bot credentials leave a durable blocked job without dispatch',async()=>{
   const a=await f.create(),before=f.posts(),token=f.globals.process.env.DISCORD_BOT_TOKEN;f.globals.process.env.DISCORD_BOT_TOKEN='';
   try{assert.equal((await f.worker.processApplicationDelivery(a.item.number)).state,'blocked');assert.equal(f.posts(),before);}finally{f.globals.process.env.DISCORD_BOT_TOKEN=token;}
  });
  await check('429 is persisted for a later retry without immediate POST replay',async()=>{
   const a=await f.create(),before=f.posts();f.mode('rate');const result=await f.worker.processApplicationDelivery(a.item.number);assert.equal(result.state,'retry');assert.equal(f.posts(),before+1);await f.worker.processApplicationDelivery(a.item.number);assert.equal(f.posts(),before+1);
  });
  await check('scheduled drain selects at most three due jobs and excludes completed work',async()=>{
   const jobs=await f.store.collection('guildApplicationDeliveries').get();for(const d of jobs.docs)if(d.data().dueAtMs)await d.ref.update({dueAtMs:Date.now()+3_600_000});
   for(let n=0;n<5;n++)await f.create();const before=f.posts(),result=await f.worker.processApplicationDeliveryQueue();assert.equal(result.processed,3);assert.equal(f.posts(),before+3);
  });
  await check('delivery GET is read-only, POST enforces role, Origin, body bounds and official message URLs',async()=>{
   const a=await f.create(),context={params:Promise.resolve({number:String(a.item.number)})},before=f.posts();
   const request=(body={},origin='https://guild.test')=>new Request('https://guild.test/api/applications/'+a.item.number+'/delivery',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const read=()=>f.deliveryRoute.GET(request(),context);assert.equal((await read()).status,200);assert.equal(f.posts(),before);
   f.auth(null);assert.equal((await read()).status,401);f.auth({id:'officer'});f.manage(false);assert.equal((await read()).status,403);assert.equal((await f.deliveryRoute.POST(request(),context)).status,403);f.manage(true);
   assert.equal((await f.deliveryRoute.POST(request({},'https://evil.test'),context)).status,403);
   assert.equal((await f.deliveryRoute.POST(request({messageUrl:'x'.repeat(3000)}),context)).status,413);
   for(const messageUrl of ['https://evil.test/discord.com/channels/333333333333333333/111111111111111111/900000000000000001','https://discord.com/channels/555555555555555555/111111111111111111/900000000000000001','javascript:alert(1)'])assert.equal((await f.deliveryRoute.POST(request({messageUrl}),context)).status,400);
   assert.equal(f.posts(),before);
  });
  await check('cron read probe never drains work; invalid service auth cannot run the worker',async()=>{
   const request=new Request('http://dashboard:3000/api/dashboard/discord/applications/automation');const before=f.posts();assert.equal((await f.cron.GET(request)).status,200);assert.equal(f.posts(),before);f.internal(false);assert.equal((await f.cron.POST(request)).status,401);assert.equal(f.posts(),before);f.internal(true);
  });
  await check('owner deletion shares the delivery lease and removes terminal receipt payload',async()=>{
   f.auth({id:'owner',isServerOwner:true});const a=await f.create();f.mode('hold');const seen=f.held(),work=f.worker.processApplicationDelivery(a.item.number);await seen;
   const context={params:Promise.resolve({number:String(a.item.number)})},request=()=>new Request('https://guild.test/api/applications/'+a.item.number,{method:'DELETE',headers:{Origin:'https://guild.test'}});
   assert.equal((await f.deleteRoute.DELETE(request(),context)).status,409);assert.ok((await f.applications.getIssue(a.item.number)).number);f.release();await work;
   const issue=await f.applications.getIssue(a.item.number),messageId=issue.discord_message_ref.message_id;assert.equal((await f.deleteRoute.DELETE(request(),context)).status,200);assert.ok(!f.messages.has(messageId));assert.equal(await f.publication.getDiscordPublicationOperation('application-message:guildApplications',a.item.id),undefined);assert.equal((await f.status(a.item.number)).state,'cancelled');f.auth({id:'officer'});
  });
  console.log(`[check-application-queue] OK — ${count}/${count}; actual PostgreSQL WASM, document adapter, leases, publication, Discord REST; no external messages`);
 }finally{await f.close();}
})().catch(error=>{console.error(error);process.exit(1)});
