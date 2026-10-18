import {NextRequest,NextResponse} from 'next/server';
import {verifyInternalBearerToken,noStoreHeaders,unauthorizedResponse} from '@/lib/security';
import {observeAutomationRun} from '@/lib/automationTaskRuns';
import {runStreamerMonitor} from '@/lib/streamers/worker';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=55;
export async function GET(request:NextRequest){const auth=await verifyInternalBearerToken(request,['CRON_SECRET','INTERNAL_API_TOKEN'],{minLength:24});if(!auth.ok)return unauthorizedResponse('Forbidden');return NextResponse.json({ok:true,mode:'read-only',route:'guild-streamers'},{headers:noStoreHeaders()});}
export async function POST(request:NextRequest){const auth=await verifyInternalBearerToken(request,['CRON_SECRET','INTERNAL_API_TOKEN'],{minLength:24});if(!auth.ok)return unauthorizedResponse('Forbidden');try{return NextResponse.json({ok:true,result:await observeAutomationRun('guild-streamers',runStreamerMonitor)},{headers:noStoreHeaders()});}catch{return NextResponse.json({ok:false,error:'Перевірка стрімерів тимчасово недоступна.'},{status:503,headers:noStoreHeaders()});}}
