import 'server-only';
import {acquireAutomationLease} from '@/lib/automationLease';
import {getDocumentDb} from '@/lib/documentDb';
import {discordApi,findDiscordPublicationMessage} from '@/lib/discordAdmin';
import {DiscordRestError} from '@/lib/discordRest';
import {publicationRevision,runDiscordPublicationCreation,withDiscordPublicationLease,DiscordPublicationNotSentError,DiscordPublicationPendingError} from '@/lib/discordPublication';
import {EVENTS,maintainStreamerMetadata,streamerSettings,streamerAccounts,verifyMember,verifyChannel,commitObservation,recordStreamerError,reserveYouTubeSearch,currentAccount,storeToken,type StreamerAccount,type StreamerEvent} from './store';
import {streamerDiscordMessage} from './message';
import {observeProvider} from './providers';
import {classifyStreamerError} from './problems';
import {recordStreamerDiagnostic} from './diagnostics';
export function eventStillWanted(event:StreamerEvent,account:StreamerAccount|null,settings:Awaited<ReturnType<typeof streamerSettings>>,now=Date.now()){
 return !!(!event.metadataPurgedAt&&account?.enabled&&account.state?.status!=='duplicate_channel'&&settings.enabled&&settings.discordEnabled&&settings.channelId===event.channelId&&settings.revision===event.settingsRevision&&account.revision===event.accountRevision&&now-event.createdAt<86400000&&(event.kind==='live'?account.notifyLive&&account.state?.live?.id===event.media.id&&account.state.expiresAt>now:account.notifyVideos));
}
async function deliver(event:StreamerEvent,assertLease:()=>Promise<void>,signal:AbortSignal){
 signal.throwIfAborted();
 const ref=getDocumentDb().collection(EVENTS).doc(event.id);
 const check=async()=>{signal.throwIfAborted();await assertLease();const [account,settings]=await Promise.all([currentAccount(event.accountId),streamerSettings()]);if(!eventStillWanted(event,account,settings))throw Error('streamer_event_cancelled');return account!;};
 if(!eventStillWanted(event,await currentAccount(event.accountId),await streamerSettings())){await ref.update({state:'cancelled',dueAtMs:0});return 'cancelled';}
 try{
  await withDiscordPublicationLease('streamer:'+event.id,async owned=>{
   await owned();await check();
   await runDiscordPublicationCreation({kind:'guild-streamer',resourceId:event.id,collection:EVENTS,target:event.channelId,revision:publicationRevision([event.kind,event.media.id,event.channelId]),assertOwned:async()=>{await owned();await assertLease();},
    create:async operation=>{
     let dispatched=false;
     try{
     const member=await check();await verifyMember(member.memberId,signal);await verifyChannel(event.channelId,signal);
     return await discordApi<Record<string,unknown>>(`/channels/${event.channelId}/messages`,{method:'POST',retry:'never',signal,onDispatch:()=>{dispatched=true;},beforeSend:async()=>{await owned();await check();},body:JSON.stringify(streamerDiscordMessage(event,operation.nonce))});
     }catch(error){if(!dispatched)throw new DiscordPublicationNotSentError(error);throw error;}
    },reconcile:operation=>findDiscordPublicationMessage({channelId:operation.target,nonce:operation.nonce,startedAt:operation.startedAt,resourceUrl:event.media.url,signal}),patch:result=>({state:'sent',messageId:String(result.id),dueAtMs:0,sentAt:Date.now()})});
  });return 'sent';
 }catch(error){if(error instanceof Error&&error.message==='streamer_event_cancelled'){await ref.update({state:'cancelled',dueAtMs:0});return 'cancelled';}const uncertain=error instanceof DiscordPublicationPendingError&&error.reason==='uncertain';const retry=error instanceof DiscordRestError&&error.status===429?Math.max(60000,error.retryAfterMs):Math.min(3600000,60000*2**Math.min(event.attempts,5));const code=uncertain?'delivery_uncertain':error instanceof DiscordRestError&&[401,403,404,429].includes(error.status)?`discord_${error.status}`:'delivery_unavailable';await ref.update({state:uncertain?'uncertain':'pending',attempts:event.attempts+1,dueAtMs:Date.now()+retry,lastError:code});if(event.lastError!==code)await recordStreamerDiagnostic({code,level:'warning',stage:'delivery',accountId:event.accountId,platform:event.platform,memberName:event.memberName});return 'failed';}
}
export async function runStreamerMonitor(options:{force?:boolean;accountId?:string;memberId?:string;budgetMs?:number;signal?:AbortSignal}={}){
 const lease=await acquireAutomationLease('guild-streamers','streamer-monitor',180000);if(!lease)return {skipped:true,reason:'distributed_lease',checked:0,sent:0,failed:0};
 const result={checked:0,sent:0,failed:0,deferred:0};
 // Stop external I/O five seconds before the 38s cycle budget to finalize receipts.
 const budget=Math.max(50,Math.min(38000,options.budgetMs??38000));
 const workMs=Math.max(1,budget-Math.min(5000,budget/5));
 const deadline=Date.now()+workMs;
 const signal=AbortSignal.any([AbortSignal.timeout(workMs),...(options.signal?[options.signal]:[])]);
 const exhausted=()=>signal.aborted||Date.now()>=deadline;
 try{
  const maintenance=await maintainStreamerMetadata();if(maintenance.more||exhausted())return {skipped:true,reason:maintenance.more?'metadata_maintenance':'deadline',...result};
  const settings=await streamerSettings();if(!settings.enabled)return {skipped:true,reason:'disabled',...result};
  const accounts=await streamerAccounts(),youtubeCount=accounts.filter(a=>a.enabled&&a.platform==='youtube').length;
  const due=accounts.filter(a=>a.enabled&&(!options.accountId||a.id===options.accountId)&&(!options.memberId||a.memberId===options.memberId)&&(!a.state||a.state.nextCheckAt<=Date.now()||((a.state.retryAt||0)<=Date.now()&&options.force&&Date.now()-(a.state.attemptedAt||a.state.checkedAt||0)>=60000))).sort((a,b)=>(a.state?.nextCheckAt||0)-(b.state?.nextCheckAt||0));
  let draining:Promise<void>|null=null;
  const drain=async()=>{
   if(draining)return draining;
   const task=(async()=>{if(exhausted())return;const queues=await Promise.all(['pending','uncertain'].map(state=>getDocumentDb().collection(EVENTS).where('state','==',state).where('dueAtMs','<=',Date.now()).orderBy('dueAtMs','asc').limit(8).get()));const jobs=queues.flatMap(q=>q.docs).sort((a,b)=>Number(a.data()?.dueAtMs)-Number(b.data()?.dueAtMs)).slice(0,8);
   for(const d of jobs){if(exhausted())break;const outcome=await deliver({...d.data(),id:d.id} as StreamerEvent,()=>lease.assertOwned(),signal);if(outcome==='sent')result.sent++;else if(outcome==='failed')result.failed++;}})();
   draining=task;try{await task;}finally{if(draining===task)draining=null;}
  };
  await drain();
  let cursor=0;const secondary:StreamerAccount[]=[];
  const next=async()=>{for(;;){const account=due[cursor++];if(!account)return;if(exhausted()){result.deferred++;return;}await lease.assertOwned();
   try{
    try{await verifyMember(account.memberId,signal);}catch(error){if(error instanceof DiscordRestError&&error.status===404){await recordStreamerError(account,'member_missing');result.failed++;continue;}throw error;}
    const searched=account.platform==='youtube'&&await reserveYouTubeSearch(account,youtubeCount);
    const fast=account.platform==='twitch';
    const observation=await observeProvider(account,searched,token=>storeToken(account,token),signal,{videos:!fast});
    if(exhausted()){result.deferred++;return;}await lease.assertOwned();signal.throwIfAborted();await commitObservation(account,observation,settings,searched);result.checked++;
    if(fast&&(options.force||Date.now()-(account.state?.lastVideoCheckAt||0)>=60000))secondary.push(account);
    await drain();
   }catch(error){if(exhausted()){result.deferred++;return;}result.failed++;const code=error instanceof DiscordRestError?[401,403,429].includes(error.status)?'discord_'+error.status:'discord_unavailable':classifyStreamerError(error,'provider_unavailable').code;await recordStreamerError(account,code,error as {retryAt?:number;retryable?:boolean;reason?:string});}
  }};
  const workers=await Promise.allSettled(Array.from({length:Math.min(3,due.length)},()=>next()));const failure=workers.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
  // Optional uploads run after LIVE delivery.
  for(const previous of secondary){if(exhausted())break;const account=await currentAccount(previous.id);if(!account||account.revision!==previous.revision)continue;
   try{const observation=await observeProvider(account,false,token=>storeToken(account,token),signal,{videos:true});if(exhausted())break;await lease.assertOwned();await commitObservation(account,observation,settings,false);await drain();}catch{if(exhausted())break;}
  }
  await drain();
  return result;
 }finally{await lease.release();}
}
