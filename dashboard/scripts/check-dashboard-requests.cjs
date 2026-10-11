const assert = require('node:assert/strict');
const http = require('node:http');
const load = require('./lib/load-server-ts.cjs');
const globals = { Headers, Request, Response, URL, AbortController, fetch };
const api = load('src/lib/apiHttp.ts', {}, globals).exports;
const client = load('src/lib/dashboardApiClient.ts', { '@/lib/apiHttp': api }, globals).exports;
let posts = 0, saved = false, gets = 0, passed = 0;
const sockets = new Set();
const server = http.createServer((req, res) => {
  if (req.method === 'POST') { posts++; saved = true; return; } // Applied mutation, lost response.
  gets++;
  if (req.url === '/hang' || req.url === '/body') { if (req.url === '/body') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); } return; }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, saved }));
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
async function check(name, run) { await run(); passed++; console.log('✓ ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
  await check('bounded GET, including a stalled response body', async () => {
    for (const endpoint of ['/hang', '/body']) { const started = Date.now(); await assert.rejects(client.dashboardApiJson(origin + endpoint, { timeoutMs: 500, retries: 0 }), /timeout/); assert.ok(Date.now() - started < 1800); }
  });
  await check('upstream cancellation aborts a pending real HTTP request', async () => {
    const controller = new AbortController(); const pending = client.dashboardApiJson(origin + '/hang', { timeoutMs: 10000, signal: controller.signal, retries: 0 }); setTimeout(() => controller.abort(), 20); const started = Date.now(); await assert.rejects(pending); assert.ok(Date.now() - started < 1000);
  });
  await check('POST timeout does not replay an applied mutation; recovery is GET only', async () => {
    await assert.rejects(client.dashboardApiJson(origin + '/mutation', { method: 'POST', json: { action: 'pause' }, timeoutMs: 500 }), /timeout/);
    assert.equal(posts, 1); const current = await client.dashboardApiJson(origin + '/state', { timeoutMs: 500, retries: 0 }); assert.equal(current.saved, true); assert.equal(posts, 1);
  });
  console.log(`[check-dashboard-requests] OK — ${passed} real HTTP scenarios; POSTs=${posts}; GETs=${gets}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { for (const socket of sockets) socket.destroy(); server.close(); });
