import {NextResponse} from 'next/server';
import {ContentMutationError} from '@/lib/content';
/** Read the actual stream: a missing Content-Length must not bypass the limit. */
export async function readContentForm(request:Request,maxBytes:number){
 const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw new ContentMutationError('Запит завеликий. Обкладинка має бути до 8 MB.','body_too_large',413);}chunks.push(part.value);}}
 finally{reader?.releaseLock();}
 try{return await new Response(new Uint8Array(Buffer.concat(chunks)),{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();}
 catch{throw new ContentMutationError('Не вдалося прочитати форму. Повтори збереження.','invalid_form',400);}
}
export function contentJson(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','CDN-Cache-Control':'no-store'}});}
