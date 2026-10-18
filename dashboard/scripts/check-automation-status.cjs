const assert = require('node:assert/strict');
const { policy, accounts, nicknames, status, loadOverview } = require('./lib/automation-status-subject.cjs');
const now = Date.parse('2026-10-13T20:00:00Z'), iso = n => new Date(n).toISOString();
const guild = '123456789012345678';
const memberSettings = { enabled: true, roleId: guild, period: 'month', updatedAt: iso(now - 30_000) };
const lease = { owner: 'private-owner-do-not-serialize', startedAt: iso(now - 20_000), expiresAtMs: now + 60_000, source: 'automatic' };
const member = (s = {}, e = {}, l = {}, settings = memberSettings) => status.memberCleanupStatus(settings, s, e, l, now);
const nickname = (p = {}, s = {}, l = {}) => status.nicknameWarningStatus(policy.normalizeGuildNicknamePolicy(p), nicknames.normalizeNicknameWarningState(s), l, now);
const account = (s = {}, l = {}) => status.accountCleanupStatus(accounts.normalizeAccountCleanupSettings(s), l, now);
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('✓ ' + name); }
(async () => {
  await check('Enabled without a worker is waiting, never running', () => assert.equal(member().state, 'waiting'));
  await check('A fresh durable lease confirms execution', () => assert.equal(member({}, {}, lease).state, 'running'));
  await check('Expired lease cannot confirm execution', () => assert.notEqual(member({}, {}, { ...lease, expiresAtMs: now }).state, 'running'));
  await check('Missing owner or invalid lease date cannot confirm execution', () => {
    assert.notEqual(member({}, {}, { ...lease, owner: '' }).state, 'running');
    assert.notEqual(member({}, {}, { ...lease, startedAt: 'invalid' }).state, 'running');
  });
  await check('Settings lease is saving, not a cleanup run', () => assert.equal(member({}, {}, { ...lease, source: 'settings:owner' }).label, 'Збереження'));
  await check('Independent pause takes precedence over enabled settings', () => assert.equal(member({}, { paused: true }).state, 'paused'));
  await check('Paused sent request with a live worker is stopping', () => assert.equal(member({}, { paused: true, inFlight: { attemptId: 'a' } }, lease).label, 'Зупинка'));
  await check('Abandoned in-flight request requires reconciliation', () => assert.equal(member({}, { inFlight: { attemptId: 'a' } }).state, 'attention'));
  await check('Uncertain results target the uncertainty list without a mutation action', () => {
    const card = member({ uncertainTotal: 2 });
    assert.equal(card.state, 'attention'); assert.ok(card.action.href.includes('?tab=uncertain'));
  });
  await check('Paused uncertainty stays visible and does not invent a next run', () => {
    const card = member({ uncertainTotal: 2 }, { paused: true });
    assert.ok(card.reason.includes('на паузі')); assert.equal(card.nextAt, null);
  });
  await check('Worker errors are attention, not success', () => assert.equal(member({ lastError: 'No Kick Members' }).state, 'attention'));
  await check('An old success is not shown as a later failed attempt result', () => {
    const card = member({ lastRunAt: iso(now), lastError: 'fail', recentRuns: [{ at: iso(now - 5000), summary: 'old success' }] });
    assert.ok(!card.lastResult.includes('old success')); assert.ok(card.lastResult.includes('помилку'));
  });
  await check('Missing role requires configuration', () => assert.equal(member({}, {}, {}, { ...memberSettings, roleId: '' }).label, 'Потрібна роль'));
  await check('An invalid stored period requires configuration instead of promising a run', () => assert.equal(member({}, {}, {}, { ...memberSettings, period: 'invalid' }).label, 'Потрібен строк'));
  await check('Malformed stored booleans cannot falsely confirm a pause or enabled mode', () => {
    assert.equal(member({}, {}, {}, { ...memberSettings, enabled: 'true' }).label, 'Перевірити правило');
    assert.equal(member({}, { paused: 'false' }).label, 'Перевірити правило');
  });
  await check('Missing automatic calls older than 3 minutes require scheduler inspection', () => assert.equal(member({}, {}, {}, { ...memberSettings, updatedAt: iso(now - 181_000) }).state, 'attention'));
  await check('Recent idle call gives the 60-second estimate', () => assert.equal(member({ lastAutomaticRunAt: iso(now - 20_000) }).nextAt, iso(now + 40_000)));
  await check('An active scan gives the 10-second estimate without claiming execution', () => {
    const card = member({ lastAutomaticRunAt: iso(now - 5000), scan: { id: 'scan' } });
    assert.equal(card.nextAt, iso(now + 5000)); assert.equal(card.state, 'waiting');
  });
  await check('Invalid stored timestamps never reach display dates', () => {
    assert.equal(status.statusDate('invalid'), null); assert.equal(member({ lastRunAt: 'invalid' }).lastAt, null);
  });
  await check('Nickname defaults use the worker normalizer and remain paused', () => assert.equal(nickname().state, 'paused'));
  await check('Nickname warnings remain visible when reminder delivery is disabled', () => assert.equal(nickname({}, { lastRunStatus: 'warning', lastError: 'DM blocked' }).state, 'attention'));
  await check('Nickname queue and full scan choose the earlier due time', () => {
    const card = nickname({ nicknameReminderEnabled: true }, { lastFullScanAt: iso(now), lastFullScanTemplate: policy.DEFAULT_NICKNAME_TEMPLATE, nextInvalidCheckAt: iso(now + 60000) });
    assert.equal(card.nextAt, iso(now + 60000));
  });
  await check('Changed nickname template makes the full scan due now', () => assert.equal(nickname({ nicknameReminderEnabled: true }, { lastFullScanAt: iso(now), lastFullScanTemplate: 'legacy' }).nextAt, iso(now)));
  await check('Account defaults enable inspection only, never deletion', () => {
    const card = account(); assert.equal(card.state, 'waiting'); assert.ok(card.reason.includes('без видалення'));
    assert.equal(accounts.normalizeAccountCleanupSettings({}).autoCleanupEnabled, false);
  });
  await check('Candidates without automatic deletion have a review action', () => assert.equal(account({ lastCheckCandidates: 7 }).label, 'Є кандидати'));
  await check('Account automation completely disabled is paused', () => assert.equal(account({ autoCheckEnabled: false }).state, 'paused'));
  await check('Latest account result is chosen by date, not by operation kind', () => {
    const card = account({ lastCheckAt: iso(now), lastCleanupAt: iso(now - 60000), lastCheckCheckedProfiles: 12, lastCleanupDeletedProfiles: 9 });
    assert.ok(card.lastResult.includes('Перевірено: 12')); assert.ok(!card.lastResult.includes('Видалено'));
  });
  await check('Overdue schedule stays overdue instead of being moved to now', () => assert.equal(account({ lastCheckAt: iso(now - 9 * 3600000), checkIntervalHours: 6 }).nextAt, iso(now - 3 * 3600000)));
  await check('Live account lease is running even during a manual operation with automation off', () => assert.equal(account({ autoCheckEnabled: false }, lease).state, 'running'));
  let calls = 0, refs = [];
  const db = { collection: c => ({ doc: id => ({ collection: c, id }) }), getAll: async (...r) => { calls++; refs = r; return r.map(ref => ({ data: () => ref.collection === 'automationLeases' ? lease : {} })); } };
  await check('Overview batches seventeen documents for eleven cards and never starts a worker or writer', async () => {
    const overview = await loadOverview(db, guild)();
    assert.equal(calls, 1); assert.equal(refs.length, 17); assert.equal(overview.cards.length, 11);
    assert.ok(!JSON.stringify(overview).includes(lease.owner)); assert.ok(!JSON.stringify(overview).includes('expiresAtMs'));
  });
  await check('A failed read reports all states unavailable, never disabled defaults', async () => {
    const overview = await loadOverview({ ...db, getAll: async () => { throw new Error('database down'); } }, guild)();
    assert.ok(overview.cards.every(card => card.state === 'unavailable'));
  });
  await check('No configured database performs no read', async () => {
    const before = calls, overview = await loadOverview(db, guild, {}, false)();
    assert.equal(calls, before); assert.ok(overview.cards.every(card => card.state === 'unavailable'));
  });
  await check('No guild makes member cleanup unavailable while other stored diagnostics remain readable', async () => {
    const overview = await loadOverview(db, '')();
    assert.equal(refs.length, 13); assert.equal(overview.cards[0].state, 'unavailable'); assert.notEqual(overview.cards[2].state, 'unavailable');
  });
  await check('A stalled database read has a bounded diagnostic deadline', async () => {
    const start = Date.now(), overview = await loadOverview({ ...db, getAll: () => new Promise(() => {}) }, guild)();
    assert.ok(Date.now() - start < 3000); assert.ok(overview.cards.every(card => card.state === 'unavailable'));
  });
  console.log(JSON.stringify({ passed }));
})().catch(error => { console.error(error); process.exitCode = 1; });
