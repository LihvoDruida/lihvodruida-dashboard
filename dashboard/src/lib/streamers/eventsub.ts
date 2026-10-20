import 'server-only';
import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {readResponseText} from '@/lib/httpBody';
import {getDocumentDb} from '@/lib/documentDb';
import {streamerAccounts,streamerSettings,ACCOUNTS,type StreamerAccount} from './store';
import {twitch,withProviderBudget} from './providers';
const PATH='/api/integrations/twitch/eventsub';
export function eventSubConfig(){
 const secret=process.env.STREAMER_TWITCH_EVENTSUB_SECRET?.trim()||'';
 const callback=process.env.STREAMER_TWITCH_EVENTSUB_CALLBACK?.trim()||'';
 try{const u=new URL(callback);if(!/^[\x21-\x7e]{32,100}$/.test(secret)||u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!==PATH||u.hostname==='localhost'||/^\d+(?:\.\d+){3}$/.test(u.hostname))return null;return {secret,callback:u.href};}catch{return null;}
}
export class EventSubError extends Error{constructor(readonly status:number){super('Twitch event rejected');}}
export function verifyTwitchEvent(headers:Headers,raw:string,secret:string,now=Date.now()){
 const id=headers.get('twitch-eventsub-message-id')||'',timestamp=headers.get('twitch-eventsub-message-timestamp')||'',signature=headers.get('twitch-eventsub-message-signature')||'';
 const at=Date.parse(timestamp);if(!id||id.length>200||!Number.isFinite(at)||now-at>600000||at-now>60000||!/^sha256=[a-f0-9]{64}$/.test(signature))throw new EventSubError(403);
 const expected=createHmac('sha256',secret).update(id+timestamp+raw).digest();const actual=Buffer.from(signature.slice(7),'hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new EventSubError(403);
 let data:any;try{data=JSON.parse(raw);}catch{throw new EventSubError(400);}
 const type=headers.get('twitch-eventsub-message-type');const subscription=data?.subscription;
 if(!subscription||!['stream.online','stream.offline'].includes(subscription.type)||subscription.version!=='1'||headers.get('twitch-eventsub-subscription-type')!==subscription.type||headers.get('twitch-eventsub-subscription-version')!=='1'||!/^\d{1,30}$/.test(subscription.condition?.broadcaster_user_id))throw new EventSubError(400);
 if(!['webhook_callback_verification','notification','revocation'].includes(type||''))throw new EventSubError(400);
 if(type==='notification'&&(data.event?.broadcaster_user_id!==subscription.condition.broadcaster_user_id||(subscription.type==='stream.online'&&(!/^\d{1,30}$/.test(data.event.id)||!Number.isFinite(Date.parse(data.event.started_at))))))throw new EventSubError(400);
 if(type==='webhook_callback_verification'&&(typeof data.challenge!=='string'||data.challenge.length>1024))throw new EventSubError(400);
 return {id,at,type,data,providerId:subscription.condition.broadcaster_user_id as string};
}
export async function acceptTwitchEvent(request:Request){
 const config=eventSubConfig();if(!config)throw new EventSubError(503);
 if(!/^application\/json\b/i.test(request.headers.get('content-type')||''))throw new EventSubError(415);
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]);
 const raw=await readResponseText(new Response(request.body),{maxBytes:64*1024,signal});const event=verifyTwitchEvent(request.headers,raw,config.secret);
 const settings=await streamerSettings();const accounts=(await streamerAccounts()).filter(a=>a.enabled&&a.platform==='twitch'&&a.providerId===event.providerId);
 if(!settings.enabled||!accounts.length)throw new EventSubError(404);
 if(event.type==='webhook_callback_verification')return {challenge:event.data.challenge as string,accountId:''};
 const ref=getDocumentDb().collection('streamerTwitchSignals').doc(createHash('sha256').update(event.providerId).digest('hex'));
 const accepted=await getDocumentDb().runTransaction(async tx=>{
  const old=(await tx.get(ref)).data();if(old?.messageId===event.id||Number(old?.timestamp)>=event.at)return false;
  // Persist only one latest signal per broadcaster; a duplicate or old replay cannot regress it.
  const snapshots=await Promise.all(accounts.map(a=>tx.get(getDocumentDb().collection(ACCOUNTS).doc(a.id))));
  tx.set(ref,{messageId:event.id,timestamp:event.at,type:event.data.subscription.type,status:event.type==='revocation'?'revoked':'pending',receivedAt:Date.now()});
  snapshots.forEach((snapshot,index)=>{const a=snapshot.data() as StreamerAccount|undefined;if(a?.enabled&&a.revision===accounts[index].revision&&event.type==='notification')tx.update(getDocumentDb().collection(ACCOUNTS).doc(a.id),{state:{...(a.state||{}),nextCheckAt:0}});});return event.type==='notification';
 });
 return {accountId:accepted?accounts[0].id:''};
}
/** Reconcile only our callback. Never delete another integration's subscriptions. */
export async function ensureTwitchSubscriptions(){return withProviderBudget(AbortSignal.timeout(8000),ensureSubscriptions);}
async function ensureSubscriptions(){
 const config=eventSubConfig();if(!config||(await streamerSettings()).enabled!==true)return {enabled:false};
 const db=getDocumentDb(),ref=db.collection('streamerProviderQuota').doc('twitch-eventsub');
 const claimed=await db.runTransaction(async tx=>{const old=(await tx.get(ref)).data();if(Number(old?.nextAt)>Date.now())return false;tx.set(ref,{...old,nextAt:Date.now()+15*60000});return true;});
 if(!claimed)return {enabled:true,skipped:true};
 try{
  const accounts=(await streamerAccounts()).filter(a=>a.enabled&&a.platform==='twitch'&&/^\d+$/.test(a.providerId));
  const existing:any[]=[];let cursor='';
  for(let page=0;page<20;page++){const r=await twitch('eventsub/subscriptions'+(cursor?'?after='+encodeURIComponent(cursor):''));if(!Array.isArray(r.data))throw Error('provider_schema');existing.push(...r.data);cursor=String((r.pagination as {cursor?:string})?.cursor||'');if(!cursor)break;if(page===19)throw Error('eventsub_page_limit');}
  let created=0;
  for(const a of accounts)for(const type of ['stream.online','stream.offline']){
   const matching=existing.filter(x=>x.type===type&&x.condition?.broadcaster_user_id===a.providerId&&x.transport?.method==='webhook'&&x.transport.callback===config.callback);
   if(matching.some(x=>['enabled','webhook_callback_verification_pending'].includes(x.status)))continue;
   // Remove only a revoked subscription for this exact callback before recreating it.
   for(const old of matching)await twitch('eventsub/subscriptions?id='+encodeURIComponent(String(old.id)),false,{method:'DELETE'});
   try{await twitch('eventsub/subscriptions',false,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,version:'1',condition:{broadcaster_user_id:a.providerId},transport:{method:'webhook',callback:config.callback,secret:config.secret}})});created++;}catch(error){if((error as {status?:number}).status!==409)throw error;}
  }
  await ref.set({nextAt:Date.now()+15*60000,status:'ok',checkedAt:Date.now(),created});return {enabled:true,created};
 }catch{await ref.set({nextAt:Date.now()+5*60000,status:'unavailable',checkedAt:Date.now()});return {enabled:true,error:'unavailable'};}
}
