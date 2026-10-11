const assert = require("node:assert/strict"),
  { webcrypto } = require("node:crypto"),
  load = require("./lib/load-server-ts.cjs"),
  next = require("next/server");
const origin = "https://guild.lihvodruida.pp.ua",
  env = {
    NODE_ENV: "production",
    DASHBOARD_URL: origin,
    SECURITY_STRICT_ORIGIN_CHECKS: "true",
  },
  globals = {
    Headers,
    Request,
    Response,
    URL,
    crypto: webcrypto,
    process: { env },
    console: { log() {}, warn() {}, error() {} },
  };
const values = load("src/lib/values.ts", {}, globals).exports,
  security = load(
    "src/lib/security.ts",
    {
      "next/server": next,
      "@/lib/oauth": { getDashboardUrl: () => origin },
      "@/lib/values": values,
      "@/lib/structuredLogs": {
        recordStructuredLog: async () => true,
        inferStructuredLogCategory: () => "security",
      },
    },
    globals,
  ).exports;
let session,
  mutations = 0,
  unavailable = false,
  auditFails = false;
class AccessGroupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const owner = {
    id: "owner",
    role: "admin",
    provider: "discord",
    isServerOwner: true,
  },
  catalog = [
    { id: "manager", role: "member", permissions: ["dashboard.view"] },
  ];
const groups = {
  AccessGroupError,
  canManageGroups: (s) =>
    !!s &&
    s.role === "admin" &&
    (s.isServerOwner || s.permissions?.includes("groups.manage")),
  applyAccessGroupToSession: (s, g) => ({
    ...s,
    role: g.role,
    permissions: g.permissions,
  }),
  listAccessGroupsForManagement: async () => {
    if (unavailable) throw Error("Offline");
    return catalog;
  },
  upsertAccessGroup: async (b) => {
    if (b.expectedRevision === "stale")
      throw new AccessGroupError("Revision conflict", 409);
    mutations++;
    return {
      id: b.id,
      name: "Saved",
      lastMutationId: b.mutationId,
      permissions: [],
    };
  },
  deleteAccessGroup: async () => {
    mutations++;
    return true;
  },
  recordAdminAudit: async () => {
    if (auditFails) throw Error("Audit offline");
    return true;
  },
};
const route = load(
  "src/app/api/dashboard/access-groups/route.ts",
  {
    "next/server": next,
    "@/lib/auth": { getSession: async () => session },
    "@/lib/accessGroups": groups,
    "@/lib/security": security,
  },
  globals,
).exports;
const request = (body = "{}", headers = {}, extra = {}) =>
  new Request(origin + "/api/dashboard/access-groups", {
    method: "POST",
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      ...headers,
    },
    body,
    ...extra,
  });
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log("✓ " + name);
};
(async () => {
  await check(
    "GET/POST require authentication and group-management permission",
    async () => {
      for (const candidate of [null, { id: "member", role: "member" }]) {
        session = candidate;
        const expected = candidate ? 403 : 401;
        assert.equal((await route.GET()).status, expected);
        assert.equal((await route.POST(request())).status, expected);
      }
    },
  );
  session = owner;
  await check(
    "Actual strict origin guard rejects untrusted, cross-site and missing provenance",
    async () => {
      for (const headers of [
        { origin: "https://evil.example" },
        { "sec-fetch-site": "cross-site" },
        { origin: "", referer: "" },
        { host: "evil.example" },
      ])
        assert.equal((await route.POST(request("{}", headers))).status, 403);
    },
  );
  await check("Declared oversized body fails before writes", async () => {
    assert.equal(
      (await route.POST(request("{}", { "content-length": "8193" }))).status,
      413,
    );
  });
  await check("Streamed JSON is bounded without Content-Length", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x".repeat(9000)));
        c.close();
      },
    });
    assert.equal(
      (await route.POST(request(body, {}, { duplex: "half" }))).status,
      413,
    );
  });
  await check(
    "Bad JSON, arrays, empty payload, wrong media type and unknown action fail",
    async () => {
      for (const body of ["{bad", "[]", "null", "", "{}"])
        assert.equal((await route.POST(request(body))).status, 400);
      assert.equal(
        (await route.POST(request("{}", { "content-type": "text/plain" })))
          .status,
        415,
      );
      assert.equal(mutations, 0);
    },
  );
  await check(
    "Revision conflict returns HTTP 409 without a write",
    async () => {
      assert.equal(
        (
          await route.POST(
            request('{"action":"save","expectedRevision":"stale"}'),
          )
        ).status,
        409,
      );
      assert.equal(mutations, 0);
    },
  );
  await check(
    "Explicit save/delete return committed no-store responses",
    async () => {
      for (const b of [
        { action: "save", id: "test", mutationId: "receipt" },
        { action: "delete", currentId: "test", expectedRevision: "snapshot" },
      ]) {
        const r = await route.POST(request(JSON.stringify(b)));
        assert.equal(r.status, 200);
        assert.match(r.headers.get("cache-control"), /no-store/);
        assert.equal((await r.json()).ok, true);
      }
      assert.equal(mutations, 2);
    },
  );
  await check(
    "Audit failure cannot report a committed mutation as failed",
    async () => {
      auditFails = true;
      assert.equal(
        (await route.POST(request('{"action":"save","id":"saved"}'))).status,
        200,
      );
      assert.equal(mutations, 3);
      auditFails = false;
    },
  );
  await check(
    "GET uses current permissions and fails closed on an outage",
    async () => {
      session = {
        id: "officer",
        role: "admin",
        groupId: "manager",
        permissions: ["groups.manage"],
      };
      assert.equal((await route.GET()).status, 403);
      session = owner;
      unavailable = true;
      assert.equal((await route.GET()).status, 503);
      unavailable = false;
      assert.equal((await route.GET()).status, 200);
    },
  );
  await check("Burst limit blocks further mutation attempts", async () => {
    session = { ...owner, id: "rate-limit-test" };
    for (let i = 0; i < 30; i++)
      assert.equal(
        (await route.POST(request('{"action":"save","id":"test"}'))).status,
        200,
      );
    const before = mutations;
    assert.equal(
      (await route.POST(request('{"action":"save","id":"test"}'))).status,
      429,
    );
    assert.equal(mutations, before);
  });
  console.log(
    `[check-access-group-api] OK — ${passed} route/security/body scenarios; actual strict origin helper`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
