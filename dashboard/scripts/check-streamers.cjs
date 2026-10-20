const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite'),load=require('./lib/load-server-ts.cjs'),{NextRequest,NextResponse}=require('next/server');
let twitchVODHang=false,lastPayload=null,streamId='777';
let hangingPhase='',now=Date.now(),memberMissing=false,providerFail=false,live=false,video=1,ytLive=false,discordMode='ok',sent=0,tokenRefreshes=0,role={id:'admin',role:'admin'},origin=true,auditFail=false,httpFailure=null,discordForbidden=false,authFail=false,customMode='redirect',providerCalls=0,lastChannelParams=null,twitchLogin='';
class Clock extends Date{constructor(v){super(v===undefined?now:v)}static now(){return now;}}
const env={STREAMER_TWITCH_CLIENT_ID:'fixture-id',STREAMER_TWITCH_CLIENT_SECRET:'fixture-secret',STREAMER_YOUTUBE_API_KEY:'fixture-youtube',STREAMER_TIKTOK_CLIENT_KEY:'fixture-tiktok',STREAMER_TIKTOK_CLIENT_SECRET:'fixture-secret',STREAMER_TOKEN_KEY:'b'.repeat(64),PUBLIC_SITE_BRIDGE_TOKEN:'a'.repeat(64)};
const globals={Date:Clock,process:{env},URL,URLSearchParams,AbortSignal,setInterval,clearInterval,fetch:providerFetch};
const channelId='123456789012345678',memberId='234567890123456789',providerId='UC'+'a'.repeat(22),ytVideo='abcdefghijk';
function hangOn(signal){assert.ok(signal,'shared budget signal required');return new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}
async function providerFetch(input,init={}){
 providerCalls++;const u=new URL(String(input));if(hangingPhase&&((hangingPhase==='resolve'&&u.pathname.endsWith('/channels'))||(hangingPhase==='feed'&&u.pathname.endsWith('/videos.xml'))||(hangingPhase==='search'&&u.pathname.endsWith('/search'))||(hangingPhase==='videos'&&u.hostname==='www.googleapis.com'&&u.pathname.endsWith('/videos'))))return hangOn(init.signal);if(httpFailure&&u.hostname==='www.googleapis.com')return Response.json({error:{errors:[{reason:httpFailure.reason}],message:'SECRET-UPSTREAM-BODY'}},{status:httpFailure.status});if(providerFail)return Response.json({},{status:503});
 if(u.hostname==='id.twitch.tv'&&u.pathname.endsWith('/validate'))return Response.json({client_id:env.STREAMER_TWITCH_CLIENT_ID,scopes:[],expires_in:3600});
 if(u.hostname==='id.twitch.tv')return Response.json({access_token:'fixture-twitch-token',expires_in:3600});
 if(u.hostname==='api.twitch.tv'){
  if(u.pathname.endsWith('/users'))return Response.json({data:[{id:'123',login:u.searchParams.get('login')}]});
  if(u.pathname.endsWith('/streams'))return Response.json({data:live?[{id:streamId,user_id:'123',user_login:twitchLogin,title:'Наш рейд',thumbnail_url:'https://static-cdn.jtvnw.net/previews-ttv/live_user_sebas-{width}x{height}.jpg',game_name:'World of Warcraft',viewer_count:0,started_at:new Clock(now-60000).toISOString()}]:[]});
  if(u.pathname.endsWith('/videos')&&twitchVODHang)return hangOn(init.signal);
  if(u.pathname.endsWith('/videos'))return Response.json({data:[{id:String(video),type:'upload',title:'Нове відео',published_at:new Clock(video===1?now-86400000:now-1000).toISOString()}]});
 }
 if(u.hostname==='www.youtube.com'&&u.pathname.startsWith('/c/')){assert.equal(init.redirect,'manual');if(customMode==='evil')return new Response(null,{status:302,headers:{Location:'https://evil.example/private'}});if(customMode==='loop')return new Response(null,{status:302,headers:{Location:u.href}});if(customMode==='html')return new Response('<html><link href="https://www.youtube.com/@sebas?si=shared&amp;feature=test" rel="canonical"></html>');return new Response(null,{status:308,headers:{Location:'https://www.youtube.com/@sebas?si=shared'}});}
 if(u.hostname==='www.youtube.com')return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${providerId}</yt:channelId><entry><yt:videoId>${ytVideo}</yt:videoId></entry></feed>`);
 if(u.hostname==='www.googleapis.com'){
  if(u.pathname.endsWith('/channels')){lastChannelParams=u.searchParams;const handle=u.searchParams.get('forHandle');return Response.json({items:[{id:!handle||handle==='@sebas'?providerId:'UC'+require('node:crypto').createHash('sha256').update(handle).digest('hex').slice(0,22)}]});}
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
 if(url.includes('/members/')){if(hangingPhase==='membership')return hangOn(init.signal);if(memberMissing)throw new rest.DiscordRestError('missing',404);return {user:{id:memberId,username:'Sebas',bot:false},nick:'Sebas'};}
 if(/^\/channels\/\d+$/.test(url)&&discordForbidden)throw new rest.DiscordRestError('SECRET-DISCORD-BODY',403);
 if(/^\/channels\/\d+$/.test(url))return {guild_id:'999999999999999999',type:0};
 if(url.endsWith('/messages')){if(init.beforeSend)await init.beforeSend();if(hangingPhase==='pre-dispatch')return hangOn(init.signal);if(init.onDispatch)init.onDispatch();const p=JSON.parse(init.body);lastPayload=p;assert.deepEqual(p.allowed_mentions,{parse:[],users:[],roles:[],replied_user:false});assert.equal(p.enforce_nonce,true);sent++;const result={id:String(100000000000000000n+BigInt(sent)),channel_id:channelId};messages.set(p.nonce,result);if(hangingPhase==='discord-post')return hangOn(init.signal);if(discordMode==='uncertain')throw Error('simulated response lost after Discord commit');if(discordMode==='forbidden')throw new rest.DiscordRestError('forbidden',403);return result;}
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
 const channelInput=load('src/lib/streamers/channel-input.ts',{'./contract':load('src/lib/streamers/contract.ts',{},globals).exports,'./problems':problems},globals).exports;
 const diagnostics=load('src/lib/streamers/diagnostics.ts',{'@/lib/db/pgPool':pool,'@/lib/structuredLogs':structured,'./problems':problems},globals).exports;
 const contract=load('src/lib/streamers/contract.ts',{},globals).exports;
 rest=load('src/lib/discordRest.ts',{},globals).exports;
 const providers=load('src/lib/streamers/providers.ts',{'./contract':contract,'./channel-input':channelInput},globals).exports;
 const discord={'@/lib/discordAdmin':{discordApi,getDiscordGuildId:()=> '999999999999999999',fetchDiscordTextChannels:async()=>({channels:[{id:channelId,name:'streams'}]}),findDiscordPublicationMessage:async p=>messages.get(p.nonce)||null}};
 const store=load('src/lib/streamers/store.ts',{...database,...storage,...discord,'@/lib/db/pgPool':pool,'./contract':contract,'./providers':providers,'./problems':problems,'./diagnostics':diagnostics,'./channel-input':channelInput},globals).exports;
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
  await store.recordStreamerError(account,'provider_authorization');let a=await store.currentAccount(account.id),projection=store.adminAccount(a);assert.equal(projection.attemptedAt,now);assert.equal(projection.checkedAt,0);assert.equal(projection.nextCheckAt,now+3600000);assert.equal(projection.failures,1);assert.equal((await diagnostics.streamerDiagnostics()).length,start+1);
  await store.recordStreamerError(a,'provider_authorization');assert.equal((await diagnostics.streamerDiagnostics()).length,start+1);
  a=await store.currentAccount(a.id);await store.commitObservation(a,{providerId,live:null,videos:[],liveSupported:true},await store.streamerSettings(),false);projection=store.adminAccount(await store.currentAccount(a.id));assert.equal(projection.status,'ok');assert.equal(projection.failures,0);assert.equal(projection.checkedAt,now);assert.equal((await diagnostics.streamerDiagnostics()).length,start+2);
 });
 await check('YouTube quota, invalid key and unsafe raw errors become distinct safe problems',async()=>{
  for(const [status,reason,expected] of [[403,'quotaExceeded','provider_rate_limit'],[400,'keyInvalid','provider_configuration'],[403,'forbidden','provider_authorization']]){env.STREAMER_YOUTUBE_API_KEY='fixture-youtube-'+reason;httpFailure={status,reason};await assert.rejects(providers.observeProvider({platform:'youtube',handle:'@sebas',providerId},false),e=>e.message===expected&&!e.message.includes('SECRET'));}httpFailure=null;env.STREAMER_YOUTUBE_API_KEY='fixture-youtube';
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
 await check('admin input normalizes shared/mobile/encoded/tabbed YouTube links and bare handles',async()=>{
  const parse=channelInput.streamerChannelInput;
  for(const value of ['https://www.youtube.com/@lihvo_druida?si=shared','https://m.youtube.com/@lihvo_druida/videos?feature=shared','youtube.com/@lihvo_druida/streams','lihvo_druida','@lihvo_druida']){const p=parse('youtube',value);assert.equal(p.handle,'@lihvo_druida');assert.equal(p.channelUrl,'https://www.youtube.com/@lihvo_druida');}
  assert.equal(parse('youtube','https://www.youtube.com/@%D0%9B%D1%96%D0%B3%D0%B2%D0%BE/videos?si=1').handle,'@Лігво');assert.equal(parse('youtube','@猫').handle,'@猫');
  assert.equal(parse('youtube','https://www.youtube.com/user/LegacyUser/videos?si=1').handle,'user:LegacyUser');assert.equal(parse('youtube','https://www.youtube.com/c/LegacyName').handle,'custom:LegacyName');
  assert.equal(parse('twitch','https://m.twitch.tv/sebas/videos?filter=all').handle,'sebas');assert.equal(parse('tiktok','https://www.tiktok.com/@sebas/live?lang=uk').handle,'sebas');
 });
 await check('admin input still rejects foreign hosts, credentials, encoded separators and video/playlist URLs',async()=>{
  for(const url of ['https://youtube.com.evil.example/@sebas','https://user:pass@youtube.com/@sebas','https://127.0.0.1/@sebas','http://youtube.com/@sebas','https://youtube.com/@sebas%2Fwatch','https://youtube.com:8443/@sebas'])assert.throws(()=>channelInput.streamerChannelInput('youtube',url),e=>e.code==='channel_invalid');
  for(const url of ['https://youtu.be/abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk','https://www.youtube.com/shorts/abcdefghijk','https://www.youtube.com/playlist?list=secret'])assert.throws(()=>channelInput.streamerChannelInput('youtube',url),e=>e.code==='channel_video_url');
 });
 await check('YouTube-only configuration saves during API authorization outage, with no provider request during save',async()=>{
  const start=providerCalls;httpFailure={status:403,reason:'forbidden'};
  const r=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'save-member',memberId,expected:[],channels:[{...base,platform:'youtube',channel:'https://m.youtube.com/@sebas/videos?si=shared'}]})}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.data.accounts.length,1);assert.equal(data.data.accounts[0].platform,'youtube');assert.equal(data.data.accounts[0].status,'not_checked');assert.equal(data.data.accounts[0].channelUrl,'https://www.youtube.com/@sebas');assert.equal(providerCalls,start);
  const settings=await store.streamerSettings();await store.saveStreamerSettings({...settings,enabled:true,discordEnabled:true});const result=await worker.runStreamerMonitor();assert.equal(result.failed,1);const a=(await store.streamerAccounts())[0];assert.equal(a.state.status,'provider_authorization');assert.equal((await store.streamerAccounts()).length,1);assert.equal(a.providerId,'');httpFailure=null;
 });
 await check('pending YouTube channel recovers in background and public LIVE remains compatible with existing site',async()=>{
  now+=3601000;await worker.runStreamerMonitor();let a=(await store.streamerAccounts())[0];assert.equal(a.providerId,providerId);assert.equal(a.state.status,'ok');assert.ok(a.state.initializedAt);ytLive=true;now+=301000;await worker.runStreamerMonitor();const snapshot=await store.publicStreamers();assert.equal(snapshot.items.length,1);assert.equal(snapshot.items[0].channelUrl,'https://www.youtube.com/channel/'+providerId);assert.equal(contract.isPublicStreamers(snapshot),true);a=(await store.streamerAccounts())[0];assert.equal(a.state.live.id,ytVideo);
 });
 await check('legacy YouTube username and custom URLs resolve safely with exact API filters',async()=>{
  assert.equal(await providers.resolveProvider('youtube','user:LegacyUser'),providerId);assert.equal(lastChannelParams.get('forUsername'),'LegacyUser');assert.equal(lastChannelParams.has('forHandle'),false);assert.equal(lastChannelParams.has('id'),false);
  for(const mode of ['redirect','html']){customMode=mode;assert.equal(await providers.resolveProvider('youtube','custom:LegacyName'),providerId);assert.equal(lastChannelParams.get('forHandle'),'@sebas');}
  for(const mode of ['evil','loop']){customMode=mode;await assert.rejects(providers.resolveProvider('youtube','custom:LegacyName'),e=>e.message==='channel_resolution_required');}customMode='redirect';
 });
 await check('resolved aliases cannot publish duplicate LIVE or notifications; deleted owner releases identity safely',async()=>{
  const input=await memberInput(),original=input.channels[0],before=sent;await store.saveStreamerMember({...input,channels:[...input.channels,{...base,platform:'youtube',channel:'https://www.youtube.com/channel/'+providerId}]});now+=61000;await worker.runStreamerMonitor();let accounts=await store.streamerAccounts();const clone=accounts.find(a=>a.id!==original.id);assert.equal(clone.state.status,'duplicate_channel');assert.equal((await store.publicStreamers()).items.length,1);assert.equal(sent,before);
  const current=await memberInput();await store.saveStreamerMember({...current,channels:current.channels.filter(a=>a.id===clone.id)});now+=301000;await worker.runStreamerMonitor();accounts=await store.streamerAccounts();assert.equal(accounts[0].state.status,'ok');assert.equal((await store.publicStreamers()).items.length,1);assert.equal(sent,before,'same platform/stream identity must not announce again after channel replacement');ytLive=false;
 });
 await check('configuration can be edited with missing API key and targeted checks validate membership',async()=>{
  const key=env.STREAMER_YOUTUBE_API_KEY;delete env.STREAMER_YOUTUBE_API_KEY;const input=await memberInput(),start=providerCalls;const result=await store.saveStreamerMember({...input,channels:input.channels.map(a=>({...a,notifyVideos:false}))});assert.equal(result.accounts[0].status,'provider_not_configured');assert.equal(providerCalls,start);env.STREAMER_YOUTUBE_API_KEY=key;
  const r=await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:JSON.stringify({action:'check',memberId:'111111111111111111'})}));assert.equal(r.status,400);const noWork=await worker.runStreamerMonitor({force:true,memberId:'111111111111111111'});assert.equal(noWork.checked,0);const final=await memberInput();await store.deleteStreamerMember(final);
 });
 await check('Twitch live links use the confirmed provider login after a channel rename',async()=>{live=true;twitchLogin='new_sebas';const o=await providers.observeProvider({platform:'twitch',handle:'old_sebas',providerId:'123'});assert.equal(o.live.url,'https://www.twitch.tv/new_sebas');assert.equal(o.live.id,'777');live=false;twitchLogin='';});
 await store.saveStreamer({...base,platform:'youtube',channel:'@sebas'});
 await check('legacy sent/pending/uncertain keys suppress the same media after channel recreation',async()=>{
  const account=(await store.streamerAccounts())[0],settings=await store.streamerSettings();
  for(const [i,state] of ['sent','pending','uncertain'].entries()){
   const media={id:'legacytest'+i,title:'Legacy LIVE',url:'https://www.youtube.com/watch?v=legacytest'+i,publishedAt:new Clock(now-1000).toISOString()};
   await db.collection(store.EVENTS).doc('legacy-'+state).set({platform:'youtube',kind:'live',media,state,createdAt:now-10000,accountId:'deleted-account'});
   await store.commitObservation({...account,state:null},{providerId,live:media,videos:[],liveSupported:true},settings,false);
   const key=require('node:crypto').createHash('sha256').update(['youtube',providerId,'live',media.id].join(':')).digest('hex');assert.equal((await db.collection(store.EVENTS).doc(key).get()).exists,false);
  }
 });
 await check('retention strips stale YouTube metadata and receipts, preserving hashed idempotency evidence',async()=>{
  for(const state of ['pending','uncertain','sent']){
   const id='retention-'+state,media={id:'retention00',title:'PRIVATE-STALE-TITLE',url:'https://www.youtube.com/watch?v=retention00',publishedAt:new Clock(now-31*86400000).toISOString()};
   await db.collection(store.EVENTS).doc(id).set({id,platform:'youtube',kind:'live',media,memberName:'old-name',state,createdAt:now-30*86400000,dueAtMs:now-1});
   const receipt=publications.publicationRevision(['guild-streamer',id]);await db.collection('discordPublications').doc(receipt).set({kind:'guild-streamer',resourceId:id,nonce:'saved-nonce',state:state==='sent'?'complete':'uncertain',result:{id:channelId,embeds:[{title:media.title}]},context:{title:media.title},error:media.title});
  }
  await store.maintainStreamerMetadata();
  for(const state of ['pending','uncertain','sent']){const id='retention-'+state,event=(await db.collection(store.EVENTS).doc(id).get()).data(),receipt=(await db.collection('discordPublications').doc(publications.publicationRevision(['guild-streamer',id])).get()).data();assert.equal(event.media,undefined);assert.equal(event.memberName,undefined);assert.equal(event.mediaKey,store.streamerMediaKey('youtube','live','retention00'));assert.equal(event.dueAtMs,0);assert.equal(receipt.nonce,'saved-nonce');assert.equal(JSON.stringify(receipt).includes('PRIVATE-STALE'),false);assert.equal(receipt.result.id,channelId);assert.equal(event.state,state==='uncertain'?'expired_uncertain':state==='sent'?'sent':'cancelled');}
  const account=(await store.streamerAccounts())[0],settings=await store.streamerSettings(),media={id:'retention00',title:'refreshed',url:'https://www.youtube.com/watch?v=retention00',publishedAt:new Clock(now-1000).toISOString()};await store.commitObservation({...account,state:null},{providerId,live:media,videos:[],liveSupported:true},settings,false);const key=require('node:crypto').createHash('sha256').update(['youtube',providerId,'live',media.id].join(':')).digest('hex');assert.equal((await db.collection(store.EVENTS).doc(key).get()).exists,false);
 });
 await check('retention runs while monitoring is disabled and clears aged channel metadata',async()=>{
  const account=(await store.streamerAccounts())[0],settings=await store.streamerSettings();
  await db.collection(store.ACCOUNTS).doc(account.id).update({createdAt:now-32*86400000,providerId,state:{...account.state,checkedAt:now-31*86400000,videoIds:['old-video'],live:{id:'old-live',title:'stale-title'}}});
  await store.saveStreamerSettings({...settings,enabled:false});await worker.runStreamerMonitor();const fresh=await store.currentAccount(account.id);assert.equal(fresh.providerId,'');assert.equal(fresh.state.live,null);assert.equal(fresh.state.videoIds.length,0);await store.saveStreamerSettings({...await store.streamerSettings(),enabled:true});
 });
 for(const phase of ['membership','resolve','feed','search','videos'])await check('shared monitor budget aborts hanging '+phase+' and releases the lease',async()=>{
  let account=(await store.streamerAccounts())[0];await db.collection(store.ACCOUNTS).doc(account.id).update({providerId:phase==='resolve'?'':providerId,state:{...account.state,live:null,nextCheckAt:0,lastSearchAt:0,checkedAt:now,attemptedAt:now-61000}});
  hangingPhase=phase;const start=performance.now();const keeper=setTimeout(()=>{},2000);try{const r=await worker.runStreamerMonitor({budgetMs:500});assert.ok(performance.now()-start<1500);assert.ok(r.deferred>=1,'deadline must be reported as deferred');}finally{clearTimeout(keeper);hangingPhase='';}
  const lease=(await db.collection('automationLeases').doc('guild-streamers').get()).data();assert.equal(lease.expiresAtMs,0);account=await store.currentAccount(account.id);assert.notEqual(account.state.status,'provider_unavailable','budget exhaustion must not fabricate a provider error');
 });
 await check('deadline before Discord dispatch keeps a retryable prepared receipt and sends once on resume',async()=>{
  let account=(await store.streamerAccounts())[0];const settings=await store.streamerSettings(),media={id:'unsenttest0',title:'Not yet sent',url:'https://www.youtube.com/watch?v=unsenttest0',publishedAt:new Clock(now-1000).toISOString()};
  await store.commitObservation({...account,state:null},{providerId,live:media,videos:[],liveSupported:true},settings,false);account=await store.currentAccount(account.id);await db.collection(store.ACCOUNTS).doc(account.id).update({state:{...account.state,nextCheckAt:now+60000}});
  for(const state of ['pending','uncertain'])await db.collection(store.EVENTS).doc('legacy-'+state).update({dueAtMs:now+86400000});
  const before=sent;hangingPhase='pre-dispatch';const keeper=setTimeout(()=>{},2000);try{await worker.runStreamerMonitor({budgetMs:500});}finally{clearTimeout(keeper);hangingPhase='';}assert.equal(sent,before);
  const key=require('node:crypto').createHash('sha256').update(['youtube',providerId,'live',media.id].join(':')).digest('hex');assert.equal((await publications.getDiscordPublicationOperation('guild-streamer',key)).state,'prepared');assert.equal((await db.collection(store.EVENTS).doc(key).get()).data().state,'pending');
  await db.collection(store.EVENTS).doc(key).update({dueAtMs:now});await worker.runStreamerMonitor();assert.equal(sent,before+1);assert.equal((await db.collection(store.EVENTS).doc(key).get()).data().state,'sent');
 });
 await check('deadline after Discord POST preserves uncertain receipt and later reconciles without a second POST',async()=>{
  let account=(await store.streamerAccounts())[0];const settings=await store.streamerSettings();const media={id:'budgettest0',title:'Budget LIVE',url:'https://www.youtube.com/watch?v=budgettest0',publishedAt:new Clock(now-1000).toISOString()};
  await store.commitObservation({...account,state:null},{providerId,live:media,videos:[],liveSupported:true},settings,false);account=await store.currentAccount(account.id);await db.collection(store.ACCOUNTS).doc(account.id).update({state:{...account.state,nextCheckAt:now+60000}});
  // Unrelated intentionally incomplete legacy fixtures are not delivery jobs.
  for(const state of ['pending','uncertain'])await db.collection(store.EVENTS).doc('legacy-'+state).update({dueAtMs:now+86400000});
  const before=sent;hangingPhase='discord-post';const keeper=setTimeout(()=>{},2000);try{await worker.runStreamerMonitor({budgetMs:500});}finally{clearTimeout(keeper);hangingPhase='';}assert.equal(sent,before+1);
  const key=require('node:crypto').createHash('sha256').update(['youtube',providerId,'live',media.id].join(':')).digest('hex');let event=(await db.collection(store.EVENTS).doc(key).get()).data();assert.equal(event.state,'uncertain');assert.equal((await publications.getDiscordPublicationOperation('guild-streamer',key)).state,'uncertain');
  await db.collection(store.EVENTS).doc(key).update({dueAtMs:now});await worker.runStreamerMonitor();assert.equal(sent,before+1);event=(await db.collection(store.EVENTS).doc(key).get()).data();assert.equal(event.state,'sent');
 });
 await check('LIVE sends with a preview before a stalled optional Twitch video request; resumed scan never duplicates it',async()=>{
  const a=await store.saveStreamer({...base,channel:'fast_sebas'});const before=sent;now+=61000;live=true;streamId='888';twitchVODHang=true;
  const keeper=setTimeout(()=>{},2000);try{const result=await worker.runStreamerMonitor({accountId:a.id,budgetMs:500});assert.equal(result.sent,1);assert.equal(sent,before+1);assert.ok(lastPayload.embeds[0].image.url.includes('1280x720'));assert.ok(lastPayload.embeds[0].fields.some(f=>f.name==='Зараз дивляться'&&f.value==='0'));}finally{clearTimeout(keeper);twitchVODHang=false;}
  const current=await store.currentAccount(a.id);assert.equal(current.state.live.id,'888');assert.equal(current.state.nextCheckAt,now+30000);assert.equal(current.state.videoIds.length,0);
  now+=31000;await worker.runStreamerMonitor({accountId:a.id});assert.equal(sent,before+1);live=false;streamId='777';
 });
 const hook=proxy(new NextRequest('https://guild.example/api/integrations/twitch/eventsub',{method:'POST',headers:{Host:'guild.example','x-mistblossom-trusted-proxy':'cloudflare','cf-ray':'fixture','cf-connecting-ip':'203.0.113.1','Content-Type':'application/json'},body:'{}'}));
 await check('production proxy lets only the public webhook path reach its signature verifier without browser session or Origin',async()=>{assert.equal(hook.headers.get('x-middleware-next'),'1');const adjacent=proxy(new NextRequest('https://guild.example/api/integrations/twitch/other',{method:'POST',headers:{Host:'guild.example','x-mistblossom-trusted-proxy':'cloudflare','cf-ray':'fixture','cf-connecting-ip':'203.0.113.1'},body:'{}'}));assert.notEqual(adjacent.headers.get('x-middleware-next'),'1');});
 console.log(`[check-streamers] OK ${passed}/${passed}; real PostgreSQL/PGlite transactions and publication ledger, fake providers/Discord only`);
 }finally{await engine.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
