const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.MISTBLOSSOM_TEST_STANDALONE || path.join(root, '.next/standalone'));
const entry = path.join(output, 'dashboard/server.js');
let passed = 0, child;
const scenarios = [];
async function check(name, run) { await run(); passed++; scenarios.push(name); console.log('✓ ' + name); }
function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name); return item.isDirectory() ? filesUnder(file) : fs.statSync(file).isFile() ? [file] : [];
  });
}
(async () => {
  assert.ok(fs.existsSync(entry), 'Run the production build before checking standalone output');
  const trace = path.join(root, '.next/server/app/api/dashboard/welcome-card/preview/route.js.nft.json');
  const traced = JSON.parse(fs.readFileSync(trace, 'utf8')).files.map(file => path.resolve(path.dirname(trace), file));
  await check('welcome route trace includes its background and three bundled fonts', () => {
    for (const relative of ['public/assets/discord-welcome-card-night-elf-base.png', 'assets/fonts/welcome/SpectralSC-Bold.ttf', 'assets/fonts/welcome/SpectralSC-ExtraBold.ttf', 'assets/fonts/welcome/Philosopher-Bold.ttf']) {
      assert.ok(traced.includes(path.join(root, relative)), 'Missing traced renderer asset: ' + relative);
      assert.ok(fs.existsSync(path.join(output, 'dashboard', relative)), 'Missing packaged renderer asset: ' + relative);
    }
  });
  await check('standalone contains no dashboard source, CI scripts or builder-only configuration', () => {
    for (const relative of ['src', 'scripts', 'Dockerfile', '.env', '.env.local', '.env.production', '.env.example', 'tsconfig.json', 'next.config.mjs']) assert.ok(!fs.existsSync(path.join(output, 'dashboard', relative)), 'Unexpected build input in runtime: ' + relative);
    for (const file of traced) assert.ok(!file.startsWith(path.join(root, 'src') + path.sep) && !file.startsWith(path.join(root, 'scripts') + path.sep), 'Unbounded dashboard trace: ' + file);
  });
  await check('packaged server chunks match the current build byte for byte', () => {
    const source = path.join(root, '.next/server/chunks');
    for (const file of filesUnder(source).filter(file => file.endsWith('.js'))) {
      const relative = path.relative(source, file);
      const packaged = path.join(output, 'dashboard/.next/server/chunks', relative);
      assert.ok(fs.existsSync(packaged), 'Missing server chunk: ' + relative);
      assert.ok(fs.readFileSync(file).equals(fs.readFileSync(packaged)), 'Stale packaged server chunk: ' + relative);
    }
  });
  await check('Sharp resolves from standalone rather than the source node_modules', () => {
    const resolved = createRequire(entry).resolve('sharp'); assert.ok(resolved.startsWith(output + path.sep), resolved);
  });
  await check('packaged Sharp and assets pass the real renderer suite', () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'check-welcome-assets.cjs')], {
      env: { ...process.env, MISTBLOSSOM_TEST_RUNTIME_ROOT: output, MISTBLOSSOM_QA_OUTPUT: '' }, encoding: 'utf8', timeout: 45_000,
    });
    assert.equal(result.error, undefined, result.error?.message); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('OK — 6/6') && result.stdout.includes('standalone=true'), result.stdout);
  });
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  let logs = '';
  child = spawn(process.execPath, [entry], { cwd: output, env: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1', PORT: String(port), DASHBOARD_URL: 'https://guild.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-6000); }); child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
  await check('packaged Next server starts and returns healthy no-store liveness without integrations', async () => {
    let response;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw Error('Standalone server exited: ' + logs);
      response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(800) }).catch(() => null);
      if (response?.ok) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(response?.ok, logs); const data = await response.json(); assert.equal(data.ok, true); assert.equal(data.service, 'mistblossom-dashboard'); assert.ok(response.headers.get('cache-control').includes('no-store'));
  });
  await check('standalone server serves the exact traced welcome background', async () => {
    const response = await new Promise((resolve, reject) => {
      // Use the configured public Host over loopback, as a reverse proxy does.
      const request = http.get(base + '/assets/discord-welcome-card-night-elf-base.png', { headers: { Host: 'guild.test', 'x-mistblossom-trusted-proxy': 'cloudflare' } }, result => {
        const chunks = []; result.on('data', chunk => chunks.push(chunk)); result.on('error', reject);
        result.on('end', () => resolve({ status: result.statusCode, headers: result.headers, buffer: Buffer.concat(chunks) }));
      });
      request.on('error', reject); request.setTimeout(3000, () => request.destroy(new Error('Standalone asset request timed out')));
    });
    assert.equal(response.status, 200, 'Asset response: ' + response.status + ' location=' + response.headers.location + '\n' + logs); assert.ok(response.headers['content-type'].includes('image/png'));
    assert.deepEqual(response.buffer, fs.readFileSync(path.join(root, 'public/assets/discord-welcome-card-night-elf-base.png')));
  });
  const packaged = filesUnder(output), report = { passed, failed: 0, scenarios, traceFiles: traced.length, traceBytes: traced.reduce((sum, file) => { const stat = fs.statSync(file); return sum + (stat.isFile() ? stat.size : 0); }, 0), standaloneFiles: packaged.length, standaloneBytes: packaged.reduce((sum, file) => sum + fs.statSync(file).size, 0), scriptsInStandalone: 0, sourceFilesInStandalone: 0 };
  if (process.env.MISTBLOSSOM_PACKAGE_REPORT) fs.writeFileSync(process.env.MISTBLOSSOM_PACKAGE_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log('[check-standalone] OK — ' + passed + '/' + passed + '; ' + report.standaloneFiles + ' files; ' + report.standaloneBytes + ' bytes');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await stopped; clearTimeout(timer);
  }
});
