const assert = require("node:assert/strict");
const load = require("./lib/load-server-ts.cjs");

function fixture(failures = [], failurePoint = "handler") {
  const events = [];
  let acquired = 0;
  let calls = 0;
  let current = null;
  const error = code => Object.assign(new Error("controlled database failure"), { code });
  const pool = {
    async connect() {
      acquired++;
      current = {
        async query(sql) {
          events.push(sql);
          if (failurePoint === sql && failures.length) throw error(failures.shift());
          return { rows: [] };
        },
        release() { events.push("release"); },
      };
      return current;
    },
  };
  const { pgTransaction } = load("src/lib/db/pgPool.ts", { pg: {} }, {
    __mistblossomPgPool: pool,
    process: { env: { DATABASE_URL: "test-only" } },
    setTimeout(callback, milliseconds) {
      events.push("backoff");
      assert.equal(events[events.length - 2], "release", "release before sleeping");
      assert.ok(milliseconds >= 25 && milliseconds <= 12825);
      callback();
    },
  }).exports;
  return {
    events, acquired: () => acquired, calls: () => calls,
    async run(options = {}) {
      return pgTransaction(async client => {
        assert.equal(client, current);
        calls++; events.push("handler");
        if (failurePoint === "handler" && failures.length) throw error(failures.shift());
        return "committed";
      }, options);
    },
  };
}

let passed = 0;
async function test(label, run) {
  await run(); passed++; console.log("✓ " + label);
}
(async () => {
  await test("stable snapshots remain the default; successful commit releases once", async () => {
    const f = fixture();
    assert.equal(await f.run(), "committed");
    assert.deepEqual(f.events, ["BEGIN ISOLATION LEVEL REPEATABLE READ", "handler", "COMMIT", "release"]);
  });
  await test("locked document writes can explicitly use READ COMMITTED", async () => {
    const f = fixture(); await f.run({ isolation: "read committed" });
    assert.equal(f.events[0], "BEGIN ISOLATION LEVEL READ COMMITTED");
  });
  await test("serialization and deadlock errors retry the complete handler", async () => {
    const f = fixture(["40001", "40P01"]);
    assert.equal(await f.run(), "committed");
    assert.equal(f.calls(), 3); assert.equal(f.acquired(), 3);
    assert.equal(f.events.filter(x => x === "ROLLBACK").length, 2);
    assert.equal(f.events.filter(x => x === "release").length, 3);
  });
  await test("exhaustion returns the original failure without a final backoff", async () => {
    const f = fixture(["40001", "40001", "40001"]);
    await assert.rejects(f.run({ retries: 2 }), e => e.code === "40001");
    assert.equal(f.calls(), 3);
    assert.equal(f.events.filter(x => x === "backoff").length, 2);
    assert.equal(f.events.at(-1), "release");
  });
  await test("ordinary, timeout and uncertain connection failures are not replayed", async () => {
    for (const code of ["23505", "55P03", "57014", "08006", undefined]) {
      const f = fixture([code]);
      await assert.rejects(f.run(), e => e.code === code);
      assert.equal(f.calls(), 1); assert.equal(f.acquired(), 1);
      assert.equal(f.events.at(-1), "release");
      assert.ok(!f.events.includes("backoff"));
    }
  });
  await test("a conflict at COMMIT rolls back and reruns the complete unit", async () => {
    const f = fixture(["40001"], "COMMIT");
    assert.equal(await f.run(), "committed");
    assert.equal(f.calls(), 2); assert.equal(f.acquired(), 2);
  });
  await test("invalid and fractional retry budgets remain finite", async () => {
    for (const [retries, attempts] of [[NaN, 6], [Infinity, 6], [-1, 1], [2.8, 3], [1000, 11]]) {
      const f = fixture(Array(20).fill("40001"));
      await assert.rejects(f.run({ retries }), e => e.code === "40001");
      assert.equal(f.acquired(), attempts);
    }
  });
  console.log("[check-pg-transactions] OK — " + passed + "/" + passed);
})().catch(error => { console.error(error); process.exitCode = 1; });
