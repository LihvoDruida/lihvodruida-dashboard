import {NextResponse} from 'next/server';
import {publicSiteContent} from '@/lib/content';
import {publicSiteCorsHeaders} from '@/lib/publicSiteBridge';
import {logDashboardEvent,safeErrorMessage} from '@/lib/security';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{return NextResponse.json(await publicSiteContent(Math.max(1,Math.min(25,Math.floor(Number(new URL(request.url).searchParams.get("page"))||1)))),{headers:{...publicSiteCorsHeaders(request,'GET, OPTIONS'),'Cache-Control':'no-store','CDN-Cache-Control':'no-store'}});}
 catch(error){logDashboardEvent('error','public_site.content.failed',request,{message:safeErrorMessage(error)});return NextResponse.json({error:'Контент тимчасово недоступний.'},{status:503,headers:publicSiteCorsHeaders(request,'GET, OPTIONS')});}
}
export async function OPTIONS(request:Request){return new NextResponse(null,{status:204,headers:publicSiteCorsHeaders(request,'GET, OPTIONS')});}
