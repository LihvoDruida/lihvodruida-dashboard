const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const pg = require("pg");

// Disposable QA container: no volumes, random port on loopback only.
// Never use the production Compose project, environment or database.
const name = "mistblossom-roadmap-qa-" + process.pid + "-" + randomBytes(6).toString("hex");
const password = randomBytes(24).toString("hex");
const image = process.env.TEST_POSTGRES_IMAGE || "postgres:17.11-alpine";
let started = false;
function docker(args, timeout = 30000) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || "Docker command failed");
  }
  return result.stdout.trim();
}
function cleanup() {
  if (!started) return;
  started = false;
  spawnSync("docker", ["rm", "--force", name], { stdio: "ignore", timeout: 10000 });
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(signal, () => { cleanup(); process.exit(code); });
}
(async () => {
  docker(["version", "--format", "{{.Server.Version}}"]);
  started = true;
  docker([
    "run", "--detach", "--rm", "--name", name, "--memory=256m", "--cpus=1",
    "--publish", "127.0.0.1::5432",
    "--env", "POSTGRES_USER=test", "--env", "POSTGRES_DB=mistblossom_test",
    "--env", "POSTGRES_PASSWORD=" + password, image,
  ], 180000);
  const port = docker(["inspect", "--format", "{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}", name]);
  if (!/^\d+$/.test(port)) throw new Error("Missing isolated test port");
  const url = "postgresql://test:" + password + "@127.0.0.1:" + port + "/mistblossom_test";
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await client.connect(); await client.query("SELECT 1"); ready = true; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    finally { await client.end().catch(() => {}); }
  }
  if (!ready) throw new Error("Isolated PostgreSQL did not start within 60 seconds");
  console.log("[test:db:docker] " + image + "; temporary database; loopback only");
  for (const script of ["test-document-store-pg.cjs", "test-discord-publication-pg.cjs", "test-profile-directory-pg.cjs", "test-discord-cleanup-pg.cjs", "test-access-groups-pg.cjs", "test-profile-identity-pg.cjs"]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
      stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: url, TEST_DOCUMENT_STORE_SOURCE: "" },
      timeout: 300000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
})().catch(error => {
  console.error("[test:db:docker] FAILED:", String(error.message).replaceAll(password, "[redacted]"));
  process.exitCode = 1;
}).finally(cleanup);
