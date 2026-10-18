import 'server-only';
import {acquireAutomationLease} from '@/lib/automationLease';
import {getDocumentDb} from '@/lib/documentDb';
import {discordApi,findDiscordPublicationMessage} from '@/lib/discordAdmin';
import {DiscordRestError} from '@/lib/discordRest';
import {publicationRevision,runDiscordPublicationCreation,withDiscordPublicationLease,DiscordPublicationPendingError} from '@/lib/discordPublication';
import {EVENTS,streamerSettings,streamerAccounts,verifyMember,verifyChannel,commitObservation,recordStreamerError,reserveYouTubeSearch,currentAccount,storeToken,type StreamerAccount,type StreamerEvent} from './store';
import {observeProvider} from './providers';
import {classifyStreamerError} from './problems';
import {recordStreamerDiagnostic} from './diagnostics';
export function eventStillWanted(event:StreamerEvent,account:StreamerAccount|null,settings:Awaited<ReturnType<typeof streamerSettings>>,now=Date.now()){
 return !!(account?.enabled&&settings.enabled&&settings.discordEnabled&&settings.channelId===event.channelId&&settings.revision===event.settingsRevision&&account.revision===event.accountRevision&&now-event.createdAt<86400000&&(event.kind==='live'?account.notifyLive&&account.state?.live?.id===event.media.id&&account.state.expiresAt>now:account.notifyVideos));
}
async function deliver(event:StreamerEvent,assertLease:()=>Promise<void>){
 const ref=getDocumentDb().collection(EVENTS).doc(event.id);
 const check=async()=>{await assertLease();const [account,settings]=await Promise.all([currentAccount(event.accountId),streamerSettings()]);if(!eventStillWanted(event,account,settings))throw Error('streamer_event_cancelled');return account!;};
 if(!eventStillWanted(event,await currentAccount(event.accountId),await streamerSettings())){await ref.update({state:'cancelled',dueAtMs:0});return 'cancelled';}
 try{
  await withDiscordPublicationLease('streamer:'+event.id,async owned=>{
   await owned();await check();
   await runDiscordPublicationCreation({kind:'guild-streamer',resourceId:event.id,collection:EVENTS,target:event.channelId,revision:publicationRevision([event.kind,event.media.id,event.channelId]),assertOwned:async()=>{await owned();await assertLease();},
    create:async operation=>{
     const member=await check();await verifyMember(member.memberId);await verifyChannel(event.channelId);
     return discordApi<Record<string,unknown>>(`/channels/${event.channelId}/messages`,{method:'POST',retry:'never',beforeSend:async()=>{await owned();await check();},body:JSON.stringify({nonce:operation.nonce,enforce_nonce:true,allowed_mentions:{parse:[],users:[],roles:[],replied_user:false},embeds:[{title:`${event.memberName} ${event.kind==='live'?'вже наживо':'опублікував нове відео'}`.slice(0,200),description:event.media.title.slice(0,300),url:event.media.url,color:event.platform==='twitch'?0x9146ff:event.platform==='youtube'?0xff0033:0x25f4ee,fields:[{name:'Платформа',value:event.platform==='twitch'?'Twitch':event.platform==='youtube'?'YouTube':'TikTok'}],timestamp:event.media.publishedAt}],components:[{type:1,components:[{type:2,style:5,label:event.kind==='live'?'Дивитися трансляцію':'Дивитися відео',url:event.media.url}]}]})});
    },reconcile:operation=>findDiscordPublicationMessage({channelId:operation.target,nonce:operation.nonce,startedAt:operation.startedAt,resourceUrl:event.media.url}),patch:result=>({state:'sent',messageId:String(result.id),dueAtMs:0,sentAt:Date.now()})});
  });return 'sent';
 }catch(error){if(error instanceof Error&&error.message==='streamer_event_cancelled'){await ref.update({state:'cancelled',dueAtMs:0});return 'cancelled';}const uncertain=error instanceof DiscordPublicationPendingError&&error.reason==='uncertain';const retry=error instanceof DiscordRestError&&error.status===429?Math.max(60000,error.retryAfterMs):Math.min(3600000,60000*2**Math.min(event.attempts,5));const code=uncertain?'delivery_uncertain':error instanceof DiscordRestError&&[401,403,404,429].includes(error.status)?`discord_${error.status}`:'delivery_unavailable';await ref.update({state:uncertain?'uncertain':'pending',attempts:event.attempts+1,dueAtMs:Date.now()+retry,lastError:code});if(event.lastError!==code)await recordStreamerDiagnostic({code,level:'warning',stage:'delivery',accountId:event.accountId,platform:event.platform,memberName:event.memberName});return 'failed';}
}
export async function runStreamerMonitor(options:{force?:boolean}={}){
 const lease=await acquireAutomationLease('guild-streamers','streamer-monitor',180000);if(!lease)return {skipped:true,reason:'distributed_lease',checked:0,sent:0,failed:0};
 const result={checked:0,sent:0,failed:0,deferred:0};const deadline=Date.now()+38000;
 try{
  const settings=await streamerSettings();if(!settings.enabled)return {skipped:true,reason:'disabled',...result};
  const accounts=await streamerAccounts(),youtubeCount=accounts.filter(a=>a.enabled&&a.platform==='youtube').length;
  const due=accounts.filter(a=>a.enabled&&(!a.state||a.state.nextCheckAt<=Date.now()||(options.force&&Date.now()-(a.state.attemptedAt||a.state.checkedAt||0)>=60000))).sort((a,b)=>(a.state?.nextCheckAt||0)-(b.state?.nextCheckAt||0));
  for(const account of due.slice(0,8)){
   if(Date.now()>deadline){result.deferred++;break;}await lease.assertOwned();
   try{
    try{await verifyMember(account.memberId);}catch(error){if(error instanceof DiscordRestError&&error.status===404){await recordStreamerError(account,'member_missing');result.failed++;continue;}throw error;}
    const searched=account.platform==='youtube'&&await reserveYouTubeSearch(account,youtubeCount);
    const observation=await observeProvider(account,searched,token=>storeToken(account,token));
    await lease.assertOwned();await commitObservation(account,observation,settings,searched);result.checked++;
   }catch(error){result.failed++;const code=error instanceof DiscordRestError?[401,403,429].includes(error.status)?'discord_'+error.status:'discord_unavailable':classifyStreamerError(error,'provider_unavailable').code;await recordStreamerError(account,code);}
  }
  if(Date.now()<deadline){const queues=await Promise.all(['pending','uncertain'].map(state=>getDocumentDb().collection(EVENTS).where('state','==',state).where('dueAtMs','<=',Date.now()).orderBy('dueAtMs','asc').limit(8).get()));const jobs=queues.flatMap(q=>q.docs).sort((a,b)=>Number(a.data()?.dueAtMs)-Number(b.data()?.dueAtMs)).slice(0,8);for(const d of jobs){if(Date.now()>deadline)break;const outcome=await deliver({...d.data(),id:d.id} as StreamerEvent,()=>lease.assertOwned());if(outcome==='sent')result.sent++;else if(outcome==='failed')result.failed++;}}
  return result;
 }finally{await lease.release();}
}
