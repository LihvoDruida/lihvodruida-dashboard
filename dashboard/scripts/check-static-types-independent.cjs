/** Independent regression checks for large Discord role-holder sweeps and violation API response. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const src = file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
const compile = (file) => {
  const result = ts.transpileModule(src(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  return result.outputText;
};
const load = (file, mocks) => {
  const m = { exports: {} };
  vm.runInNewContext(compile(file), { module: m, exports: m.exports, console, process, Date, Buffer,
    require: key => {
      if (key === 'server-only') return {};
      if (key === 'node:crypto') return require(key);
      if (!(key in mocks)) throw new Error(`Unexpected module ${key}`);
      return mocks[key];
    } }, { filename: file });
  return m.exports;
};
const clone = value => value === undefined ? undefined : structuredClone(value);
const prefix = '123456789012340';
const idAt = i => prefix + String(i).padStart(3, '0');
const ROLE = '923456789012345678';
const rows = new Map();
const times = { future: new Date(Date.now() + 30 * 86400000).toISOString(), expired: new Date(Date.now() - 86400000).toISOString() };
const bannedIndices = [0, 249, 250, 499, 500, 603];
for (let i = 0; i < 604; i++) {
  rows.set(idAt(i), { userId:idAt(i), status:'active', name:'Test', acceptedAt:'2026-10-08T00:00:00.000Z',
    blocked: bannedIndices.includes(i) && i % 2 === 0,
    banUntil: bannedIndices.includes(i) && i % 2 !== 0 ? times.future : null });
}
// One document has an expired ban and must remain untouched.
rows.get(idAt(603)).banUntil = times.expired;
const roles = new Map([...rows.keys()].map(id => [id, [ROLE]]));
const removals = [];
const dbTables = new Map([['staticRulesMembers', rows], ['staticRulesConfig', new Map([['main', {memberRoleId:ROLE,managerRoleId:'823456789012345678',text:'Enough Markdown content for tests',version:1}]])], ['staticRulesAudit', new Map()]]);
const getTable = name => { if (!dbTables.has(name)) dbTables.set(name, new Map()); return dbTables.get(name); };
const getDoc = (table, id) => ({id, get: async () => ({id, data: () => clone(getTable(table).get(id))}),
  set:async data => getTable(table).set(id, clone(data)), update:async data => getTable(table).set(id,{...getTable(table).get(id),...clone(data)})});
const db = {collection: name => ({ doc: id => getDoc(name, id) })};
let rosterReads = 0;
const mocks = {
  '@/lib/firebaseAdmin':{getFirebaseAdminDb:()=>db},
  '@/lib/discordAdmin':{
    getDiscordGuildId:()=> '723456789012345678',
    fetchDiscordGuildMembers:async limit => { assert.equal(limit,0); rosterReads++; return [...roles].map(([userId,roleIds])=>({userId,roleIds})); },
    fetchDiscordGuildMemberSnapshot:async id => ({userId:id,roleIds:roles.get(id)||[],joinedAt:'2026-10-01'}),
    removeGuildMemberRoles:async ({userId,roleIds}) => { removals.push(userId); roles.set(userId,(roles.get(userId)||[]).filter(id => !roleIds.includes(id))); },
  },
  '@/lib/permissions':{isDashboardAdmin:()=>false},
  '@/lib/staticRulesDefault':{DEFAULT_STATIC_RULES_MARKDOWN:'## Default rules are present'},
};
const rules = load('lib/staticRules.ts',mocks);
(async () => {
  const stats = await rules.sweepStaticForbiddenRoles();
  assert.equal(stats.checked,604, 'all actual Discord role holders are checked');
  assert.equal(stats.revoked,5);
  assert.equal(stats.failed,0);
  assert.equal(rosterReads,1);
  assert.deepEqual(removals.sort(),bannedIndices.filter(i=>i!==603).map(idAt).sort());
  assert.deepEqual(roles.get(idAt(603)),[ROLE], 'expired ban is ignored');
  console.log('PASS 604 Discord role holders checked without reliance on acceptance-registry pagination');
  console.log('PASS all active bans re-evaluated including page boundaries; expired ban untouched');

  let nextResult={banned:false,banUntil:null,violation:{id:'v1'}};
  const route=load('app/api/static/manage/route.ts',{
    'next/server':{NextResponse:{json:(data,{status=200})=>({data,status})}},
    '@/lib/auth':{getSession:async()=>({id:'123456789012345678'})},
    '@/lib/security':{assertRequestBodySize:()=>null,verifyTrustedOrigin:()=>true,checkRateLimit:()=>({ok:true}),noStoreHeaders:()=>({})},
    '@/lib/staticRules':{staticPermission:async()=>({view:true,edit:true,admin:false}),addStaticViolation:async()=>nextResult},
  });
  const request={json:async()=>({action:'add-violation',userId:idAt(1),description:'test'})};
  let response=await route.POST(request);
  assert.equal(response.status,200);
  assert.equal(Object.hasOwn(response.data,'warning'),false);
  console.log('PASS API response omits warning for successful no-warning case');
  nextResult={...nextResult,banned:true,warning:'Discord unavailable'};
  response=await route.POST(request);
  assert.equal(response.status,200);
  assert.equal(response.data.warning,'Discord unavailable');
  console.log('PASS API response preserves enforcement warning for Discord failure');
  console.log('[independent static type hotfix] 4/4 PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
