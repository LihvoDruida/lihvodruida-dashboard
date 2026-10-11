const assert = require("node:assert/strict"),
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
const schema = "r62_" + randomBytes(12).toString("hex"),
  pool = new pg.Pool({
    connectionString: url,
    max: 6,
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
const normalizers = require("./lib/profile-directory-subject.cjs")(
  database,
  store,
  [],
).normalizers;
let configured = true,
  preflight = null,
  retry = false,
  callbacks = 0;
const adapter = {
  collection: (...args) => store.collection(...args),
  runTransaction: (handler) =>
    store.runTransaction(async (tx) => {
      callbacks++;
      const result = await handler(tx);
      if (retry) {
        retry = false;
        throw Object.assign(Error("Controlled serialization retry"), {
          code: "40001",
        });
      }
      return result;
    }),
};
const deps = {
  "@/lib/firebaseAdmin": {
    getFirebaseAdminDb: () => adapter,
    hasFirebaseProfileConfig: () => configured,
  },
  "@/lib/db/firestoreCompat": compat,
  "@/lib/wowCharacters": load("src/lib/wowCharacters.ts", {
    crypto: require("node:crypto"),
  }).exports,
  "@/lib/wowRoles": load("src/lib/wowRoles.ts").exports,
  "@/lib/profiles": {
    ...normalizers,
    invalidateProfileIdentityCaches() {},
    async assertNoProfileCharacterConflicts(...args) {
      if (preflight) {
        const fn = preflight;
        preflight = null;
        await fn();
      }
      return normalizers.assertNoProfileCharacterConflicts(...args);
    },
  },
};
const subject = () => load("src/lib/profileCharacterSetup.ts", deps).exports;
let mod = subject(),
  passed = 0;
const id = (n) => "id" + n.toString(16).padStart(16, "0"),
  ref = (n) => store.collection("dashboardProfiles").doc(id(n));
const hero = (name, role = "dps") => ({
  key: `eu:silvermoon:${name.toLowerCase()}`,
  name,
  normalizedName: name.toLowerCase(),
  region: "eu",
  realmSlug: "silvermoon",
  realmName: "Silvermoon",
  className: "Druid",
  activeSpecRole: role,
  verifiedGuild: true,
});
const a = hero("Alpha", "tank"),
  b = hero("Beta", "healer"),
  c = hero("Gamma");
async function seed(n, characters = [], candidates = [a, b, c]) {
  await ref(n).set({
    provider: "discord",
    providerUserId: String(100000000000000000n + BigInt(n)),
    displayName: "Fixture" + n,
    characters,
    mainCharacterKey: characters[0]?.key || null,
    nicknameCharacterKeys: [],
    battlenet: {
      linked: true,
      candidateCharacters: candidates,
      candidateSavedAt: new Date().toISOString(),
      candidateExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  });
}
async function input(n, overrides = {}) {
  return {
    operationId: randomUUID(),
    expectedRevision: (await mod.getProfileCharacterSetupState(id(n))).revision,
    characterKeys: [a.key, b.key],
    mainCharacterKey: b.key,
    raidRole: "healer",
    ...overrides,
  };
}
async function raw(n) {
  return (await ref(n).get()).data();
}
async function check(name, fn) {
  await fn();
  passed++;
  console.log("✓ " + name);
}
const refused = async (fn, status) =>
  assert.rejects(fn, (e) => e.status === status);
(async () => {
  await pool.query("CREATE SCHEMA " + schema);
  await pool.query(
    require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../src/lib/db/schema.sql"),
      "utf8",
    ),
  );
  await check(
    "One commit saves characters, main, role and consumes candidates",
    async () => {
      await seed(1);
      const result = await mod.saveProfileCharacterSetup(id(1), await input(1));
      assert.equal(result.characters.length, 2);
      assert.equal(result.mainCharacterKey, b.key);
      assert.equal(result.raidRole, "healer");
      assert.equal(result.receipt.addedKeys.length, 2);
      assert.equal(result.candidates.length, 1);
      const data = await raw(1);
      assert.equal(data.raidRolePreference.characterKey, b.key);
      assert.deepEqual(
        data.battlenet.candidateCharacters.map((x) => x.key),
        [c.key],
      );
      assert.equal(
        (await mod.getProfileCharacterSetupState(id(1))).revision,
        result.revision,
      );
    },
  );
  // Keep other profiles from triggering the intentionally preserved ownership guard.
  await store.collection("dashboardProfiles").doc(id(1)).delete();
  await check(
    "Existing main and automatic role can be saved without adding characters",
    async () => {
      await seed(2, [a, b], []);
      await ref(2).set(
        {
          raidRolePreference: { characterKey: a.key, role: "healer" },
          nicknameCharacterKeys: [b.key],
        },
        { merge: true },
      );
      const result = await mod.saveProfileCharacterSetup(
        id(2),
        await input(2, {
          characterKeys: [],
          mainCharacterKey: b.key,
          raidRole: "auto",
        }),
      );
      assert.equal(result.raidRole, "auto");
      assert.equal((await raw(2)).raidRolePreference, undefined);
      assert.deepEqual((await raw(2)).nicknameCharacterKeys, []);
    },
  );
  await ref(2).delete();
  await check(
    "Exact replay after lost response and a process restart is read-only",
    async () => {
      await seed(3);
      const wanted = await input(3);
      const result = await mod.saveProfileCharacterSetup(id(3), wanted);
      const saved = JSON.stringify(await raw(3));
      mod = subject();
      const repeated = await mod.saveProfileCharacterSetup(id(3), wanted);
      assert.equal(repeated.receipt.operationId, wanted.operationId);
      assert.equal(repeated.revision, result.revision);
      assert.equal(JSON.stringify(await raw(3)), saved);
      await refused(
        () =>
          mod.saveProfileCharacterSetup(id(3), { ...wanted, raidRole: "tank" }),
        409,
      );
    },
  );
  await ref(3).delete();
  await check(
    "Rollback leaves all fields and candidate storage unchanged",
    async () => {
      await seed(4);
      const wanted = await input(4),
        before = JSON.stringify(await raw(4));
      await pool.query(
        "CREATE FUNCTION fail_setup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled SQL rollback'; END $$",
      );
      await pool.query(
        "CREATE TRIGGER fail_setup BEFORE UPDATE ON documents FOR EACH ROW WHEN (NEW.collection = 'dashboardProfiles' AND NEW.doc_id = '" +
          id(4) +
          "') EXECUTE FUNCTION fail_setup()",
      );
      await assert.rejects(() => mod.saveProfileCharacterSetup(id(4), wanted));
      assert.equal(JSON.stringify(await raw(4)), before);
      await pool.query("DROP TRIGGER fail_setup ON documents");
    },
  );
  await ref(4).delete();
  await check(
    "Transaction retry returns only the committed attempt's counts",
    async () => {
      await seed(5);
      callbacks = 0;
      retry = true;
      const result = await mod.saveProfileCharacterSetup(id(5), await input(5));
      assert.equal(callbacks, 2);
      assert.equal(result.receipt.addedKeys.length, 2);
      assert.equal(result.characters.length, 2);
    },
  );
  await ref(5).delete();
  await check(
    "Two simultaneous identical requests share one committed receipt",
    async () => {
      await seed(6);
      const wanted = await input(6);
      const results = await Promise.all([
        mod.saveProfileCharacterSetup(id(6), wanted),
        mod.saveProfileCharacterSetup(id(6), wanted),
      ]);
      assert.ok(
        results.every((r) => r.receipt.operationId === wanted.operationId),
      );
      assert.equal((await raw(6)).characters.length, 2);
    },
  );
  await ref(6).delete();
  await check(
    "Two different writers with one revision cannot overwrite each other",
    async () => {
      await seed(7);
      const wanted = await input(7),
        second = {
          ...wanted,
          operationId: randomUUID(),
          mainCharacterKey: a.key,
          raidRole: "tank",
        };
      const results = await Promise.allSettled([
        mod.saveProfileCharacterSetup(id(7), wanted),
        mod.saveProfileCharacterSetup(id(7), second),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.find((r) => r.status === "rejected").reason.status,
        409,
      );
    },
  );
  await ref(7).delete();
  await check(
    "Legacy main or raid-role edit is detected by the revision",
    async () => {
      await seed(8, [a, b], []);
      const wanted = await input(8, { characterKeys: [] });
      await ref(8).set(
        {
          mainCharacterKey: b.key,
          raidRolePreference: { characterKey: b.key, role: "tank" },
        },
        { merge: true },
      );
      const before = JSON.stringify(await raw(8));
      await refused(() => mod.saveProfileCharacterSetup(id(8), wanted), 409);
      assert.equal(JSON.stringify(await raw(8)), before);
    },
  );
  await ref(8).delete();
  await check(
    "Candidate refresh between preflight and commit rejects all writes",
    async () => {
      await seed(9);
      const wanted = await input(9);
      preflight = () =>
        ref(9).set(
          { battlenet: { candidateCharacters: [c] } },
          { merge: true },
        );
      await refused(() => mod.saveProfileCharacterSetup(id(9), wanted), 409);
      assert.equal((await raw(9)).characters.length, 0);
    },
  );
  await ref(9).delete();
  await check(
    "Candidate expiry is rechecked inside the transaction",
    async () => {
      await seed(10);
      const wanted = await input(10);
      preflight = () =>
        ref(10).set(
          {
            battlenet: {
              candidateExpiresAt: new Date(Date.now() - 1000).toISOString(),
            },
          },
          { merge: true },
        );
      await refused(() => mod.saveProfileCharacterSetup(id(10), wanted), 409);
      assert.equal((await raw(10)).characters.length, 0);
    },
  );
  await ref(10).delete();
  await check(
    "Forged character and an unselected new main cannot be saved",
    async () => {
      await seed(11);
      const before = JSON.stringify(await raw(11));
      await refused(
        async () =>
          mod.saveProfileCharacterSetup(
            id(11),
            await input(11, { characterKeys: [hero("Forged").key] }),
          ),
        410,
      );
      await refused(
        async () =>
          mod.saveProfileCharacterSetup(
            id(11),
            await input(11, {
              characterKeys: [a.key],
              mainCharacterKey: b.key,
            }),
          ),
        400,
      );
      assert.equal(JSON.stringify(await raw(11)), before);
    },
  );
  await ref(11).delete();
  await check(
    "Duplicate existing characters are counted without duplication",
    async () => {
      await seed(12, [a], [b]);
      const result = await mod.saveProfileCharacterSetup(
        id(12),
        await input(12, { characterKeys: [a.key, a.key, b.key] }),
      );
      assert.equal(result.receipt.addedKeys.length, 1);
      assert.equal(result.receipt.duplicateKeys.length, 1);
      assert.equal(result.characters.length, 2);
      assert.equal((await raw(12)).battlenet.candidateExpiresAt, undefined);
    },
  );
  await ref(12).delete();
  await check(
    "Other profile's linked character is refused without partial writes",
    async () => {
      await seed(13, [a], []);
      await seed(14);
      const before = JSON.stringify(await raw(14));
      await refused(
        async () => mod.saveProfileCharacterSetup(id(14), await input(14)),
        409,
      );
      assert.equal(JSON.stringify(await raw(14)), before);
    },
  );
  await ref(13).delete();
  await ref(14).delete();
  await check(
    "Validation rejects absent preconditions, invalid roles, keys and operation IDs",
    async () => {
      await seed(15);
      const wanted = await input(15);
      for (const [changes, status] of [
        [{ expectedRevision: "" }, 428],
        [{ raidRole: "owner" }, 400],
        [{ raidRole: ["tank"] }, 400],
        [{ operationId: "bad" }, 400],
        [{ mainCharacterKey: "" }, 400],
        [{ characterKeys: Array(201).fill(a.key) }, 400],
        [{ characterKeys: [null] }, 400],
      ])
        await refused(
          () =>
            mod.saveProfileCharacterSetup(id(15), { ...wanted, ...changes }),
          status,
        );
      assert.equal((await raw(15)).characters.length, 0);
    },
  );
  await ref(15).delete();
  await check(
    "Missing profile, invalid ID and unavailable storage fail clearly",
    async () => {
      await refused(() => mod.getProfileCharacterSetupState(id(16)), 404);
      await refused(() => mod.getProfileCharacterSetupState("invalid"), 400);
      configured = false;
      await refused(() => mod.getProfileCharacterSetupState(id(16)), 503);
      configured = true;
    },
  );
  await check(
    "Old receipts remain distinguishable after later profile changes",
    async () => {
      await seed(17);
      const wanted = await input(17),
        result = await mod.saveProfileCharacterSetup(id(17), wanted);
      await ref(17).set({ mainCharacterKey: a.key }, { merge: true });
      const current = await mod.getProfileCharacterSetupState(id(17));
      assert.equal(current.receipt.revision, result.revision);
      assert.notEqual(current.revision, current.receipt.revision);
      const before = JSON.stringify(await raw(17));
      await mod.saveProfileCharacterSetup(id(17), wanted);
      assert.equal(JSON.stringify(await raw(17)), before);
    },
  );
  await ref(17).delete();
  await check(
    "Legacy bulk-add retry no longer accumulates abandoned results",
    async () => {
      await seed(18, [], []);
      const legacy = require("./lib/profile-directory-subject.cjs")(
        database,
        adapter,
        [],
      ).normalizers;
      retry = true;
      callbacks = 0;
      const result = await legacy.addProfileCharacters(id(18), [a]);
      assert.equal(callbacks, 2);
      assert.equal(result.added, 1);
      assert.equal(result.skipped, 0);
      assert.equal((await raw(18)).characters.length, 1);
    },
  );
  console.log(
    JSON.stringify({
      passed,
      postgres: (await pool.query("SHOW server_version")).rows[0]
        .server_version,
      isolatedSchema: true,
      noExternalApis: true,
    }),
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    } finally {
      await pool.end();
    }
  });
