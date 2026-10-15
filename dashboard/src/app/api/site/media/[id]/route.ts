import {NextResponse} from 'next/server';
import {pgQuery} from '@/lib/db/pgPool';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;
 if(!/^[a-f0-9]{64}$/.test(id))return new NextResponse(null,{status:404});
 try{
  const result=await pgQuery<{payload:Buffer;mime_type:string}>('SELECT payload,mime_type FROM site_content_media WHERE id=$1',[id]);
  const file=result.rows[0];if(!file)return new NextResponse(null,{status:404});
  return new NextResponse(new Uint8Array(file.payload),{headers:{'Content-Type':file.mime_type,'Content-Length':String(file.payload.length),'Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch{return new NextResponse(null,{status:503});}
}
