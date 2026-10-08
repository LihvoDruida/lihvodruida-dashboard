/* Independent execution of TS routes with explicit permission/error fakes. */
'use strict';
const ts=require('typescript'),fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
let count=0;
function build(file, overrides={}){
 const src=fs.readFileSync(path.resolve(__dirname,'../src/',file),'utf8');
 const code=ts.transpileModule(src,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const flags={view:true,edit:false,auth:false,origin:true,session:{id:'123456789012345678'},calls:[], ...overrides};
 const reply=(data,{status=200}={})=>({status,data});
 const mocks={
   'next/server':{NextResponse:{json:reply}},
   '@/lib/auth':{getSession:async()=>flags.session},
   '@/lib/security':{assertRequestBodySize:()=>null,verifyTrustedOrigin:()=>flags.origin,verifyInternalBearerToken:async()=>({ok:flags.auth}),checkRateLimit:()=>({ok:true}),noStoreHeaders:()=>({})},
   '@/lib/staticRules':{
     staticPermission:async()=>({view:flags.view,edit:flags.edit}),
     listStaticDiscipline:async()=>{flags.calls.push('bans');return []},
     listStaticOverview:async()=>{flags.calls.push('overview');return {members:[],invites:[],settings:{}}},
     addStaticViolation:async()=>{flags.calls.push('violation');return {banned:false}},
     removeStaticViolation:async()=>{flags.calls.push('remove-violation')},
     removeStaticMember:async()=>{flags.calls.push('remove-member')},
     createStaticInvite:async()=>{},revokeStaticInvite:async()=>{},unblockStaticMember:async()=>{},
     enforceStaticMemberRole:async()=>{flags.calls.push('enforce');return {revoked:1}},
     sweepStaticForbiddenRoles:async()=>{flags.calls.push('sweep');return {checked:1,revoked:1}},
   },
   '@/lib/discordAdmin':{getDiscordGuildId:()=> '423456789012345678'}
 };
 const loadedModule={exports:{}};
 vm.runInNewContext(code,{module:loadedModule,exports:loadedModule.exports,require:key=>{if(!(key in mocks))throw Error(`Unexpected import ${key}`);return mocks[key]}},{filename:file});
 return {route:loadedModule.exports,flags};
}
const req=body=>({json:async()=>body});
async function test(name,callback){await callback();console.log('PASS',name);count++}
(async()=>{
 await test('non-authorized viewer sees banlist',async()=>{let x=build('app/api/static/bans/route.ts');assert.equal((await x.route.GET()).status,200)});
 await test('outsider cannot view violations',async()=>{let x=build('app/api/static/bans/route.ts',{view:false});assert.equal((await x.route.GET()).status,403);assert.equal(x.flags.calls.length,0)});
 await test('view-only officer cannot add violation',async()=>{let x=build('app/api/static/manage/route.ts');assert.equal((await x.route.POST(req({action:'add-violation'}))).status,403);assert.equal(x.flags.calls.length,0)});
 await test('RL can add violation',async()=>{let x=build('app/api/static/manage/route.ts',{edit:true});assert.equal((await x.route.POST(req({action:'add-violation'}))).status,200);assert.deepEqual(x.flags.calls,['violation'])});
 await test('cross-origin violation rejected',async()=>{let x=build('app/api/static/manage/route.ts',{edit:true,origin:false});assert.equal((await x.route.POST(req({action:'add-violation'}))).status,403)});
 await test('internal role cleanup requires bearer',async()=>{let x=build('app/api/internal/discord/static-enforce/route.ts');assert.equal((await x.route.POST(req({guildId:'423456789012345678',userId:'123456789012345678'}))).status,403)});
 await test('internal cleanup rejects wrong guild',async()=>{let x=build('app/api/internal/discord/static-enforce/route.ts',{auth:true});assert.equal((await x.route.POST(req({guildId:'WRONG',userId:'123456789012345678'}))).status,403)});
 await test('internal event cleanup authorizes bot and dispatches',async()=>{let x=build('app/api/internal/discord/static-enforce/route.ts',{auth:true});assert.equal((await x.route.POST(req({guildId:'423456789012345678',userId:'123456789012345678'}))).status,200);assert.deepEqual(x.flags.calls,['enforce'])});
 await test('internal sweep never available to anonymous user',async()=>{let x=build('app/api/internal/discord/static-enforce/route.ts');assert.equal((await x.route.POST(req({guildId:'423456789012345678',sweep:true}))).status,403)});
 console.log(`[independent static routes] ${count}/${count} PASS`);
})().catch(e=>{console.error(e);process.exitCode=1});
