export class ApiResponseError extends Error {
 constructor(readonly code:'body_limit'|'content_type'|'invalid_json'|'schema'|'body_interrupted',readonly status=0){super(`API response ${code}`);this.name='ApiResponseError';}
}
export function awaitAbortable<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return promise;if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{const abort=()=>{reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
export function isJsonContainer(value:unknown){return value!==null&&typeof value==='object';}
export async function readResponseText(response:Response,options:{maxBytes?:number;signal?:AbortSignal}={}){
 const limit=Math.max(1,Math.min(16*1024*1024,options.maxBytes??4*1024*1024));
 const reader=response.body?.getReader();if(!reader)return '';
 let completed=false;
 try{
  const length=response.headers.get('content-length');if(length!==null&&Number(length)>limit)throw new ApiResponseError('body_limit',response.status);
  let size=0;const decoder=new TextDecoder('utf-8',{fatal:true});const parts:string[]=[];
  for(;;){options.signal?.throwIfAborted();const chunk=await awaitAbortable(reader.read(),options.signal);if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit)throw new ApiResponseError('body_limit',response.status);parts.push(decoder.decode(chunk.value,{stream:true}));}
  parts.push(decoder.decode());completed=true;return parts.join('');
 }catch(error){if(options.signal?.aborted)throw options.signal.reason;if(error instanceof ApiResponseError)throw error;throw new ApiResponseError('body_interrupted',response.status);}
 finally{if(!completed)void reader.cancel().catch(()=>{});}
}
export async function readResponseJson<T=unknown>(response:Response,options:{maxBytes?:number;signal?:AbortSignal;validate?:(value:unknown)=>boolean}={}):Promise<T>{
 if([204,205].includes(response.status)){void response.body?.cancel().catch(()=>{});return undefined as T;}
 if(!/application\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw new ApiResponseError('content_type',response.status);}
 const raw=await readResponseText(response,options);let value:unknown;try{value=JSON.parse(raw);}catch{throw new ApiResponseError('invalid_json',response.status);}
 if(options.validate&&!options.validate(value))throw new ApiResponseError('schema',response.status);return value as T;
}
