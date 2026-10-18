import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {type StreamPlatform,type StreamMedia,channelIdentity,validMedia} from './contract';
type Json=Record<string,unknown>;
const obj=(x:unknown):Json=>x&&typeof x==='object'&&!Array.isArray(x)?x as Json:{};
const rows=(x:unknown):Json[]=>{if(!Array.isArray(x)||x.length>100)throw Error('provider_schema');return x.map(obj);};
const text=(x:unknown)=>typeof x==='string'?x:'';
export type TikTokToken={accessToken:string;refreshToken:string;expiresAt:number};
export type ProviderAccount={platform:StreamPlatform;handle:string;providerId?:string;token?:string;state?:{videoIds?:string[];live?:StreamMedia|null}|null};
export type Observation={live:StreamMedia|null;videos:StreamMedia[];providerId:string;token?:string;liveSupported:boolean;warning?:string};
export function providerReadiness(){return {twitch:!!(process.env.STREAMER_TWITCH_CLIENT_ID&&process.env.STREAMER_TWITCH_CLIENT_SECRET),youtube:!!process.env.STREAMER_YOUTUBE_API_KEY,tiktok:!!(process.env.STREAMER_TIKTOK_CLIENT_KEY&&process.env.STREAMER_TIKTOK_CLIENT_SECRET&&/^[a-f0-9]{64}$/i.test(process.env.STREAMER_TOKEN_KEY||''))};}
function key(){const raw=process.env.STREAMER_TOKEN_KEY||'';if(!/^[a-f0-9]{64}$/i.test(raw))throw Error('Для TikTok налаштуй STREAMER_TOKEN_KEY (32 байти hex).');return Buffer.from(raw,'hex');}
export function encryptToken(value:TikTokToken){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
export function decryptToken(value:string):TikTokToken{const raw=Buffer.from(value,'base64');const decipher=createDecipheriv('aes-256-gcm',key(),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));}
async function response(url:string,init:RequestInit={}){
 const r=await fetch(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7000)});
 if(!r.ok){await r.body?.cancel();throw Error(r.status===429?'provider_rate_limit':r.status===401||r.status===403?'provider_authorization':'provider_unavailable');}
 const reader=r.body?.getReader();if(!reader)throw Error('provider_empty');let size=0;const parts:Uint8Array[]=[];
 try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>1024*1024)throw Error('provider_body_limit');parts.push(p.value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(parts).toString('utf8');
}
async function json(url:string,init:RequestInit={}){return obj(JSON.parse(await response(url,init)));}
let twitchToken:{key:string;token:string;until:number}|null=null;
async function twitch(path:string,retry=true):Promise<Json>{
 const id=process.env.STREAMER_TWITCH_CLIENT_ID||'',secret=process.env.STREAMER_TWITCH_CLIENT_SECRET||'';if(!id||!secret)throw Error('provider_not_configured');
 if(!twitchToken||twitchToken.key!==id+secret||twitchToken.until<Date.now()+60000){const d=await json('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:'client_credentials'})});if(!text(d.access_token)||!Number.isFinite(Number(d.expires_in)))throw Error('provider_schema');twitchToken={key:id+secret,token:text(d.access_token),until:Date.now()+Number(d.expires_in)*1000};}
 try{return await json('https://api.twitch.tv/helix/'+path,{headers:{Authorization:`Bearer ${twitchToken.token}`,'Client-Id':id}});}catch(e){if(retry&&e instanceof Error&&e.message==='provider_authorization'){twitchToken=null;return twitch(path,false);}throw e;}
}
async function youtube(resource:string,params:Record<string,string>){const key=process.env.STREAMER_YOUTUBE_API_KEY;if(!key)throw Error('provider_not_configured');return json('https://www.googleapis.com/youtube/v3/'+resource+'?'+new URLSearchParams({...params,key}));}
export async function resolveProvider(platform:StreamPlatform,handle:string){
 if(platform==='twitch'){const user=rows((await twitch('users?'+new URLSearchParams({login:handle}))).data)[0];if(!user||!/^\d+$/.test(text(user.id)))throw Error('Канал Twitch не знайдено.');return text(user.id);}
 if(platform==='youtube'){const channel=rows((await youtube('channels',{part:'id',...(handle.startsWith('@')?{forHandle:handle}:{id:handle})})).items)[0];if(!channel||!/^UC[a-zA-Z0-9_-]{22}$/.test(text(channel.id)))throw Error('Канал YouTube не знайдено.');return text(channel.id);}
 return '';
}
async function verifyTikTok(token:TikTokToken,handle:string){const d=await json('https://open.tiktokapis.com/v2/user/info/?fields=open_id,username',{headers:{Authorization:`Bearer ${token.accessToken}`}});if(obj(d.error).code!=='ok')throw Error('provider_authorization');const user=obj(obj(d.data).user);if(text(user.username).toLowerCase()!==handle.toLowerCase()||!text(user.open_id))throw Error('TikTok: потрібен дозвіл саме цього автора (user.info.basic, user.info.profile, video.list).');return text(user.open_id);}
export async function prepareTikTokToken(handle:string,access:string,refresh:string){if(!access||access.length>4096||refresh.length>4096)throw Error('Перевір TikTok access token.');const token={accessToken:access,refreshToken:refresh,expiresAt:refresh?0:Date.now()+900000};const providerId=await verifyTikTok(token,handle);return {token:encryptToken(token),providerId};}
function media(platform:StreamPlatform,id:string,title:unknown,published:unknown,url:string):StreamMedia{const m={id,title:(text(title).trim()||'Трансляція учасника').slice(0,300),publishedAt:text(published),url};if(!validMedia(platform,m))throw Error('provider_schema');return m;}
export async function observeProvider(a:ProviderAccount,searchLive=false,onToken?:(token:string)=>Promise<void>):Promise<Observation>{
 const providerId=a.providerId||await resolveProvider(a.platform,a.handle);
 if(a.platform==='twitch'){
  const [s,v]=await Promise.all([twitch('streams?'+new URLSearchParams({user_id:providerId})),twitch('videos?'+new URLSearchParams({user_id:providerId,type:'all',first:'20'})).catch(()=>null)]);const live=rows(s.data)[0];const videos=(v?rows(v.data):[]).filter(v=>v.type==='upload'||v.type==='highlight').map(v=>media('twitch',text(v.id),v.title,v.published_at,`https://www.twitch.tv/videos/${v.id}`));
  if(live&&text(live.user_id)!==providerId)throw Error('provider_identity');
  return {providerId,live:live?media('twitch',text(live.id),live.title,live.started_at,channelIdentity('twitch',a.handle).channelUrl):null,videos,liveSupported:true,...(!v?{warning:'videos_unavailable'}:{})};
 }
 if(a.platform==='youtube'){
  let xml='',warning='';try{xml=await response('https://www.youtube.com/feeds/videos.xml?'+new URLSearchParams({channel_id:providerId}));if(!/<feed[\s>]/.test(xml)||!xml.includes(`<yt:channelId>${providerId}</yt:channelId>`))throw Error('provider_schema');}catch{warning='discovery_unavailable';if(!a.state?.live&&!searchLive)throw Error('provider_unavailable');}
  const ids=new Set([...xml.matchAll(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/g)].map(m=>m[1]).slice(0,20));if(a.state?.live)ids.add(a.state.live.id);
  if(searchLive){try{const s=await youtube('search',{part:'snippet',type:'video',eventType:'live',channelId:providerId,maxResults:'5'});for(const v of rows(s.items)){const id=text(obj(v.id).videoId);if(/^[a-zA-Z0-9_-]{11}$/.test(id))ids.add(id);}}catch{warning='discovery_unavailable';if(!ids.size)throw Error('provider_unavailable');}}
  if(!ids.size)return {providerId,live:null,videos:[],liveSupported:true};
  const data=await youtube('videos',{part:'snippet,liveStreamingDetails,status',id:[...ids].slice(0,30).join(',')});let live:StreamMedia|null=null;const videos:StreamMedia[]=[];
  for(const v of rows(data.items)){const s=obj(v.snippet),l=obj(v.liveStreamingDetails);if(text(s.channelId)!==providerId)throw Error('provider_identity');if(obj(v.status).privacyStatus!=='public')continue;
   const current=media('youtube',text(v.id),s.title,l.actualStartTime||s.publishedAt,`https://www.youtube.com/watch?v=${v.id}`);
   if(s.liveBroadcastContent==='live'&&text(l.actualStartTime)&&!l.actualEndTime)live=current;
   else if(!Object.keys(l).length&&s.liveBroadcastContent==='none')videos.push(current);
  }
  return {providerId,live,videos,liveSupported:true,...(warning?{warning}:{})};
 }
 if(!a.token)throw Error('tiktok_authorization_required');let token=decryptToken(a.token),updated:string|undefined;
 if(token.expiresAt<Date.now()+60000){if(!token.refreshToken||!providerReadiness().tiktok)throw Error('provider_authorization');const d=await json('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',body:new URLSearchParams({client_key:process.env.STREAMER_TIKTOK_CLIENT_KEY!,client_secret:process.env.STREAMER_TIKTOK_CLIENT_SECRET!,grant_type:'refresh_token',refresh_token:token.refreshToken})});if(!text(d.access_token)||!text(d.refresh_token)||!Number.isFinite(Number(d.expires_in)))throw Error('provider_authorization');token={accessToken:text(d.access_token),refreshToken:text(d.refresh_token),expiresAt:Date.now()+Number(d.expires_in)*1000};updated=encryptToken(token);if(onToken)await onToken(updated);}
 const verified=await verifyTikTok(token,a.handle);if(a.providerId&&verified!==a.providerId)throw Error('provider_identity');
 const d=await json('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time',{method:'POST',headers:{Authorization:`Bearer ${token.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({max_count:20})});if(obj(d.error).code!=='ok')throw Error('provider_authorization');const videos=rows(obj(d.data).videos).map(v=>media('tiktok',text(v.id),v.title,new Date(Number(v.create_time)*1000).toISOString(),`https://www.tiktok.com/@${a.handle}/video/${v.id}`));
 return {providerId:verified,token:updated,live:null,videos,liveSupported:false};
}
