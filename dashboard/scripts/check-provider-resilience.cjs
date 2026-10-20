const assert=require('node:assert/strict'),fs=require('node:fs'),{createHmac}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),load=require('./lib/load-server-ts.cjs');
let now=Date.now(),count=0,requests=0,tokenCalls=0,validations=0,helixCalls=0,timer,unref=false,mode='',posts=[],revokedToken='';
class Clock extends Date{constructor(v){super(v===undefined?now:v)}static now(){return now;}}
const env={STREAMER_TWITCH_CLIENT_ID:'client',STREAMER_TWITCH_CLIENT_SECRET:'secret',STREAMER_YOUTUBE_API_KEY:'key',STREAMER_TWITCH_EVENTSUB_SECRET:'s'.repeat(64),STREAMER_TWITCH_EVENTSUB_CALLBACK:'https://guild.example/api/integrations/twitch/eventsub'};
const globals={Date:Clock,Error,process:{env},fetch:fixture,setTimeout:(fn,ms)=>{if(ms===55*60000){timer=fn;return {unref(){unref=true;}};}return setTimeout(fn,ms);},clearTimeout:t=>{if(typeof t?.unref!=='function'||t.constructor?.name==='Timeout')clearTimeout(t);}};
const json=(v,status=200,headers={})=>Response.json(v,{status,headers});
async function fixture(url,init={}){
 requests++;const u=new URL(String(url));
 if(u.pathname.endsWith('/token')){tokenCalls++;return json({access_token:'token-'+tokenCalls,expires_in:8*3600});}
 if(u.pathname.endsWith('/validate')){validations++;return json({client_id:mode==='bad-validation'?'other':env.STREAMER_TWITCH_CLIENT_ID,scopes:[],expires_in:8*3600});}
 if(u.hostname==='api.twitch.tv'){
  helixCalls++;
  if(revokedToken&&new Headers(init.headers).get('authorization')===revokedToken)return json({error:'Unauthorized'},401);
  if(mode==='vod429'&&u.pathname.endsWith('/videos'))return json({error:'limited'},429,{'retry-after':'600'});
  if(u.pathname.endsWith('/eventsub/subscriptions')){if(init.method==='POST'){posts.push(JSON.parse(init.body));return json({data:[{id:'sub-'+posts.length}]},202);}return json({data:[],pagination:{}});}
  if(u.pathname.endsWith('/streams'))return json({data:[{id:'777',user_id:'123',user_login:'sebas',title:'Наш рейд',started_at:new Clock(now-5000).toISOString(),thumbnail_url:'https://static-cdn.jtvnw.net/previews-ttv/live_user_sebas-{width}x{height}.jpg',game_name:'World of Warcraft',viewer_count:0}]});
  if(u.pathname.endsWith('/videos'))return json({data:[]});
 }
 if(u.hostname==='www.googleapis.com')return mode==='quota'&&u.pathname.endsWith('/search')?json({error:{errors:[{reason:'quotaExceeded'}]}},403):json({items:[]});
 if(mode==='large429')return json({error:'SECRET'},429,{'retry-after':'600'});
 if(mode==='exhausted')return json({data:[]},200,{'ratelimit-remaining':'0','ratelimit-reset':String((now+900000)/1000),'retry-after':'120'});
 return new Response('<html>SECRET</html>',{headers:{'content-type':'text/html'}});
}
async function check(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
 const engine=new PGlite();await engine.exec(fs.readFileSync('src/lib/db/schema.sql','utf8'));
 const pool={hasPostgresConfig:()=>true,pgQuery:async(sql,values=[],client)=>{const r=await (client||engine).query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length};}};
 const body=load('src/lib/httpBody.ts',{},globals).exports;
 const api=load('src/lib/apiHttp.ts',{'@/lib/httpBody':body},globals).exports;
 const cd=load('src/lib/providerCooldown.ts',{'@/lib/apiHttp':api,'@/lib/db/pgPool':pool},globals).exports;
 const http=load('src/lib/providerHttp.ts',{'@/lib/apiHttp':api,'@/lib/providerCooldown':cd},globals).exports;
 const contract=load('src/lib/streamers/contract.ts',{},globals).exports;
 const problems=load('src/lib/streamers/problems.ts',{},globals).exports;
 const input=load('src/lib/streamers/channel-input.ts',{'./contract':contract,'./problems':problems},globals).exports;
 const providers=load('src/lib/streamers/providers.ts',{'@/lib/apiHttp':api,'@/lib/httpBody':body,'@/lib/providerHttp':http,'@/lib/providerCooldown':cd,'./contract':contract,'./channel-input':input},globals).exports;
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
  const failed=load('src/lib/providerCooldown.ts',{'@/lib/apiHttp':api,'@/lib/db/pgPool':{hasPostgresConfig:()=>true,pgQuery:async()=>{throw Error('SECRET-DB-URL');}}},globals).exports;await assert.rejects(failed.checkProviderPause({provider:'twitch',key:'fail'}),e=>e.status===503&&!e.message.includes('SECRET'));
 });
 await check('Twitch exhausted success uses the later header reset and normalized client scope',async()=>{
  mode='exhausted';await http.providerFetchJson('https://test.example/exhausted',{onResponse:r=>cd.observeProviderHeaders({provider:'twitch',key:'test-twitch'},r)});await assert.rejects(cd.checkProviderPause({provider:'twitch',key:'test-twitch'}),e=>e.retryAt===now+900250);assert.deepEqual(cd.providerScope('https://api.twitch.tv/helix/streams',{'Client-Id':' client '}),cd.providerScope('https://api.twitch.tv/helix/videos',{'Client-Id':'client'}));mode='';
 });
 await check('YouTube search quota leaves data reads available and respects Pacific midnight including DST',async()=>{
  mode='quota';const search='https://www.googleapis.com/youtube/v3/search?key=yt';await assert.rejects(http.providerFetchJson(search));const start=requests;await assert.rejects(http.providerFetchJson(search),e=>e.status===429);assert.equal(requests,start);await http.providerFetchJson('https://www.googleapis.com/youtube/v3/videos?key=yt');mode='';
  for(const date of ['2026-03-08T08:30:00Z','2026-11-01T07:30:00Z']){const t=Date.parse(date),reset=cd.pacificQuotaReset(t);assert.ok(reset>t&&reset-t<=26*3600000+60000);assert.match(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(reset),/^00:01$/);}
 });
 await check('parallel Twitch consumers use one validated token and retain actual thumbnail, category and zero viewers',async()=>{
  const start=tokenCalls,validated=validations;const observations=await Promise.all(Array.from({length:8},()=>providers.observeProvider({platform:'twitch',handle:'sebas',providerId:'123'},false,undefined,undefined,{videos:false})));assert.equal(tokenCalls,start+1);assert.equal(validations,validated+1);assert.equal(observations[0].live.thumbnailUrl,'https://static-cdn.jtvnw.net/previews-ttv/live_user_sebas-1280x720.jpg?streamer_media=777');assert.equal(observations[0].live.viewers,0);assert.equal(observations[0].live.game,'World of Warcraft');assert.equal(unref,true);
 });
 await check('55 minute validation runs detached from an already completed request budget',async()=>{
  const start=validations;now+=55*60000;timer();for(let i=0;i<12;i++)await new Promise(setImmediate);assert.equal(validations,start+1);
 });
 await check('mismatched client ID never reaches Helix and negative caching prevents token storms',async()=>{
  env.STREAMER_TWITCH_CLIENT_ID='new-client';mode='bad-validation';const h=helixCalls,t=tokenCalls;await Promise.all(Array.from({length:5},()=>assert.rejects(providers.observeProvider({platform:'twitch',handle:'sebas',providerId:'123'}),/provider_authorization/)));await assert.rejects(providers.observeProvider({platform:'twitch',handle:'sebas',providerId:'123'}));assert.equal(helixCalls,h);assert.equal(tokenCalls,t+1);mode='';env.STREAMER_TWITCH_CLIENT_ID='client-restored';
 });
 await check('concurrent revoked-token 401 responses share one validated replacement',async()=>{
  await providers.observeProvider({platform:'twitch',handle:'sebas',providerId:'123'},false,undefined,undefined,{videos:false});revokedToken='Bearer token-'+tokenCalls;const start=tokenCalls;
  await Promise.all(Array.from({length:8},()=>providers.observeProvider({platform:'twitch',handle:'sebas',providerId:'123'},false,undefined,undefined,{videos:false})));assert.equal(tokenCalls,start+1);revokedToken='';
 });
 const message=load('src/lib/streamers/message.ts',{'./contract':contract},globals).exports;
 await check('every platform has an explicit preview image; invalid URLs fall back to a safe text card',async()=>{
  const images={twitch:'https://static-cdn.jtvnw.net/a.jpg',youtube:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',tiktok:'https://p16.tiktokcdn.com/a.jpg?signature=test'};
  for(const [platform,thumbnailUrl] of Object.entries(images)){const event={memberName:'Sebas',platform,kind:platform==='tiktok'?'video':'live',media:{id:'777',title:'Title',url:'https://example.com',publishedAt:new Clock().toISOString(),thumbnailUrl,viewers:0}};const payload=message.streamerDiscordMessage(event,'nonce');assert.equal(payload.embeds[0].image.url,thumbnailUrl);assert.deepEqual(JSON.parse(JSON.stringify(payload.allowed_mentions)),{parse:[],users:[],roles:[],replied_user:false});assert.equal(message.streamerDiscordMessage({...event,media:{...event.media,thumbnailUrl:'http://127.0.0.1/private'}},'nonce').embeds[0].image,undefined);}
 });
 const adapter=load('src/lib/db/documentStore.ts',{'@/lib/db/pgPool':{...pool,pgTransaction:fn=>engine.transaction(client=>fn(client))}},globals).exports,db=new adapter.PgDocumentStore();
 const account={id:'account',enabled:true,platform:'twitch',providerId:'123',revision:'rev',state:{nextCheckAt:now+600000}};
 await db.collection('guildStreamers').doc(account.id).set(account);
 const eventsub=load('src/lib/streamers/eventsub.ts',{'@/lib/httpBody':body,'@/lib/documentDb':{getDocumentDb:()=>db},'./store':{ACCOUNTS:'guildStreamers',streamerAccounts:async()=>[account],streamerSettings:async()=>({enabled:true})},'./providers':providers},globals).exports;
 const event={subscription:{id:'sub',type:'stream.online',version:'1',condition:{broadcaster_user_id:'123'}},event:{id:'777',broadcaster_user_id:'123',started_at:new Clock(now-1000).toISOString()}};
 function signed(data=event,id='id-1',at=now,type='notification'){const raw=JSON.stringify(data),timestamp=new Clock(at).toISOString();return new Request(env.STREAMER_TWITCH_EVENTSUB_CALLBACK,{method:'POST',body:raw,headers:{'content-type':'application/json','twitch-eventsub-message-id':id,'twitch-eventsub-message-timestamp':timestamp,'twitch-eventsub-message-type':type,'twitch-eventsub-subscription-type':'stream.online','twitch-eventsub-subscription-version':'1','twitch-eventsub-message-signature':'sha256='+createHmac('sha256',env.STREAMER_TWITCH_EVENTSUB_SECRET).update(id+timestamp+raw).digest('hex')}});}
 await check('signed EventSub challenge returns the challenge, notification persists a due flag, duplicate cannot replay',async()=>{
  assert.equal((await eventsub.acceptTwitchEvent(signed({...event,challenge:'challenge'},'challenge',now,'webhook_callback_verification'))).challenge,'challenge');assert.equal((await eventsub.acceptTwitchEvent(signed())).accountId,'account');assert.equal((await db.collection('guildStreamers').doc('account').get()).data().state.nextCheckAt,0);assert.equal((await eventsub.acceptTwitchEvent(signed())).accountId,'');
 });
 await check('forged, stale and oversized EventSub messages are rejected before creating work',async()=>{
  const forged=signed();forged.headers.set('twitch-eventsub-message-signature','sha256='+'0'.repeat(64));await assert.rejects(eventsub.acceptTwitchEvent(forged),e=>e.status===403);await assert.rejects(eventsub.acceptTwitchEvent(signed(event,'old',now-601000)),e=>e.status===403);await assert.rejects(eventsub.acceptTwitchEvent(signed({...event,padding:'x'.repeat(70000)})),e=>e.code==='body_limit');
 });
 await check('subscription reconciliation creates online/offline once, with the exact callback and secret',async()=>{
  await eventsub.ensureTwitchSubscriptions();assert.equal(posts.length,2);assert.deepEqual(posts.map(p=>p.type),['stream.online','stream.offline']);assert.ok(posts.every(p=>p.transport.callback===env.STREAMER_TWITCH_EVENTSUB_CALLBACK&&p.transport.secret===env.STREAMER_TWITCH_EVENTSUB_SECRET));await eventsub.ensureTwitchSubscriptions();assert.equal(posts.length,2);
 });
 await check('a partial Twitch videos 429 retains confirmed LIVE and its full absolute retry time',async()=>{
  mode='vod429';const observation=await providers.observeProvider({platform:'twitch',handle:'sebas',providerId:'123'});assert.equal(observation.live.id,'777');assert.equal(observation.warning,'videos_unavailable');assert.equal(observation.retryAt,now+600000);mode='';
 });
 console.log(`[check-provider-resilience] ${count}/${count} passed; real modules and PGlite, controlled HTTP only`);
 }finally{await engine.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
