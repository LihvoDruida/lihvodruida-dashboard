const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const pg = require("pg");
const load = require("./lib/load-server-ts.cjs");

// Never fall back to the application's DATABASE_URL. Every run owns a new
// schema; cleanup can only drop that exact generated schema.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to an isolated PostgreSQL test database.");
  process.exit(1);
}
if (url === process.env.DATABASE_URL || url === process.env.POSTGRES_URL) {
  console.error("Use a separate test database, not the application's database URL.");
  process.exit(1);
}
const worker = process.argv[2] === "--worker";
const schema = worker ? process.argv[3] : "r1_" + crypto.randomBytes(12).toString("hex");
if (!/^r1_[a-f0-9]{24}$/.test(schema)) throw Error("Invalid private test schema");
const options = "-c search_path=" + schema +
  " -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=10000";
const pool = new pg.Pool({ connectionString: url, max: 8, options, connectionTimeoutMillis: 3000 });
const observedCodes = [];
pool.on("connect", client => {
  const query = client.query.bind(client);
  client.query = (...args) => {
    const result = query(...args);
    if (!result?.catch) return result;
    return result.catch(error => { observedCodes.push(error.code); throw error; });
  };
});
pool.on("error", () => {}); // The failing assertion reports the database error.
const loadedPool = load("src/lib/db/pgPool.ts", { pg }, {
  __mistblossomPgPool: pool, process: { env: { DATABASE_URL: url } },
});
const db = loadedPool.exports;
let afterQuery = null;
const instrumentedPool = {
  ...db,
  async pgQuery(...args) {
    const result = await db.pgQuery(...args);
    if (afterQuery) await afterQuery(args, result);
    return result;
  },
};
const source = process.env.TEST_DOCUMENT_STORE_SOURCE || "src/lib/db/documentStore.ts";
const { PgDocumentStore, FieldValue, Timestamp } = load(source, {
  "@/lib/db/pgPool": instrumentedPool,
}).exports;
const store = new PgDocumentStore();
const ref = id => store.collection("profiles").doc(id);
const data = async doc => JSON.parse(JSON.stringify((await doc.get()).data()));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function all(operations) {
  const results = await Promise.allSettled(operations);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  return results.map(result => result.value);
}
async function blockedQuery() {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid " +
      "WHERE NOT l.granted AND a.datname=current_database() AND a.query LIKE '%documents%'",
    );
    if (rows.length) return;
    await sleep(10);
  }
  throw Error("Expected a real PostgreSQL waiter");
}
async function withClient(run) {
  const client = await pool.connect();
  try { return await run(client); }
  finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
}
const lock = (client, doc) => client.query(
  "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
  [JSON.stringify([doc.collectionName, doc.id])],
);
let passed = 0;
async function test(label, run) {
  afterQuery = null;
  await run();
  afterQuery = null;
  passed++; console.log("✓ " + label);
}

async function run() {
  if (worker) {
    await all(Array.from({ length: 24 }, () => ref("processes").update({ count: FieldValue.increment(1) })));
    return;
  }
  await pool.query("CREATE SCHEMA " + schema);
  try {
    await pool.query(fs.readFileSync(path.resolve(__dirname, "../src/lib/db/schema.sql"), "utf8"));
    const version = (await pool.query("SHOW server_version")).rows[0].server_version;
    console.log("[test-document-store-pg] PostgreSQL " + version + "; isolated schema; 8 connections");

    await test("D01: two simultaneous profile merges preserve both fields", async () => {
      const doc = ref("d01");
      await doc.set({ preferredName: "Old", grammaticalGender: "neutral" });
      // Reproduction mode runs the ORIGINAL module against real PostgreSQL.
      // Its two unlocked reads are held until both read the original row.
      if (process.argv.includes("--reproduce-d01")) {
        const read = deferred(); let reads = 0;
        afterQuery = async ([sql]) => {
          if (sql === "SELECT data FROM documents WHERE collection = $1 AND doc_id = $2") {
            if (++reads === 2) read.resolve();
            await read.promise;
          }
        };
      }
      await all([
        doc.set({ preferredName: "New" }, { merge: true }),
        doc.set({ grammaticalGender: "male" }, { merge: true }),
      ]);
      afterQuery = null;
      assert.deepEqual(await data(doc), { preferredName: "New", grammaticalGender: "male" });
    });
    if (process.argv.includes("--reproduce-d01")) return;

    await test("32 concurrent mixed merge/update increments produce exactly 32", async () => {
      const doc = ref("counter"); await doc.set({ count: 0, keep: true });
      await all(Array.from({ length: 32 }, (_, i) => i % 2
        ? doc.update({ count: FieldValue.increment(1) })
        : doc.set({ count: FieldValue.increment(1) }, { merge: true })));
      assert.deepEqual(await data(doc), { count: 32, keep: true });
    });
    await test("simultaneous merges create a missing document without losing fields", async () => {
      const doc = ref("new");
      await all(Array.from({ length: 24 }, (_, i) => doc.set({ ["field" + i]: i }, { merge: true })));
      assert.deepEqual(await data(doc), Object.fromEntries(Array.from({ length: 24 }, (_, i) => ["field" + i, i])));
    });
    await test("deep merges and dotted updates preserve siblings", async () => {
      const doc = ref("nested"); await doc.set({ preferences: { original: true } });
      await all(Array.from({ length: 24 }, (_, i) => i % 2
        ? doc.update({ ["preferences.field" + i]: i })
        : doc.set({ preferences: { ["field" + i]: i } }, { merge: true })));
      const result = await data(doc);
      assert.equal(result.preferences.original, true);
      for (let i = 0; i < 24; i++) assert.equal(result.preferences["field" + i], i);
    });
    await test("nested deletes and transforms do not erase independent changes", async () => {
      const doc = ref("delete-fields");
      await doc.set({ nested: { remove: true, counter: 0, untouched: 42 } });
      await all([
        doc.update({ "nested.remove": FieldValue.delete() }),
        doc.set({ nested: { counter: FieldValue.increment(1) } }, { merge: true }),
        doc.update({ "nested.extra": "added" }),
      ]);
      assert.deepEqual(await data(doc), { nested: { counter: 1, untouched: 42, extra: "added" } });
    });
    await test("arrayUnion preserves concurrent additions and removes duplicates", async () => {
      const doc = ref("array"); await doc.set({ items: [] });
      await all(Array.from({ length: 24 }, (_, i) => doc.update({ items: FieldValue.arrayUnion("same", i) })));
      const { items } = await data(doc);
      assert.equal(items.length, 25); assert.equal(items.filter(x => x === "same").length, 1);
      for (let i = 0; i < 24; i++) assert.ok(items.includes(i));
    });
    await test("update of a missing document rejects and creates nothing", async () => {
      const doc = ref("missing");
      await assert.rejects(doc.update({ count: FieldValue.increment(1) }), /No document to update/);
      assert.equal((await doc.get()).exists, false);
    });
    await test("update waiting for a committed DELETE does not resurrect the row", async () => {
      const doc = ref("deletion"); await doc.set({ original: true });
      await withClient(async client => {
        await client.query("BEGIN");
        await client.query("DELETE FROM documents WHERE collection=$1 AND doc_id=$2", [doc.collectionName, doc.id]);
        const outcome = doc.update({ changed: true }).then(() => null, error => error);
        await blockedQuery();
        await client.query("COMMIT");
        assert.match((await outcome).message, /No document to update/);
      });
      assert.equal((await doc.get()).exists, false);
    });
    await test("24 concurrent creates have one winner and never overwrite it", async () => {
      const doc = ref("created");
      const outcomes = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => doc.create({ winner: i })));
      assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
      const winningIndex = outcomes.findIndex(x => x.status === "fulfilled");
      assert.deepEqual(await data(doc), { winner: winningIndex });
      for (const outcome of outcomes) if (outcome.status === "rejected") assert.match(outcome.reason.message, /Document already exists/);
    });
    await test("two transactions creating the same absent document have one winner", async () => {
      const doc = ref("tx-created"); const barrier = deferred(); let reads = 0;
      const outcomes = await Promise.allSettled([1, 2].map(winner => store.runTransaction(async tx => {
        await tx.get(doc);
        if (++reads === 2) barrier.resolve();
        await barrier.promise;
        tx.create(doc, { winner });
      })));
      assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
      assert.match(outcomes.find(x => x.status === "rejected").reason.message, /Document already exists/);
      assert.ok([1, 2].includes((await data(doc)).winner));
    });
    await test("a stale transaction retries and preserves a direct writer's fields", async () => {
      const doc = ref("stale"); await doc.set({ name: "Old", gender: "neutral" });
      let attempts = 0;
      const value = await store.runTransaction(async tx => {
        attempts++; await tx.get(doc);
        if (attempts === 1) await doc.set({ gender: "male" }, { merge: true });
        tx.set(doc, { name: "New" }, { merge: true });
        return "committed";
      });
      assert.equal(value, "committed"); assert.equal(attempts, 2);
      assert.deepEqual(await data(doc), { name: "New", gender: "male" });
    });
    await test("an external action after a retried transaction is executed once", async () => {
      const doc = ref("side-effect"); await doc.set({ count: 0 });
      let attempts = 0, externalActions = 0;
      await store.runTransaction(async tx => {
        const old = (await tx.get(doc)).data(); attempts++;
        if (attempts === 1) await doc.update({ count: FieldValue.increment(1) });
        tx.update(doc, { count: Number(old.count) + 1 });
      });
      externalActions++;
      assert.equal(attempts, 2); assert.equal(externalActions, 1);
      assert.equal((await data(doc)).count, 2);
    });
    await test("stale transaction update after deletion rejects and rolls back preceding writes", async () => {
      const gone = ref("gone"), other = ref("rollback-other");
      await gone.set({ keep: true }); await other.set({ count: 0 });
      let attempts = 0;
      await assert.rejects(store.runTransaction(async tx => {
        await tx.get(gone); attempts++;
        if (attempts === 1) await gone.delete();
        tx.update(other, { count: FieldValue.increment(1) });
        tx.update(gone, { keep: false });
      }), /No document to update/);
      assert.equal((await gone.get()).exists, false);
      assert.equal((await data(other)).count, 0);
    });
    await test("failed batch rolls back merge and delete, then releases locks", async () => {
      const a = ref("batch-a"), b = ref("batch-b");
      await a.set({ value: 1 }); await b.set({ value: 2 });
      const batch = store.batch();
      batch.set(a, { value: 9 }, { merge: true }).delete(b).update(ref("batch-missing"), { value: 3 });
      await assert.rejects(batch.commit(), /No document to update/);
      assert.equal((await data(a)).value, 1); assert.equal((await data(b)).value, 2);
      await a.update({ value: 4 }); assert.equal((await data(a)).value, 4);
    });
    await test("queued operations see earlier writes in the same batch", async () => {
      const doc = ref("batch-increments"); await doc.set({ count: 0 });
      const batch = store.batch();
      batch.update(doc, { count: FieldValue.increment(1) });
      batch.set(doc, { count: FieldValue.increment(1) }, { merge: true });
      await batch.commit(); assert.equal((await data(doc)).count, 2);
    });
    await test("real multi-document deadlock retries without partial or lost increments", async () => {
      const a = ref("deadlock-a"), b = ref("deadlock-b");
      await a.set({ count: 0 }); await b.set({ count: 0 });
      const gate = deferred(), clients = new Set(); const codesBefore = observedCodes.length;
      afterQuery = async ([sql, values, client]) => {
        if (sql.includes("pg_advisory_xact_lock") && !clients.has(client) && clients.size < 2) {
          clients.add(client);
          if (clients.size === 2) gate.resolve();
          await gate.promise;
        }
      };
      const first = store.batch().update(a, { count: FieldValue.increment(1) }).update(b, { count: FieldValue.increment(1) });
      const second = store.batch().update(b, { count: FieldValue.increment(1) }).update(a, { count: FieldValue.increment(1) });
      await all([first.commit(), second.commit()]);
      afterQuery = null;
      assert.ok(observedCodes.slice(codesBefore).includes("40P01"), "PostgreSQL actually detected the deadlock");
      assert.equal((await data(a)).count, 2); assert.equal((await data(b)).count, 2);
    });
    await test("a blocked document does not block unrelated documents or collections", async () => {
      const doc = ref("held"), other = store.collection("another").doc("held");
      await withClient(async client => {
        await client.query("BEGIN"); await lock(client, doc);
        const waiting = doc.set({ ready: true });
        // The advisory query does not contain documents; inspect that lock.
        const deadline = Date.now() + 1500;
        let waiter = false;
        while (Date.now() < deadline && !waiter) {
          waiter = Boolean((await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rowCount);
          if (!waiter) await sleep(10);
        }
        assert.ok(waiter);
        await Promise.race([other.set({ ready: true }), sleep(1000).then(() => { throw Error("Unrelated document blocked"); })]);
        await client.query("ROLLBACK"); await waiting;
      });
      assert.equal((await data(other)).ready, true);
    });
    await test("default application transaction isolation is unchanged", async () => {
      assert.equal(await db.pgTransaction(async client => (await client.query("SHOW transaction_isolation")).rows[0].transaction_isolation), "repeatable read");
    });
    await test("full set remains an explicit replacement; update map replaces that map", async () => {
      const doc = ref("replace");
      await doc.set({ old: true, nested: { a: 1, b: 2 } });
      await doc.set({ nested: { a: 3 } });
      assert.deepEqual(await data(doc), { nested: { a: 3 } });
      await doc.update({ nested: { c: 4 } });
      assert.deepEqual(await data(doc), { nested: { c: 4 } });
    });
    await test("timestamps, dates and nested transforms retain their stored representation", async () => {
      const doc = ref("dates"); const date = new Date("2026-10-11T12:00:00.000Z");
      await doc.set({ date, timestamp: Timestamp.fromDate(date), nested: { touched: FieldValue.serverTimestamp() } });
      const result = await data(doc);
      assert.equal(result.date, date.toISOString()); assert.equal(result.timestamp, date.toISOString());
      assert.ok(Number.isFinite(Date.parse(result.nested.touched)));
    });
    await test("serialization failure rolls back and releases the document lock", async () => {
      const doc = ref("invalid-json"); await doc.set({ value: 1 });
      const bad = []; bad.push(bad);
      await assert.rejects(doc.update({ bad }));
      assert.deepEqual(await data(doc), { value: 1 });
      await doc.update({ value: 2 }); assert.equal((await data(doc)).value, 2);
    });
    await test("getAll keeps ordering, missing documents, queries and subcollections", async () => {
      const a = ref("read-a"), b = ref("read-b"), missing = ref("read-missing");
      await a.set({ name: "a" }); await b.set({ name: "b" });
      const snapshots = await store.getAll(b, missing, a);
      assert.deepEqual(JSON.parse(JSON.stringify(snapshots.map(x => [x.id, x.exists]))), [["read-b", true], ["read-missing", false], ["read-a", true]]);
      assert.equal((await store.collection("profiles").where("name", "==", "b").get()).size, 1);
      const nested = a.collection("chunks").doc("1");
      await nested.set({ count: 1 }); await nested.update({ count: FieldValue.increment(1) });
      assert.equal((await data(nested)).count, 2);
    });
    await test("independent Node processes share atomicity through PostgreSQL", async () => {
      const doc = ref("processes"); await doc.set({ count: 0 });
      const child = promisify(execFile)(process.execPath, [__filename, "--worker", schema], {
        env: { ...process.env, DATABASE_URL: "", POSTGRES_URL: "", TEST_DOCUMENT_STORE_SOURCE: "" },
        timeout: 20000,
      });
      await all([child, all(Array.from({ length: 24 }, () => doc.update({ count: FieldValue.increment(1) })))]);
      assert.equal((await data(doc)).count, 48);
    });
    console.log("[test-document-store-pg] OK — " + passed + "/" + passed);
  } finally {
    afterQuery = null;
    await pool.query("DROP SCHEMA " + schema + " CASCADE");
  }
}
run().catch(error => {
  console.error("[test-document-store-pg] FAILED:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
