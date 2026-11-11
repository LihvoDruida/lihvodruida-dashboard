import 'server-only';
import {createHash} from 'node:crypto';
import {hasPostgresConfig,pgQuery} from '@/lib/db/pgPool';
import {ApiHttpError,parseRetryAfter} from '@/lib/apiHttp';
export type ProviderScope={provider:string;key:string};
export class ProviderCooldownError extends ApiHttpError{
 readonly reason:string;readonly retryable=true;
 constructor(scope:ProviderScope,retryAt:number,reason='rate_limit'){super('provider_rate_limit',{status:429,url:scope.provider,retryAt:retryAt,retryAfterMs:Math.max(0,retryAt-Date.now())});this.reason=reason;}
}
const memory=new Map<string,{retryAt:number;reason:string}>();
const hash=(value:string)=>createHash('sha256').update(value.trim()).digest('hex').slice(0,32);
export function providerScope(input:RequestInfo|URL,headers?:HeadersInit):ProviderScope|null{
 let u:URL;try{u=new URL(String(input));}catch{return null;}const h=new Headers(headers);
 if(u.hostname==='raider.io')return {provider:'raiderio',key:'raiderio'};
 if(/^(?:(?:[a-z]{2}|oauth)\.)?(?:battle\.net|api\.blizzard\.com)$/.test(u.hostname))return {provider:'battlenet',key:'battlenet:'+hash(process.env.BATTLENET_CLIENT_ID||h.get('authorization')||'')};
 return null;
}
export async function storeProviderPause(scope:ProviderScope,retryAt:number,reason='rate_limit'){
 const key=scope.key;
 if(hasPostgresConfig()){
  try{await pgQuery(`INSERT INTO documents(collection,doc_id,data) VALUES('externalApiCooldowns',$1,$2::jsonb) ON CONFLICT(collection,doc_id) DO UPDATE SET data=CASE WHEN COALESCE((documents.data->>'retryAt')::numeric,0)<COALESCE((EXCLUDED.data->>'retryAt')::numeric,0) THEN EXCLUDED.data ELSE documents.data END,updated_at=now()`,[key,JSON.stringify({retryAt,reason})]);}catch{throw new ApiHttpError('provider_state_unavailable',{status:503,url:scope.provider});}
 }else{const old=memory.get(key);if(!old||old.retryAt<retryAt)memory.set(key,{retryAt,reason});}
}
export async function checkProviderPause(scope:ProviderScope|null){
 if(!scope)return;let records:{retryAt:number;reason?:string}[];
 if(hasPostgresConfig()){try{records=(await pgQuery<{data:{retryAt:number;reason?:string}}>("SELECT data FROM documents WHERE collection='externalApiCooldowns' AND doc_id=ANY($1::text[])",[[scope.key]] )).rows.map(r=>r.data);}catch{throw new ApiHttpError('provider_state_unavailable',{status:503,url:scope.provider});}}
 else records=[memory.get(scope.key)].filter(Boolean) as {retryAt:number;reason:string}[];
 const record=records.sort((a,b)=>Number(b.retryAt)-Number(a.retryAt))[0];if(record&&Number(record.retryAt)>Date.now())throw new ProviderCooldownError(scope,Number(record.retryAt),record.reason);
}
export async function observeProviderHeaders(scope:ProviderScope|null,r:Response){
 if(!scope)return;const retry=parseRetryAfter(r.headers.get('retry-after'));const reset=Number(r.headers.get('ratelimit-reset'))*1000;
 if(r.status===429)await storeProviderPause(scope,Math.max(Date.now()+(retry??60000),Number.isFinite(reset)?reset+250:0));
}
export async function observeProviderFailure(scope:ProviderScope|null,body:unknown,status:number){
 if(!scope||!body||typeof body!=='object')return;const e=(body as {error?:{errors?:{reason?:string}[];status?:string;code?:string}}).error;
 const reasons=e&&typeof e==='object'?[...(Array.isArray(e.errors)?e.errors.map(x=>x.reason):[]),e.status,e.code]:[];
 if(status===429||reasons.some(x=>['rateLimitExceeded','userRateLimitExceeded','rate_limit_exceeded'].includes(String(x))))await storeProviderPause(scope,Date.now()+60000);
}
