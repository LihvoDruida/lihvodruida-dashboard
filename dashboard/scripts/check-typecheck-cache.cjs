// Optional heavy QA: compile the full project and mutate an isolated probe.
// Keep this out of each Docker build: it intentionally compiles several times.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mistblossom-type-cache-'));
const config = path.join(root, '.typecheck-cache-qa-' + process.pid + '.json');
const fixture = path.join(temporary, 'probe.ts'), cache = path.join(temporary, 'probe.tsbuildinfo');
const base = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.typecheck.json'), 'utf8'));
const scenarios = [];
let ownsConfig = false;
function run(name, expected) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config, '--noEmit', '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 180000 });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, result.stdout + result.stderr);
  if (expected !== 0) assert.match(result.stdout, /probe\.ts\(1,14\): error TS2322/);
  scenarios.push({ name, seconds: Math.round((performance.now() - start) / 10) / 100, exitCode: result.status, expectedFailure: expected !== 0 });
  console.log('PASS', name);
}
try {
  fs.writeFileSync(config, JSON.stringify({ extends: './tsconfig.typecheck.json', compilerOptions: { tsBuildInfoFile: cache }, include: [...base.include, fixture] }), { flag: 'wx' });
  ownsConfig = true;
  fs.writeFileSync(fixture, 'export const probe: number = 1;\n');
  run('cold full-project compile creates a reusable cache', 0);
  assert.ok(fs.existsSync(cache), 'Compiler did not create incremental state');
  run('unchanged project passes with the warm cache', 0);
  fs.writeFileSync(fixture, 'export const probe: number = "must fail after cached success";\n');
  run('changed source invalidates cached success and reports a real type error', 2);
  fs.writeFileSync(fixture, 'export const probe: number = 2;\n');
  run('repaired source invalidates cached errors and succeeds', 0);
  const report = { passed: scenarios.length, failed: 0, scenarios };
  if (process.env.MISTBLOSSOM_QA_REPORT) fs.writeFileSync(process.env.MISTBLOSSOM_QA_REPORT, JSON.stringify(report, null, 2));
  console.log('[check-typecheck-cache] OK — ' + scenarios.length + '/' + scenarios.length);
} finally {
  if (ownsConfig) fs.unlinkSync(config);
  fs.rmSync(temporary, { recursive: true });
}
