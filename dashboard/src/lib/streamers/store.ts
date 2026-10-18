import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {pgQuery,pgTransaction} from '@/lib/db/pgPool';
import {getDocumentDb} from '@/lib/documentDb';
import {discordApi,getDiscordGuildId} from '@/lib/discordAdmin';
import {assertStorageWriteAvailable} from '@/lib/storageAccess';
import {STREAMER_LIMIT,STREAMER_SCHEMA,channelIdentity,type StreamMedia,type StreamPlatform,type PublicStreamers} from './contract';
import {StreamerInputError,classifyStreamerError} from './problems';
import {recordStreamerDiagnostic} from './diagnostics';
import {prepareTikTokToken,providerReadiness,resolveProvider,type Observation} from './providers';
export const ACCOUNTS='guildStreamers',EVENTS='guildStreamerEvents';
export type StreamerSettings={enabled:boolean;siteEnabled:boolean;discordEnabled:boolean;channelId:string;revision:string};
export type StreamerState={initializedAt:number;videoIds:string[];live:StreamMedia|null;checkedAt:number;expiresAt:number;status:string;nextCheckAt:number;membershipAt:number;memberActive:boolean;lastSearchAt:number;attemptedAt?:number;failures?:number};
export type StreamerAccount={id:string;memberId:string;memberName:string;platform:StreamPlatform;handle:string;channelUrl:string;providerId:string;token?:string;enabled:boolean;siteEnabled:boolean;notifyLive:boolean;notifyVideos:boolean;revision:string;createdAt:number;updatedAt:number;state:StreamerState|null};
export type StreamerEvent={id:string;accountId:string;accountRevision:string;settingsRevision:string;channelId:string;kind:'live'|'video';media:StreamMedia;memberName:string;platform:StreamPlatform;state:string;dueAtMs:number;attempts:number;createdAt:number;messageId?:string;lastError?:string};
const settingsRef=()=>getDocumentDb().collection('dashboardSettings').doc('guildStreamers');
export async function streamerSettings():Promise<StreamerSettings>{const s=(await settingsRef().get()).data()||{};return {enabled:s.enabled===true,siteEnabled:s.siteEnabled===true,discordEnabled:s.discordEnabled===true,channelId:String(s.channelId||''),revision:String(s.revision||'initial')};}
export async function streamerAccounts():Promise<StreamerAccount[]>{const s=await getDocumentDb().collection(ACCOUNTS).limit(STREAMER_LIMIT+1).get();if(s.docs.length>STREAMER_LIMIT)throw Error('streamer_limit');return s.docs.map(d=>({...d.data(),id:d.id}) as StreamerAccount);}
export function adminAccount(a:StreamerAccount){
 const state=a.state,ready=providerReadiness()[a.platform];
 const status=!ready?'provider_not_configured':a.platform==='tiktok'&&!a.token?'tiktok_authorization_required':state?.status||'not_checked';
 return {id:a.id,memberId:a.memberId,memberName:a.memberName,platform:a.platform,handle:a.handle,channelUrl:a.channelUrl,enabled:a.enabled,siteEnabled:a.siteEnabled,notifyLive:a.notifyLive,notifyVideos:a.notifyVideos,revision:a.revision,authorized:!!a.token,status,checkedAt:state?.checkedAt||0,attemptedAt:state?.attemptedAt||state?.checkedAt||0,nextCheckAt:state?.nextCheckAt||0,failures:state?.failures||0,live:state?.live&&state.expiresAt>Date.now()&&state.memberActive?state.live:null};
}
export async function verifyMember(id:string){if(!/^\d{16,25}$/.test(id)||!/^\d{16,25}$/.test(getDiscordGuildId()))throw Error('Вкажи Discord ID учасника та підключи Discord-сервер.');const m=await discordApi<{user?:{id?:string;bot?:boolean;global_name?:string;username?:string};nick?:string}>(`/guilds/${getDiscordGuildId()}/members/${id}`);if(m.user?.id!==id||m.user.bot)throw Error('Потрібен чинний учасник гільдії, який не є ботом.');return String(m.nick||m.user.global_name||m.user.username||'Учасник').slice(0,80);}
export async function verifyChannel(id:string){if(!/^\d{16,25}$/.test(id))throw Error('Обери текстовий Discord-канал.');const c=await discordApi<{guild_id?:string;type?:number}>(`/channels/${id}`);if(c.guild_id!==getDiscordGuildId()||![0,5].includes(Number(c.type)))throw Error('Канал має бути текстовим каналом цього Discord-сервера.');}
export async function saveStreamerSettings(input:Record<string,unknown>){
 assertStorageWriteAvailable('settings');if(typeof input.enabled!=='boolean'||typeof input.siteEnabled!=='boolean'||typeof input.discordEnabled!=='boolean')throw Error('Некоректні налаштування.');
 const channelId=String(input.channelId||'');if(input.discordEnabled)await verifyChannel(channelId);else if(channelId&&!/^\d{16,25}$/.test(channelId))throw Error('Некоректний канал.');
 return getDocumentDb().runTransaction(async tx=>{const current=(await tx.get(settingsRef())).data();if(String(current?.revision||'initial')!==input.revision)throw Error('Налаштування вже змінено. Онови сторінку.');const settings={enabled:input.enabled===true,siteEnabled:input.siteEnabled===true,discordEnabled:input.discordEnabled===true,channelId,revision:randomUUID()};tx.set(settingsRef(),settings);return settings;});
}
async function prepareAccount(input:Record<string,unknown>,memberId:string,memberName:string,current?:StreamerAccount){
 if(!['twitch','youtube','tiktok'].includes(String(input.platform)))throw new StreamerInputError('invalid_input');
 const platform=input.platform as StreamPlatform;let identity:ReturnType<typeof channelIdentity>;
 try{identity=channelIdentity(platform,String(input.channel||''));}catch{throw new StreamerInputError('channel_invalid',platform);}
 const id=String(input.id||randomUUID());if(!/^[a-f0-9-]{36}$/.test(id))throw new StreamerInputError('invalid_input',platform);
 for(const key of ['enabled','siteEnabled','notifyLive','notifyVideos'])if(typeof input[key]!=='boolean')throw new StreamerInputError('invalid_input',platform);
 if(platform==='tiktok'&&input.notifyLive)throw new StreamerInputError('invalid_input',platform);
 if(String(input.accessToken||'').length>4096||String(input.refreshToken||'').length>4096||input.refreshToken&&!input.accessToken)throw new StreamerInputError('invalid_input',platform);
 const identityChanged=!current||current.platform!==platform||current.handle!==identity.handle||current.memberId!==memberId;
 let providerId=!identityChanged?current?.providerId||'':'';let token:string|undefined;
 try{
  if(!providerId&&providerReadiness()[platform])providerId=await resolveProvider(platform,identity.handle);
  if(platform==='tiktok'&&input.accessToken){const prepared=await prepareTikTokToken(identity.handle,String(input.accessToken),String(input.refreshToken||''));providerId=prepared.providerId;token=prepared.token;}
 }catch(error){throw new StreamerInputError(classifyStreamerError(error,'provider_unavailable').code,platform);}
 return {input,id,platform,identity,providerId,token,memberId,memberName};
}
type PreparedAccount=Awaited<ReturnType<typeof prepareAccount>>;
function accountRecord(p:PreparedAccount,current?:StreamerAccount):StreamerAccount{
 const changed=!current||current.platform!==p.platform||current.handle!==p.identity.handle||current.memberId!==p.memberId||!current.enabled&&p.input.enabled===true;
 // Re-enabling the same channel keeps creator authorization but restarts the video baseline.
 const sameIdentity=current?.platform===p.platform&&current.handle===p.identity.handle&&current.memberId===p.memberId;
 const keptToken=p.token||(sameIdentity?current?.token:undefined);
 const account:StreamerAccount={id:p.id,memberId:p.memberId,memberName:p.memberName,platform:p.platform,...p.identity,providerId:p.providerId||(sameIdentity?current?.providerId:'')||'',enabled:p.input.enabled===true,siteEnabled:p.platform!=='tiktok'&&p.input.siteEnabled===true,notifyLive:p.platform!=='tiktok'&&p.input.notifyLive===true,notifyVideos:p.input.notifyVideos===true,revision:randomUUID(),createdAt:current?.createdAt||Date.now(),updatedAt:Date.now(),state:changed?null:current!.state,...(keptToken?{token:keptToken}:{})};
 const fields=['memberId','memberName','platform','handle','channelUrl','providerId','enabled','siteEnabled','notifyLive','notifyVideos','token'] as const;
 return current&&fields.every(field=>current[field]===account[field])?current:account;
}
async function lockAccounts(client:Parameters<typeof pgQuery>[2]){
 await pgQuery("INSERT INTO documents(collection,doc_id,data) VALUES ('dashboardSettings','guildStreamers',$1::jsonb) ON CONFLICT(collection,doc_id) DO UPDATE SET updated_at=now()",[JSON.stringify({enabled:false,siteEnabled:true,discordEnabled:false,channelId:'',revision:'initial'})],client);
 return (await pgQuery<{doc_id:string;data:StreamerAccount}>("SELECT doc_id,data FROM documents WHERE collection=$1 LIMIT 31 FOR UPDATE",[ACCOUNTS],client)).rows.map(row=>({...row.data,id:row.doc_id}));
}
function assertAccounts(accounts:StreamerAccount[]){
 if(accounts.length>STREAMER_LIMIT||accounts.filter(a=>a.platform==='youtube').length>5)throw new StreamerInputError('account_limit');
 const seen=new Set<string>(),providers=new Set<string>();
 for(const a of accounts){const handle=a.platform==='youtube'&&!a.handle.startsWith('@')?a.handle:a.handle.toLowerCase();const key=a.platform+':'+handle,provider=a.providerId?a.platform+':'+a.providerId:'';if(seen.has(key)||provider&&providers.has(provider))throw new StreamerInputError('duplicate_channel',a.platform);seen.add(key);if(provider)providers.add(provider);}
}
async function writeAccount(account:StreamerAccount,client:Parameters<typeof pgQuery>[2]){await pgQuery('INSERT INTO documents(collection,doc_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(collection,doc_id) DO UPDATE SET data=EXCLUDED.data',[ACCOUNTS,account.id,JSON.stringify(account)],client);}
export async function saveStreamer(input:Record<string,unknown>){
 assertStorageWriteAvailable('settings');const memberId=String(input.memberId||''),memberName=await verifyMember(memberId);
 const before=input.id?await currentAccount(String(input.id)):null;
 const prepared=await prepareAccount(input,memberId,memberName,before||undefined);
 return pgTransaction(async client=>{
  const all=await lockAccounts(client),current=all.find(a=>a.id===prepared.id);
  if(current?current.revision!==input.revision:!!input.id)throw new StreamerInputError('revision_conflict');
  const account=accountRecord(prepared,current);assertAccounts([...all.filter(a=>a.id!==account.id),account]);await writeAccount(account,client);return adminAccount(account);
 },{isolation:'read committed'});
}
export async function saveStreamerMember(input:Record<string,unknown>){
 assertStorageWriteAvailable('settings');const memberId=String(input.memberId||'');
 if(!/^\d{16,25}$/.test(memberId)||!Array.isArray(input.channels)||!input.channels.length||input.channels.length>30||!Array.isArray(input.expected)||input.expected.length>30)throw new StreamerInputError('invalid_input','memberId');
 const before=(await streamerAccounts()).filter(a=>a.memberId===memberId);
 const expected=input.expected.map((v:unknown)=>{if(!v||typeof v!=='object'||typeof (v as {id?:unknown}).id!=='string'||typeof (v as {revision?:unknown}).revision!=='string')throw new StreamerInputError('invalid_input');return v as {id:string;revision:string};});
 const signature=(items:{id:string;revision:string}[])=>JSON.stringify(items.map(a=>[a.id,a.revision]).sort((a,b)=>a[0].localeCompare(b[0])));
 if(signature(before)!==signature(expected))throw new StreamerInputError('revision_conflict');
 let memberName:string;
 try{memberName=await verifyMember(memberId);}catch(error){const status=(error as {status?:number})?.status;throw new StreamerInputError(status===404?'member_missing':[401,403,429].includes(status||0)?'discord_'+status:'discord_unavailable','memberId');}
 const prepared:PreparedAccount[]=[];
 for(const value of input.channels){if(!value||typeof value!=='object'||Array.isArray(value))throw new StreamerInputError('invalid_input');const row=value as Record<string,unknown>;const old=before.find(a=>a.id===row.id);if(row.id&&(!old||row.revision!==old.revision))throw new StreamerInputError('revision_conflict');prepared.push(await prepareAccount(row,memberId,memberName,old));}
 if(new Set(prepared.map(p=>p.id)).size!==prepared.length)throw new StreamerInputError('invalid_input');
 return pgTransaction(async client=>{
  const all=await lockAccounts(client),current=all.filter(a=>a.memberId===memberId);
  if(signature(current)!==signature(expected))throw new StreamerInputError('revision_conflict');
  const accounts=prepared.map(p=>accountRecord(p,current.find(a=>a.id===p.id)));assertAccounts([...all.filter(a=>a.memberId!==memberId),...accounts]);
  for(const account of accounts)await writeAccount(account,client);
  for(const old of current)if(!accounts.some(a=>a.id===old.id))await pgQuery('DELETE FROM documents WHERE collection=$1 AND doc_id=$2',[ACCOUNTS,old.id],client);
  return {memberId,memberName,accounts:accounts.map(adminAccount)};
 },{isolation:'read committed'});
}
export async function deleteStreamerMember(input:Record<string,unknown>){
 assertStorageWriteAvailable('settings');const memberId=String(input.memberId||'');
 if(!/^\d{16,25}$/.test(memberId)||!Array.isArray(input.expected)||!input.expected.length||input.expected.length>30)throw new StreamerInputError('invalid_input');
 const expected=input.expected as {id?:string;revision?:string}[];
 return pgTransaction(async client=>{
  const all=await lockAccounts(client),current=all.filter(a=>a.memberId===memberId);
  if(current.length!==expected.length||current.some(a=>!expected.some(e=>e&&e.id===a.id&&e.revision===a.revision)))throw new StreamerInputError('revision_conflict');
  for(const a of current)await pgQuery('DELETE FROM documents WHERE collection=$1 AND doc_id=$2',[ACCOUNTS,a.id],client);
  return {deleted:true,count:current.length};
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
 const committed=await getDocumentDb().runTransaction(async tx=>{
  const d=(await tx.get(ref)).data();if(d?.revision!==a.revision||d.enabled!==true)return;
  const latestSettings=(await tx.get(settingsRef())).data();
  const ready=latestSettings?.revision===settings.revision&&latestSettings?.enabled===true;
  const eventRefs=events.map(e=>{const id=createHash('sha256').update([a.id,a.platform,a.handle,e.kind,e.media.id].join(':')).digest('hex');return {e,id,ref:getDocumentDb().collection(EVENTS).doc(id)};});
  const previous=await Promise.all(eventRefs.map(e=>tx.get(e.ref)));
  const state:StreamerState={initializedAt:a.state?.initializedAt||now,videoIds:[...new Set([...o.videos.map(v=>v.id),...(a.state?.videoIds||[])])].slice(0,100),live:o.live,checkedAt:now,expiresAt:now+300000,status:o.warning||'ok',attemptedAt:now,failures:0,nextCheckAt:now+(a.platform==='twitch'||o.live?60000:300000),membershipAt:now,memberActive:true,lastSearchAt:searched?now:a.state?.lastSearchAt||0};
  tx.update(ref,{providerId:o.providerId,state,...(o.token?{token:o.token}:{})});
  if(ready)eventRefs.forEach((e,index)=>{if(!previous[index].exists)tx.set(e.ref,{id:e.id,accountId:a.id,accountRevision:a.revision,settingsRevision:settings.revision,channelId:settings.channelId,kind:e.e.kind,media:e.e.media,memberName:a.memberName,platform:a.platform,state:'pending',dueAtMs:now,attempts:0,createdAt:now} satisfies StreamerEvent);});
  return true;
 });
 if(committed&&a.state?.status!==(o.warning||'ok'))await recordStreamerDiagnostic({code:o.warning||'ok',level:o.warning?'warning':'success',stage:'check',accountId:a.id,platform:a.platform,memberName:a.memberName});
}
export async function recordStreamerError(a:StreamerAccount,status:string){
 const ref=getDocumentDb().collection(ACCOUNTS).doc(a.id);
 const changed=await getDocumentDb().runTransaction(async tx=>{const d=(await tx.get(ref)).data();if(d?.revision!==a.revision)return false;const old=(d.state||{}) as Partial<StreamerState>;tx.update(ref,{state:{...old,status,attemptedAt:Date.now(),failures:(old.failures||0)+1,nextCheckAt:Date.now()+300000,...(status==='member_missing'?{memberActive:false,live:null,expiresAt:0}:{})}});return old.status!==status;});
 if(changed)await recordStreamerDiagnostic({code:status,level:'warning',stage:'check',accountId:a.id,platform:a.platform,memberName:a.memberName});
}
export async function publicStreamers():Promise<PublicStreamers>{const settings=await streamerSettings();const now=Date.now();const items=settings.enabled&&settings.siteEnabled?(await streamerAccounts()).filter(a=>a.enabled&&a.siteEnabled&&a.state?.memberActive&&a.state.live&&a.state.expiresAt>now).map(a=>({id:a.id,memberName:a.memberName,platform:a.platform,channelUrl:a.channelUrl,live:a.state!.live!,expiresAt:new Date(a.state!.expiresAt).toISOString()})):[];return {schema:STREAMER_SCHEMA,checked_at:new Date(now).toISOString(),items};}
