const assert = require("node:assert/strict"),
  { webcrypto } = require("node:crypto"),
  next = require("next/server"),
  load = require("./lib/load-server-ts.cjs");
const origin = "https://guild.lihvodruida.pp.ua",
  globals = {
    Headers,
    Request,
    Response,
    URL,
    crypto: webcrypto,
    process: {
      env: {
        NODE_ENV: "production",
        DASHBOARD_URL: origin,
        SECURITY_STRICT_ORIGIN_CHECKS: "true",
      },
    },
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
class ProfileIdentityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
let session = null,
  status = 0,
  mutations = 0,
  workers = [],
  lastProfile = null,
  auditFails = false;
const identity = {
  preferredName: "New",
  revision: "a".repeat(64),
  nicknamePreview: "New",
  sync: { operationId: "b".repeat(36), state: "queued", dueAtMs: Date.now() },
};
const mod = load(
  "src/app/api/profile/identity/route.ts",
  {
    "next/server": { ...next, after: (fn) => workers.push(fn) },
    "@/lib/auth": { getSession: async () => session },
    "@/lib/security": {
      ...security,
      logDashboardEvent() {
        if (auditFails) throw Error("Audit unavailable");
      },
    },
    "@/lib/profileNicknameSync": {
      ProfileIdentityError,
      getProfileIdentityState: async (id) => {
        lastProfile = id;
        if (status) throw new ProfileIdentityError("Controlled", status);
        return identity;
      },
      saveProfileIdentity: async (id) => {
        lastProfile = id;
        if (status) throw new ProfileIdentityError("Controlled", status);
        mutations++;
        return identity;
      },
      requestProfileNicknameReconciliation: async (id) => {
        lastProfile = id;
        return identity;
      },
      runProfileNicknameSync: async () => {},
    },
  },
  globals,
).exports;
const own = { profileId: "id" + "1".repeat(16), provider: "discord" },
  request = (body = {}, extra = {}) =>
    new next.NextRequest(origin + "/api/profile/identity", {
      method: "POST",
      headers: {
        host: new URL(origin).host,
        Origin: origin,
        "Content-Type": "application/json",
        ...extra,
      },
      body:
        typeof body === "string"
          ? body
          : JSON.stringify({ action: "save", ...body }),
    });
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log("✓ " + name);
}
(async () => {
  await check("Unauthenticated GET/POST reject and never mutate", async () => {
    assert.equal((await mod.GET()).status, 401);
    assert.equal((await mod.POST(request())).status, 401);
    assert.equal(mutations, 0);
  });
  await check("Impersonation cannot change another identity", async () => {
    session = { ...own, impersonatedBy: "owner" };
    assert.equal((await mod.GET()).status, 403);
    assert.equal((await mod.POST(request())).status, 403);
  });
  await check("Strict origin and missing-origin checks", async () => {
    session = own;
    assert.equal(
      (await mod.POST(request({}, { Origin: "https://evil.example" }))).status,
      403,
    );
    assert.equal((await mod.POST(request({}, { Origin: "" }))).status, 403);
  });
  await check(
    "Only session profile is targeted; supplied profile ID is ignored",
    async () => {
      const result = await mod.POST(request({ profileId: "victim" }));
      assert.equal(result.status, 202);
      assert.equal(lastProfile, own.profileId);
      assert.equal(mutations, 1);
      assert.equal(workers.length, 1);
    },
  );
  await check("GET is fresh, private, and no-store", async () => {
    const result = await mod.GET();
    assert.equal(result.status, 200);
    assert.match(result.headers.get("cache-control"), /no-store/);
    assert.equal(lastProfile, own.profileId);
    assert.equal(mutations, 1);
  });
  await check(
    "Streamed oversized body without Content-Length is refused",
    async () => {
      assert.equal((await mod.POST(request(" ".repeat(2049)))).status, 413);
      assert.equal(mutations, 1);
    },
  );
  await check("Type, JSON shape and action validation", async () => {
    assert.equal(
      (await mod.POST(request({}, { "Content-Type": "text/plain" }))).status,
      415,
    );
    assert.equal((await mod.POST(request("{bad"))).status, 400);
    assert.equal((await mod.POST(request("[]"))).status, 400);
    assert.equal((await mod.POST(request({ action: "unknown" }))).status, 400);
  });
  await check(
    "Conflicts, missing preconditions, and missing profile are retained",
    async () => {
      for (const code of [409, 428, 404]) {
        status = code;
        assert.equal((await mod.POST(request())).status, code);
      }
      status = 0;
      assert.equal(mutations, 1);
    },
  );
  await check(
    "Audit failure cannot report a committed save as failed",
    async () => {
      auditFails = true;
      assert.equal((await mod.POST(request())).status, 202);
      auditFails = false;
      assert.equal(mutations, 2);
    },
  );
  await check(
    "Storage failure returns visible 503 without worker scheduling",
    async () => {
      status = 503;
      const before = workers.length;
      assert.equal((await mod.GET()).status, 503);
      assert.equal((await mod.POST(request())).status, 503);
      assert.equal(workers.length, before);
      status = 0;
    },
  );
  await check("Rate limit stops new writes", async () => {
    let response;
    for (let i = 0; i < 25; i++) response = await mod.POST(request());
    assert.equal(response.status, 429);
  });
  console.log(JSON.stringify({ passed, noLiveDiscord: true }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
