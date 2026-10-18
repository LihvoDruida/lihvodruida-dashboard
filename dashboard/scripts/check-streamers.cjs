const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite'),load=require('./lib/load-server-ts.cjs'),{NextRequest,NextResponse}=require('next/server');
let now=Date.now(),memberMissing=false,providerFail=false,live=false,video=1,ytLive=false,discordMode='ok',sent=0,tokenRefreshes=0,role={id:'admin',role:'admin'},origin=true;
class Clock extends Date{constructor(v){super(v===undefined?now:v)}static now(){return now;}}
const env={STREAMER_TWITCH_CLIENT_ID:'fixture-id',STREAMER_TWITCH_CLIENT_SECRET:'fixture-secret',STREAMER_YOUTUBE_API_KEY:'fixture-youtube',STREAMER_TIKTOK_CLIENT_KEY:'fixture-tiktok',STREAMER_TIKTOK_CLIENT_SECRET:'fixture-secret',STREAMER_TOKEN_KEY:'b'.repeat(64),PUBLIC_SITE_BRIDGE_TOKEN:'a'.repeat(64)};
const globals={Date:Clock,process:{env},URL,URLSearchParams,AbortSignal,setInterval,clearInterval,fetch:providerFetch};
const channelId='123456789012345678',memberId='234567890123456789',providerId='UC'+'a'.repeat(22),ytVideo='abcdefghijk';
async function providerFetch(input,init={}){
 const u=new URL(String(input));if(providerFail)return Response.json({},{status:503});
 if(u.hostname==='id.twitch.tv')return Response.json({access_token:'fixture-twitch-token',expires_in:3600});
 if(u.hostname==='api.twitch.tv'){
  if(u.pathname.endsWith('/users'))return Response.json({data:[{id:'123',login:u.searchParams.get('login')}]});
  if(u.pathname.endsWith('/streams'))return Response.json({data:live?[{id:'777',user_id:'123',title:'Наш рейд',started_at:new Clock(now-60000).toISOString()}]:[]});
  if(u.pathname.endsWith('/videos'))return Response.json({data:[{id:String(video),type:'upload',title:'Нове відео',published_at:new Clock(video===1?now-86400000:now-1000).toISOString()}]});
 }
 if(u.hostname==='www.youtube.com')return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${providerId}</yt:channelId><entry><yt:videoId>${ytVideo}</yt:videoId></entry></feed>`);
 if(u.hostname==='www.googleapis.com'){
  if(u.pathname.endsWith('/channels'))return Response.json({items:[{id:providerId}]});
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
 if(/^\/channels\/\d+$/.test(url))return {guild_id:'999999999999999999',type:0};
 if(url.endsWith('/messages')){if(init.beforeSend)await init.beforeSend();const p=JSON.parse(init.body);assert.deepEqual(p.allowed_mentions,{parse:[],users:[],roles:[],replied_user:false});assert.equal(p.enforce_nonce,true);sent++;const result={id:String(100000000000000000n+BigInt(sent)),channel_id:channelId};messages.set(p.nonce,result);if(discordMode==='uncertain')throw Error('simulated response lost after Discord commit');if(discordMode==='forbidden')throw new rest.DiscordRestError('forbidden',403);return result;}
 throw Error('Unexpected Discord request '+url);
}
let rest;let passed=0;async function check(name,run){await run();passed++;console.log('PASS '+name);}
(async()=>{
 const engine=new PGlite();await engine.exec(fs.readFileSync(path.join(__dirname,'../src/lib/db/schema.sql'),'utf8'));
 try{
 const query=async(sql,values=[],client)=>{const r=await(client||engine).query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length}};
 const pool={pgQuery:query,pgTransaction:run=>engine.transaction(tx=>run({query:(sql,values)=>query(sql,values,tx)}))};
 const adapter=load('src/lib/db/documentStore.ts',{'@/lib/db/pgPool':pool},globals).exports,db=new adapter.PgDocumentStore();
 const database={'@/lib/documentDb':{getDocumentDb:()=>db}};const storage={'@/lib/storageAccess':{assertStorageWriteAvailable:()=>{}}};
 const contract=load('src/lib/streamers/contract.ts',{},globals).exports;
 rest=load('src/lib/discordRest.ts',{},globals).exports;
 const providers=load('src/lib/streamers/providers.ts',{'./contract':contract},globals).exports;
 const discord={'@/lib/discordAdmin':{discordApi,getDiscordGuildId:()=> '999999999999999999',fetchDiscordTextChannels:async()=>({channels:[{id:channelId,name:'streams'}]}),findDiscordPublicationMessage:async p=>messages.get(p.nonce)||null}};
 const store=load('src/lib/streamers/store.ts',{...database,...storage,...discord,'@/lib/db/pgPool':pool,'./contract':contract,'./providers':providers},globals).exports;
 const leases=load('src/lib/automationLease.ts',{...database,...storage},globals).exports;
 const publications=load('src/lib/discordPublication.ts',{...database,'@/lib/automationLease':leases,'@/lib/discordRest':rest},globals).exports;
 const worker=load('src/lib/streamers/worker.ts',{...database,...discord,'@/lib/automationLease':leases,'@/lib/discordRest':rest,'@/lib/discordPublication':publications,'./store':store,'./providers':providers},globals).exports;
 const base={memberId,platform:'twitch',channel:'sebas',enabled:true,siteEnabled:true,notifyLive:true,notifyVideos:true};let id;
 await check('only owner/admin can manage, including forged moderator permissions',async()=>{for(const role of ['member','mentor','moderator'])assert.equal(contract.canManageStreamers({role,permissions:['groups.manage','discord.members.manage']}),false);assert.equal(contract.canManageStreamers({role:'admin'}),true);assert.equal(contract.canManageStreamers({role:'member',isServerOwner:true}),true);});
 await check('platform URLs reject SSRF, wrong hosts, redirects, credentials and video URLs',async()=>{for(const url of ['https://evil.example/sebas','http://twitch.tv/sebas','https://user:pass@twitch.tv/sebas','https://twitch.tv/sebas?token=secret','https://twitch.tv/videos/123','https://127.0.0.1/sebas'])assert.throws(()=>contract.channelIdentity('twitch',url));assert.equal(contract.channelIdentity('twitch','https://www.twitch.tv/Sebas').handle,'sebas');});
 await check('real SQL registration persists canonical channel, membership and unique ownership',async()=>{const a=await store.saveStreamer(base);id=a.id;assert.equal(a.memberName,'Sebas');await assert.rejects(store.saveStreamer({...base,channel:'https://www.twitch.tv/sebas'}),/уже додано/);assert.equal((await store.streamerAccounts()).length,1);assert.equal((await store.streamerSettings()).enabled,false);});
 await check('settings use revision checks and reject another guild channel',async()=>{await store.saveStreamerSettings({enabled:true,siteEnabled:true,discordEnabled:true,channelId,revision:'initial'});await assert.rejects(store.saveStreamerSettings({enabled:false,siteEnabled:false,discordEnabled:false,channelId:'',revision:'initial'}),/вже змінено/);});
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
 const route=load('src/app/api/dashboard/streamers/route.ts',{'next/server':{NextRequest,NextResponse,after:()=>{}},'@/lib/auth':{getSession:async options=>{assert.equal(options.live,true);return role}},'@/lib/streamers/contract':contract,'@/lib/streamers/store':store,'@/lib/streamers/providers':providers,'@/lib/streamers/worker':worker,...database,...discord,'@/lib/accessGroups':{recordAdminAudit:async()=>{}},'@/lib/security':{verifyTrustedOrigin:()=>origin,noStoreHeaders:()=>({'Cache-Control':'no-store'}),checkRateLimit:()=>({ok:true}),getClientIp:()=> '127.0.0.1'}},globals).exports;
 await check('admin routes enforce role and origin before any settings write; secrets are not serialized',async()=>{for(const r of ['member','mentor','moderator']){role={id:r,role:r,permissions:['groups.manage']};assert.equal((await route.GET()).status,403);assert.equal((await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:'{"action":"settings"}'}))).status,403);}role={id:'admin',role:'admin'};origin=false;assert.equal((await route.POST(new NextRequest('https://guild.example/api/dashboard/streamers',{method:'POST',body:'{}'}))).status,403);origin=true;const r=await route.GET();assert.equal(r.status,200);assert.equal((await r.text()).includes('fixture-secret'),false);});
 const bridgeAuth=load('src/lib/siteBridgeAuth.ts',{},globals).exports;const publicRoute=load('src/app/api/site/streamers/route.ts',{'next/server':{NextResponse},'@/lib/siteBridgeAuth':bridgeAuth,'@/lib/streamers/store':store},globals).exports;
 await check('public snapshot requires scoped site bridge token and never carries admin state',async()=>{assert.equal((await publicRoute.GET(new Request('http://dashboard:3000/api/site/streamers'))).status,403);const r=await publicRoute.GET(new Request('http://dashboard:3000/api/site/streamers',{headers:{Authorization:'Bearer '+'a'.repeat(64)}}));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');});
 console.log(`[check-streamers] OK ${passed}/${passed}; real PostgreSQL/PGlite transactions and publication ledger, fake providers/Discord only`);
 }finally{await engine.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
