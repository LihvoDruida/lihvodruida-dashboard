/* Fresh isolated route tests: execute transpiled API handlers with intentionally controlled dependency behavior. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../src');
const SESSION = { id: '123456789012345678', provider: 'discord' };
const validConfig = { text: '## Правила Статика\nСписок вимог.', version: 3, memberRoleId: '111111111111111111', managerRoleId: '222222222222222222' };
const roleList = [{ id: '111111111111111111', name: 'Статик', manageable: true }, { id: '222222222222222222', name: 'РЛ', manageable: false }];
function rig(route, options = {}) {
  const calls = [];
  const flags = { origin: true, admin: false, edit: false, view: true, available: true, ...options };
  const s = fs.readFileSync(path.join(ROOT, route), 'utf8');
  const source = ts.transpileModule(s, { fileName: route, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const reply = (data, opt = {}) => ({ status: opt.status || 200, jsonData: data, headers: opt.headers });
  const mocks = {
    'next/server': { NextResponse: { json: reply } },
    '@/lib/auth': { getSession: async () => flags.session === undefined ? SESSION : flags.session },
    '@/lib/security': { assertRequestBodySize: () => null, verifyTrustedOrigin: () => flags.origin, checkRateLimit: () => ({ ok: true }), noStoreHeaders: () => ({'cache-control':'no-store'}) },
    '@/lib/staticRules': {
      staticPermission: async () => ({ view: flags.view, edit: flags.edit, admin: flags.admin }),
      getStaticSettings: async () => validConfig,
      saveStaticSettings: async (input, id, only) => { calls.push({ name: 'save', input, id, only }); return { ...validConfig, ...input }; },
      listStaticAudit: async () => { calls.push({ name: 'audit' }); return [{ id: 'event1', kind: 'member.accepted' }]; },
      listStaticOverview: async () => { calls.push({ name: 'overview' }); return { settings: validConfig, invites: [], members: [] }; },
      createStaticInvite: async () => ({ token: 'token', expiresAt: '2026-10-09T00:00:00Z' }),
      removeStaticMember: async () => null, revokeStaticInvite: async () => null, unblockStaticMember: async () => null,
    },
    '@/lib/discordAdmin': {
      fetchDiscordRoleControlSnapshot: async () => flags.available ? { roles: roleList, guild: { name:'Test' }, botCanManageRoles: true, error: null } : { roles: [], guild: null, botCanManageRoles: false, error: 'API down' },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name) => { if (!(name in mocks)) throw Error('Unexpected import: ' + name); return mocks[name]; } }, { filename: route });
  return { handler: module.exports, flags, calls };
}
function post(body) { return { json: async () => body }; }
let pass = 0;
async function check(title, callback) { await callback();pass++;console.log('PASS '+title); }
(async () => {
  const rules = 'app/api/static/rules/route.ts',
        roles = 'app/api/dashboard/static-roles/route.ts',
        events = 'app/api/static/events/route.ts',
        overview = 'app/api/static/manage/route.ts';
  await check('rules: ordinary guild viewer can read', async () => { const x = rig(rules); assert.equal((await x.handler.GET()).jsonData.settings.version,3); });
  await check('rules: viewer denied write', async () => { const x = rig(rules);assert.equal((await x.handler.POST(post({text:'Valid enough content for testing.'}))).status,403); });
  await check('rules: authorized RL can edit', async () => { const x=rig(rules,{edit:true});assert.equal((await x.handler.POST(post({text:'Valid enough content for testing.'}))).status,200); assert.equal(x.calls[0].only,undefined); });
  await check('rules: CSRF denied', async () => { const x=rig(rules,{edit:true,origin:false});assert.equal((await x.handler.POST(post({text:'Valid enough content for testing.'}))).status,403); });
  await check('rules: excessive markdown denied', async () => { const x=rig(rules,{edit:true});assert.equal((await x.handler.POST(post({text:'x'.repeat(20001)}))).status,400); });
  await check('rules: unauthenticated GET denied', async () => { const x=rig(rules,{view:false,session:null});assert.equal((await x.handler.GET()).status,403); });
  await check('events: viewer can open history', async () => { const x=rig(events);assert.equal((await x.handler.GET()).jsonData.events[0].id,'event1'); });
  await check('events: non-member forbidden', async () => { const x=rig(events,{view:false});assert.equal((await x.handler.GET()).status,403); });
  await check('events: does not fetch roster', async () => { const x=rig(events);await x.handler.GET();assert.deepEqual(x.calls.map(c=>c.name),['audit']); });
  await check('overview: does not fetch audit', async () => { const x=rig(overview);await x.handler.GET();assert.deepEqual(x.calls.map(c=>c.name),['overview']); });
  await check('overview: save-rules no longer accepted', async () => { const x=rig(overview,{edit:true});assert.equal((await x.handler.POST(post({action:'save-rules',text:'Unapproved'}))).status,400); });
  await check('overview: save-roles no longer accepted', async () => { const x=rig(overview,{edit:true});assert.equal((await x.handler.POST(post({action:'save-roles',memberRoleId:'1'}))).status,400); });
  await check('settings: RL cannot GET admin roles', async () => { const x=rig(roles,{edit:true});assert.equal((await x.handler.GET()).status,403); });
  await check('settings: RL cannot POST admin roles', async () => { const x=rig(roles,{edit:true});assert.equal((await x.handler.POST(post({memberRoleId:'1',managerRoleId:'2'}))).status,403); });
  await check('settings: owner/admin can load list', async () => { const x=rig(roles,{admin:true,edit:true});assert.equal((await x.handler.GET()).jsonData.roles.length,2); });
  await check('settings: Discord failure surfaced', async () => { const x=rig(roles,{admin:true,available:false});assert.equal((await x.handler.GET()).jsonData.warning,'API down'); });
  await check('settings: admin can change roles', async () => { const x=rig(roles,{admin:true,edit:true});assert.equal((await x.handler.POST(post({memberRoleId:roleList[0].id,managerRoleId:roleList[1].id}))).status,200);assert.equal(x.calls[0].only,true); });
  await check('settings: missing role selection denied', async () => { const x=rig(roles,{admin:true});assert.equal((await x.handler.POST(post({memberRoleId:12,managerRoleId:null}))).status,400); });
  await check('settings: CSRF denied', async () => { const x=rig(roles,{admin:true,origin:false});assert.equal((await x.handler.POST(post({memberRoleId:'1',managerRoleId:'2'}))).status,403); });
  await check('settings: anonymous GET denied', async () => { const x=rig(roles,{session:null});assert.equal((await x.handler.GET()).status,403); });
  console.log(`Independent Static sections route checks passed: ${pass}/${pass}`);
})().catch(err => { console.error(err); process.exitCode = 1; });
