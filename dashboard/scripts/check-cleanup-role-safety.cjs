// Real PostgreSQL engine, document adapter, cleanup worker, strict reader and REST client.
// All Discord traffic terminates in the local controlled transport; never uses credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./lib/load-server-ts.cjs');
const guild = '111111111111111111', role = '222222222222222222', extra = '333333333333333333', user = '555555555555555555';
const control = { guildId: guild, ownerId: '999999999999999999', botId: '888888888888888888', canKick: true, botTopRole: { id: '444444444444444444', position: 20 }, roles: [
  { id: guild, name: '@everyone', position: 0, permissions: '0', managed: false },
  { id: role, name: 'Мурлок', position: 1, permissions: '0', managed: false },
  { id: extra, name: 'Козак', position: 2, permissions: '0', managed: false },
] };
const original = () => ({ user: { id: user, username: 'member', bot: false }, roles: [role], joined_at: '2020-01-01T00:00:00Z' });
let engine, service, admin, raw, calls, readCount, queueHook, readHook, afterPrepare, afterCommit, proofOffset = 0, clockOffset = 0, passed = 0;
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [Date.now() + clockOffset])); } static now() { return Date.now() + clockOffset; } }
const policy = load('src/lib/discordCleanupPolicy.ts').exports;
async function check(label, run) { await run(); passed++; console.log('✓ ' + label); }
async function main() {
  engine = new PGlite();
  await engine.exec(fs.readFileSync(path.resolve(__dirname, '../src/lib/db/schema.sql'), 'utf8'));
  const query = async (sql, values = [], client = engine) => { const r = await client.query(sql, values); return { ...r, rowCount: r.affectedRows ?? r.rows.length }; };
  const pool = { pgQuery: query, pgTransaction: async run => { const value = await engine.transaction(tx => run({ query: (sql, values) => query(sql, values, tx) })); await afterCommit?.(); return value; } };
  const { PgDocumentStore } = load('src/lib/db/documentStore.ts', { '@/lib/db/pgPool': pool }).exports;
  const store = new PgDocumentStore(), database = { '@/lib/documentDb': { getDocumentDb: () => store } };
  const access = { assertStorageWriteAvailable() {} }, security = { logDashboardEvent() {} };
  async function reset(roles = [role]) {
    await engine.exec('DELETE FROM documents');
    raw = { ...original(), roles }; calls = []; readCount = 0; queueHook = readHook = afterPrepare = afterCommit = null; clockOffset = 0; proofOffset = 0;
    const globals = { Date: Clock, Error, Headers, Request, Response, FormData, AbortSignal, AbortController, DOMException, setInterval, clearInterval,
      process: { env: { DISCORD_BOT_TOKEN: 'isolated-safety-test', DISCORD_GUILD_ID: guild, DISCORD_REST_CONCURRENCY: '1' } },
      fetch: async (url, init) => {
        assert.equal(url, `https://discord.com/api/v10/guilds/${guild}/members/${user}`);
        const method = init.method || 'GET'; calls.push(method);
        assert.equal(init.cache, 'no-store');
        if (method === 'GET') { readCount++; await readHook?.(readCount); return Response.json(raw); }
        assert.equal(method, 'DELETE'); return new Response(null, { status: 204 });
      },
    };
    const rest = load('src/lib/discordRest.ts', {}, globals).exports;
    admin = load('src/lib/discordAdmin.ts', { '@/lib/discordRest': rest, '@/lib/concurrency': {}, '@/lib/rulesOnboarding': {}, '@/lib/security': security, '@/lib/values': { cleanSnowflake: x => typeof x === 'string' && /^\d{16,25}$/.test(x) ? x : '' }, '@/lib/discordAvatar': {}, '@/lib/discordRulesStats': {} }, globals).exports;
    const discord = { ...admin, fetchDiscordCleanupControl: async () => control,
      fetchDiscordCleanupMemberPage: async () => ({ members: [{ userId: user, displayName: 'member', roleIds: roles, joinedAt: original().joined_at, bot: false }], after: user, complete: true }),
      kickDiscordCleanupMember: async (g, u, reason, beforeSend, onDispatch, prepareSend) => {
        await queueHook?.();
        return admin.kickDiscordCleanupMember(g, u, reason, beforeSend, onDispatch, async () => { await prepareSend(); await afterPrepare?.(); });
      },
    };
    const leases = load('src/lib/automationLease.ts', { ...database, '@/lib/storageAccess': access }, globals).exports;
    service = load('src/lib/discordMemberCleanup.ts', { ...database, 'node:perf_hooks': { performance: { now: () => Date.now() + proofOffset } }, '@/lib/automationLease': leases, '@/lib/storageAccess': access, '@/lib/discordAdmin': discord, '@/lib/discordCleanupPolicy': policy, '@/lib/security': security }, globals).exports;
    await service.saveDiscordCleanupSettings({ enabled: true, roleId: role, period: 'week' }, 'owner');
  }
  const events = () => store.collection('discordCleanupEvents_' + guild).get();
  async function protectedMember() {
    const result = await service.runDiscordMemberCleanup();
    assert.equal(calls.includes('DELETE'), false); assert.equal(result.kicked, 0);
    assert.equal((await events()).size, 0); assert.equal((await service.getDiscordCleanupOverview()).state.uncertainTotal, 0);
    return result;
  }
  await check('Мурлок + Козак, either order and further roles: always ignored', async () => {
    for (const roles of [[role, extra], [extra, role], [role, extra, '777777777777777777'], [extra]]) {
      await reset(roles); await protectedMember(); assert.equal(calls.length, 0);
    }
  });
  await check('only Мурлок or no roles: overdue member checked twice and receipt records exact roles', async () => {
    for (const roles of [[role], []]) {
      await reset(roles); const result = await service.runDiscordMemberCleanup(); assert.equal(result.kicked, 1);
      assert.deepEqual(calls, ['GET', 'GET', 'DELETE']);
      const event = (await events()).docs[0].data(); assert.deepEqual(event.verifiedRoleIds, roles);
      assert.equal(event.policyVersion, 'exact-role-set-v3'); assert.ok(Date.parse(event.rolesVerifiedAt)); assert.equal(event.verificationCount, 2);
      assert.equal((await service.getDiscordCleanupOverview()).state.kickedTotal, 1);
    }
  });
  await check('additional role acquired while waiting: no DELETE and no prepared receipt', async () => {
    for (const roles of [[role, extra], [extra, role]]) {
      await reset(); queueHook = () => { raw.roles = roles; }; const result = await protectedMember();
      assert.equal(readCount, 2); assert.equal(result.failed, 0);
    }
  });
  await check('rejoin and bot discovered after waiting protect the membership', async () => {
    for (const mutate of [() => { raw.joined_at = new Date().toISOString(); }, () => { raw.user.bot = true; }]) {
      await reset(); queueHook = mutate; await protectedMember(); assert.equal(readCount, 2);
    }
  });
  await check('missing, malformed or wrong-identity data fails closed on the final read', async () => {
    for (const mutate of [() => { delete raw.roles; }, () => { raw.roles = null; }, () => { raw.roles = [role, null]; }, () => { raw.roles = [role, 123]; }, () => { raw.user.id = extra; }, () => { delete raw.user; }, () => { raw.user.bot = 'false'; }]) {
      await reset(); queueHook = mutate; const result = await protectedMember(); assert.equal(result.failed, 1);
    }
  });
  await check('strict reader preserves every role, including roles beyond the old 100-role slice', async () => {
    await reset(); raw.roles = Array.from({ length: 101 }, (_, i) => String(600000000000000000n + BigInt(i)));
    const snapshot = await admin.fetchDiscordCleanupMemberSnapshot(user, guild);
    assert.deepEqual(Array.from(snapshot.roleIds), raw.roles);
  });
  await check('pause during final member read wins before receipt and dispatch', async () => {
    await reset(); readHook = async n => { if (n === 2) await service.pauseDiscordCleanup('owner'); };
    const result = await protectedMember(); assert.equal(result.failed, 0);
    assert.equal((await service.getDiscordCleanupOverview()).settings.enabled, false);
  });
  await check('delayed final acquisition rejects stale role verification without dispatch', async () => {
    await reset(); afterPrepare = () => { proofOffset += 1500; }; const result = await protectedMember(); assert.equal(result.failed, 0);
  });
  await check('any role-set change requires a new pair of matching confirmations', async () => {
    for (const [initial, final] of [[[role], []], [[], [role]]]) {
      await reset(initial); queueHook = () => { raw.roles = final; }; const result = await protectedMember(); assert.equal(result.failed, 0);
      assert.equal(readCount, 2); queueHook = null;
      await service.runDiscordMemberCleanup();
      const event = (await events()).docs[0].data(); assert.deepEqual(event.verifiedRoleIds, final); assert.equal(event.verificationCount, 2);
    }
  });
  await check('a slow receipt commit cannot dispatch using an expired confirmation', async () => {
    await reset();
    afterCommit = async () => { if ((await events()).docs.some(doc => doc.data().status === 'prepared')) { afterCommit = null; proofOffset += 1500; } };
    const result = await service.runDiscordMemberCleanup();
    assert.equal(calls.includes('DELETE'), false); assert.equal(result.kicked, 0); assert.equal(result.failed, 0);
    assert.equal((await events()).docs[0].data().status, 'retry');
    assert.ok((await events()).docs[0].data().sortKey.startsWith('r_'), 'known-unsent receipt leaves the abandoned-prepared queue');
    const overview = await service.getDiscordCleanupOverview(); assert.equal(overview.execution.inFlight, null); assert.equal(overview.state.uncertainTotal, 0);
    await service.runDiscordMemberCleanup(); assert.equal(calls.filter(method => method === 'DELETE').length, 1);
  });
  await check('backwards clock adjustment cannot make an old proof look fresh', async () => {
    await reset(); afterPrepare = () => { clockOffset -= 1500; }; await protectedMember();
  });
  console.log(`[check-cleanup-role-safety] OK — ${passed} PostgreSQL/worker/REST role safety scenarios; no live Discord requests`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await engine?.close(); });
