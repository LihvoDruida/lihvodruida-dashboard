const assert = require("node:assert/strict"),
  next = require("next/server"),
  load = require("./lib/load-server-ts.cjs");
const origin = "https://guild.lihvodruida.pp.ua",
  globals = {
    Headers,
    Request,
    Response,
    URL,
    process: {
      env: {
        NODE_ENV: "production",
        DASHBOARD_URL: origin,
        SECURITY_STRICT_ORIGIN_CHECKS: "true",
      },
    },
    console: { log() {}, warn() {}, error() {} },
  };
const values = load("src/lib/values.ts", {}, globals).exports;
const security = load(
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
class ProfileCharacterSetupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
let session = null,
  status = 0,
  mutations = 0,
  lastProfile = null,
  auditFails = false;
const setup = {
  revision: "a".repeat(64),
  receipt: {
    operationId: "fixture",
    addedKeys: ["verified"],
    duplicateKeys: [],
  },
};
const mod = load(
  "src/app/api/profile/characters/setup/route.ts",
  {
    "next/server": next,
    "@/lib/auth": { getSession: async () => session },
    "@/lib/security": {
      ...security,
      logDashboardEvent() {
        if (auditFails) throw Error("Audit unavailable");
      },
    },
    "@/lib/profileCharacterSetup": {
      ProfileCharacterSetupError,
      getProfileCharacterSetupState: async (id) => {
        lastProfile = id;
        if (status) throw new ProfileCharacterSetupError("Controlled", status);
        return setup;
      },
      saveProfileCharacterSetup: async (id) => {
        lastProfile = id;
        if (status) throw new ProfileCharacterSetupError("Controlled", status);
        mutations++;
        return setup;
      },
    },
  },
  globals,
).exports;
const own = { profileId: "id" + "1".repeat(16), provider: "discord" };
const request = (body = {}, extra = {}) =>
  new next.NextRequest(origin + "/api/profile/characters/setup", {
    method: "POST",
    headers: {
      host: new URL(origin).host,
      Origin: origin,
      "Content-Type": "application/json",
      ...extra,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log("✓ " + name);
}
(async () => {
  await check(
    "Unauthenticated GET/POST never read or mutate a profile",
    async () => {
      assert.equal((await mod.GET()).status, 401);
      assert.equal((await mod.POST(request())).status, 401);
      assert.equal(lastProfile, null);
    },
  );
  await check(
    "Impersonation cannot access another member's setup",
    async () => {
      session = { ...own, impersonatedBy: "owner" };
      assert.equal((await mod.GET()).status, 403);
      assert.equal((await mod.POST(request())).status, 403);
    },
  );
  await check(
    "Strict Origin checks reject evil or missing origins",
    async () => {
      session = own;
      assert.equal(
        (await mod.POST(request({}, { Origin: "https://evil.example" })))
          .status,
        403,
      );
      assert.equal((await mod.POST(request({}, { Origin: "" }))).status, 403);
    },
  );
  await check(
    "Supplied profile ID cannot select a different target",
    async () => {
      assert.equal(
        (await mod.POST(request({ profileId: "victim" }))).status,
        200,
      );
      assert.equal(lastProfile, own.profileId);
      assert.equal(mutations, 1);
    },
  );
  await check(
    "GET is private, fresh and has no write side effects",
    async () => {
      const result = await mod.GET();
      assert.equal(result.status, 200);
      assert.match(result.headers.get("cache-control"), /no-store/);
      assert.equal(mutations, 1);
    },
  );
  await check(
    "Streamed body limit also works without Content-Length",
    async () => {
      assert.equal((await mod.POST(request(" ".repeat(40961)))).status, 413);
      assert.equal(mutations, 1);
    },
  );
  await check(
    "Wrong content type, invalid JSON and arrays are refused",
    async () => {
      assert.equal(
        (await mod.POST(request({}, { "Content-Type": "text/plain" }))).status,
        415,
      );
      assert.equal((await mod.POST(request("{bad"))).status, 400);
      assert.equal((await mod.POST(request("[]"))).status, 400);
    },
  );
  await check(
    "Conflict, expiry and absent preconditions retain status codes",
    async () => {
      for (const code of [400, 404, 409, 410, 428]) {
        status = code;
        assert.equal((await mod.POST(request())).status, code);
      }
      status = 0;
      assert.equal(mutations, 1);
    },
  );
  await check(
    "Audit failure cannot report an already committed save as failed",
    async () => {
      auditFails = true;
      assert.equal((await mod.POST(request())).status, 200);
      auditFails = false;
      assert.equal(mutations, 2);
    },
  );
  await check(
    "Storage failure is visible and rate limit stops new writes",
    async () => {
      status = 503;
      assert.equal((await mod.GET()).status, 503);
      assert.equal((await mod.POST(request())).status, 503);
      status = 0;
      let result;
      for (let i = 0; i < 25; i++) result = await mod.POST(request());
      assert.equal(result.status, 429);
    },
  );
  console.log(JSON.stringify({ passed, noLiveDiscord: true }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
