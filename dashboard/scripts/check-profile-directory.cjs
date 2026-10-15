const assert = require('node:assert/strict');
const subject = require('./lib/profile-directory-subject.cjs');
const groups = [{ id: 'admin', role: 'admin', rank: 100 }, { id: 'member', role: 'member', rank: 10 }];
const records = Array.from({ length: 257 }, (_, i) => ({ id: 'id' + i.toString(16).padStart(32, '0'), data: { displayName: i === 250 ? 'Target250' : 'Name' + (i % 5), providerUserId: String(i), role: i % 2 ? 'member' : 'admin', battlenet: { linked: i % 3 === 0 }, lastLoginAt: '2026-10-01T00:00:00Z', characters: [] } }));
let reads = 0;
// Controlled DocumentStore boundary; production permissions, normalization,
// filtering, cursors and aggregation run unchanged, without network/config.
const store = {
  collection(name) {
    const query = (after = '', limit = 100) => ({
      doc: id => ({ id, collection: name }),
      orderBy: () => query(after, limit), limit: n => query(after, n), startAfter: id => query(id, limit),
      async get() { reads++; return { docs: records.filter(r => r.id > after).slice(0, limit).map(r => ({ id: r.id, data: () => r.data })) }; },
    });
    return query();
  },
  getAll: async (...refs) => refs.map(r => ({ id: r.id, exists: false })),
};
const mod = subject({}, store, groups, 'documentStore');
const admin = { provider: 'discord', id: 'no-own', role: 'admin' };
const member = { ...admin, role: 'member', groupId: 'member', groupRank: 10, permissions: ['profiles.group.view'] };
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('✓ ' + name); }
(async () => {
  await check('Production catalog finds Target250 beyond first 200', async () => { const page = await mod.listDashboardProfilePage({ viewer: admin, query: 'target250' }); assert.equal(page.total, 1); assert.equal(page.profiles[0].profileId, records[250].id); });
  await check('Production forward cursors cover all records with equal dates', async () => {
    let cursor, ids = [];
    do { const page = await mod.listDashboardProfilePage({ viewer: admin, cursor }); assert.equal(page.total, 257); assert.ok(page.profiles.length <= 20); ids.push(...page.profiles.map(p => p.profileId)); cursor = page.nextCursor; } while (cursor);
    assert.equal(ids.length, 257); assert.equal(new Set(ids).size, 257);
  });
  await check('Backward cursor preserves search, role and link constraints', async () => {
    const params = { viewer: member, query: 'Name', link: 'unlinked', role: 'member', sort: 'name' };
    const a = await mod.listDashboardProfilePage(params), b = await mod.listDashboardProfilePage({ ...params, cursor: a.nextCursor });
    const back = await mod.listDashboardProfilePage({ ...params, cursor: b.previousCursor }); assert.equal(b.start, 21); assert.deepEqual(back.profiles.map(p => p.profileId), a.profiles.map(p => p.profileId));
    assert.equal(a.total, records.filter(r => r.data.role === 'member' && !r.data.battlenet.linked && r.data.displayName.includes('Name')).length);
  });
  await check('Hidden profiles do not influence totals or search', async () => { const page = await mod.listDashboardProfilePage({ viewer: member, query: 'Target250' }); assert.equal(page.total, 0); assert.equal(page.linkedCount, 0); assert.equal(page.characterCount, 0); });
  await check('Cursor scope changes with permissions and filters', async () => { const a = await mod.listDashboardProfilePage({ viewer: admin }); const page = await mod.listDashboardProfilePage({ viewer: member, cursor: a.nextCursor }); assert.equal(page.start, 1); assert.ok(page.cursorReset); assert.equal(page.total, 128); });
  await check('Invalid cursor and unconfigured store expose explicit states', async () => { assert.ok((await mod.listDashboardProfilePage({ viewer: admin, cursor: 'bad!' })).cursorReset); assert.ok((await subject({}, store, groups, 'unconfigured').listDashboardProfilePage({ viewer: admin })).unavailable); });
  await check('Filter parsing is bounded and defaults are deterministic', async () => { const f = mod.profileDirectoryFilters({ query: 'x'.repeat(500), role: 'invalid', link: 'invalid', sort: 'invalid' }); assert.equal(f.query.length, 120); assert.equal(f.role, 'all'); assert.equal(f.sort, 'activity'); assert.equal(f.link, 'all'); });
  assert.ok(reads > 30);
  console.log(`[check-profile-directory] OK — ${passed}/${passed}; actual catalog and permission functions; controlled DocumentStore boundary`);
})().catch(error => { console.error(error); process.exitCode = 1; });
