const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mistblossom-build-'));
const log = path.join(scratch, 'calls.jsonl');
const scripts = path.join(repo, 'deploy/scripts');
let checks = 0;
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }

const mock = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const command=path.basename(process.argv[1]), args=process.argv.slice(2);
fs.appendFileSync(process.env.BUILD_TEST_LOG,JSON.stringify({command,args,parallel:process.env.COMPOSE_PARALLEL_LIMIT})+'\\n');
if(command==='docker') process.exit(args.at(-1)===process.env.BUILD_TEST_FAIL_SERVICE?7:0);
if(command==='getent') process.exit((process.env.BUILD_TEST_DNS_FAILURES||'').split(',').includes(args.at(-1))?1:0);
if(command==='curl') {
 const host=new URL(args.at(-1)).hostname;
 if(host===process.env.BUILD_TEST_HTTP_FAIL_HOST)process.exit(60);
 process.stdout.write(host==='registry-1.docker.io'?'401':'200');
}
`;
for (const command of ['docker', 'getent', 'curl']) {
  fs.writeFileSync(path.join(scratch, command), mock, { mode: 0o755 });
}
function run(script, args = [], extra = {}) {
  fs.writeFileSync(log, '');
  const result = spawnSync('bash', [path.join(scripts, script), ...args], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: `${scratch}:${process.env.PATH}`, BUILD_TEST_LOG: log,
      BUILD_TEST_FAIL_SERVICE: '', BUILD_TEST_DNS_FAILURES: '', BUILD_TEST_HTTP_FAIL_HOST: '', ...extra },
  });
  assert.ifError(result.error);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { ...result, calls };
}
try {
  test('both Dockerfiles use the bundled frontend and retain cache mounts', () => {
    for (const file of ['dashboard/Dockerfile', 'bot/Dockerfile']) {
      const source = read(file);
      assert.ok(!/^\s*#\s*syntax\s*=/m.test(source));
      assert.ok(source.includes('RUN --mount=type=cache'));
    }
  });
  test('dashboard Docker stage contains every new build-test input', () => {
    const source = read('dashboard/Dockerfile');
    for (const file of ['build-images.sh', 'network-check.sh']) {
      assert.ok(source.includes(`COPY deploy/scripts/${file} /repo/deploy/scripts/${file}`));
    }
  });
  test('dashboard finishes before bot starts; concurrency is one', () => {
    const r = run('build-images.sh'); assert.equal(r.status, 0);
    assert.deepEqual(r.calls.map(c => c.args), [['compose', 'build', 'dashboard'], ['compose', 'build', 'bot']]);
    assert.ok(r.calls.every(c => c.parallel === '1'));
  });
  test('one-service rebuild does not build another image', () => {
    const r = run('build-images.sh', ['bot']); assert.equal(r.status, 0);
    assert.deepEqual(r.calls.map(c => c.args), [['compose', 'build', 'bot']]);
  });
  test('failed first build stops subsequent build, diagnoses DNS and preserves exit code', () => {
    const r = run('build-images.sh', [], { BUILD_TEST_FAIL_SERVICE: 'dashboard', BUILD_TEST_DNS_FAILURES: 'auth.docker.io' });
    assert.equal(r.status, 7); assert.equal(r.calls.filter(c => c.command === 'docker').length, 1);
    assert.ok(r.stderr.includes('FAIL DNS: auth.docker.io'));
    assert.ok(!r.calls.some(c => c.command === 'docker' && c.args.includes('down')));
  });
  test('failure of bot also preserves build exit code', () => {
    const r = run('build-images.sh', [], { BUILD_TEST_FAIL_SERVICE: 'bot' });
    assert.equal(r.status, 7); assert.equal(r.calls.filter(c => c.command === 'docker').length, 2);
  });
  test('invalid service is rejected before any Docker call', () => {
    const r = run('build-images.sh', ['dashboard', 'unknown']); assert.equal(r.status, 2); assert.equal(r.calls.length, 0);
  });
  test('anonymous registry HTTP 401 is treated as available HTTPS', () => {
    const r = run('network-check.sh'); assert.equal(r.status, 0);
    assert.equal(r.calls.filter(c => c.command === 'curl').length, 4);
    assert.ok(r.stdout.includes('registry-1.docker.io (HTTP 401)'));
  });
  test('DNS failure skips HTTP for that host and reports failure', () => {
    const r = run('network-check.sh', [], { BUILD_TEST_DNS_FAILURES: 'auth.docker.io,registry.npmjs.org' });
    assert.equal(r.status, 1); assert.equal(r.calls.filter(c => c.command === 'curl').length, 2);
    assert.ok(r.stderr.includes('FAIL DNS: auth.docker.io'));
  });
  test('TLS/network failure remains visible and fails diagnosis', () => {
    const r = run('network-check.sh', [], { BUILD_TEST_HTTP_FAIL_HOST: 'registry-1.docker.io' });
    assert.equal(r.status, 1); assert.ok(r.stderr.includes('FAIL HTTPS: registry-1.docker.io'));
  });
  test('restart stops containers only after build succeeds', () => {
    const source = read('deploy/scripts/start.sh');
    assert.ok(source.indexOf('bash deploy/scripts/build-images.sh dashboard bot') < source.indexOf('$COMPOSE down --remove-orphans'));
  });
  console.log(`[check-deployment-build] ${checks}/${checks} PASS (mocked Docker/DNS/HTTPS; no real Docker build).`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
