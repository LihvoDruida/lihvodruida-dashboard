import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {pgQuery,pgTransaction} from '@/lib/db/pgPool';
import {getDocumentDb} from '@/lib/documentDb';
import {discordApi,getDiscordGuildId} from '@/lib/discordAdmin';
import {assertStorageWriteAvailable} from '@/lib/storageAccess';
import {STREAMER_LIMIT,STREAMER_SCHEMA,channelIdentity,type StreamMedia,type StreamPlatform,type PublicStreamers} from './contract';
import {prepareTikTokToken,providerReadiness,resolveProvider,type Observation} from './providers';
export const ACCOUNTS='guildStreamers',EVENTS='guildStreamerEvents';
export type StreamerSettings={enabled:boolean;siteEnabled:boolean;discordEnabled:boolean;channelId:string;revision:string};
export type StreamerState={initializedAt:number;videoIds:string[];live:StreamMedia|null;checkedAt:number;expiresAt:number;status:string;nextCheckAt:number;membershipAt:number;memberActive:boolean;lastSearchAt:number};
export type StreamerAccount={id:string;memberId:string;memberName:string;platform:StreamPlatform;handle:string;channelUrl:string;providerId:string;token?:string;enabled:boolean;siteEnabled:boolean;notifyLive:boolean;notifyVideos:boolean;revision:string;createdAt:number;updatedAt:number;state:StreamerState|null};
export type StreamerEvent={id:string;accountId:string;accountRevision:string;settingsRevision:string;channelId:string;kind:'live'|'video';media:StreamMedia;memberName:string;platform:StreamPlatform;state:string;dueAtMs:number;attempts:number;createdAt:number;messageId?:string};
const settingsRef=()=>getDocumentDb().collection('dashboardSettings').doc('guildStreamers');
export async function streamerSettings():Promise<StreamerSettings>{const s=(await settingsRef().get()).data()||{};return {enabled:s.enabled===true,siteEnabled:s.siteEnabled===true,discordEnabled:s.discordEnabled===true,channelId:String(s.channelId||''),revision:String(s.revision||'initial')};}
export async function streamerAccounts():Promise<StreamerAccount[]>{const s=await getDocumentDb().collection(ACCOUNTS).limit(STREAMER_LIMIT+1).get();if(s.docs.length>STREAMER_LIMIT)throw Error('streamer_limit');return s.docs.map(d=>({...d.data(),id:d.id}) as StreamerAccount);}
export function adminAccount(a:StreamerAccount){return {id:a.id,memberId:a.memberId,memberName:a.memberName,platform:a.platform,handle:a.handle,channelUrl:a.channelUrl,enabled:a.enabled,siteEnabled:a.siteEnabled,notifyLive:a.notifyLive,notifyVideos:a.notifyVideos,revision:a.revision,authorized:!!a.token,status:a.state?.status||'not_checked',checkedAt:a.state?.checkedAt||0,live:a.state?.live||null};}
export async function verifyMember(id:string){if(!/^\d{16,25}$/.test(id)||!/^\d{16,25}$/.test(getDiscordGuildId()))throw Error('Вкажи Discord ID учасника та підключи Discord-сервер.');const m=await discordApi<{user?:{id?:string;bot?:boolean;global_name?:string;username?:string};nick?:string}>(`/guilds/${getDiscordGuildId()}/members/${id}`);if(m.user?.id!==id||m.user.bot)throw Error('Потрібен чинний учасник гільдії, який не є ботом.');return String(m.nick||m.user.global_name||m.user.username||'Учасник').slice(0,80);}
export async function verifyChannel(id:string){if(!/^\d{16,25}$/.test(id))throw Error('Обери текстовий Discord-канал.');const c=await discordApi<{guild_id?:string;type?:number}>(`/channels/${id}`);if(c.guild_id!==getDiscordGuildId()||![0,5].includes(Number(c.type)))throw Error('Канал має бути текстовим каналом цього Discord-сервера.');}
export async function saveStreamerSettings(input:Record<string,unknown>){
 assertStorageWriteAvailable('settings');if(typeof input.enabled!=='boolean'||typeof input.siteEnabled!=='boolean'||typeof input.discordEnabled!=='boolean')throw Error('Некоректні налаштування.');
 const channelId=String(input.channelId||'');if(input.discordEnabled)await verifyChannel(channelId);else if(channelId&&!/^\d{16,25}$/.test(channelId))throw Error('Некоректний канал.');
 return getDocumentDb().runTransaction(async tx=>{const current=(await tx.get(settingsRef())).data();if(String(current?.revision||'initial')!==input.revision)throw Error('Налаштування вже змінено. Онови сторінку.');const settings={enabled:input.enabled===true,siteEnabled:input.siteEnabled===true,discordEnabled:input.discordEnabled===true,channelId,revision:randomUUID()};tx.set(settingsRef(),settings);return settings;});
}
export async function saveStreamer(input:Record<string,unknown>){
 assertStorageWriteAvailable('settings');if(!['twitch','youtube','tiktok'].includes(String(input.platform)))throw Error('Обери платформу.');
 const platform=input.platform as StreamPlatform,identity=channelIdentity(platform,String(input.channel||'')),memberId=String(input.memberId||'');
 const memberName=await verifyMember(memberId);const id=String(input.id||randomUUID());if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Некоректний запис.');
 for(const key of ['enabled','siteEnabled','notifyLive','notifyVideos'])if(typeof input[key]!=='boolean')throw Error('Некоректні перемикачі.');
 if(platform==='tiktok'&&input.notifyLive)throw Error('Офіційний TikTok Display API не надає LIVE-статус.');
 let providerId=providerReadiness()[platform]?await resolveProvider(platform,identity.handle):'';let token:string|undefined;
 if(platform==='tiktok'&&input.accessToken){const prepared=await prepareTikTokToken(identity.handle,String(input.accessToken),String(input.refreshToken||''));providerId=prepared.providerId;token=prepared.token;}
 return pgTransaction(async client=>{
  await pgQuery("INSERT INTO documents(collection,doc_id,data) VALUES ('dashboardSettings','guildStreamers',$1::jsonb) ON CONFLICT(collection,doc_id) DO UPDATE SET updated_at=now()",[JSON.stringify({enabled:false,siteEnabled:true,discordEnabled:false,channelId:'',revision:'initial'})],client);
  const records=await pgQuery<{doc_id:string;data:StreamerAccount}>("SELECT doc_id,data FROM documents WHERE collection=$1 LIMIT 31 FOR UPDATE",[ACCOUNTS],client);
  const all=records.rows;const current=all.find(d=>d.doc_id===id)?.data;
  if(current?current.revision!==input.revision:!!input.id)throw Error('Запис уже змінено. Онови сторінку.');
  if(!current&&all.length>=STREAMER_LIMIT)throw Error(`Можна додати до ${STREAMER_LIMIT} каналів.`);
  if(all.some(d=>d.doc_id!==id&&d.data.platform===platform&&(d.data.handle===identity.handle||(providerId&&d.data.providerId===providerId))))throw Error('Цей канал уже додано.');
  if(platform==='youtube'&&!current&&all.filter(d=>d.data.platform==='youtube').length>=5)throw Error('Ліміт YouTube — 5 каналів, щоб берегти квоту API.');
  const identityChanged=!current||current.platform!==platform||current.handle!==identity.handle||current.memberId!==memberId;const changed=identityChanged||(!current!.enabled&&input.enabled===true);
  const account:StreamerAccount={id,memberId,memberName,platform,...identity,providerId:providerId||(!identityChanged?current?.providerId:'')||'',enabled:input.enabled===true,siteEnabled:input.siteEnabled===true,notifyLive:input.notifyLive===true,notifyVideos:input.notifyVideos===true,revision:randomUUID(),createdAt:current?.createdAt||Date.now(),updatedAt:Date.now(),state:changed?null:current!.state,...((token||(!identityChanged&&current?.token))?{token:token||current!.token}:{})};
  await pgQuery('INSERT INTO documents(collection,doc_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(collection,doc_id) DO UPDATE SET data=EXCLUDED.data',[ACCOUNTS,id,JSON.stringify(account)],client);return adminAccount(account);
 },{isolation:'read committed'});
}
export async function deleteStreamer(id:string,revision:string){assertStorageWriteAvailable('settings');if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Некоректний запис.');const ref=getDocumentDb().collection(ACCOUNTS).doc(id);await getDocumentDb().runTransaction(async tx=>{const d=(await tx.get(ref)).data();if(d?.revision!==revision)throw Error('Запис уже змінено. Онови сторінку.');tx.delete(ref);});}
export async function currentAccount(id:string){const d=await getDocumentDb().collection(ACCOUNTS).doc(id).get();return d.exists?({...d.data(),id:d.id}) as StreamerAccount:null;}
export async function storeToken(a:StreamerAccount,token:string){const ref=getDocumentDb().collection(ACCOUNTS).doc(a.id);await getDocumentDb().runTransaction(async tx=>{const d=(await tx.get(ref)).data();if(d?.revision!==a.revision)throw Error('account_changed');tx.update(ref,{token});});}
export async function reserveYouTubeSearch(account:StreamerAccount,count:number){
 const now=Date.now();if(now-(account.state?.lastSearchAt||0)<Math.max(20*60000,86400000*Math.max(1,count)/72))return false;
 const ref=getDocumentDb().collection('streamerProviderQuota').doc('youtube-search');return getDocumentDb().runTransaction(async tx=>{const d=(await tx.get(ref)).data();const times=(Array.isArray(d?.times)?d.times:[]).filter((v:unknown)=>typeof v==='number'&&now-v<86400000);if(times.length>=80)return false;tx.set(ref,{times:[...times,now]});return true;});
}
export function observedEvents(a:StreamerAccount,observation:Observation,settings:StreamerSettings,now:number){
 const old=a.state;const events:Array<{kind:'live'|'video';media:StreamMedia}>=[];
 if(a.notifyLive&&observation.live&&observation.live.id!==old?.live?.id)events.push({kind:'live',media:observation.live});
 if(a.notifyVideos&&old?.initializedAt)for(const v of observation.videos)if(!old.videoIds.includes(v.id)&&Date.parse(v.publishedAt)>old.initializedAt&&now-Date.parse(v.publishedAt)<86400000&&Date.parse(v.publishedAt)<=now+60000)events.push({kind:'video',media:v});
 return events.filter(()=>settings.enabled&&settings.discordEnabled&&!!settings.channelId).slice(0,20);
}
export async function commitObservation(a:StreamerAccount,o:Observation,settings:StreamerSettings,searched:boolean){
 const now=Date.now(),ref=getDocumentDb().collection(ACCOUNTS).doc(a.id),events=observedEvents(a,o,settings,now);
 await getDocumentDb().runTransaction(async tx=>{
  const d=(await tx.get(ref)).data();if(d?.revision!==a.revision||d.enabled!==true)return;
  const latestSettings=(await tx.get(settingsRef())).data();
  const ready=latestSettings?.revision===settings.revision&&latestSettings?.enabled===true;
  const eventRefs=events.map(e=>{const id=createHash('sha256').update([a.id,a.platform,a.handle,e.kind,e.media.id].join(':')).digest('hex');return {e,id,ref:getDocumentDb().collection(EVENTS).doc(id)};});
  const previous=await Promise.all(eventRefs.map(e=>tx.get(e.ref)));
  const state:StreamerState={initializedAt:a.state?.initializedAt||now,videoIds:[...new Set([...o.videos.map(v=>v.id),...(a.state?.videoIds||[])])].slice(0,100),live:o.live,checkedAt:now,expiresAt:now+300000,status:o.warning||'ok',nextCheckAt:now+(a.platform==='twitch'||o.live?60000:300000),membershipAt:now,memberActive:true,lastSearchAt:searched?now:a.state?.lastSearchAt||0};
  tx.update(ref,{providerId:o.providerId,state,...(o.token?{token:o.token}:{})});
  if(ready)eventRefs.forEach((e,index)=>{if(!previous[index].exists)tx.set(e.ref,{id:e.id,accountId:a.id,accountRevision:a.revision,settingsRevision:settings.revision,channelId:settings.channelId,kind:e.e.kind,media:e.e.media,memberName:a.memberName,platform:a.platform,state:'pending',dueAtMs:now,attempts:0,createdAt:now} satisfies StreamerEvent);});
 });
}
export async function recordStreamerError(a:StreamerAccount,status:string){const ref=getDocumentDb().collection(ACCOUNTS).doc(a.id);await getDocumentDb().runTransaction(async tx=>{const d=(await tx.get(ref)).data();if(d?.revision!==a.revision)return;const old=(d.state||{}) as Partial<StreamerState>;tx.update(ref,{state:{...old,status,nextCheckAt:Date.now()+300000,...(status==='member_missing'?{memberActive:false,live:null,expiresAt:0}:{})}});});}
export async function publicStreamers():Promise<PublicStreamers>{const settings=await streamerSettings();const now=Date.now();const items=settings.enabled&&settings.siteEnabled?(await streamerAccounts()).filter(a=>a.enabled&&a.siteEnabled&&a.state?.memberActive&&a.state.live&&a.state.expiresAt>now).map(a=>({id:a.id,memberName:a.memberName,platform:a.platform,channelUrl:a.channelUrl,live:a.state!.live!,expiresAt:new Date(a.state!.expiresAt).toISOString()})):[];return {schema:STREAMER_SCHEMA,checked_at:new Date(now).toISOString(),items};}
