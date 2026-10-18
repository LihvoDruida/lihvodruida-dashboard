import {NextRequest,NextResponse,after} from 'next/server';
import {getSession} from '@/lib/auth';
import {canManageStreamers} from '@/lib/streamers/contract';
import {streamerSettings,streamerAccounts,adminAccount,saveStreamer,saveStreamerSettings,deleteStreamer,EVENTS} from '@/lib/streamers/store';
import {providerReadiness} from '@/lib/streamers/providers';
import {runStreamerMonitor} from '@/lib/streamers/worker';
import {getDocumentDb} from '@/lib/documentDb';
import {fetchDiscordTextChannels} from '@/lib/discordAdmin';
import {recordAdminAudit} from '@/lib/accessGroups';
import {verifyTrustedOrigin,noStoreHeaders,checkRateLimit,getClientIp} from '@/lib/security';
export const dynamic='force-dynamic';export const runtime='nodejs';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:noStoreHeaders()});
async function session(){const user=await getSession({live:true});return canManageStreamers(user)?user:null;}
export async function GET(){const user=await session();if(!user)return reply({error:'Доступ лише для адміністратора та власника.'},403);try{const [settings,accounts,channels,jobs]=await Promise.all([streamerSettings(),streamerAccounts(),fetchDiscordTextChannels().catch(()=>({channels:[]})),getDocumentDb().collection(EVENTS).orderBy('createdAt','desc').limit(15).get()]);return reply({settings,accounts:accounts.map(adminAccount),readiness:providerReadiness(),channels:channels.channels.map(c=>({id:c.id,name:c.name})),events:jobs.docs.map(d=>{const e=d.data()||{};return {id:d.id,memberName:e.memberName,platform:e.platform,kind:e.kind,state:e.state,lastError:e.lastError||'',createdAt:e.createdAt};})});}catch{return reply({error:'Дані стрімерів тимчасово недоступні.'},503);}}
async function body(request:Request){const reader=request.body?.getReader();if(!reader)throw Error('Порожній запит.');let n=0;const parts:Uint8Array[]=[];try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>24576)throw Error('Запит завеликий.');parts.push(p.value);}}finally{await reader.cancel().catch(()=>{});}const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Некоректний запит.');return value as Record<string,unknown>;}
export async function POST(request:NextRequest){
 if(!verifyTrustedOrigin(request))return reply({error:'Недовірене джерело запиту.'},403);const user=await session();if(!user)return reply({error:'Доступ лише для адміністратора та власника.'},403);
 if(!checkRateLimit(`streamers:${user.id}:${getClientIp(request)}`,30,600000).ok)return reply({error:'Забагато змін. Спробуй пізніше.'},429);
 try{const input=await body(request);let data:unknown;
  if(input.action==='save')data=await saveStreamer(input);
  else if(input.action==='settings')data=await saveStreamerSettings(input);
  else if(input.action==='delete'){await deleteStreamer(String(input.id),String(input.revision));data={deleted:true};}
  else if(input.action==='check'){after(async()=>{await runStreamerMonitor({force:true});});data={queued:true};}
  else return reply({error:'Невідома дія.'},400);
  await recordAdminAudit('streamers.'+String(input.action),user,{entityId:String(input.id||'settings'),platform:String(input.platform||''),status:'success'});
  return reply({ok:true,data});
 }catch(error){const message=error instanceof Error?error.message:'';const safe=/^(?:Вкажи|Обери|Перевір|Це не|Некоректн|Потрібен|Канал |Цей канал|Ліміт |Можна |Налаштування|Запис |Для TikTok|TikTok:|Офіційний |Посилання|Порожній |Запит |Канал Twitch|Канал YouTube)/.test(message)?message:'Не вдалося зберегти. Перевір підключення платформи та права бота.';return reply({error:safe},400);}
}
