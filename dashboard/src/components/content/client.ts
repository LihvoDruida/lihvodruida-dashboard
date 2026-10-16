import type {SiteContentItem} from '@/lib/content';
export class ContentRequestError extends Error{constructor(message:string,readonly code='request_failed'){super(message);}}
export async function contentRequest<T>(url:string,init:RequestInit={}):Promise<T>{
 let response:Response;
 try{response=await fetch(url,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),headers:{Accept:'application/json',...init.headers}});}
 catch{throw new ContentRequestError('Не отримано відповіді. Зміни залишилися у формі. Перед повтором перевір список матеріалів.','network');}
 if(!response.headers.get('content-type')?.includes('application/json'))throw new ContentRequestError('Сервер повернув неочікувану відповідь. Перевір сесію та підключення.');
 let result;
 try{result=await response.json();}catch{throw new ContentRequestError('Відповідь пошкоджено. Зміни залишилися у формі.');}
 if(!response.ok)throw new ContentRequestError(response.status===401?'Сесія завершилась. Увійди в іншій вкладці та повтори збереження.':typeof result?.error==='string'?result.error:'Не вдалося виконати дію.',typeof result?.code==='string'?result.code:undefined);
 return result as T;
}

/** Stable across multipart boundaries and reselecting the same image. */
export async function contentCreationFingerprint(data:FormData){
 const values:unknown[]=[];
 for(const [key,value] of data.entries()){
  if(key==='requestId'||key==='lastModifiedAt')continue;
  if(typeof value==='string')values.push([key,value]);
  else if(value.size)values.push([key,value.type,await digest(new Uint8Array(await value.arrayBuffer()))]);
 }
 return digest(new TextEncoder().encode(JSON.stringify(values)));
}
async function digest(bytes:Uint8Array<ArrayBuffer>){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}

export function parseContentLibrary(value:unknown):{items:SiteContentItem[];checkedAt:string}{
 if(!value||typeof value!=='object')throw new ContentRequestError('Список матеріалів має неочікуваний формат.');
 const data=value as {items?:unknown;checkedAt?:unknown};
 if(!Array.isArray(data.items)||typeof data.checkedAt!=='string'||!Number.isFinite(Date.parse(data.checkedAt))||data.items.some(item=>!item||!['news','guides'].includes(item.kind)||!['draft','published'].includes(item.status)||!/^_(news|guides)\/[a-z0-9-]{1,130}\.md$/.test(item.path)||['title','slug','description','author','image','tags','categories','date','last_modified_at','updated_at','sha'].some(key=>typeof item[key]!=='string')))throw new ContentRequestError('Список матеріалів має неочікуваний формат. Попередні дані залишилися на екрані.');
 return {items:data.items as SiteContentItem[],checkedAt:data.checkedAt};
}
