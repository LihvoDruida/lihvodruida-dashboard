/* Execute real Static functions with isolated database/Discord adapters. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/staticRules.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const USER = '123456789012345678', ROLE = '223456789012345678', OTHER = '323456789012345678';
const tables = new Map();
const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
const clone = value => value === undefined ? undefined : structuredClone(value);
let readFailure = false, onSnapshot, onGrant, grantFailure = false, removalFailure = false;
let roleState, removals, grants, rosterReads;
const doc = (name, id) => ({
  id, table: name,
  get: async () => {
    if (readFailure && name === 'staticRulesMembers') throw Error('Database unavailable');
    return { exists: table(name).has(id), data: () => clone(table(name).get(id)) };
  },
  set: async value => table(name).set(id, clone(value)),
  update: async value => table(name).set(id, { ...table(name).get(id), ...clone(value) }),
});
const db = {
  collection: name => ({ doc: id => doc(name, id) }),
  runTransaction: async work => work({ get: ref => ref.get(), set: (ref, value) => ref.set(value), update: (ref, value) => ref.update(value) }),
};
const discord = {
  getDiscordGuildId: () => '423456789012345678',
  assertDiscordRolesManageable: async () => {},
  fetchDiscordGuildMemberSnapshot: async userId => {
    await onSnapshot?.();
    return { userId, displayName: 'Sebas', joinedAt: '2026-10-01T00:00:00Z', roleIds: [...(roleState.get(userId) || [])] };
  },
  fetchDiscordGuildMembers: async limit => {
    assert.equal(limit, 0); rosterReads++;
    return [...roleState].map(([userId, roleIds]) => ({ userId, roleIds }));
  },
  addGuildMemberRoles: async ({ userId, roleIds }) => {
    const acceptance = table('staticRulesMembers').get(userId);
    assert.ok(acceptance?.acceptedAt, 'Consent must be durable before Discord emits a grant event');
    assert.deepEqual(Array.from(roleIds), [ROLE]);
    if (grantFailure) throw Error('Discord unavailable');
    grants++;
    roleState.set(userId, [...new Set([...(roleState.get(userId) || []), ...roleIds])]);
    await onGrant?.();
  },
  removeGuildMemberRoles: async ({ userId, roleIds }) => {
    assert.deepEqual(Array.from(roleIds), [ROLE], 'Only the configured Static role may be removed');
    if (removalFailure) throw Error('Discord unavailable');
    removals++;
    roleState.set(userId, (roleState.get(userId) || []).filter(id => !roleIds.includes(id)));
  },
};
const mocks = {
  'server-only': {}, 'node:crypto': crypto,
  '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => db }, '@/lib/discordAdmin': discord,
  '@/lib/permissions': { isDashboardAdmin: () => false },
  '@/lib/staticRulesDefault': { DEFAULT_STATIC_RULES_MARKDOWN: '## Default rules with sufficient length' },
};
const loaded = { exports: {} };
vm.runInNewContext(source, { module: loaded, exports: loaded.exports, process, Buffer, Date,
  require: name => { if (!(name in mocks)) throw Error('Unexpected dependency: ' + name); return mocks[name]; },
});
const f = loaded.exports;
const accepted = () => ({ userId: USER, name: 'Sebas', status: 'active', blocked: false, acceptedAt: new Date().toISOString(), version: 1 });
function reset() {
  tables.clear(); readFailure = false; onSnapshot = onGrant = undefined;
  grantFailure = removalFailure = false; removals = grants = rosterReads = 0;
  roleState = new Map([[USER, [ROLE, OTHER]]]);
  table('staticRulesConfig').set('main', { text: '## Valid Static rules for acceptance', version: 1, memberRoleId: ROLE, managerRoleId: OTHER });
}
function challenge() {
  const code = '0123456789ABCDEF01', inviteId = 'invite';
  const key = crypto.createHash('sha256').update(code).digest('hex');
  table('staticRulesInvites').set(inviteId, { expiresAt: new Date(Date.now() + 86400000).toISOString(), revokedAt: null });
  table('staticRulesChallenges').set(key, { inviteId, version: 1, status: 'pending', expiresAt: new Date(Date.now() + 600000).toISOString() });
  return { code, key };
}
let count = 0;
async function check(name, work) { reset(); await work(); count++; console.log('PASS ' + name); }
(async () => {
  await check('manual role without any consent record is revoked; other roles survive', async () => {
    assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 1); assert.deepEqual(roleState.get(USER), [OTHER]);
  });
  await check('null or malformed acceptance is rejected', async () => {
    for (const acceptedAt of [null, '', 'not-a-date']) {
      table('staticRulesMembers').set(USER, { ...accepted(), acceptedAt }); roleState.set(USER, [ROLE, OTHER]);
      assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 1);
    }
  });
  await check('valid prior consent survives subsequent rules publication', async () => {
    table('staticRulesMembers').set(USER, accepted()); table('staticRulesConfig').get('main').version = 2;
    assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 0); assert.equal(removals, 0);
  });
  await check('blocked participant remains rejected despite previous consent', async () => {
    table('staticRulesMembers').set(USER, { ...accepted(), blocked: true });
    assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 1);
  });
  await check('active timed suspension rejects manual regrant', async () => {
    table('staticRulesMembers').set(USER, { ...accepted(), banUntil: new Date(Date.now() + 86400000).toISOString() });
    assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 1);
  });
  await check('missing role, invalid user and unconfigured role are no-ops', async () => {
    roleState.set(USER, [OTHER]); assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 0);
    assert.equal((await f.enforceStaticMemberRole('invalid')).checked, 0);
    table('staticRulesConfig').get('main').memberRoleId = '';
    assert.equal((await f.enforceStaticMemberRole(USER)).checked, 0); assert.equal(removals, 0);
  });
  await check('database failure never means missing consent', async () => {
    readFailure = true; await assert.rejects(f.enforceStaticMemberRole(USER)); assert.equal(removals, 0);
  });
  await check('consent committed during Discord read prevents revocation', async () => {
    onSnapshot = () => table('staticRulesMembers').set(USER, accepted());
    assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 0);
  });
  await check('configuration change during lookup prevents deleting previous role', async () => {
    onSnapshot = () => { table('staticRulesConfig').get('main').memberRoleId = OTHER; };
    assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 0); assert.equal(removals, 0);
  });
  await check('startup sweep discovers holders absent from acceptance registry', async () => {
    const known = '523456789012345678'; table('staticRulesMembers').set(known, accepted()); roleState.set(known, [ROLE, OTHER]);
    const result = await f.sweepStaticForbiddenRoles();
    assert.equal(result.checked, 2); assert.equal(result.revoked, 1); assert.equal(result.failed, 0);
    assert.equal(rosterReads, 1); assert.deepEqual(roleState.get(known), [ROLE, OTHER]);
  });
  await check('sweep reports failed removal and subsequent sweep retries', async () => {
    removalFailure = true; assert.equal((await f.sweepStaticForbiddenRoles()).failed, 1);
    removalFailure = false; assert.equal((await f.sweepStaticForbiddenRoles()).revoked, 1);
  });
  await check('bot acceptance stores consent before grant; gateway check preserves role', async () => {
    const { code, key } = challenge(); roleState.set(USER, [OTHER]);
    onGrant = async () => assert.equal((await f.enforceStaticMemberRole(USER)).revoked, 0);
    assert.equal((await f.confirmStaticChallenge(code, USER)).ok, true);
    assert.equal(table('staticRulesChallenges').get(key).status, 'completed'); assert.equal(grants, 1); assert.equal(removals, 0);
    assert.equal((await f.confirmStaticChallenge(code, USER)).ok, true); assert.equal(grants, 1);
  });
  await check('failed role grant preserves actual consent and permits same-code retry', async () => {
    const { code, key } = challenge(); roleState.set(USER, [OTHER]); grantFailure = true;
    assert.equal((await f.confirmStaticChallenge(code, USER)).ok, false);
    assert.equal(table('staticRulesChallenges').get(key).status, 'failed'); assert.ok(table('staticRulesMembers').get(USER).acceptedAt);
    grantFailure = false; assert.equal((await f.confirmStaticChallenge(code, USER)).ok, true); assert.equal(grants, 1);
  });
  await check('revocation while grant is in flight removes only Static role', async () => {
    const { code } = challenge(); onGrant = () => { table('staticRulesMembers').get(USER).blocked = true; };
    assert.equal((await f.confirmStaticChallenge(code, USER)).ok, false); assert.deepEqual(roleState.get(USER), [OTHER]);
  });
  console.log(`[check-static-role-enforcement] ${count}/${count} behavioral scenarios passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
