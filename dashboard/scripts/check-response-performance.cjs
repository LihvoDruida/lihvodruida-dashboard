const assert = require("node:assert/strict");
const load = require("./lib/load-node-ts.cjs");
const { settleWithConcurrency } = load("src/lib/settleWithConcurrency.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log("PASS", name); }

function store() {
  const collections = new Map(), queries = [];
  let tail = Promise.resolve();
  const db = { transactions: 0, failProcessingOnce: false, queries, rows(name) {
    if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name);
  }, collection(name) {
    const ref = (id) => ({ id, name, async delete() { db.rows(name).delete(id); } });
    const snapshot = (id) => ({ id, ref: ref(id), data: () => db.rows(name).get(id) });
    function query(filters = [], limit = Infinity) {
      return {
        where(field, op, value) { return query([...filters, { field, op, value }], limit); },
        limit(n) { return query(filters, n); },
        async get() {
          if (db.failProcessingOnce && filters.some((f) => f.value === "processing")) { db.failProcessingOnce = false; throw Error("temporary DB read error"); }
          const rows = [...db.rows(name)].filter(([, data]) => filters.every((f) => f.op === "==" ? data[f.field] === f.value : data[f.field] !== undefined && data[f.field] <= f.value)).slice(0, limit);
          queries.push({ name, filters, returned: rows.length });
          return { docs: rows.map(([id]) => snapshot(id)) };
        },
      };
    }
    return { ...query(), doc: ref };
  }, runTransaction(fn) {
    const pending = tail.then(() => { db.transactions++; return fn({
      get: async (ref) => ({ data: () => db.rows(ref.name).get(ref.id) }),
      set: (ref, data) => db.rows(ref.name).set(ref.id, data),
    }); });
    tail = pending.catch(() => {}); return pending;
  } };
  return db;
}
const secret = { env: { SESSION_SECRET: "isolated-performance-test-" + "x".repeat(48) } };
function outbox(db) { return load("src/lib/discordInteractionOutbox.ts", { "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => db } }, { process: secret }); }
const id = (n) => String(1977770001112224401n + BigInt(n));

(async () => {
  await check("resource slots refill while an unrelated slow read is still pending", async () => {
    const slow = gate(), started = []; let active = 0, peak = 0;
    const pending = settleWithConcurrency([0, 1, 2, 3], async (n) => {
      started.push(n); peak = Math.max(peak, ++active);
      try { if (n === 0) await slow.promise; if (n === 2) throw Error("one failed widget"); return n; }
      finally { active--; }
    }, 2);
    await tick(); assert.deepEqual(started, [0, 1, 2, 3]); assert.equal(peak, 2);
    slow.release(); const result = await pending;
    assert.equal(result[0].value, 0); assert.equal(result[2].status, "rejected"); assert.equal(result[3].value, 3);
  });
  await check("empty resource set performs no work; invalid concurrency stays bounded", async () => {
    assert.equal((await settleWithConcurrency([], () => assert.fail())).length, 0);
    let active = 0, peak = 0;
    await settleWithConcurrency([1, 2, 3], async () => { peak = Math.max(peak, ++active); await tick(); active--; }, 0);
    assert.equal(peak, 1);
  });

  let session = { profileId: "owner" }, staff = true, allowOrigin = true;
  let resolver = async (kind) => ({ kind });
  const route = load("src/app/api/background/refresh/route.ts", {
    "next/server": { NextResponse: { json: (data, init) => new Response(JSON.stringify(data), init) } },
    "@/lib/settleWithConcurrency": { settleWithConcurrency },
    "@/lib/auth": { getSession: async () => session },
    "@/lib/integrationStatus": { getIntegrationStatusSummary: () => resolver("integrations") },
    "@/lib/dashboardApiSettings": { getDashboardApiSettings: async () => ({ profileViewRefreshMinSeconds: 600 }) },
    "@/lib/guildRoster": { loadStoredGuildRosterData: async () => { await resolver("guild"); return { members: [], stats: {} }; } },
    "@/lib/permissions": { isDashboardStaff: () => staff, canViewGuildRoster: () => staff, canManageRaids: () => staff, canViewRaidDirectory: () => staff },
    "@/lib/profiles": { canViewProfile: () => staff, getProfileById: async () => { await resolver("profile"); return { characters: [] }; } },
    "@/lib/raids": {}, "@/lib/raidPolls": {},
    "@/lib/security": {
      verifyTrustedOrigin: () => allowOrigin, assertRequestBodySize: () => null,
      getClientIp: () => "local", checkRateLimit: () => ({ ok: true }), logDashboardEvent() {},
      noStoreHeaders: () => ({ "cache-control": "no-store" }),
      forbiddenResponse: () => new Response(null, { status: 403 }), unauthorizedResponse: () => new Response(null, { status: 401 }),
    },
  });
  const resources = [{ key: "a", kind: "integrations" }, { key: "b", kind: "guild-roster" }, { key: "c", kind: "profile-external", id: "p" }];
  const request = (items = resources) => new Request("https://guild.test/api/background/refresh", { method: "POST", body: JSON.stringify({ resources: items }) });
  await check("authenticated server starts three independent resources together and preserves response order", async () => {
    const hold = gate(), started = [];
    resolver = async (kind) => { started.push(kind); await hold.promise; return {}; };
    const pending = route.POST(request()); await tick();
    assert.deepEqual(started, ["integrations", "guild", "profile"]); hold.release();
    const result = await (await pending).json(); assert.deepEqual(result.resources.map((r) => r.key), ["a", "b", "c"]);
  });
  await check("one failed resource does not cancel siblings; only three requested resources run", async () => {
    let calls = 0; resolver = async (kind) => { calls++; if (kind === "integrations") throw Error("unavailable"); return {}; };
    const result = await (await route.POST(request([...resources, resources[0]]))).json();
    assert.equal(calls, 3); assert.equal(result.resources.length, 3); assert.equal(result.resources[0].ok, false); assert.equal(result.resources[1].ok, true);
  });
  await check("origin, session and per-resource permissions still block unauthorized loaders", async () => {
    resolver = async () => assert.fail("Unauthorized data loader executed");
    allowOrigin = false; assert.equal((await route.POST(request())).status, 403); allowOrigin = true;
    session = null; assert.equal((await route.POST(request())).status, 401); session = { profileId: "viewer" };
    staff = false; const result = await (await route.POST(request())).json();
    assert.equal(result.resources[0].ok, false); assert.equal(result.resources[1].ok, false); staff = true;
  });

  await check("30 delivery polls share one recovery scan; the next scan runs after 15 seconds", async () => {
    const db = store(), lib = outbox(db), now = Date.now();
    for (let n = 0; n < 30; n++) await lib.leaseInteractionDeliveries(1, now + n);
    const scans = () => db.queries.filter((q) => q.filters.some((f) => f.value === "processing")).length;
    assert.equal(scans(), 1); await lib.leaseInteractionDeliveries(1, now + 15_000); assert.equal(scans(), 2);
  });
  await check("recovery selects an old claim even after 150 fresh processing claims", async () => {
    const db = store(), lib = outbox(db), now = Date.now();
    for (let n = 0; n < 150; n++) await lib.beginInteractionOutbox(id(n), "token", now - 60_000);
    await lib.beginInteractionOutbox(id(150), "token", now - 5 * 60_000);
    assert.equal(await lib.retireStalledInteractionResults(now), 1);
    const query = db.queries.at(-1); assert.equal(query.returned, 1);
    assert.equal(db.rows("discordInteractionClaims").get(id(0)).deliveryState, "processing");
  });
  await check("concurrent leases share recovery and still claim a ready response only once", async () => {
    const db = store(), lib = outbox(db), now = Date.now();
    await lib.beginInteractionOutbox(id(0), "token", now);
    await lib.finishInteractionOutbox(id(0), { type: 4, data: { content: "ready" } }, now);
    const jobs = await Promise.all([lib.leaseInteractionDeliveries(1, now), lib.leaseInteractionDeliveries(1, now)]);
    assert.equal(jobs.flat().length, 1);
    assert.equal(db.queries.filter((q) => q.filters.some((f) => f.value === "processing")).length, 1);
  });
  await check("failed recovery is retried on the next poll without caching the failure", async () => {
    const db = store(), lib = outbox(db), now = Date.now(); db.failProcessingOnce = true;
    await assert.rejects(lib.leaseInteractionDeliveries(1, now), /temporary DB/);
    await lib.leaseInteractionDeliveries(1, now + 1);
    assert.equal(db.queries.filter((q) => q.filters.some((f) => f.value === "processing")).length, 1);
  });
  await check("outbox retention reads and rewrites only expired deliveries", async () => {
    const db = store(), lib = outbox(db), now = Date.now();
    for (let n = 0; n < 150; n++) await lib.beginInteractionOutbox(id(n), "token", now);
    await lib.beginInteractionOutbox(id(150), "token", now - 15 * 60_000);
    const before = db.transactions; await lib.pruneInteractionOutbox();
    assert.equal(db.transactions - before, 1); assert.equal(db.rows("discordInteractionClaims").get(id(150)).tokenCipher, "");
    assert.equal(db.rows("discordInteractionClaims").get(id(0)).deliveryState, "processing");
  });
  await check("ingress retention skips fresh encrypted receipts and retires only expired signatures", async () => {
    const db = store();
    const lib = load("src/lib/discordInteractionIngress.ts", { "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => db } }, { process: secret });
    const now = Date.now();
    for (const [n, at] of [[0, now], [1, now - 6 * 60_000]]) {
      await lib.enqueueInteractionIngress({ id: id(n), rawBody: JSON.stringify({ id: id(n), type: 3 }), signature: "a".repeat(128), timestamp: String(Math.floor(at / 1000)), domain: "raid" }, at);
    }
    const before = db.transactions; await lib.pruneInteractionIngress(250, now);
    assert.equal(db.transactions - before, 1); assert.equal(db.rows("discordInteractionIngress").get(id(0)).status, "ready");
    assert.equal(db.rows("discordInteractionIngress").get(id(1)).status, "failed");
  });

  let clock = Date.now();
  const env = { DISCORD_BOT_TOKEN: "credential-a", DISCORD_GUILD_ID: id(20) }, counts = { identity: 0, member: 0, roles: 0 };
  let failIdentity = false, hasMemberRole = true;
  const rest = { discordCredentialKey: (token) => token, DiscordRestError: class extends Error {},
    async discordRestRequest(path, init, options) {
      if (path === "/users/@me") { counts.identity++; if (failIdentity) { failIdentity = false; throw Error("identity unavailable"); } return { id: id(0), username: options.token }; }
      if (path.endsWith("/roles")) { counts.roles++; return [{ id: id(20), position: 0, permissions: "0" }, { id: id(10), position: 10, permissions: "268435456" }]; }
      if (path.includes("/members/")) { counts.member++; return { roles: hasMemberRole ? [id(10)] : [] }; }
      return { id: id(20), name: "guild" };
    } };
  const admin = load("src/lib/discordAdmin.ts", {
    "@/lib/discordRest": rest, "@/lib/concurrency": {}, "@/lib/rulesOnboarding": {},
    "@/lib/security": { logDashboardEvent() {} }, "@/lib/values": { cleanSnowflake: (value) => /^\d{16,25}$/.test(String(value)) ? String(value) : "" },
    "@/lib/discordAvatar": {}, "@/lib/discordRulesStats": {},
  }, { process: { env }, Date: class extends Date { static now() { return clock; } } });
  await check("bot identity is reused but role and membership checks remain fresh", async () => {
    for (let n = 0; n < 2; n++) assert.equal((await admin.fetchDiscordRoleControlSnapshot()).botCanManageRoles, true);
    assert.deepEqual(counts, { identity: 1, member: 2, roles: 2 });
  });
  await check("revoked bot membership permissions take effect while identity remains cached", async () => {
    hasMemberRole = false;
    const snapshot = await admin.fetchDiscordRoleControlSnapshot();
    assert.equal(snapshot.botCanManageRoles, false); assert.equal(snapshot.manageableRoles.length, 0);
    assert.equal(counts.identity, 1); assert.equal(counts.member, 3); hasMemberRole = true;
  });
  await check("credential rotation and identity TTL force a new lookup", async () => {
    env.DISCORD_BOT_TOKEN = "credential-b";
    assert.equal((await admin.fetchDiscordRoleControlSnapshot()).bot.username, "credential-b");
    assert.equal(counts.identity, 2); clock += 5 * 60_000;
    await admin.fetchDiscordRoleControlSnapshot(); assert.equal(counts.identity, 3);
  });
  await check("identity lookup failure is not retained as a successful cache entry", async () => {
    env.DISCORD_BOT_TOKEN = "credential-c"; failIdentity = true;
    assert.ok((await admin.fetchDiscordRoleControlSnapshot()).error);
    assert.equal((await admin.fetchDiscordRoleControlSnapshot()).bot.username, "credential-c");
    assert.equal(counts.identity, 5);
  });
  await check("identity cache evicts old credentials instead of growing without bound", async () => {
    const before = counts.identity;
    for (let n = 0; n < 5; n++) { env.DISCORD_BOT_TOKEN = `rotation-${n}`; await admin.fetchDiscordRoleControlSnapshot(); }
    env.DISCORD_BOT_TOKEN = "rotation-0"; await admin.fetchDiscordRoleControlSnapshot();
    assert.equal(counts.identity - before, 6);
  });
  console.log(`[check-response-performance] OK — ${passed}/${passed}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
