const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomBytes, randomUUID } = require("node:crypto"),
  pg = require("pg"),
  load = require("./lib/load-server-ts.cjs");
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  url === process.env.POSTGRES_URL
)
  throw Error("Use an isolated TEST_DATABASE_URL; application URLs refused.");
const schema = "r6_" + randomBytes(12).toString("hex"),
  pool = new pg.Pool({
    connectionString: url,
    max: 5,
    options:
      "-c search_path=" +
      schema +
      " -c statement_timeout=10000 -c lock_timeout=3000",
  });
pool.on("error", () => {});
const database = load(
  "src/lib/db/pgPool.ts",
  { pg },
  { __mistblossomPgPool: pool, process: { env: { DATABASE_URL: url } } },
).exports;
const compat = load("src/lib/db/documentStore.ts", {
    "@/lib/db/pgPool": database,
  }).exports,
  store = new compat.PgFirestore();
const profiles = require("./lib/profile-directory-subject.cjs")(
  database,
  store,
  [],
).normalizers;
let now = Date.now(),
  mode = "",
  configured = true,
  guild = "111111111111111111",
  owner = "999999999999999999",
  calls = [],
  members = new Map(),
  barrier = null,
  beforeDispatch = null;
class Clock extends Date {
  constructor(...args) {
    super(...(args.length ? args : [now]));
  }
  static now() {
    return now;
  }
}
class DiscordError extends Error {
  constructor(status, delay = 0) {
    super("Controlled Discord failure");
    this.status = status;
    this.retryAfterMs = delay;
  }
}
const transport = {
  getDiscordGuildId: () => guild,
  discordApi: async (endpoint, init = {}) => {
    const method = init.method || "GET";
    calls.push({ endpoint, method, init });
    if (mode === "read-offline" && method === "GET")
      throw new DiscordError(503);
    if (mode === "read-denied" && method === "GET") throw new DiscordError(403);
    if (!endpoint.includes("/members/")) return { owner_id: owner };
    const user = endpoint.split("/").at(-1);
    if (!members.has(user)) throw new DiscordError(404);
    if (method === "GET") return { nick: members.get(user) };
    if (beforeDispatch) {
      const fn = beforeDispatch;
      beforeDispatch = null;
      await fn();
    }
    await init.beforeSend?.();
    if (barrier) {
      const fn = barrier;
      barrier = null;
      await fn();
    }
    if (mode === "forbidden") throw new DiscordError(403);
    if (mode === "limited") {
      mode = "";
      throw new DiscordError(429, 150_000);
    }
    members.set(user, JSON.parse(init.body).nick);
    if (mode === "lost") throw Error("Network response lost");
  },
};
const deps = {
  "@/lib/firebaseAdmin": {
    getFirebaseAdminDb: () => store,
    hasFirebaseProfileConfig: () => configured,
  },
  "@/lib/db/firestoreCompat": compat,
  "@/lib/profiles": { ...profiles, invalidateProfileIdentityCaches() {} },
  "@/lib/discordAdmin": transport,
  "@/lib/guildNicknamePolicy": {
    DEFAULT_NICKNAME_TEMPLATE: "{name} [{main}, {alt}, {alt}]",
  },
};
const subject = () =>
  load("src/lib/profileNicknameSync.ts", deps, { Date: Clock, AbortSignal })
    .exports;
let mod = subject();
const id = (n) => "id" + n.toString(16).padStart(16, "0"),
  user = (n) => (700000000000000000n + BigInt(n)).toString(),
  ref = (n) => store.collection("dashboardProfiles").doc(id(n)),
  job = (n) => store.collection("profileNicknameSyncJobs").doc(id(n));
async function seed(n, patch = {}) {
  await ref(n).set({
    provider: "discord",
    providerUserId: user(n),
    preferredName: "Old",
    displayName: "User",
    characters: [],
    ...patch,
  });
  members.set(user(n), "Old");
}
async function save(n, name = "New", patch = {}) {
  const state = await mod.getProfileIdentityState(id(n));
  return mod.saveProfileIdentity(id(n), {
    preferredName: name,
    expectedRevision: state.revision,
    operationId: randomUUID(),
    ...patch,
  });
}
const patchCount = () => calls.filter((x) => x.method === "PATCH").length;
let passed = 0;
async function check(name, fn) {
  mode = "";
  beforeDispatch = null;
  barrier = null;
  await fn();
  passed++;
  console.log("✓ " + name);
}
async function reject(fn, status) {
  await assert.rejects(fn, (e) => e.status === status);
}
(async () => {
  await pool.query("CREATE SCHEMA " + schema);
  await pool.query(
    fs.readFileSync(path.join(__dirname, "../src/lib/db/schema.sql"), "utf8"),
  );
  await check(
    "Name and intent commit together without Discord I/O",
    async () => {
      await seed(1);
      const before = calls.length,
        state = await save(1);
      assert.equal(state.preferredName, "New");
      assert.equal(state.sync.state, "queued");
      assert.equal((await ref(1).get()).data().preferredName, "New");
      assert.equal(calls.length, before);
    },
  );
  await check("Real SQL fault rolls back name and queue together", async () => {
    await seed(2);
    await pool.query(
      "CREATE FUNCTION fail_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected job failure'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER fail_job BEFORE INSERT OR UPDATE ON documents FOR EACH ROW WHEN (NEW.collection = 'profileNicknameSyncJobs' AND NEW.doc_id = '" +
        id(2) +
        "') EXECUTE FUNCTION fail_job()",
    );
    await assert.rejects(() => save(2));
    await pool.query("DROP TRIGGER fail_job ON documents");
    assert.equal((await ref(2).get()).data().preferredName, "Old");
    assert.equal((await job(2).get()).exists, false);
  });
  await check(
    "Missing profile never becomes a partial new profile",
    async () => {
      await reject(
        () =>
          mod.saveProfileIdentity(id(300), {
            preferredName: "Test",
            expectedRevision: "a".repeat(64),
            operationId: randomUUID(),
          }),
        404,
      );
      assert.equal((await ref(300).get()).exists, false);
    },
  );
  await check("Strict name, UUID and revision validation", async () => {
    await reject(() => save(1, "X"), 400);
    await reject(() => save(1, "A".repeat(33)), 400);
    await reject(() => save(1, "Okay", { operationId: "invalid" }), 400);
    await reject(() => save(1, "Okay", { expectedRevision: undefined }), 428);
  });
  await check("Concurrent stale saves admit exactly one name", async () => {
    await seed(3);
    const base = await mod.getProfileIdentityState(id(3)),
      results = await Promise.allSettled(
        ["First", "Second"].map((preferredName) =>
          mod.saveProfileIdentity(id(3), {
            preferredName,
            expectedRevision: base.revision,
            operationId: randomUUID(),
          }),
        ),
      );
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      results.find((x) => x.status === "rejected").reason.status,
      409,
    );
  });
  await check(
    "Exact receipt replay is read-only; ID cannot change payload",
    async () => {
      await seed(4);
      const base = await mod.getProfileIdentityState(id(4)),
        input = {
          preferredName: "New",
          expectedRevision: base.revision,
          operationId: randomUUID(),
        };
      const first = await mod.saveProfileIdentity(id(4), input),
        again = await mod.saveProfileIdentity(id(4), input);
      assert.equal(first.revision, again.revision);
      await reject(
        () =>
          mod.saveProfileIdentity(id(4), { ...input, preferredName: "Other" }),
        409,
      );
    },
  );
  await check("ABA name changes invalidate the original revision", async () => {
    await seed(5);
    const base = await mod.getProfileIdentityState(id(5));
    await save(5);
    await save(5, "Old");
    await reject(
      () =>
        mod.saveProfileIdentity(id(5), {
          preferredName: "Third",
          expectedRevision: base.revision,
          operationId: randomUUID(),
        }),
      409,
    );
  });
  await check("Concurrent workers send one explicit PATCH", async () => {
    await seed(6);
    await save(6);
    const before = patchCount();
    await Promise.all([
      mod.runProfileNicknameSync(id(6)),
      mod.runProfileNicknameSync(id(6)),
    ]);
    assert.equal(patchCount() - before, 1);
    assert.equal(
      (await mod.getProfileIdentityState(id(6))).sync.state,
      "synced",
    );
    assert.equal((await ref(6).get()).data().discordNickname.value, "New");
    assert.equal(
      calls.findLast((x) => x.method === "PATCH").init.retry,
      "never",
    );
  });
  await check("Already matching live nickname performs no PATCH", async () => {
    await seed(7);
    await save(7);
    members.set(user(7), "New");
    const before = patchCount();
    await mod.runProfileNicknameSync(id(7));
    assert.equal(patchCount(), before);
    assert.equal(
      (await mod.getProfileIdentityState(id(7))).sync.state,
      "synced",
    );
  });
  await check("Owner gets copy-ready result without PATCH", async () => {
    await seed(8);
    await save(8);
    owner = user(8);
    const before = patchCount();
    await mod.runProfileNicknameSync(id(8));
    assert.equal(
      (await mod.getProfileIdentityState(id(8))).sync.state,
      "owner",
    );
    assert.equal(patchCount(), before);
    owner = "999999999999999999";
  });
  await check(
    "Non-Discord profile saves name without a scheduled Discord task",
    async () => {
      await seed(9, { provider: "github", providerUserId: "1234" });
      const result = await save(9);
      assert.equal(result.sync.state, "not_discord");
      assert.equal(result.sync.dueAtMs, null);
    },
  );
  await check(
    "Missing guild configuration saves name with visible blocker",
    async () => {
      await seed(10);
      guild = "";
      const result = await save(10);
      assert.equal(result.preferredName, "New");
      assert.equal(result.sync.reason, "configuration");
      guild = "111111111111111111";
    },
  );
  await check(
    "403 hierarchy refusal is explicit and does not churn",
    async () => {
      await seed(11);
      await save(11);
      mode = "forbidden";
      await mod.runProfileNicknameSync(id(11));
      const state = await mod.getProfileIdentityState(id(11));
      assert.equal(state.sync.reason, "hierarchy");
      assert.equal(state.sync.dueAtMs, null);
      assert.equal((await ref(11).get()).data().discordNickname, undefined);
    },
  );
  await check(
    "429 respects server retry deadline without immediate replay",
    async () => {
      await seed(12);
      await save(12);
      mode = "limited";
      const before = patchCount();
      await mod.runProfileNicknameSync(id(12));
      const state = await mod.getProfileIdentityState(id(12));
      assert.equal(state.sync.state, "retry");
      assert.ok(state.sync.dueAtMs >= now + 150_000);
      assert.equal(patchCount() - before, 1);
      await mod.runProfileNicknameSync(id(12));
      assert.equal(patchCount() - before, 1);
      now += 151_000;
      await mod.runProfileNicknameSync(id(12));
      assert.equal(
        (await mod.getProfileIdentityState(id(12))).sync.state,
        "synced",
      );
    },
  );
  await check(
    "Lost PATCH response is reconciled across module restart with GET only",
    async () => {
      await seed(13);
      await save(13);
      mode = "lost";
      const before = patchCount();
      await mod.runProfileNicknameSync(id(13));
      assert.equal(
        (await mod.getProfileIdentityState(id(13))).sync.state,
        "uncertain",
      );
      mod = subject();
      mode = "";
      now += 61_000;
      await mod.runProfileNicknameSync(id(13));
      assert.equal(
        (await mod.getProfileIdentityState(id(13))).sync.state,
        "synced",
      );
      assert.equal(patchCount() - before, 1);
    },
  );
  await check(
    "A dispatched crash with mismatching nick never repeats PATCH",
    async () => {
      await seed(14);
      await save(14);
      await job(14).update({
        state: "running",
        dispatched: true,
        lease: "crashed",
        leaseUntilMs: now - 1,
        dueAtMs: now - 1,
      });
      const before = patchCount();
      await mod.runProfileNicknameSync(id(14));
      assert.equal(
        (await mod.getProfileIdentityState(id(14))).sync.state,
        "uncertain",
      );
      assert.equal(patchCount(), before);
    },
  );
  await check("Explicit reconciliation remains GET-only", async () => {
    const state = await mod.getProfileIdentityState(id(14)),
      before = patchCount();
    await mod.requestProfileNicknameReconciliation(
      id(14),
      state.sync.operationId,
    );
    await mod.runProfileNicknameSync(id(14));
    assert.equal(patchCount(), before);
    assert.equal(
      (await mod.getProfileIdentityState(id(14))).sync.state,
      "uncertain",
    );
  });
  await check(
    "Verification outage keeps uncertain status and dispatch receipt",
    async () => {
      await mod.requestProfileNicknameReconciliation(
        id(14),
        (await mod.getProfileIdentityState(id(14))).sync.operationId,
      );
      mode = "read-denied";
      const before = patchCount();
      await mod.runProfileNicknameSync(id(14));
      assert.equal(
        (await mod.getProfileIdentityState(id(14))).sync.state,
        "uncertain",
      );
      assert.equal((await job(14).get()).data().dispatched, true);
      assert.equal(patchCount(), before);
    },
  );
  await check("Legacy name change before dispatch blocks old job", async () => {
    await seed(15);
    await save(15);
    await ref(15).update({ preferredName: "Other" });
    const before = patchCount();
    await mod.runProfileNicknameSync(id(15));
    assert.equal(
      (await mod.getProfileIdentityState(id(15))).sync.reason,
      "profile_changed",
    );
    assert.equal(patchCount(), before);
  });
  await check(
    "Queue delay rechecks latest profile immediately before send",
    async () => {
      await seed(16);
      await save(16);
      beforeDispatch = () => ref(16).update({ preferredName: "Other" });
      await mod.runProfileNicknameSync(id(16));
      assert.equal(members.get(user(16)), "Old");
      assert.equal(
        (await mod.getProfileIdentityState(id(16))).sync.reason,
        "profile_changed",
      );
    },
  );
  await check(
    "Active lease blocks replacement, then releases after result",
    async () => {
      await seed(17);
      await save(17);
      let release, started;
      const ready = new Promise((r) => (started = r));
      barrier = () => {
        started();
        return new Promise((r) => (release = r));
      };
      const task = mod.runProfileNicknameSync(id(17));
      await ready;
      await reject(() => save(17, "Replacement"), 409);
      release();
      await task;
      await save(17, "Replacement");
      assert.equal(
        (await mod.getProfileIdentityState(id(17))).preferredName,
        "Replacement",
      );
    },
  );
  await check(
    "Member disappearance gives a visible permanent blocker",
    async () => {
      await seed(18);
      await save(18);
      members.delete(user(18));
      await mod.runProfileNicknameSync(id(18));
      assert.equal(
        (await mod.getProfileIdentityState(id(18))).sync.reason,
        "member_missing",
      );
    },
  );
  await check(
    "Dispatched receipt uses its original target after characters change",
    async () => {
      await seed(19);
      await save(19);
      await job(19).update({
        state: "running",
        dispatched: true,
        leaseUntilMs: now - 1,
        dueAtMs: now - 1,
      });
      members.set(user(19), "New");
      await ref(19).update({
        characters: [
          {
            key: "eu:terokkar:sebas",
            name: "Sebas",
            realmSlug: "terokkar",
            region: "eu",
            isMain: true,
          },
        ],
      });
      const before = patchCount();
      await mod.runProfileNicknameSync(id(19));
      assert.equal(
        (await mod.getProfileIdentityState(id(19))).sync.state,
        "synced",
      );
      assert.equal((await ref(19).get()).data().discordNickname.value, "New");
      assert.equal(patchCount(), before);
    },
  );
  await check(
    "Deleted profile does not recreate or send queued job",
    async () => {
      await seed(20);
      await save(20);
      await ref(20).delete();
      const before = calls.length;
      await mod.runProfileNicknameSync(id(20));
      assert.equal(calls.length, before);
      assert.equal((await ref(20).get()).exists, false);
    },
  );
  await check(
    "Independent profile fields survive identity update",
    async () => {
      await seed(21);
      await Promise.all([
        save(21),
        ref(21).update({ grammaticalGender: "female" }),
      ]);
      const data = (await ref(21).get()).data();
      assert.equal(data.preferredName, "New");
      assert.equal(data.grammaticalGender, "female");
    },
  );
  await check(
    "Provider identity changes block the old member target",
    async () => {
      await seed(22);
      await save(22);
      await ref(22).update({ providerUserId: user(23) });
      const before = calls.length;
      await mod.runProfileNicknameSync(id(22));
      assert.equal(calls.length, before);
      assert.equal(
        (await mod.getProfileIdentityState(id(22))).sync.reason,
        "profile_changed",
      );
    },
  );
  await check(
    "Character change during transport wait aborts the old nickname",
    async () => {
      await seed(23);
      await save(23);
      beforeDispatch = () =>
        ref(23).update({
          characters: [
            {
              key: "eu:terokkar:sebas",
              name: "Sebas",
              realmSlug: "terokkar",
              region: "eu",
              isMain: true,
            },
          ],
        });
      await mod.runProfileNicknameSync(id(23));
      assert.equal(members.get(user(23)), "Old");
      assert.equal(
        (await mod.getProfileIdentityState(id(23))).sync.reason,
        "profile_changed",
      );
    },
  );
  await check("Queue selects at most three due profiles per tick", async () => {
    await pool.query(
      "UPDATE documents SET data=jsonb_set(data,'{dueAtMs}','null') WHERE collection='profileNicknameSyncJobs'",
    );
    for (let n = 30; n < 34; n++) {
      await seed(n);
      await save(n);
    }
    const before = patchCount(),
      result = await mod.processProfileNicknameSyncQueue();
    assert.equal(result.found, 3);
    assert.equal(result.processed, 3);
    assert.equal(patchCount() - before, 3);
    assert.equal((await mod.processProfileNicknameSyncQueue()).found, 1);
  });
  await check(
    "Unavailable storage fails without fabricated success",
    async () => {
      configured = false;
      await reject(() => mod.getProfileIdentityState(id(21)), 503);
      configured = true;
    },
  );
  await check("Idle queue makes zero Discord requests", async () => {
    await pool.query(
      "UPDATE documents SET data=jsonb_set(data,'{dueAtMs}','null') WHERE collection='profileNicknameSyncJobs'",
    );
    const before = calls.length;
    const result = await mod.processProfileNicknameSyncQueue();
    assert.equal(result.found, 0);
    assert.equal(calls.length, before);
  });
  console.log(JSON.stringify({ passed, postgres: true, noLiveDiscord: true }));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    await pool.end();
  });
