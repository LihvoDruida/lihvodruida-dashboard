/* Independent behavioral tests: actual exported Static functions against in-memory Firestore and Discord. */
'use strict';
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/staticRules.ts'), 'utf8');
const compiled = ts.transpileModule(source, { fileName:'staticRules.ts', reportDiagnostics:true,
  compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } });
assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const dbdata = new Map();
const stash = (table) => { if(!dbdata.has(table)) dbdata.set(table,new Map()); return dbdata.get(table); };
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const doc = (table,id) => ({ id, get:async()=>({id,exists:stash(table).has(id),data:()=>clone(stash(table).get(id))}),
  set:async(value)=>{stash(table).set(id,clone(value));}, update:async(value)=>{stash(table).set(id,{...stash(table).get(id),...clone(value)})} });
const collection = table => ({ doc:id=>doc(table,id), limit:()=>({get:async()=>({docs:[...stash(table)].map(([id,value])=>({id,data:()=>clone(value)}))})}),
 orderBy:()=>({limit:()=>({get:async()=>({docs:[...stash(table)].map(([id,value])=>({id,data:()=>clone(value)}))})})})});
const db = {collection, runTransaction:async(handler)=> handler({get:r=>r.get(),set:(r,v)=>stashByRef(r,v),update:(r,v)=>{throw Error('transaction update unused')},})};
// Backing document refs maintain collection identity for a tiny stand-in transaction.
function stashByRef(r,v){throw Error('unwired');}
const realCollection=table=>({doc:id=>({ ...doc(table,id), table }),limit:collection(table).limit,orderBy:collection(table).orderBy});
function refFor(table,id){const r=doc(table,id);r.table=table;return r;}
db.collection=table=>({doc:id=>refFor(table,id),limit:collection(table).limit,orderBy:collection(table).orderBy});
db.runTransaction=async handler=>handler({get:r=>r.get(),set:(r,v)=>stash(r.table).set(r.id,clone(v)),update:(r,v)=>stash(r.table).set(r.id,{...stash(r.table).get(r.id),...clone(v)})});
const USER='123456789012345678', ACTOR='223456789012345678', ROLE='323456789012345678';
const roleState = new Map([[USER,[ROLE]]]);let removals=0, failRemove=false;
const discord={
 fetchDiscordGuildMemberSnapshot:async userId=>({userId,joinedAt:'2026-10-01',displayName:'Test',roleIds:roleState.get(userId)||[]}),
 fetchDiscordGuildMembersCachedForUi:async()=>[], fetchDiscordGuildSnapshot:async()=>({ownerId:ACTOR}),
 getDiscordGuildId:()=> '423456789012345678',
 fetchDiscordRoleControlSnapshot:async()=>({roles:[]}), assertDiscordRolesManageable:async()=>{},
 removeGuildMemberRoles:async ({userId,roleIds})=> { if(failRemove)throw Error('Discord unavailable'); removals++;roleState.set(userId,(roleState.get(userId)||[]).filter(r=>!roleIds.includes(r))); },
 addGuildMemberRoles:async ({userId,roleIds})=>roleState.set(userId,roleIds),
};
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,process,Date,Buffer,console,
 require:key=>({ 'server-only':{},'node:crypto':require('node:crypto'),'@/lib/firebaseAdmin':{getFirebaseAdminDb:()=>db},'@/lib/discordAdmin':discord,'@/lib/permissions':{isDashboardAdmin:()=>false} }[key] || (()=>{throw Error('Unexpected dependency: '+key)})()) },{filename:'staticRules.compiled.js'});
const f=mod.exports;
async function run(){let count=0;const check=async (name,fn)=>{await fn();count++;console.log(`PASS ${name}`)};
 stash('staticRulesConfig').set('main',{text:'## Rules long enough for acceptance tests',memberRoleId:ROLE,managerRoleId:'523456789012345678',version:1});
 stash('staticRulesMembers').set(USER,{userId:USER,name:'Test member',status:'active',blocked:false,version:1,acceptedAt:'2026-10-08T10:00:00Z',removedAt:null,removedBy:null});
 await check('one violation recorded in first of three slots',async()=>{await f.addStaticViolation(USER,'Запізнення',ACTOR);assert.equal(stash('staticRulesMembers').get(USER).violations.length,1);assert.equal(removals,0)});
 await check('empty and too long descriptions rejected',async()=>{await assert.rejects(f.addStaticViolation(USER,' ',ACTOR));await assert.rejects(f.addStaticViolation(USER,'a'.repeat(129),ACTOR));assert.equal(stash('staticRulesMembers').get(USER).violations.length,1)});
 await check('second violation does not revoke role',async()=>{await f.addStaticViolation(USER,'Без попередження',ACTOR);assert.equal(removals,0)});
 await check('third violation creates one month ban and removes role',async()=>{const result=await f.addStaticViolation(USER,'Дисципліна',ACTOR);assert.equal(result.banned,true);assert.equal(removals,1);const member=stash('staticRulesMembers').get(USER);assert.equal(member.status,'removed');assert(Date.parse(member.banUntil)>Date.now()+27*24*60*60*1000)});
 await check('cannot add fourth or overlap active ban',async()=>await assert.rejects(f.addStaticViolation(USER,'Extra',ACTOR)));
 await check('gateway enforcement revokes manually re-added role',async()=>{roleState.set(USER,[ROLE]);const result=await f.enforceStaticMemberRole(USER);assert.equal(result.revoked,1);assert.equal(removals,2)});
 await check('enforcement does nothing if role already absent',async()=>{const result=await f.enforceStaticMemberRole(USER);assert.equal(result.revoked,0);assert.equal(removals,2)});
 await check('removing a strike lifts timed ban without auto-granting role',async()=>{const strike=stash('staticRulesMembers').get(USER).violations[0];await f.removeStaticViolation(USER,strike.id,ACTOR);const member=stash('staticRulesMembers').get(USER);assert.equal(member.banUntil,null);assert.equal(member.violations.length,2);assert.equal(roleState.get(USER).length,0)});
 await check('invalid strike id never mutates DB',async()=>{await assert.rejects(f.removeStaticViolation(USER,'not-real-12345',ACTOR));assert.equal(stash('staticRulesMembers').get(USER).violations.length,2)});
 await check('manual exclusion always blocks role for gateway',async()=>{await f.removeStaticMember(USER,ACTOR);roleState.set(USER,[ROLE]);assert.equal((await f.enforceStaticMemberRole(USER)).revoked,1)});
 await check('Discord failure keeps the ban durable for later retry',async()=>{await f.unblockStaticMember(USER,ACTOR);const member=stash('staticRulesMembers').get(USER);member.violations=[];member.status='active';stash('staticRulesMembers').set(USER,member);roleState.set(USER,[ROLE]);failRemove=true;await f.addStaticViolation(USER,'a',ACTOR);await f.addStaticViolation(USER,'b',ACTOR);const result=await f.addStaticViolation(USER,'c',ACTOR);assert(result.warning);assert(f.staticBanActive(stash('staticRulesMembers').get(USER)));failRemove=false;});
 await check('banlist includes people with at least one strike',async()=>{const list=await f.listStaticDiscipline();assert.equal(list.length,1);assert.equal(list[0].userId,USER);});
 console.log(`[independent static discipline] ${count}/${count} behavioral scenarios PASS`);
}
run().catch(err=>{console.error(err);process.exitCode=1});
