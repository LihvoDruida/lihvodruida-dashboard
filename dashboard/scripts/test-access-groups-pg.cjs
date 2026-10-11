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
  throw Error("Use a separate TEST_DATABASE_URL; production URLs refused.");
const schema = "r5_" + randomBytes(12).toString("hex"),
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
const { PgFirestore } = load("src/lib/db/documentStore.ts", {
  "@/lib/db/pgPool": database,
}).exports;
const store = new PgFirestore(),
  cache = new Map();
let configured = true;
const groupSchema = load("src/lib/accessGroupSchema.ts").exports;
function subject(source = "src/lib/accessGroups.ts", db = store) {
  return load(source, {
    "@/lib/firebaseAdmin": {
      getFirebaseAdminDb: () => db,
      hasFirebaseProfileConfig: () => configured,
    },
    "@/lib/firebaseAccess": {
      assertFirebaseWriteAvailable: () => {
        if (!configured) throw Error("Offline");
      },
      firebaseWrite: async (a, k, fn) => fn(),
    },
    "@/lib/runtimeResilience": {
      getRuntimeCachedValue: (k) => cache.get(k) || null,
      setRuntimeCachedValue: (k, v) => {
        cache.set(k, v);
        return v;
      },
      clearRuntimeCachedValue: (k) => cache.delete(k),
      resilientRead: async (k, fn) => fn(),
      logThrottled: () => {},
      safeErrorText: String,
    },
    "@/lib/accessGroupSchema": groupSchema,
    "@/lib/structuredLogs": {
      inferStructuredLogCategory: () => "admin",
      listStructuredLogs: async () => [],
      recordStructuredLog: async () => true,
    },
  }).exports;
}
const mod = subject(),
  owner = {
    id: "owner",
    provider: "discord",
    role: "admin",
    isServerOwner: true,
    groupId: "1",
  },
  ref = (id) => store.collection("dashboardAccessGroups").doc(id);
const get = async (id) =>
  (await mod.listAccessGroupsForManagement()).find((g) => g.id === id);
function input(g, patch = {}) {
  return {
    currentId: g.id,
    expectedRevision: g.revision,
    id: g.id,
    name: g.name,
    role: g.role,
    rank: g.rank,
    icon: g.icon || "",
    discordRoleId: g.discordRoleIds[0] || "",
    permissions: [...g.permissions],
    mutationId: randomUUID(),
    ...patch,
  };
}
const create = (id, patch = {}) =>
  mod.upsertAccessGroup(
    {
      ...input(
        {
          id,
          name: "Група " + id,
          role: "member",
          rank: 20,
          discordRoleIds: [],
          permissions: ["dashboard.view"],
        },
        patch,
      ),
      currentId: "",
      expectedRevision: null,
    },
    owner,
  );
async function reject(fn, status) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error, "operation must fail");
  if (status) assert.equal(error.status, status, error.message);
}
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log("✓ " + name);
};
(async () => {
  await pool.query("CREATE SCHEMA " + schema);
  await pool.query(
    fs.readFileSync(path.join(__dirname, "../src/lib/db/schema.sql"), "utf8"),
  );
  await mod.ensureDefaultAccessGroups();
  await create("a");
  await create("b");
  if (process.env.TEST_ACCESS_GROUPS_BASELINE) {
    const old = subject(process.env.TEST_ACCESS_GROUPS_BASELINE),
      base = await get("a");
    await old.upsertAccessGroup(input(base, { name: "First" }), owner);
    await old.upsertAccessGroup(
      input(base, { name: "Stale overwrites" }),
      owner,
    );
    assert.equal((await get("a")).name, "Stale overwrites");
    console.log(
      "BASELINE R4: stale snapshot silently overwrites the first administrator.",
    );
  }
  await check(
    "Legacy content revisions and authoritative empty catalog",
    async () => {
      await ref("legacy").set({
        id: "legacy",
        name: "Legacy",
        role: "member",
        rank: 10,
        permissions: ["dashboard.view"],
      });
      assert.match((await get("legacy")).revision, /^[a-f0-9]{64}$/);
    },
  );
  await check(
    "Explicit save returns exact committed revision and receipt",
    async () => {
      const base = await get("a"),
        data = input(base, { name: "Saved" }),
        saved = await mod.upsertAccessGroup(data, owner);
      assert.notEqual(saved.revision, base.revision);
      assert.equal(saved.lastMutationId, data.mutationId);
      assert.equal((await get("a")).revision, saved.revision);
      assert.ok(saved.createdAt);
    },
  );
  await check("Missing edit and create preconditions fail closed", async () => {
    const base = await get("a");
    await reject(
      () =>
        mod.upsertAccessGroup(
          input(base, { expectedRevision: undefined }),
          owner,
        ),
      428,
    );
    await reject(
      () =>
        mod.upsertAccessGroup(
          input(base, {
            currentId: "",
            id: "absent",
            expectedRevision: undefined,
          }),
          owner,
        ),
      428,
    );
  });
  await check("Stale save cannot overwrite committed changes", async () => {
    const base = await get("a");
    await mod.upsertAccessGroup(input(base, { name: "First" }), owner);
    await reject(
      () => mod.upsertAccessGroup(input(base, { name: "Stale" }), owner),
      409,
    );
    assert.equal((await get("a")).name, "First");
  });
  await check(
    "Concurrent edits of one revision have exactly one winner",
    async () => {
      const base = await get("a"),
        r = await Promise.allSettled(
          ["A", "B"].map((name) =>
            mod.upsertAccessGroup(input(base, { name }), owner),
          ),
        );
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(r.find((x) => x.status === "rejected").reason.status, 409);
    },
  );
  await check(
    "Concurrent creates with one ID cannot overwrite each other",
    async () => {
      const r = await Promise.allSettled([create("same"), create("same")]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(r.find((x) => x.status === "rejected").reason.status, 409);
    },
  );
  await check(
    "One Discord role assigned concurrently has one winner",
    async () => {
      const a = await get("a"),
        b = await get("b"),
        role = "123456789012345678",
        r = await Promise.allSettled([
          mod.upsertAccessGroup(input(a, { discordRoleId: role }), owner),
          mod.upsertAccessGroup(input(b, { discordRoleId: role }), owner),
        ]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        (await mod.listAccessGroupsForManagement()).filter((g) =>
          g.discordRoleIds.includes(role),
        ).length,
        1,
      );
    },
  );
  await check(
    "Independent edits both commit with serialized catalog checks",
    async () => {
      const r = await Promise.allSettled(
        ["a", "b"].map(async (id) =>
          mod.upsertAccessGroup(
            input(await get(id), { name: "Independent " + id }),
            owner,
          ),
        ),
      );
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 2);
    },
  );
  await check(
    "Fresh catalog enforces role uniqueness despite stale auth cache",
    async () => {
      cache.set("access-groups", []);
      const g = (await mod.listAccessGroupsForManagement()).find(
        (g) => g.discordRoleIds.length,
      );
      await reject(
        () => create("collision", { discordRoleId: g.discordRoleIds[0] }),
        409,
      );
    },
  );
  await check(
    "Direct legacy writer changes invalidate the snapshot",
    async () => {
      const base = await get("legacy");
      await ref("legacy").set({ name: "External" }, { merge: true });
      await reject(() => mod.upsertAccessGroup(input(base), owner), 409);
    },
  );
  await check(
    "Delete/recreate ABA invalidates old save and delete revisions",
    async () => {
      const base = await get("same");
      await mod.deleteAccessGroup(base.id, owner, base.revision);
      await create("same");
      await reject(() => mod.upsertAccessGroup(input(base), owner), 409);
      await reject(
        () => mod.deleteAccessGroup(base.id, owner, base.revision),
        409,
      );
    },
  );
  await check(
    "Stale or unversioned deletion cannot remove a changed group",
    async () => {
      const base = await get("b");
      await mod.upsertAccessGroup(input(base, { name: "Keep" }), owner);
      await reject(() => mod.deleteAccessGroup("b", owner, base.revision), 409);
      await reject(() => mod.deleteAccessGroup("b", owner), 428);
      assert.ok(await get("b"));
    },
  );
  await check(
    "Protected custom and system groups cannot be deleted",
    async () => {
      await ref("protected").set({
        id: "protected",
        name: "Protected",
        role: "member",
        rank: 10,
        protectedGroup: true,
        permissions: ["dashboard.view"],
      });
      await reject(
        async () =>
          mod.deleteAccessGroup(
            "protected",
            owner,
            (await get("protected")).revision,
          ),
        403,
      );
      for (const id of ["1", "2", "3", "99"])
        await reject(
          async () =>
            mod.deleteAccessGroup(id, owner, (await get(id)).revision),
          400,
        );
    },
  );
  await check(
    "Atomic rename preserves unknown fields and creation time",
    async () => {
      await ref("legacy").set({ extension: "Keep" }, { merge: true });
      const base = await get("legacy"),
        saved = await mod.upsertAccessGroup(
          input(base, { id: "renamed" }),
          owner,
        );
      assert.equal((await ref("legacy").get()).exists, false);
      assert.equal((await ref("renamed").get()).data().extension, "Keep");
      assert.notEqual(saved.revision, base.revision);
    },
  );
  await check(
    "Rename collision and injected destination failure preserve source",
    async () => {
      const base = await get("renamed");
      await reject(
        () => mod.upsertAccessGroup(input(base, { id: "b" }), owner),
        409,
      );
      const fault = subject("src/lib/accessGroups.ts", {
        collection: (...a) => store.collection(...a),
        runTransaction: (fn) =>
          store.runTransaction((tx) =>
            fn(
              new Proxy(tx, {
                get(target, key) {
                  if (key === "create")
                    return () => {
                      throw Error("Injected failure");
                    };
                  const v = target[key];
                  return typeof v === "function" ? v.bind(target) : v;
                },
              }),
            ),
          ),
      });
      await reject(() =>
        fault.upsertAccessGroup(input(base, { id: "never" }), owner),
      );
      assert.equal((await get("renamed")).revision, base.revision);
      assert.equal((await ref("never").get()).exists, false);
    },
  );
  await check(
    "Revoked manager permission overrides a stale cookie",
    async () => {
      await create("manager", {
        role: "admin",
        rank: 90,
        permissions: ["dashboard.view", "groups.manage"],
      });
      const viewer = {
        id: "officer",
        provider: "discord",
        role: "admin",
        groupId: "manager",
        permissions: ["groups.manage"],
      };
      await ref("manager").set(
        { permissions: ["dashboard.view"] },
        { merge: true },
      );
      await reject(
        async () => mod.upsertAccessGroup(input(await get("a")), viewer),
        403,
      );
    },
  );
  await check(
    "Non-owner can edit regular groups, cannot escalate or edit own/admin groups",
    async () => {
      await mod.upsertAccessGroup(
        input(await get("manager"), {
          permissions: ["dashboard.view", "groups.manage"],
        }),
        owner,
      );
      const viewer = {
        id: "officer",
        provider: "discord",
        role: "admin",
        groupId: "manager",
        permissions: ["groups.manage"],
      };
      for (const id of ["manager", "1"])
        await reject(
          async () => mod.upsertAccessGroup(input(await get(id)), viewer),
          403,
        );
      await reject(
        async () =>
          mod.upsertAccessGroup(
            input(await get("a"), { role: "admin" }),
            viewer,
          ),
        403,
      );
      await mod.upsertAccessGroup(
        input(await get("b"), { name: "Officer edit" }),
        viewer,
      );
      assert.equal((await get("b")).name, "Officer edit");
    },
  );
  await check(
    "System ID and role remain fixed; mentor rank remains configurable",
    async () => {
      await reject(
        async () =>
          mod.upsertAccessGroup(input(await get("2"), { id: "other" }), owner),
        400,
      );
      const g = await mod.upsertAccessGroup(
        input(await get("3"), { role: "member", rank: 25 }),
        owner,
      );
      assert.equal(g.role, "mentor");
      assert.equal(g.rank, 25);
    },
  );
  await check(
    "Invalid IDs, role IDs, rank and permission inputs cannot be normalized into writes",
    async () => {
      const base = await get("a");
      for (const patch of [
        { id: "a<script>" },
        { discordRoleId: "bad" },
        {
          discordRoleId: undefined,
          discordRoleIds: ["123456789012345678", "222222222222222222"],
        },
        { rank: 101 },
        { rank: 2.5 },
        { permissions: ["unknown"] },
        { role: "unknown" },
      ])
        await reject(
          () => mod.upsertAccessGroup(input(base, patch), owner),
          400,
        );
    },
  );
  await check(
    "Default repair and concurrent moderator edit cannot lose fields",
    async () => {
      await ref("2").set({ icon: "" }, { merge: true });
      const base = await get("2"),
        r = await Promise.allSettled([
          mod.ensureDefaultAccessGroups(),
          mod.upsertAccessGroup(input(base, { name: "New Moderator" }), owner),
        ]);
      if (r[1].status === "rejected") {
        assert.equal(r[1].reason.status, 409);
        await mod.upsertAccessGroup(
          input(await get("2"), { name: "New Moderator" }),
          owner,
        );
      }
      assert.equal((await get("2")).name, "New Moderator");
    },
  );
  await check(
    "Storage failure never returns cached/default editor authority",
    async () => {
      configured = false;
      await reject(() => mod.listAccessGroupsForManagement(), 503);
      configured = true;
    },
  );
  console.log(
    JSON.stringify({
      passed,
      database: "PostgreSQL",
      privateSchema: true,
      productionUntouched: true,
    }),
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool
      .query("DROP SCHEMA IF EXISTS " + schema + " CASCADE")
      .catch(() => {});
    await pool.end();
  });
