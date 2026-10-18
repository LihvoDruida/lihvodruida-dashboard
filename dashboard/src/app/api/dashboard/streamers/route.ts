import {randomUUID} from 'node:crypto';
import {NextRequest,NextResponse,after} from 'next/server';
import {getSession} from '@/lib/auth';
import {canManageStreamers} from '@/lib/streamers/contract';
import {streamerSettings,streamerAccounts,adminAccount,saveStreamer,saveStreamerMember,deleteStreamerMember,saveStreamerSettings,deleteStreamer,EVENTS} from '@/lib/streamers/store';
import {providerReadiness} from '@/lib/streamers/providers';
import {runStreamerMonitor} from '@/lib/streamers/worker';
import {StreamerInputError,streamerProblem,classifyStreamerError} from '@/lib/streamers/problems';
import {recordStreamerDiagnostic,streamerDiagnostics} from '@/lib/streamers/diagnostics';
import {getDocumentDb} from '@/lib/documentDb';
import {fetchDiscordTextChannels} from '@/lib/discordAdmin';
import {recordAdminAudit} from '@/lib/accessGroups';
import {verifyTrustedOrigin,noStoreHeaders,checkRateLimit,getClientIp} from '@/lib/security';
export const dynamic='force-dynamic';export const runtime='nodejs';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:noStoreHeaders()});
const failure=(code:string)=>{const p=streamerProblem(code);return reply(p,p.status);};
async function session(){const user=await getSession({live:true});return canManageStreamers(user)?user:null;}
export async function GET(){
 try{
  const user=await session();if(!user)return failure('access_denied');const warnings:string[]=[];
  const [settings,accounts,channels,jobs,logs]=await Promise.all([
   streamerSettings(),streamerAccounts(),fetchDiscordTextChannels().catch(()=>{warnings.push('channels_unavailable');return {channels:[]};}),
   getDocumentDb().collection(EVENTS).orderBy('createdAt','desc').limit(15).get(),
   streamerDiagnostics().catch(()=>{warnings.push('logs_unavailable');return [];})]);
  return reply({settings,accounts:accounts.map(adminAccount),readiness:providerReadiness(),channels:channels.channels.map(c=>({id:c.id,name:c.name})),events:jobs.docs.map(d=>{const e=d.data()||{};return {id:d.id,memberName:e.memberName,platform:e.platform,kind:e.kind,state:e.state,lastError:e.lastError||'',createdAt:e.createdAt,dueAtMs:e.dueAtMs||0,attempts:e.attempts||0};}),logs,warnings,now:new Date().toISOString()});
 }catch{return failure('storage_unavailable');}
}
async function body(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new StreamerInputError('invalid_input');let n=0;const parts:Uint8Array[]=[];
 try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>65536)throw new StreamerInputError('body_limit');parts.push(p.value);}}finally{await reader.cancel().catch(()=>{});}
 let value:unknown;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new StreamerInputError('invalid_input');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new StreamerInputError('invalid_input');return value as Record<string,unknown>;
}
export async function POST(request:NextRequest){
 if(!verifyTrustedOrigin(request))return failure('origin_rejected');let user;try{user=await session();}catch{return failure('storage_unavailable');}if(!user)return failure('access_denied');
 if(!checkRateLimit(`streamers:${user.id}:${getClientIp(request)}`,30,600000).ok)return failure('rate_limit');
 const requestId=randomUUID();
 try{
  const input=await body(request);let data:unknown;
  if(input.action==='save-member')data=await saveStreamerMember(input);
  else if(input.action==='delete-member')data=await deleteStreamerMember(input);
  else if(input.action==='save')data=await saveStreamer(input);
  else if(input.action==='settings')data=await saveStreamerSettings(input);
  else if(input.action==='delete'){await deleteStreamer(String(input.id),String(input.revision));data={deleted:true};}
  else if(input.action==='check'){
   if(!(await streamerSettings()).enabled)throw new StreamerInputError('monitor_disabled');
   after(async()=>{try{await runStreamerMonitor({force:true});}catch{await recordStreamerDiagnostic({code:'storage_unavailable',level:'error',stage:'check',requestId});}});data={queued:true};
  }else throw new StreamerInputError('invalid_input');
  const entityId=/^[a-f0-9-]{36}$/.test(String(input.id))?String(input.id):/^\d{16,25}$/.test(String(input.memberId))?String(input.memberId):'settings';
  const audit=await recordAdminAudit('streamers.'+String(input.action),user,{resourceType:'guild-streamer',resourceId:entityId,requestId,status:'success',channelCount:Array.isArray(input.channels)?input.channels.length:undefined}).catch(()=>false);
  await recordStreamerDiagnostic({code:input.action==='check'?'check_requested':String(input.action).startsWith('delete')?'deleted':'saved',level:'info',stage:'settings',requestId});
  return reply({ok:true,data,requestId,...(audit===false?{warning:streamerProblem('logs_unavailable')}: {})});
 }catch(error){const problem=classifyStreamerError(error);await recordStreamerDiagnostic({code:problem.code,level:'warning',stage:'settings',requestId});return reply({...problem,requestId},problem.status);}
}
