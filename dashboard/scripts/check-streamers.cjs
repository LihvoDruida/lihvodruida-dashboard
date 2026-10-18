const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite'),load=require('./lib/load-server-ts.cjs'),{NextRequest,NextResponse}=require('next/server');
let now=Date.now(),memberMissing=false,providerFail=false,live=false,video=1,ytLive=false,discordMode='ok',sent=0,tokenRefreshes=0,role={id:'admin',role:'admin'},origin=true,auditFail=false,httpFailure=null,discordForbidden=false,authFail=false;
class Clock extends Date{constructor(v){super(v===undefined?now:v)}static now(){return now;}}
const env={STREAMER_TWITCH_CLIENT_ID:'fixture-id',STREAMER_TWITCH_CLIENT_SECRET:'fixture-secret',STREAMER_YOUTUBE_API_KEY:'fixture-youtube',STREAMER_TIKTOK_CLIENT_KEY:'fixture-tiktok',STREAMER_TIKTOK_CLIENT_SECRET:'fixture-secret',STREAMER_TOKEN_KEY:'b'.repeat(64),PUBLIC_SITE_BRIDGE_TOKEN:'a'.repeat(64)};
const globals={Date:Clock,process:{env},URL,URLSearchParams,AbortSignal,setInterval,clearInterval,fetch:providerFetch};
const channelId='123456789012345678',memberId='234567890123456789',providerId='UC'+'a'.repeat(22),ytVideo='abcdefghijk';
async function providerFetch(input,init={}){
 const u=new URL(String(input));if(httpFailure&&u.hostname==='www.googleapis.com')return Response.json({error:{errors:[{reason:httpFailure.reason}],message:'SECRET-UPSTREAM-BODY'}},{status:httpFailure.status});if(providerFail)return Response.json({},{status:503});
 if(u.hostname==='id.twitch.tv')return Response.json({access_token:'fixture-twitch-token',expires_in:3600});
 if(u.hostname==='api.twitch.tv'){
  if(u.pathname.endsWith('/users'))return Response.json({data:[{id:'123',login:u.searchParams.get('login')}]});
  if(u.pathname.endsWith('/streams'))return Response.json({data:live?[{id:'777',user_id:'123',title:'Наш рейд',started_at:new Clock(now-60000).toISOString()}]:[]});
  if(u.pathname.endsWith('/videos'))return Response.json({data:[{id:String(video),type:'upload',title:'Нове відео',published_at:new Clock(video===1?now-86400000:now-1000).toISOString()}]});
 }
 if(u.hostname==='www.youtube.com')return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${providerId}</yt:channelId><entry><yt:videoId>${ytVideo}</yt:videoId></entry></feed>`);
 if(u.hostname==='www.googleapis.com'){
  if(u.pathname.endsWith('/channels')){const handle=u.searchParams.get('forHandle');return Response.json({items:[{id:!handle||handle==='@sebas'?providerId:'UC'+require('node:crypto').createHash('sha256').update(handle).digest('hex').slice(0,22)}]});}
  if(u.pathname.endsWith('/search'))return Response.json({items:ytLive?[{id:{videoId:ytVideo}}]:[]});
  if(u.pathname.endsWith('/videos'))return Response.json({items:[{id:ytVideo,snippet:{channelId:providerId,title:'YouTube рейд',publishedAt:new Clock(now-86400000).toISOString(),liveBroadcastContent:ytLive?'live':'none'},status:{privacyStatus:'public'},...(ytLive?{liveStreamingDetails:{actualStartTime:new Clock(now-1000).toISOString()}}:{})}]});
 }
 if(u.hostname==='open.tiktokapis.com'){
  if(u.pathname.includes('/oauth/')){tokenRefreshes++;return Response.json({access_token:'rotated-token',refresh_token:'rotated-refresh',expires_in:86400});}
  if(u.pathname.includes('/user/info/'))return Response.json({data:{user:{open_id:'tiktok-1',username:'sebas'}},error:{code:'ok'}});
  if(u.pathname.includes('/video/list/'))return Response.json({data:{videos:[{id:'123456789012345',title:'TikTok відео',create_time:Math.floor((now-1000)/1000)}]},error:{code:'ok'}});
 }
 throw Error('UNEXPECTED NETWORK '+u.origin+u.pathname);
}
const messages=new Map();
async function discordApi(url,init={}){
 if(url.includes('/members/')){if(memberMissing)throw new rest.DiscordRestError('missing',404);return {user:{id:memberId,username:'Sebas',bot:false},nick:'Sebas'};}
 if(/^\/channels\/\d+$/.test(url)&&discordForbidden)throw new rest.DiscordRestError('SECRET-DISCORD-BODY',403);
 if(/^\/channels\/\d+$/.test(url))return {guild_id:'999999999999999999',type:0};
 if(url.endsWith('/messages')){if(init.beforeSend)await init.beforeSend();const p=JSON.parse(init.body);assert.deepEqual(p.allowed_mentions,{parse:[],users:[],roles:[],replied_user:false});assert.equal(p.enforce_nonce,true);sent++;const result={id:String(100000000000000000n+BigInt(sent)),channel_id:channelId};messages.set(p.nonce,result);if(discordMode==='uncertain')throw Error('simulated response lost after Discord commit');if(discordMode==='forbidden')throw new rest.DiscordRestError('forbidden',403);return result;}
 throw Error('Unexpected Discord request '+url);
}
let rest;let passed=0;async function check(name,run){await run();passed++;console.log('PASS '+name);}
(async()=>{
 const engine=new PGlite();await engine.exec(fs.readFileSync(path.join(__dirname,'../src/lib/db/schema.sql'),'utf8'));
 try{
 const query=async(sql,values=[],client)=>{const r=await(client||engine).query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length}};
 const pool={hasPostgresConfig:()=>true,pgQuery:query,pgTransaction:run=>engine.transaction(tx=>run({query:(sql,values)=>query(sql,values,tx)}))};
 const adapter=load('src/lib/db/documentStore.ts',{'@/lib/db/pgPool':pool},globals).exports,db=new adapter.PgDocumentStore();
 const database={'@/lib/documentDb':{getDocumentDb:()=>db}};const storage={'@/lib/storageAccess':{assertStorageWriteAvailable:()=>{}}};
 const problems=load('src/lib/streamers/problems.ts',{},globals).exports;
 const structured=load('src/lib/structuredLogs.ts',{'crypto':require('node:crypto'),'@/lib/db/pgPool':pool,'@/lib/logSettings':{getStructuredLogSettings:async()=>({queryLimit:100})},'@/lib/securityLogDiscord':{mirrorSecurityLogToDiscord:async()=>{throw Error('must not send Discord diagnostics')}}},globals).exports;
 const diagnostics=load('src/lib/streamers/diagnostics.ts',{'@/lib/db/pgPool':pool,'@/lib/structuredLogs':structured,'./problems':problems},globals).exports;
 const contract=load('src/lib/streamers/contract.ts',{},globals).exports;
 rest=load('src/lib/discordRest.ts',{},globals).exports;
 const providers=load('src/lib/streamers/providers.ts',{'./contract':contract},globals).exports;
 const discord={'@/lib/discordAdmin':{discordApi,getDiscordGuildId:()=> '999999999999999999',fetchDiscordTextChannels:async()=>({channels:[{id:channelId,name:'streams'}]}),findDiscordPublicationMessage:async p=>messages.get(p.nonce)||null}};
 const store=load('src/lib/streamers/store.ts',{...database,...storage,...discord,'@/lib/db/pgPool':pool,'./contract':contract,'./providers':providers,'./problems':problems,'./diagnostics':diagnostics},globals).exports;
 const leases=load('src/lib/automationLease.ts',{...database,...storage},globals).exports;
 const publications=load('src/lib/discordPublication.ts',{...database,'@/lib/automationLease':leases,'@/lib/discordRest':rest},globals).exports;
 const worker=load('src/lib/streamers/worker.ts',{...database,...discord,'@/lib/automationLease':leases,'@/lib/discordRest':rest,'@/lib/discordPublication':publications,'./store':store,'./providers':providers,'./problems':problems,'./diagnostics':diagnostics},globals).exports;
 const base={memberId,platform:'twitch',channel:'sebas',enabled:true,siteEnabled:true,notifyLive:true,notifyVideos:true};let id;
 await check('only owner/admin can manage, including forged moderator permissions',async()=>{for(const role of ['member','mentor','moderator'])assert.equal(contract.canManageStreamers({role,permissions:['groups.manage','discord.members.manage']}),false);assert.equal(contract.canManageStreamers({role:'admin'}),true);assert.equal(contract.canManageStreamers({role:'member',isServerOwner:true}),true);});
 await check('platform URLs reject SSRF, wrong hosts, redirects, credentials and video URLs',async()=>{for(const url of ['https://evil.example/sebas','http://twitch.tv/sebas','https://user:pass@twitch.tv/sebas','https://twitch.tv/sebas?token=secret','https://twitch.tv/videos/123','https://127.0.0.1/sebas'])assert.throws(()=>contract.channelIdentity('twitch',url));assert.equal(contract.channelIdentity('twitch','https://www.twitch.tv/Sebas').handle,'sebas');});
 await check('real SQL registration persists canonical channel, membership and unique ownership',async()=>{const a=await store.saveStreamer(base);id=a.id;assert.equal(a.memberName,'Sebas');await assert.rejects(store.saveStreamer({...base,channel:'https://www.twitch.tv/sebas'}),/duplicate_channel/);assert.equal((await store.streamerAccounts()).length,1);assert.equal((await store.streamerSettings()).enabled,false);});
 await check('settings use revision checks and reject another guild channel',async()=>{await store.saveStreamerSettings({enabled:true,siteEnabled:true,discordEnabled:true,channelId,revision:'initial'});await assert.rejects(store.saveStreamerSettings({enabled:false,siteEnabled:false,discordEnabled:false,channelId:'',revision:'initial'}),/вже змінено|revision_conflict/);});
 await check('first scan seeds old videos without sending historical announcements',async()=>{const r=await worker.runStreamerMonitor();assert.equal(r.checked,1);assert.equal(sent,0);assert.equal((await db.collection(store.EVENTS).get()).docs.length,0);});
 await check('new Twitch live event is delivered once and exposed with a bounded expiry',async()=>{now+=61000;live=true;await worker.runStreamerMonitor();assert.equal(sent,1);const d=await store.publicStreamers();assert.equal(d.items.length,1);assert.equal(d.items[0].live.id,'777');assert.equal(contract.isPublicStreamers(d),true);const raw=JSON.stringify(d);for(const secret of ['memberId','token','secret','revision'])assert.equal(raw.includes(secret),false);now+=61000;await worker.runStreamerMonitor();assert.equal(sent,1);});
 await check('new upload produces one separate video announcement',async()=>{now+=61000;video=2;await worker.runStreamerMonitor();assert.equal(sent,2);});
 await check('provider failure never becomes offline and expires stale LIVE automatically',async()=>{providerFail=true;now+=61000;await worker.runStreamerMonitor();assert.equal((await store.publicStreamers()).items.length,1);now+=301000;assert.equal((await store.publicStreamers()).items.length,0);providerFail=false;});
 await check('confirmed stream end removes banner, without new live notification',async()=>{live=false;await worker.runStreamerMonitor();assert.equal((await store.publicStreamers()).items.length,0);assert.equal(sent,2);});
 await check('new event with lost acknowledgement reconciles after restart, never creates twice',async()=>{video=3;now+=61000;discordMode='uncertain';await worker.runStreamerMonitor();assert.equal(sent,3);let jobs=(await db.collection(store.EVENTS).get()).docs.map(d=>d.data());assert.ok(jobs.some(j=>j.state==='uncertain'));discordMode='ok';now+=301000;await worker.runStreamerMonitor();assert.equal(sent,3);jobs=(await db.collection(store.EVENTS).get()).docs.map(d=>d.data());assert.ok(jobs.every(j=>j.state==='sent'));});
 await check('TikTok refresh tokens are encrypted, rotated durably before video request and never public',async()=>{const sealed=providers.encryptToken({accessToken:'old-access',refreshToken:'old-refresh',expiresAt:now-1});let saved='';const o=await providers.observeProvider({platform:'tiktok',handle:'sebas',providerId:'tiktok-1',token:sealed},false,async token=>{saved=token;});assert.ok(saved);assert.equal(providers.decryptToken(saved).refreshToken,'rotated-refresh');assert.equal(o.live,null);assert.equal(o.liveSupported,false);assert.equal(tokenRefreshes,1);assert.equal(saved.includes('rotated-token'),false);});
 await check('YouTube public LIVE and new uploads are distinguished by authoritative video metadata',async()=>{ytLive=true;const o=await providers.observeProvider({platform:'youtube',handle:'@sebas',providerId},true);assert.equal(o.live.id,ytVideo);assert.equal(o.videos.length,0);ytLive=false;const ended=await providers.observeProvider({platform:'youtube',handle:'@sebas',providerId},false);assert.equal(ended.live,null);assert.equal(ended.videos.length,1);});
 await check('disabled/deleted accounts cancel pending notifications and remove public state',async()=>{const a=await store.currentAccount(id);await store.saveStreamer({...base,id,revision:a.revision,enabled:false});assert.equal((await store.publicStreamers()).items.length,0);const current=await store.currentAccount(id);const settings=await store.streamerSettings();assert.equal(worker.eventStillWanted({accountRevision:a.revision,settingsRevision:settings.revision,channelId,kind:'live',media:{id:'777'},createdAt:now},current,settings),false);await store.deleteStreamer(id,current.revision);assert.equal(await store.currentAccount(id),null);});
 await check('leaving the guild removes the live banner and cannot send new events',async()=>{const a=await store.saveStreamer({...base,channel:'other'});memberMissing=true;await worker.runStreamerMonitor();assert.equal((await store.currentAccount(a.id)).state.status,'member_missing');assert.equal((await store.publicStreamers()).items.length,0);memberMissing=false;});
 const route=load('src/app/api/dashboard/streamers/route.ts',{'next/server':{NextRequest,NextResponse,after:()=>{}},'@/lib/auth':{getSession:async options=>{assert.equal(options.live,true);if(authFail)throw Error('SECRET-SESSION-FAILURE');return role}},'@/lib/streamers/contract':contract,'@/lib/streamers/store':store,'@/lib/streamers/providers':providers,'@/lib/streamers/worker':worker,'@/lib/streamers/problems':problems,'@/lib/streamers/diagnostics':diagnostics,...database,...discord,'@/lib/accessGroups':{recordAdminAudit:async()=>{if(auditFail)throw Error('SECRET-AUDIT-FAILURE');return true;}},'@/lib/security':{verifyTrustedOrigin:()=>origin,noStoreHeaders:()=>({'Cache-Control':'no-store'}),checkRateLimit:()=>({ok:true}),getClientIp:()=> '127.0.0.1'}},globals).exports;
 await check('admin routes enforce role and origin before any settings write; secrets are not serialized',async()=>{for(const r of ['member','mentor','moderator']){role={id:r,role:r,permissions:['groups.manage']};assert.equal((await route.GET()).status,403);assert.equal((await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:'{"action":"settings"}'}))).status,403);}role={id:'admin',role:'admin'};origin=false;assert.equal((await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:'{}'}))).status,403);origin=true;const r=await route.GET();assert.equal(r.status,200);assert.equal((await r.text()).includes('fixture-secret'),false);});
 const bridgeAuth=load('src/lib/siteBridgeAuth.ts',{},globals).exports;const publicRoute=load('src/app/api/site/streamers/route.ts',{'next/server':{NextResponse},'@/lib/siteBridgeAuth':bridgeAuth,'@/lib/streamers/store':store},globals).exports;
 await check('public snapshot requires scoped site bridge token and never carries admin state',async()=>{assert.equal((await publicRoute.GET(new Request('http://dashboard:3000/api/site/streamers'))).status,403);const r=await publicRoute.GET(new Request('http://dashboard:3000/api/site/streamers',{headers:{Authorization:'Bearer '+'a'.repeat(64)}}));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');});
 Object.assign(env,{NODE_ENV:'production',DASHBOARD_URL:'https://guild.example',DASHBOARD_ALLOWED_HOSTS:'guild.example',SECURITY_REQUIRE_CLOUDFLARE:'strict'});
 const security=load('src/lib/security.ts',{'next/server':{NextRequest,NextResponse},'@/lib/oauth':{getDashboardUrl:()=>env.DASHBOARD_URL},'@/lib/values':{envFlag:name=>env[name]==='true'}},{...globals,crypto:require('node:crypto').webcrypto}).exports;
 const proxy=load('src/proxy.ts',{'next/server':{NextRequest,NextResponse},'@/lib/siteBridgeAuth':bridgeAuth,'@/lib/security':{...security,logDashboardEvent:()=>{}}},{...globals,crypto:require('node:crypto').webcrypto,btoa,Headers}).exports.proxy;
 await check('actual production proxy and public route serve streamers via private Host without session or Cloudflare',async()=>{
  const url='http://dashboard:3000/api/site/streamers';
  for(const token of [null,'invalid']){const r=proxy(new NextRequest(url,{headers:{Host:'dashboard:3000',...(token?{Authorization:'Bearer '+token}:{})}}));assert.equal(r.status,401);assert.equal(r.headers.get('location'),null);}
  const request=new NextRequest(url,{headers:{Host:'dashboard:3000',Authorization:'Bearer '+env.PUBLIC_SITE_BRIDGE_TOKEN}}),gate=proxy(request);
  assert.equal(gate.headers.get('x-middleware-next'),'1','valid internal bridge must reach the route rather than redirect');
  const r=await publicRoute.GET(request);assert.equal(r.status,200);assert.equal(contract.isPublicStreamers(await r.json()),true);
  const adjacent=proxy(new NextRequest('http://dashboard:3000/api/dashboard/streamers',{headers:{Host:'dashboard:3000',Authorization:'Bearer '+env.PUBLIC_SITE_BRIDGE_TOKEN}}));assert.equal(adjacent.headers.get('x-middleware-next'),null,'site token must not bypass management protection');
  const write=proxy(new NextRequest(url,{method:'POST',headers:{Host:'dashboard:3000',Authorization:'Bearer '+env.PUBLIC_SITE_BRIDGE_TOKEN}}));assert.equal(write.status,421);
 });
 const memberInput=async()=>{const accounts=(await store.streamerAccounts()).filter(a=>a.memberId===memberId);return {memberId,expected:accounts.map(a=>({id:a.id,revision:a.revision})),channels:accounts.map(a=>({...a,channel:a.channelUrl,accessToken:'',refreshToken:''}))};};
 await check('one member saves Twitch, YouTube and TikTok atomically with existing identities preserved',async()=>{
  const input=await memberInput(),original=input.channels[0];const result=await store.saveStreamerMember({...input,channels:[...input.channels,{...base,platform:'youtube',channel:'@sebas'},{...base,platform:'tiktok',channel:'sebas',notifyLive:false,accessToken:'fixture-creator-access',refreshToken:'fixture-creator-refresh'}]});
  assert.equal(result.accounts.length,3);assert.ok(result.accounts.every(a=>a.memberId===memberId));assert.equal(result.accounts.find(a=>a.id===original.id).revision,original.revision);assert.equal((await store.currentAccount(result.accounts.find(a=>a.platform==='tiktok').id)).token.includes('fixture-creator'),false);
 });
 await check('invalid platform or duplicate in a member batch cannot partially save valid siblings',async()=>{
  const input=await memberInput(),before=JSON.stringify(await store.streamerAccounts());
  await assert.rejects(store.saveStreamerMember({...input,channels:[...input.channels,{...base,platform:'youtube',channel:'https://evil.example/sebas'}]}),e=>e.code==='channel_invalid'&&e.field==='youtube');assert.equal(JSON.stringify(await store.streamerAccounts()),before);
  await assert.rejects(store.saveStreamerMember({...input,channels:[...input.channels,{...base,channel:'other'}]}),e=>e.code==='duplicate_channel');assert.equal(JSON.stringify(await store.streamerAccounts()),before);
 });
 await check('stale member snapshot rejects the whole batch; unchanged platform preserves delivery revision',async()=>{
  const input=await memberInput(),twitch=input.channels.find(a=>a.platform==='twitch');const next=await store.saveStreamerMember({...input,channels:input.channels.map(a=>a.platform==='youtube'?{...a,notifyVideos:false}:a)});
  assert.equal(next.accounts.find(a=>a.id===twitch.id).revision,twitch.revision);await assert.rejects(store.saveStreamerMember(input),e=>e.code==='revision_conflict');
 });
 await check('initial failed attempts have timestamps and retry times; repeated errors log once, recovery logs safely',async()=>{
  const account=(await store.streamerAccounts()).find(a=>a.platform==='youtube');const start=(await diagnostics.streamerDiagnostics()).length;now+=1000;
  await store.recordStreamerError(account,'provider_authorization');let a=await store.currentAccount(account.id),projection=store.adminAccount(a);assert.equal(projection.attemptedAt,now);assert.equal(projection.checkedAt,0);assert.equal(projection.nextCheckAt,now+300000);assert.equal(projection.failures,1);assert.equal((await diagnostics.streamerDiagnostics()).length,start+1);
  await store.recordStreamerError(a,'provider_authorization');assert.equal((await diagnostics.streamerDiagnostics()).length,start+1);
  a=await store.currentAccount(a.id);await store.commitObservation(a,{providerId,live:null,videos:[],liveSupported:true},await store.streamerSettings(),false);projection=store.adminAccount(await store.currentAccount(a.id));assert.equal(projection.status,'ok');assert.equal(projection.failures,0);assert.equal(projection.checkedAt,now);assert.equal((await diagnostics.streamerDiagnostics()).length,start+2);
 });
 await check('YouTube quota, invalid key and unsafe raw errors become distinct safe problems',async()=>{
  for(const [status,reason,expected] of [[403,'quotaExceeded','provider_rate_limit'],[400,'keyInvalid','provider_authorization'],[403,'forbidden','provider_authorization']]){httpFailure={status,reason};await assert.rejects(providers.observeProvider({platform:'youtube',handle:'@sebas',providerId},false),e=>e.message===expected&&!e.message.includes('SECRET'));}httpFailure=null;
  assert.equal(problems.classifyStreamerError(Error('SECRET-RAW-TOKEN')).error.includes('SECRET'),false);
  await diagnostics.recordStreamerDiagnostic({code:'SECRET-RAW-TOKEN',stage:'check',level:'error'});const log=await engine.query("SELECT details FROM system_logs WHERE resource_type='guild-streamer'");assert.equal(JSON.stringify(log.rows).includes('SECRET'),false);
 });
 await check('member API returns field problems and correct conflict status, never a partial success',async()=>{
  const input=await memberInput();const r=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'save-member',...input,channels:[{...base,channel:'https://evil.example/sebas'}]})}));assert.equal(r.status,400);const error=await r.json();assert.equal(error.code,'channel_invalid');assert.equal(error.field,'twitch');assert.ok(error.hint);assert.equal(JSON.stringify(error).includes('evil.example'),false);
  const conflict=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'save-member',...input,expected:[]})}));assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'revision_conflict');
 });
 await check('audit failure does not turn a committed member update into an error; token access is preserved',async()=>{
  const input=await memberInput(),tiktok=input.channels.find(a=>a.platform==='tiktok'),token=(await store.currentAccount(tiktok.id)).token;auditFail=true;
  const r=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'save-member',...input,channels:input.channels.map(a=>a.platform==='youtube'?{...a,notifyVideos:true}:a)})}));auditFail=false;assert.equal(r.status,200);const data=await r.json();assert.equal(data.ok,true);assert.equal(data.warning.code,'logs_unavailable');assert.equal((await store.currentAccount(tiktok.id)).token,token);
  const view=await (await route.GET()).json();assert.equal(view.accounts.length,3);assert.ok(view.logs.length>0);assert.equal(JSON.stringify(view).includes('fixture-creator'),false);
 });
 await check('removing one platform preserves siblings; disabled check and oversized body fail before work',async()=>{
  const input=await memberInput(),keep=input.channels.filter(a=>a.platform!=='tiktok');await store.saveStreamerMember({...input,channels:keep});assert.equal((await store.streamerAccounts()).length,2);assert.equal((await store.streamerAccounts()).some(a=>a.platform==='tiktok'),false);
  const settings=await store.streamerSettings();await store.saveStreamerSettings({...settings,enabled:false});const r=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:'{"action":"check"}'}));assert.equal(r.status,400);assert.equal((await r.json()).code,'monitor_disabled');
  const huge=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'save-member',secret:'z'.repeat(66000)})}));assert.equal(huge.status,413);assert.equal((await huge.json()).code,'body_limit');
 });
 await check('simultaneous member edits cannot overwrite one another',async()=>{
  const input=await memberInput();const result=await Promise.allSettled([store.saveStreamerMember({...input,channels:input.channels.map(a=>a.platform==='youtube'?{...a,notifyVideos:false}:a)}),store.saveStreamerMember({...input,channels:input.channels.map(a=>a.platform==='youtube'?{...a,siteEnabled:false}:a)})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected'&&r.reason.code==='revision_conflict').length,1);
 });
 await check('converting an existing Twitch channel cannot bypass the five-channel YouTube limit',async()=>{
  const input=await memberInput(),baseIds=input.channels.map(a=>a.id);await store.saveStreamerMember({...input,channels:[...input.channels,...[1,2,3,4].map(n=>({...base,platform:'youtube',channel:'@channel'+n}))]});
  const twitch=(await store.streamerAccounts()).find(a=>a.platform==='twitch');await assert.rejects(store.saveStreamer({...base,id:twitch.id,revision:twitch.revision,platform:'youtube',channel:'@converted'}),e=>e.code==='account_limit');
  const current=await memberInput();await store.saveStreamerMember({...current,channels:current.channels.filter(a=>baseIds.includes(a.id))});assert.equal((await store.streamerAccounts()).length,2);
 });
 await check('member deletion checks the whole snapshot and removes all platforms atomically',async()=>{
  const input=await memberInput();await assert.rejects(store.deleteStreamerMember({...input,expected:input.expected.slice(1)}),e=>e.code==='revision_conflict');assert.equal((await store.streamerAccounts()).length,2);
  const response=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'delete-member',memberId,expected:input.expected})}));assert.equal(response.status,200);assert.equal((await response.json()).data.count,2);assert.equal((await store.streamerAccounts()).length,0);assert.equal((await store.publicStreamers()).items.length,0);
 });
 await check('Discord permission failure identifies the cause without changing settings or leaking response body',async()=>{
  const settings=await store.streamerSettings();discordForbidden=true;const r=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'settings',...settings,discordEnabled:true})}));discordForbidden=false;assert.equal(r.status,502);const data=await r.json();assert.equal(data.code,'discord_403');assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.equal((await store.streamerSettings()).revision,settings.revision);
 });
 await check('session storage failure returns safe retryable JSON to both read and mutation clients',async()=>{
  authFail=true;const a=await route.GET(),b=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:'{"action":"check"}'}));authFail=false;assert.equal(a.status,503);assert.equal(b.status,503);assert.equal((await a.json()).code,'storage_unavailable');assert.equal((await b.text()).includes('SECRET'),false);
 });
 console.log(`[check-streamers] OK ${passed}/${passed}; real PostgreSQL/PGlite transactions and publication ledger, fake providers/Discord only`);
 }finally{await engine.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
