import {after} from 'next/server';
import {acceptTwitchEvent,EventSubError} from '@/lib/streamers/eventsub';
import {runStreamerMonitor} from '@/lib/streamers/worker';
import {ApiResponseError} from '@/lib/httpBody';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=55;
export async function POST(request:Request){
 try{const result=await acceptTwitchEvent(request);if(result.accountId)after(async()=>{try{await runStreamerMonitor({accountId:result.accountId,force:true});}catch{/* Durable due flag remains for cron. */}});
 return new Response(result.challenge??null,{status:result.challenge?200:204,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
 }catch(error){return new Response('Event rejected',{status:error instanceof EventSubError?error.status:error instanceof ApiResponseError?413:503,headers:{'Cache-Control':'no-store'}});}
}
