const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes } = require('node:crypto'), pg = require('pg'), load = require('./lib/load-server-ts.cjs');
const { loadOverview, policy } = require('./lib/automation-status-subject.cjs');
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || url === process.env.POSTGRES_URL) throw Error('Use an isolated TEST_DATABASE_URL; application URLs refused.');
const schema = 'r65_' + randomBytes(12).toString('hex');
const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 1000, options: '-c search_path=' + schema + ' -c statement_timeout=3000' });
pool.on('error', () => {});
const db = load('src/lib/db/pgPool.ts', { pg }, { __mistblossomPgPool: pool, process: { env: { DATABASE_URL: url } } }).exports;
let queries = [];
const adapter = load('src/lib/db/documentStore.ts', { '@/lib/db/pgPool': { ...db, pgQuery: (...args) => { queries.push(args); return db.pgQuery(...args); } } }).exports;
const store = new adapter.PgFirestore(), guild = '123456789012345678', read = loadOverview(store, guild);
const settings = id => store.collection('dashboardSettings').doc(id), lease = id => store.collection('automationLeases').doc(id);
const digest = async () => (await pool.query('SELECT collection,doc_id,data FROM documents ORDER BY collection,doc_id')).rows;
const iso = offset => new Date(Date.now() + offset).toISOString();
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('✓ ' + name); }
(async () => {
  await pool.query('CREATE SCHEMA ' + schema);
  await pool.query(fs.readFileSync(path.join(__dirname, '../src/lib/db/schema.sql'), 'utf8'));
  await check('Missing documents are readable defaults, with inspection enabled and deletion disabled', async () => {
    const result = await read();
    assert.equal(result.cards[0].state, 'paused'); assert.equal(result.cards[1].state, 'paused');
    assert.equal(result.cards[2].state, 'waiting'); assert.ok(result.cards[2].reason.includes('без видалення'));
  });
  await settings('discordMemberCleanup_' + guild).set({ enabled: true, roleId: guild, period: 'month', updatedAt: iso(0) });
  await settings('discordMemberCleanupState_' + guild).set({ uncertainTotal: 2 });
  await settings('discordMemberCleanupState_999999999999999999').set({ uncertainTotal: 9000, lastError: 'Other guild data' });
  await check('The member projection reads only its configured guild and targets uncertain results', async () => {
    const card = (await read()).cards[0]; assert.equal(card.label, 'Потрібна звірка');
    assert.ok(card.reason.includes('2')); assert.ok(!card.reason.includes('9000')); assert.ok(card.action.href.includes('tab=uncertain'));
  });
  await check('Nine diagnostic references execute exactly one parameterized SELECT', async () => {
    queries = []; await read(); assert.equal(queries.length, 1);
    assert.equal(queries[0][1][0].length, 15); assert.equal(queries[0][1][1].length, 15);
    assert.ok(queries[0][0].includes('UNNEST($1::text[])'));
  });
  await lease('discord-member-cleanup_' + guild).set({ owner: 'private-lease-owner', source: 'automatic', startedAt: iso(-5000), expiresAtMs: Date.now() + 60000 });
  await check('A stored live lease is execution; its expired replacement is attention', async () => {
    assert.equal((await read()).cards[0].state, 'running');
    await lease('discord-member-cleanup_' + guild).set({ expiresAtMs: Date.now() - 1000 }, { merge: true });
    assert.equal((await read()).cards[0].state, 'attention');
  });
  await settings('discordNicknamePolicy').set({ nicknameReminderEnabled: 'on' });
  await settings('discordNicknameWarningAutomation').set({ lastFullScanAt: iso(0), lastFullScanTemplate: policy.DEFAULT_NICKNAME_TEMPLATE, nextInvalidCheckAt: iso(60000), trackedInvalid: 3 });
  await settings('accountCleanupAutomation').set({ lastCheckAt: iso(-60000), lastCheckCandidates: 7, lastCheckCheckedProfiles: 42, autoCleanupEnabled: false });
  await check('Real stored values use the same normalization as the workers', async () => {
    const cards = (await read()).cards; assert.equal(cards[1].state, 'waiting'); assert.ok(cards[1].reason.includes('3'));
    assert.equal(cards[2].label, 'Є кандидати'); assert.ok(cards[2].lastResult.includes('42'));
  });
  await settings('discordMemberCleanupControl_' + guild).set({ token: 'private-pause-token', paused: true, pauseRequestedBy: 'private-actor' });
  await check('Public diagnostic cards contain no lease owner, pause token or actor', async () => {
    const result = JSON.stringify(await read());
    for (const value of ['private-lease-owner', 'private-pause-token', 'private-actor', 'expiresAtMs', 'updatedBy']) assert.ok(!result.includes(value));
  });
  await check('Reading diagnostics leaves every stored document byte-equivalent', async () => {
    const before = await digest(); await read(); assert.deepEqual(await digest(), before);
  });
  await check('A genuine storage error is unavailable despite a previous successful read', async () => {
    await pool.query('ALTER TABLE documents RENAME TO unavailable_documents');
    try { assert.ok((await read()).cards.every(card => card.state === 'unavailable')); }
    finally { await pool.query('ALTER TABLE unavailable_documents RENAME TO documents'); }
  });
  console.log(JSON.stringify({ passed, database: (await pool.query('SHOW server_version')).rows[0].server_version, privateSchema: true }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await pool.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => {}); await pool.end();
});
