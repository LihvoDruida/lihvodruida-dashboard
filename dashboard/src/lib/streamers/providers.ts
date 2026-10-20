import 'server-only';
import {AsyncLocalStorage} from 'node:async_hooks';
const providerSignal=new AsyncLocalStorage<AbortSignal>();
function checkBudget(){providerSignal.getStore()?.throwIfAborted();}
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {streamerChannelInput} from './channel-input';
import {type StreamPlatform,type StreamMedia,channelIdentity,validMedia,safeMediaImage} from './contract';
import {ApiHttpError} from '@/lib/apiHttp';
import {ApiResponseError,readResponseText,readResponseJson,awaitAbortable} from '@/lib/httpBody';
import {providerFetch} from '@/lib/providerHttp';
import {providerScope,observeProviderFailure,checkProviderPause,ProviderCooldownError} from '@/lib/providerCooldown';
export class ProviderRequestError extends Error {
 constructor(readonly code:string,readonly status=0,readonly retryAt:number|null=null,readonly retryable=true,readonly reason=code){super(code);this.name='ProviderRequestError';}
}
function providerError(error:unknown):never{
 if(error instanceof ProviderRequestError)throw error;
 if(error instanceof ProviderCooldownError)throw new ProviderRequestError('provider_rate_limit',429,error.retryAt,true,error.reason);
 if(error instanceof ApiResponseError)throw new ProviderRequestError('provider_schema',error.status);
 if(error instanceof ApiHttpError)throw new ProviderRequestError('provider_unavailable',error.status,error.retryAt);
 throw error;
}
type Json=Record<string,unknown>;
const obj=(x:unknown):Json=>x&&typeof x==='object'&&!Array.isArray(x)?x as Json:{};
const rows=(x:unknown):Json[]=>{if(!Array.isArray(x)||x.length>100)throw new ProviderRequestError('provider_schema');return x.map(obj);};
const text=(x:unknown)=>typeof x==='string'?x:'';
export type TikTokToken={accessToken:string;refreshToken:string;expiresAt:number};
export type ProviderAccount={platform:StreamPlatform;handle:string;providerId?:string;token?:string;state?:{videoIds?:string[];live?:StreamMedia|null}|null};
export type Observation={live:StreamMedia|null;videos:StreamMedia[];providerId:string;token?:string;liveSupported:boolean;warning?:string;retryAt?:number;reason?:string;retryable?:boolean;videosChecked?:boolean};
export function providerReadiness(){return {twitch:!!(process.env.STREAMER_TWITCH_CLIENT_ID?.trim()&&process.env.STREAMER_TWITCH_CLIENT_SECRET?.trim()),youtube:!!process.env.STREAMER_YOUTUBE_API_KEY?.trim(),tiktok:!!(process.env.STREAMER_TIKTOK_CLIENT_KEY&&process.env.STREAMER_TIKTOK_CLIENT_SECRET&&/^[a-f0-9]{64}$/i.test(process.env.STREAMER_TOKEN_KEY||''))};}
function key(){const raw=process.env.STREAMER_TOKEN_KEY||'';if(!/^[a-f0-9]{64}$/i.test(raw))throw Error('Для TikTok налаштуй STREAMER_TOKEN_KEY (32 байти hex).');return Buffer.from(raw,'hex');}
export function encryptToken(value:TikTokToken){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
export function decryptToken(value:string):TikTokToken{const raw=Buffer.from(value,'base64');const decipher=createDecipheriv('aes-256-gcm',key(),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));}
async function response(url:string,init:RequestInit={},asJson=false):Promise<any>{
 checkBudget();const signal=AbortSignal.any([AbortSignal.timeout(7000),...(providerSignal.getStore()?[providerSignal.getStore()!]:[]),...(init.signal?[init.signal]:[])]);
 try{
 const r=await providerFetch(url,{...init,redirect:'error',cache:'no-store',signal});
 const body=asJson?await readResponseJson<Json>(r,{maxBytes:1024*1024,signal,validate:v=>!!v&&typeof v==='object'&&!Array.isArray(v)}):await readResponseText(r,{maxBytes:1024*1024,signal});
 const scope=providerScope(url,init.headers);
 if(asJson)await observeProviderFailure(scope,body,r.status);
 if(!r.ok||asJson&&obj(obj(body).error).code==='rate_limit_exceeded'){
  // An active durable pause retains the original absolute deadline.
  if(scope)await checkProviderPause(scope);
  const reasons=asJson?JSON.stringify(obj(obj(body).error).errors||[]):'';
  const config=/keyInvalid|API_KEY_INVALID/.test(reasons);
  throw new ProviderRequestError(config?'provider_configuration':[400,401,403].includes(r.status)?'provider_authorization':'provider_unavailable',r.status,null,![400,401,403].includes(r.status));
 }
 return body??{};
 }catch(error){providerError(error);}
}
async function json(url:string,init:RequestInit={}):Promise<Json>{return response(url,init,true);}
type TwitchToken={key:string;token:string;until:number;validatedAt:number};
let twitchToken:TwitchToken|null=null,tokenFlight:Promise<TwitchToken>|null=null,tokenFailureUntil=0,tokenFailure:unknown,tokenKey='',validationTimer:ReturnType<typeof setTimeout>|undefined;
function credentials(){const id=process.env.STREAMER_TWITCH_CLIENT_ID?.trim()||'',secret=process.env.STREAMER_TWITCH_CLIENT_SECRET?.trim()||'';if(!id||!secret)throw new ProviderRequestError('provider_not_configured',0,null,false);return {id,secret,key:id+':'+secret};}
async function validateTwitch(value:TwitchToken,id:string){
 const d=await json('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:`OAuth ${value.token}`}});
 if(d.client_id!==id||!Array.isArray(d.scopes)||d.scopes.some(x=>typeof x!=='string')||!Number.isFinite(d.expires_in)||Number(d.expires_in)<=60)throw new ProviderRequestError('provider_authorization',401,null,false);
 return {...value,validatedAt:Date.now(),until:Math.min(value.until,Date.now()+Number(d.expires_in)*1000)};
}
async function getTwitchToken():Promise<TwitchToken>{
 const {id,secret,key}=credentials();if(tokenKey!==key){twitchToken=null;tokenFlight=null;tokenFailureUntil=0;tokenKey=key;if(validationTimer)clearTimeout(validationTimer);}
 if(twitchToken&&twitchToken.until>Date.now()+60000&&Date.now()-twitchToken.validatedAt<3600000)return twitchToken;
 if(Date.now()<tokenFailureUntil)throw tokenFailure;
 if(!tokenFlight){
 const task=(async()=>{let token=twitchToken;
 if(!token||token.until<=Date.now()+60000){const d=await json('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:'client_credentials'})});if(!text(d.access_token)||!Number.isFinite(d.expires_in)||Number(d.expires_in)<=60)throw new ProviderRequestError('provider_schema');token={key,token:text(d.access_token),until:Date.now()+Number(d.expires_in)*1000,validatedAt:0};}
 token=await validateTwitch(token,id);if(tokenKey===key){twitchToken=token;tokenFailureUntil=0;if(validationTimer)clearTimeout(validationTimer);validationTimer=providerSignal.exit(()=>setTimeout(()=>providerSignal.exit(()=>{if(twitchToken?.key===key){twitchToken.validatedAt=0;void getTwitchToken().catch(()=>{});}}),55*60000));validationTimer.unref?.();}return token;
 })();tokenFlight=task;
 void task.catch(error=>{if(tokenKey===key){twitchToken=null;if(!providerSignal.getStore()?.aborted){tokenFailure=error;tokenFailureUntil=Date.now()+60000;}}}).finally(()=>{if(tokenFlight===task)tokenFlight=null;});
 }
 return awaitAbortable(tokenFlight,providerSignal.getStore());
}
export function withProviderBudget<T>(signal:AbortSignal,run:()=>Promise<T>){return providerSignal.run(signal,run);}
export async function twitch(path:string,retry=true,init:RequestInit={}):Promise<Json>{
 const token=await getTwitchToken();const {id}=credentials();
 try{return await json('https://api.twitch.tv/helix/'+path,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:`Bearer ${token.token}`,'Client-Id':id}});}
 catch(error){if(retry&&error instanceof ProviderRequestError&&error.status===401){if(twitchToken?.token===token.token)twitchToken=null;return twitch(path,false,init);}throw error;}
}
async function youtube(resource:string,params:Record<string,string>){const key=process.env.STREAMER_YOUTUBE_API_KEY?.trim();if(!key)throw Error('provider_not_configured');return json('https://www.googleapis.com/youtube/v3/'+resource+'?'+new URLSearchParams({...params,key}));}
async function resolveCustomYouTube(handle:string):Promise<string>{
 let url=streamerChannelInput('youtube',handle).channelUrl;const visited=new Set<string>(),deadline=AbortSignal.any([AbortSignal.timeout(9000),...(providerSignal.getStore()?[providerSignal.getStore()!]:[])]);
 for(let hop=0;hop<4;hop++){
  if(visited.has(url))break;visited.add(url);
  const r=await providerFetch(url,{redirect:'manual',cache:'no-store',signal:AbortSignal.any([deadline,AbortSignal.timeout(7000)]),headers:{Accept:'text/html'}});
  let next='';
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');void r.body?.cancel().catch(()=>{});if(!location)break;try{next=new URL(location,url).href;}catch{break;}}
  else if(r.ok){let html='';try{html=await readResponseText(r,{maxBytes:2*1024*1024,signal:deadline});}catch{throw Error('channel_resolution_required');}
   for(const match of html.matchAll(/<link\b[^>]*>/gi)){const tag=match[0];if(!/\brel\s*=\s*(["'])canonical\1/i.test(tag))continue;const href=/\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];if(href){try{next=new URL(href.replace(/&amp;/g,'&'),url).href;}catch{}break;}}
  }else{void r.body?.cancel().catch(()=>{});break;}
  if(!next)break;
  let identity:ReturnType<typeof streamerChannelInput>;try{identity=streamerChannelInput('youtube',next);}catch{break;}
  if(!identity.handle.startsWith('custom:'))return resolveProvider('youtube',identity.handle);
  url=identity.channelUrl;
 }
 throw Error('channel_resolution_required');
}
export async function resolveProvider(platform:StreamPlatform,handle:string){
 if(platform==='twitch'){const user=rows((await twitch('users?'+new URLSearchParams({login:handle}))).data)[0];if(!user||!/^\d+$/.test(text(user.id)))throw Error('channel_not_found');return text(user.id);}
 if(platform==='youtube'){if(!process.env.STREAMER_YOUTUBE_API_KEY?.trim())throw Error('provider_not_configured');if(handle.startsWith('custom:'))return resolveCustomYouTube(handle);const channel=rows((await youtube('channels',{part:'id',...(handle.startsWith('@')?{forHandle:handle}:handle.startsWith('user:')?{forUsername:handle.slice(5)}:{id:handle})})).items)[0];if(!channel||!/^UC[a-zA-Z0-9_-]{22}$/.test(text(channel.id)))throw Error('channel_not_found');return text(channel.id);}
 return '';
}
async function verifyTikTok(token:TikTokToken,handle:string){const d=await json('https://open.tiktokapis.com/v2/user/info/?fields=open_id,username',{headers:{Authorization:`Bearer ${token.accessToken}`}});if(obj(d.error).code!=='ok')throw Error('provider_authorization');const user=obj(obj(d.data).user);if(text(user.username).toLowerCase()!==handle.toLowerCase()||!text(user.open_id))throw Error('TikTok: потрібен дозвіл саме цього автора (user.info.basic, user.info.profile, video.list).');return text(user.open_id);}
export async function prepareTikTokToken(handle:string,access:string,refresh:string){if(!access||access.length>4096||refresh.length>4096)throw Error('Перевір TikTok access token.');const token={accessToken:access,refreshToken:refresh,expiresAt:refresh?0:Date.now()+900000};const providerId=await verifyTikTok(token,handle);return {token:encryptToken(token),providerId};}
function media(platform:StreamPlatform,id:string,title:unknown,published:unknown,url:string):StreamMedia{const m={id,title:(text(title).trim()||'Трансляція учасника').slice(0,300),publishedAt:text(published),url};if(!validMedia(platform,m))throw new ProviderRequestError('provider_schema');return m;}
function enrich(platform:StreamPlatform,m:StreamMedia,image:unknown,game?:unknown,viewers?:unknown):StreamMedia{
 let thumbnailUrl=safeMediaImage(platform,text(image).replace(/%?\{width\}/g,'1280').replace(/%?\{height\}/g,'720'));
 if(thumbnailUrl&&platform==='twitch'){const url=new URL(thumbnailUrl);url.searchParams.set('streamer_media',m.id);thumbnailUrl=url.href;}
 return {...m,...(thumbnailUrl?{thumbnailUrl}:{}),...(typeof game==='string'&&game?{game:game.slice(0,100)}:{}),...(viewers!==undefined&&Number.isSafeInteger(Number(viewers))&&Number(viewers)>=0?{viewers:Number(viewers)}:{})};
}
export async function observeProvider(a:ProviderAccount,searchLive=false,onToken?:(token:string)=>Promise<void>,signal?:AbortSignal,options:{videos?:boolean}={}):Promise<Observation>{
 return signal?providerSignal.run(signal,()=>observe(a,searchLive,onToken,options)):observe(a,searchLive,onToken,options);
}
async function observe(a:ProviderAccount,searchLive:boolean,onToken:((token:string)=>Promise<void>)|undefined,options:{videos?:boolean}):Promise<Observation>{
 checkBudget();
 const providerId=a.providerId||await resolveProvider(a.platform,a.handle);
 if(a.platform==='twitch'){
  // LIVE is authoritative first; optional VOD reads never hold its publication.
  const s=await twitch('streams?'+new URLSearchParams({user_id:providerId}));const live=rows(s.data)[0];
  if(live&&text(live.user_id)!==providerId)throw new ProviderRequestError('provider_identity');
  const current=live?enrich('twitch',media('twitch',text(live.id),live.title,live.started_at,channelIdentity('twitch',text(live.user_login)||a.handle).channelUrl),live.thumbnail_url,live.game_name,live.viewer_count):null;
  let warning='',retryAt:number|undefined,reason:string|undefined,videos:StreamMedia[]=[];
  if(options.videos!==false){try{const v=await twitch('videos?'+new URLSearchParams({user_id:providerId,type:'all',first:'20'}));videos=rows(v.data).filter(v=>v.type==='upload'||v.type==='highlight').map(v=>enrich('twitch',media('twitch',text(v.id),v.title,v.published_at,`https://www.twitch.tv/videos/${v.id}`),v.thumbnail_url));}catch(error){checkBudget();warning='videos_unavailable';if(error instanceof ProviderRequestError){retryAt=error.retryAt||undefined;reason=error.reason;}}}
  return {providerId,live:current,videos,liveSupported:true,videosChecked:options.videos!==false,...(warning?{warning}:{}),...(retryAt?{retryAt,reason}: {})};
 }
 if(a.platform==='youtube'){
  let xml='',warning='';try{xml=await response('https://www.youtube.com/feeds/videos.xml?'+new URLSearchParams({channel_id:providerId}));if(!/<feed[\s>]/.test(xml)||!xml.includes(`<yt:channelId>${providerId}</yt:channelId>`))throw new ProviderRequestError('provider_schema');}catch{checkBudget();warning='discovery_unavailable';if(!a.state?.live&&!searchLive)throw Error('provider_unavailable');}
  const ids=new Set([...xml.matchAll(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/g)].map(m=>m[1]).slice(0,20));if(a.state?.live)ids.add(a.state.live.id);
  if(searchLive){try{const s=await youtube('search',{part:'snippet',type:'video',eventType:'live',channelId:providerId,maxResults:'5'});for(const v of rows(s.items)){const id=text(obj(v.id).videoId);if(/^[a-zA-Z0-9_-]{11}$/.test(id))ids.add(id);}}catch{checkBudget();warning='discovery_unavailable';if(!ids.size)throw Error('provider_unavailable');}}
  if(!ids.size)return {providerId,live:null,videos:[],liveSupported:true};
  const data=await youtube('videos',{part:'snippet,liveStreamingDetails,status',id:[...ids].slice(0,30).join(',')});let live:StreamMedia|null=null;const videos:StreamMedia[]=[];
  for(const v of rows(data.items)){const s=obj(v.snippet),l=obj(v.liveStreamingDetails);if(text(s.channelId)!==providerId)throw Error('provider_identity');if(obj(v.status).privacyStatus!=='public')continue;
   const thumbs=obj(s.thumbnails);const image=['maxres','standard','high','medium','default'].map(k=>obj(thumbs[k]).url).find(v=>safeMediaImage('youtube',v));const current=enrich('youtube',media('youtube',text(v.id),s.title,l.actualStartTime||s.publishedAt,`https://www.youtube.com/watch?v=${v.id}`),image,undefined,l.concurrentViewers);
   if(s.liveBroadcastContent==='live'&&text(l.actualStartTime)&&!l.actualEndTime)live=current;
   else if(!Object.keys(l).length&&s.liveBroadcastContent==='none')videos.push(current);
  }
  return {providerId,live,videos,liveSupported:true,...(warning?{warning}:{})};
 }
 if(!a.token)throw Error('tiktok_authorization_required');let token:TikTokToken,updated:string|undefined;try{token=decryptToken(a.token);}catch{throw Error('tiktok_token_invalid');}
 if(token.expiresAt<Date.now()+60000){if(!token.refreshToken||!providerReadiness().tiktok)throw Error('provider_authorization');const d=await json('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',body:new URLSearchParams({client_key:process.env.STREAMER_TIKTOK_CLIENT_KEY!,client_secret:process.env.STREAMER_TIKTOK_CLIENT_SECRET!,grant_type:'refresh_token',refresh_token:token.refreshToken})});if(!text(d.access_token)||!text(d.refresh_token)||!Number.isFinite(Number(d.expires_in)))throw Error('provider_authorization');token={accessToken:text(d.access_token),refreshToken:text(d.refresh_token),expiresAt:Date.now()+Number(d.expires_in)*1000};updated=encryptToken(token);if(onToken)await onToken(updated);}
 const verified=await verifyTikTok(token,a.handle);if(a.providerId&&verified!==a.providerId)throw Error('provider_identity');
 const d=await json('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,cover_image_url',{method:'POST',headers:{Authorization:`Bearer ${token.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({max_count:20})});if(obj(d.error).code!=='ok')throw Error('provider_authorization');const videos=rows(obj(d.data).videos).map(v=>enrich('tiktok',media('tiktok',text(v.id),v.title,new Date(Number(v.create_time)*1000).toISOString(),`https://www.tiktok.com/@${a.handle}/video/${v.id}`),v.cover_image_url));
 return {providerId:verified,token:updated,live:null,videos,liveSupported:false};
}
