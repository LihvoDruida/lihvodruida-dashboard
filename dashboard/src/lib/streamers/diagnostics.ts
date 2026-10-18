import 'server-only';
import {pgQuery} from '@/lib/db/pgPool';
import {recordStructuredLog} from '@/lib/structuredLogs';
import {streamerProblem} from './problems';
type Diagnostic={code:string;level:'info'|'success'|'warning'|'error';stage:'check'|'delivery'|'settings';accountId?:string;platform?:string;memberName?:string;requestId?:string};
export async function recordStreamerDiagnostic(input:Diagnostic){
  const code=/^(?:ok|saved|deleted|check_requested|cancelled)$/.test(input.code)?input.code:streamerProblem(input.code).code;
  const label=({ok:'Платформу успішно перевірено',saved:'Налаштування збережено',deleted:'Платформу видалено',check_requested:'Запущено перевірку каналів',cancelled:'Сповіщення скасовано'} as Record<string,string>)[code]||streamerProblem(code).error;
  try{return await recordStructuredLog({event:'streamers.'+input.stage+'.'+code,category:input.stage==='delivery'?'discord':'integration',source:'dashboard',level:input.level,message:label,resourceType:'guild-streamer',resourceId:input.accountId||null,requestId:input.requestId||null,details:{code,stage:input.stage,platform:input.platform||null,memberName:input.memberName?.slice(0,80)||null}});}catch{return false;}
}
export async function streamerDiagnostics(){
  const result=await pgQuery<{id:string;created_at:Date|string;level:string;details:Record<string,unknown>}>("SELECT id,created_at,level,details FROM system_logs WHERE resource_type=$1 AND details->>'stage' IN ('check','delivery','settings') AND created_at>=now()-interval '72 hours' ORDER BY created_at DESC LIMIT 30",['guild-streamer']);
  return result.rows.map(row=>({id:row.id,createdAt:new Date(row.created_at).toISOString(),level:row.level,code:/^(?:ok|saved|deleted|check_requested|cancelled)$/.test(String(row.details?.code))?String(row.details.code):streamerProblem(String(row.details?.code)).code,stage:String(row.details?.stage||'check'),platform:String(row.details?.platform||''),memberName:String(row.details?.memberName||'').slice(0,80)}));
}
