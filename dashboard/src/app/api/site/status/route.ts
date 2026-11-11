import {NextResponse} from 'next/server';
import {hasSiteBridgeToken} from '@/lib/siteBridgeAuth';
import {pgQuery} from '@/lib/db/pgPool';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!hasSiteBridgeToken(request))return NextResponse.json({ok:false},{status:403,headers});
 try{
  const result=await pgQuery<{documents:string|null;media:string|null}>("SELECT to_regclass('documents')::text AS documents,to_regclass('site_content_media')::text AS media");
  if(!result.rows[0]?.documents||!result.rows[0]?.media)throw new Error('schema_missing');
  return NextResponse.json({ok:true,protocol:'mistblossom.site-bridge.v2',store:'postgres',schemas:{guild:'mistblossom.public-guild.v1',applications:'mistblossom.public-applications.v1',content:'mistblossom.public-content.v2'},capabilities:['guild:read','applications:read','applications:submit','content:read','media:read','sync:revisions:v1','guild:raid-history:v2']},{headers});
 }catch{return NextResponse.json({ok:false,error:'database_unavailable'},{status:503,headers});}
}
