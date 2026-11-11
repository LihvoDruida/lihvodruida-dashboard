import 'server-only';
import {apiFetchJson,type ApiFetchJsonOptions} from '@/lib/apiHttp';
import {providerScope,checkProviderPause,observeProviderHeaders,observeProviderFailure} from '@/lib/providerCooldown';
export async function providerFetchJson<T=unknown>(url:RequestInfo|URL,options:ApiFetchJsonOptions={}):Promise<T>{
 const scope=providerScope(url,options.headers);
 return apiFetchJson<T>(url,{validate:v=>!!v&&typeof v==="object",...options,beforeAttempt:async()=>{await checkProviderPause(scope);await options.beforeAttempt?.();},onResponse:async r=>{await observeProviderHeaders(scope,r);await options.onResponse?.(r);},onBody:async(body,status)=>{await observeProviderFailure(scope,body,status);await options.onBody?.(body,status);}});
}
export {ApiHttpError} from "@/lib/apiHttp";
