import {NextResponse} from 'next/server';
import {hasSiteBridgeToken} from '@/lib/siteBridgeAuth';
import {publicStreamers} from '@/lib/streamers/store';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){const headers={'Cache-Control':'no-store','CDN-Cache-Control':'no-store'};if(!hasSiteBridgeToken(request))return NextResponse.json({ok:false,code:'bridge_auth_failed'},{status:403,headers});try{return NextResponse.json(await publicStreamers(),{headers});}catch{return NextResponse.json({ok:false,code:'database_unavailable'},{status:503,headers});}}
