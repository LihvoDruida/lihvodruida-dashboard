const assert = require("node:assert/strict");
const loadServerTs = require("./lib/load-server-ts.cjs");
const load = (file, modules = {}, globals = {}) => loadServerTs(file, modules, { Error, ...globals });
const { exports: client } = load("src/lib/applicationModerationClient.ts");
const { exports: concurrency } = load("src/lib/concurrency.ts");
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log("PASS", name); }
const plain = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  const rows = new Map(); let queue = Promise.resolve(); const edits = [], notices = [];
  let failRead = false, failDiscord = false;
  const ref = (id) => ({ id });
  const snapshot = (id) => ({ id, ref: ref(id), exists: rows.has(id), data: () => rows.get(id) });
  const db = { collection() { return {
    doc(id) { return { ...ref(id), get: async () => { if (failRead) throw Error("DB offline"); return snapshot(id); } }; },
    where() { return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } }; },
  }; }, runTransaction(fn) {
    const pending = queue.then(async () => {
      const writes = [];
      const result = await fn({ get: async (r) => snapshot(r.id), update: (r, patch) => writes.push([r.id, patch]) });
      for (const [id, patch] of writes) {
        const old = rows.get(id); const next = { ...old, ...patch };
        if (patch.moderation_events?.union) next.moderation_events = [...(old.moderation_events || []), patch.moderation_events.union];
        rows.set(id, next);
      }
      return result;
    }); queue = pending.catch(() => {}); return pending;
  } };
  const { exports: github } = load("src/lib/github.ts", {
    "@/lib/firebaseAdmin": { getFirebaseAdminDb: () => db },
    "@/lib/db/firestoreCompat": { FieldValue: { arrayUnion: (value) => ({ union: value }) } },
    "@/lib/concurrency": concurrency,
  });
  const { exports: moderation } = load("src/lib/moderation.ts", {
    "./github": github, "@/lib/concurrency": concurrency,
    "./discord": {
      editDiscordApplicationMessage: async (v) => { edits.push(v); if (failDiscord) throw Error("Discord offline"); return { ok: true }; },
      notifyDiscordStatusChange: async (v) => { notices.push(v); if (failDiscord) throw Error("Discord offline"); return { ok: true }; },
    },
  });
  function seed(number, status = "review", state = status === "review" ? "open" : "closed") {
    rows.set(`application-${number}`, { number, application_number: number, status_key: status, labels: [`status:${status}`], state, character_name: "Fixture" });
  }
  return { rows, github, moderation, edits, notices, seed,
    failRead: (value) => { failRead = value; }, failDiscord: (value) => { failDiscord = value; } };
}
(async () => {
  await check("two concurrent final decisions commit one result and one Discord edit", async () => {
    const f = fixture(); f.seed(1);
    const results = await Promise.all(["accepted", "declined"].map((status) => f.moderation.moderateApplication({ issueNumber: 1, status, moderator: "staff", source: "dashboard", requireReview: true })));
    assert.equal(results.filter((r) => r.changed).length, 1); assert.equal(results.filter((r) => r.alreadyModerated).length, 1);
    assert.equal(f.edits.length, 1); assert.equal(f.notices.length, 0); assert.equal(f.rows.get("application-1").moderation_events.length, 1);
    assert.equal(results[0].status, results[1].status);
  });
  await check("Discord and dashboard decisions obey the same transactional guard", async () => {
    const f = fixture(); f.seed(1);
    await Promise.all(["dashboard", "discord"].map((source) => f.moderation.moderateApplication({ issueNumber: 1, status: "accepted", moderator: source, source, requireReview: true })));
    assert.equal(f.edits.length, 1); assert.equal(f.rows.get("application-1").moderation_events.length, 1);
  });
  await check("completed and closed-review applications are not re-moderated", async () => {
    const f = fixture(); f.seed(1, "declined"); f.seed(2, "review", "closed");
    for (const issueNumber of [1, 2]) assert.equal((await f.moderation.moderateApplication({ issueNumber, status: "accepted", moderator: "staff", source: "dashboard", requireReview: true })).alreadyModerated, true);
    assert.equal(f.edits.length, 0); assert.equal(f.rows.get("application-1").status_key, "declined");
  });
  await check("partial Discord outage never rolls back a confirmed database decision", async () => {
    const f = fixture(); f.seed(1); f.failDiscord(true);
    const result = await f.moderation.moderateApplication({ issueNumber: 1, status: "accepted", moderator: "staff", source: "dashboard", requireReview: true });
    assert.equal(result.ok, true); assert.equal(f.rows.get("application-1").status_key, "accepted");
    assert.equal(client.describeApplicationDecision(1, result).outcome, "partial");
  });
  await check("bulk de-duplicates one application and reports actual existing status", async () => {
    const f = fixture(); f.seed(1); f.seed(2, "declined");
    const result = await f.moderation.moderateApplications({ items: [1, 1, 2, 3].map((issueNumber) => ({ issueNumber, status: "accepted" })), moderator: "staff", source: "dashboard" });
    assert.equal(result.total, 3); assert.equal(result.changed, 1); assert.equal(result.unchanged, 1); assert.equal(result.failed, 1);
    assert.equal(result.items.find((v) => v.issueNumber === 2).status, "declined"); assert.equal(f.edits.length, 1);
  });
  await check("contradictory bulk decisions fail before any write or Discord action", async () => {
    const f = fixture(); f.seed(1);
    await assert.rejects(f.moderation.moderateApplications({ items: [{ issueNumber: 1, status: "accepted" }, { issueNumber: 1, status: "declined" }], moderator: "staff", source: "dashboard" }), /два різні/);
    assert.equal(f.rows.get("application-1").status_key, "review"); assert.equal(f.edits.length, 0);
  });
  await check("a lost successful response can be retried without repeating Discord effects", async () => {
    const f = fixture(); f.seed(1);
    const params = { issueNumber: 1, status: "accepted", moderator: "staff", source: "dashboard", requireReview: true };
    await f.moderation.moderateApplication(params); const retried = await f.moderation.moderateApplication(params);
    assert.equal(retried.alreadyModerated, true); assert.equal(f.edits.length, 1);
  });
  await check("single moderation transport has a deadline and never auto-retries POST", async () => {
    const calls = [];
    const result = await client.submitApplicationDecisions(async (url, options) => { calls.push({ url, options }); return { ok: true, issueNumber: 5, status: "accepted", discord: { edited: { ok: true } } }; }, [5], "accepted");
    assert.equal(calls.length, 1); assert.equal(calls[0].options.retries, 0); assert.equal(calls[0].options.timeoutMs, 45000);
    assert.equal(result[0].outcome, "changed");
  });
  await check("network uncertainty produces one POST, never a hidden replay", async () => {
    let calls = 0; await assert.rejects(client.submitApplicationDecisions(async () => { calls++; throw Error("timeout"); }, [5], "accepted")); assert.equal(calls, 1);
  });
  await check("bulk partial/missing/old results remain separate per application", async () => {
    const result = await client.submitApplicationDecisions(async () => ({ items: [
      { ok: true, issueNumber: 1, result: { ok: true, status: "accepted", changed: true, discord: {} } },
      { ok: true, issueNumber: 2, result: { ok: true, status: "declined", alreadyModerated: true } },
      { ok: false, issueNumber: 3 },
    ] }), [1, 2, 3, 4], "accepted");
    assert.deepEqual(plain(client.summarizeApplicationDecisions(result)), { total: 4, changed: 1, already: 1, discordPending: 1, uncertain: 2 });
    assert.equal(result[1].status, "declined");
  });
  await check("invalid or oversized selection never issues a request", async () => {
    for (const numbers of [[], [0], [NaN], Array.from({ length: 51 }, (_, n) => n + 1)]) await assert.rejects(client.submitApplicationDecisions(() => assert.fail("unexpected POST"), numbers, "accepted"));
  });
  await check("reconciliation performs one GET and does not claim Discord delivery", async () => {
    const calls = [];
    const result = await client.readApplicationDecision(async (url, opts) => { calls.push(opts); return { ok: true, issueNumber: 2, status: "accepted", state: "closed" }; }, 2);
    assert.equal(calls[0].method, "GET"); assert.equal(calls[0].retries, 0); assert.equal(result.outcome, "already"); assert.match(result.message, /не перевірявся/);
  });
  await check("reconciliation rejects mismatched results and distinguishes a still-open review", async () => {
    assert.equal((await client.readApplicationDecision(async () => ({ ok: true, issueNumber: 99, status: "accepted" }), 2)).outcome, "uncertain");
    assert.equal((await client.readApplicationDecision(async () => ({ ok: true, issueNumber: 2, status: "review", state: "open" }), 2)).outcome, "review");
  });

  const f = fixture(); f.seed(1);
  let session = { id: "viewer" }, view = true, manage = true, origin = true;
  const audits = [];
  const security = { noStoreHeaders: () => ({ "cache-control": "no-store" }), verifyTrustedOrigin: () => origin,
    getClientIp: () => "local", checkRateLimit: () => ({ ok: true }), logDashboardEvent() {}, assertRequestBodySize: () => null, safeErrorMessage: () => "safe error",
    unauthorizedResponse: () => new Response(null, { status: 401 }), forbiddenResponse: () => new Response(null, { status: 403 }) };
  const dependencies = { "next/server": { NextResponse: { json: (v, init) => new Response(JSON.stringify(v), init) } },
    "@/lib/auth": { getSession: async () => session }, "@/lib/security": security,
    "@/lib/accessGroups": { recordAdminAudit: async (...args) => { audits.push(args); } },
    "@/lib/permissions": { canViewApplications: () => view, canManageApplications: () => manage, hierarchyTitle: () => "staff" },
    "@/lib/authorIdentity": { resolveAuthorIdentity: async () => ({ primaryName: "staff" }) },
    "@/lib/github": f.github, "@/lib/moderation": f.moderation, "@/lib/discord": { deleteDiscordApplicationMessage: () => assert.fail("Unexpected Discord delete") } };
  const { exports: route } = load("src/app/api/applications/[number]/route.ts", dependencies, { Response });
  const { exports: single } = load("src/app/api/applications/[number]/status/route.ts", dependencies, { Response });
  const { exports: bulk } = load("src/app/api/applications/bulk-status/route.ts", dependencies, { Response });
  const ctx = (number) => ({ params: Promise.resolve({ number: String(number) }) });
  const request = (body = {}) => new Request("http://fixture/api/applications", { method: "POST", body: JSON.stringify(body) });
  await check("status GET requires a session and view rights", async () => {
    session = null; assert.equal((await route.GET(new Request("http://fixture"), ctx(1))).status, 401);
    session = { id: "viewer" }; view = false; assert.equal((await route.GET(new Request("http://fixture"), ctx(1))).status, 403); view = true;
  });
  await check("status GET is no-store, minimal and performs no Discord mutation", async () => {
    const response = await route.GET(new Request("http://fixture"), ctx(1)); const data = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(data).sort(), ["issueNumber", "ok", "state", "status", "updatedAt"]); assert.equal(f.edits.length, 0); assert.equal(audits.length, 0);
  });
  await check("status GET distinguishes invalid/missing/failed storage", async () => {
    assert.equal((await route.GET(new Request("http://fixture"), ctx(0))).status, 400);
    assert.equal((await route.GET(new Request("http://fixture"), ctx(99))).status, 404);
    f.failRead(true); assert.equal((await route.GET(new Request("http://fixture"), ctx(1))).status, 503); f.failRead(false);
  });
  await check("single and bulk POST preserve origin and moderation authorization", async () => {
    origin = false; assert.equal((await single.POST(request({ status: "accepted" }), ctx(1))).status, 403);
    assert.equal((await bulk.POST(request({ issueNumbers: [1], status: "accepted" }))).status, 403); origin = true;
    manage = false; assert.equal((await single.POST(request({ status: "accepted" }), ctx(1))).status, 401);
    assert.equal((await bulk.POST(request({ issueNumbers: [1], status: "accepted" }))).status, 401); manage = true; assert.equal(f.edits.length, 0);
  });
  await check("bulk route rejects contradictory decisions before moderation", async () => {
    const response = await bulk.POST(request({ items: [{ issueNumber: 1, status: "accepted" }, { issueNumber: 1, status: "declined" }] }));
    assert.equal(response.status, 400); assert.equal(f.edits.length, 0);
  });
  await check("single route does not overwrite a completed decision", async () => {
    f.seed(1, "declined"); const response = await single.POST(request({ status: "accepted" }), ctx(1)); const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.status, "declined"); assert.equal(data.alreadyModerated, true); assert.equal(f.edits.length, 0);
    assert.equal(audits.at(-1)[2].applicationStatus, "declined"); assert.equal(audits.at(-1)[2].changed, false);
  });
  await check("failed mutation audit records uncertainty instead of claiming a rollback", async () => {
    f.failRead(true);
    const response = await single.POST(request({ status: "accepted" }), ctx(1));
    assert.equal(response.status, 500); assert.match(audits.at(-1)[2].summary, /не підтверджено/);
    assert.equal(audits.at(-1)[2].requestedStatus, "accepted"); assert.equal(f.edits.length, 0);
    f.failRead(false);
  });
  console.log(`[check-application-workbench] OK — ${passed}/${passed}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
