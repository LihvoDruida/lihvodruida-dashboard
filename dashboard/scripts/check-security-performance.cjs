const fs = require('node:fs');
const path = require('node:path');

const dashboardRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(dashboardRoot, '..');
let checks = 0;

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function ok(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`[check-security-performance] FAIL — ${message}`);
    process.exitCode = 1;
  }
}

function versionTuple(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function versionAtLeast(value, minimum) {
  const a = versionTuple(value);
  const b = versionTuple(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

const dockerfile = read('dashboard/Dockerfile');
const compose = read('docker-compose.yml');
const proxy = read('dashboard/src/proxy.ts');
const security = read('dashboard/src/lib/security.ts');
const geo = read('dashboard/src/lib/geoAccessPolicy.ts');
const auth = read('dashboard/src/lib/auth.ts');
const pool = read('dashboard/src/lib/db/pgPool.ts');
const nextConfig = read('dashboard/next.config.mjs');
const nginx = read('deploy/nginx/nginx.conf');
const vhost = read('deploy/nginx/dashboard.conf');
const proxyParams = read('deploy/nginx/proxy-params.inc');
const proxyParamsFast = read('deploy/nginx/proxy-params-fast.inc');
const envExample = read('.env.example');
const dashboardEnvExample = read('dashboard/.env.example');
const dockerignore = read('.dockerignore');

const overlayMatch = dockerfile.match(/ARG NEXT_SECURITY_VERSION=([^\s]+)/);
const pinnedNext = overlayMatch?.[1] || '';
ok(dockerignore.includes('**/.env') && dockerignore.includes('**/.env.*') && dockerignore.includes('!**/.env.example'), 'Docker build context must exclude real env files while allowing templates');
ok(versionAtLeast(pinnedNext, '16.3.3'), `Docker Next.js security overlay must be >=16.3.3 (found ${pinnedNext || 'missing'})`);
ok(dockerfile.includes('npm install --no-save --package-lock=false') && dockerfile.includes('next@${NEXT_SECURITY_VERSION}'), 'Docker build must install the pinned Next.js security overlay');
ok(dockerfile.includes('MISTBLOSSOM_EXPECTED_NEXT_VERSION=${NEXT_SECURITY_VERSION}'), 'builder must expose the expected Next.js version to CI');
ok(!dockerfile.includes('/repo/dashboard/scripts ./dashboard/scripts') && dockerfile.includes('scripts/db-init.mjs'), 'runtime image must not copy the whole CI/build scripts directory');
ok(envExample.includes('NEXT_SECURITY_VERSION=16.3.5'), 'root env example must pin the approved Next.js security release');

const installedPath = path.join(dashboardRoot, 'node_modules', 'next', 'package.json');
if (fs.existsSync(installedPath)) {
  const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8')).version;
  const expected = String(process.env.MISTBLOSSOM_EXPECTED_NEXT_VERSION || pinnedNext).trim();
  ok(versionAtLeast(installed, '16.3.3'), `installed Next.js must be >=16.3.3 (found ${installed})`);
  if (expected) ok(installed === expected, `installed Next.js ${installed} must equal pinned ${expected}`);
} else {
  // Source-only audits do not contain node_modules. The real Docker build does,
  // so build:ci performs the stronger installed-version assertions above.
  ok(Boolean(pinnedNext), 'source-only audit must still contain a pinned Next.js security overlay');
}

ok(!proxy.includes('next-router-prefetch') && !proxy.includes('purpose:'), 'proxy matcher must not skip auth/security for prefetch requests');
ok(!proxy.includes('response.headers.set("X-Nonce"') && !proxy.includes("response.headers.set('X-Nonce'"), 'CSP nonce must not be reflected in a response header');
ok(proxy.includes('frame-src \'none\'') && proxy.includes('child-src \'none\''), 'CSP must explicitly deny frames/child browsing contexts');
ok(proxy.includes('x-mistblossom-trusted-proxy'), 'Cloudflare enforcement must use the server-created trusted-proxy marker');

ok(security.includes('RATE_LIMIT_MAX_BUCKETS') && security.includes('pruneRateLimitBuckets'), 'in-memory rate limiter must be bounded and pruned');
ok(security.includes('Bearer [redacted]') && security.includes('postgres(?:ql)?'), 'structured logs must redact bearer/database credentials in free-form messages');
ok(security.includes('x-real-ip') && security.includes('isTrustedCloudflareRequest'), 'client IP must prefer proxy-pinned X-Real-IP and trust CF IP only with marker');
ok(geo.includes('x-mistblossom-country') && geo.includes('isTrustedCloudflareRequest'), 'geo policy must consume trusted proxy country metadata');

ok(auth.includes('DISCORD_LIVE_ACCESS_GRACE_SECONDS') && auth.includes('safeDiscordAccessFallback'), 'live Discord authorization must have a bounded outage grace period');
ok(auth.includes('process.env.NODE_ENV === "production"'), 'production sessions must live-sync Discord access by default');
ok(dashboardEnvExample.includes('SESSION_LIVE_ACCESS_SYNC_ENABLED=1'), 'env example must enable live Discord access sync');

ok(pool.includes('statement_timeout') && pool.includes('lock_timeout') && pool.includes('idle_in_transaction_session_timeout'), 'PostgreSQL connections must enforce query/lock/idle transaction timeouts');
ok(pool.includes('keepAlive: true') && pool.includes('connectionTimeoutMillis: 8_000'), 'PostgreSQL pool must use keepalive and bounded connect timeout');
ok(dashboardEnvExample.includes('DATABASE_POOL_SIZE=8') && pool.includes('DATABASE_POOL_SIZE || 8'), '4-GB VPS preset must keep PostgreSQL pool bounded at 8 by default');

ok(nextConfig.includes('cacheMaxMemorySize: 32 * 1024 * 1024'), 'Next.js memory cache must be bounded for the VPS');
ok(nextConfig.includes('productionBrowserSourceMaps: false'), 'production browser source maps must stay disabled');

ok(nginx.includes('server_tokens off') && nginx.includes('keepalive_requests 1000'), 'nginx must hide its version and bound/reuse keepalive connections');
ok(nginx.includes('proxy_cache_path /var/cache/nginx/next-images') && vhost.includes('proxy_cache next_images'), 'Next image optimizer output must be cached at nginx');
ok(vhost.includes('proxy_cache_lock on'), 'image cache must use cache-lock against thundering herd');
ok(nginx.includes('limit_conn_zone') && vhost.includes('limit_conn perip'), 'edge must cap concurrent requests per client IP');
ok(nginx.includes('zone=scanner') && vhost.includes('wp-login\\.php'), 'common scanner probes must be rejected before Node');
ok(nginx.includes('2606:4700::/32') && nginx.includes('2a06:98c0::/29'), 'Cloudflare IPv6 ranges must be included in trusted real-IP configuration');
ok(nginx.includes('geo $realip_remote_addr $mistblossom_from_cloudflare'), 'Cloudflare metadata trust must be based on actual TCP peer');

for (const [name, content] of [['proxy-params.inc', proxyParams], ['proxy-params-fast.inc', proxyParamsFast]]) {
  ok(content.includes('CF-Connecting-IP $remote_addr') && content.includes('X-Mistblossom-Trusted-Proxy $mistblossom_trusted_proxy'), `${name} must overwrite client-spoofable Cloudflare headers`);
  ok(content.includes('X-GeoIP-Country ""') && content.includes('CloudFront-Viewer-Country ""'), `${name} must strip client-spoofable geo headers`);
}

ok(compose.includes('image: postgres:17.11-alpine'), 'PostgreSQL must pin the current 17.x security minor');
ok(compose.includes('image: nginx:1.30.4-alpine'), 'nginx must use a stable release containing the July 2026 security fixes');
ok(compose.includes('image: curlimages/curl:8.22.0'), 'cron curl image must not use the vulnerable 2024-era curl 8.11.1');
const dashboardSection = compose.split(/^  dashboard:/m)[1]?.split(/^  [a-zA-Z0-9_-]+:/m)[0] || '';
const botSection = compose.split(/^  bot:/m)[1]?.split(/^  [a-zA-Z0-9_-]+:/m)[0] || '';
const nginxSection = compose.split(/^  nginx:/m)[1]?.split(/^  [a-zA-Z0-9_-]+:/m)[0] || '';
ok(dashboardSection.includes('pull: true'), 'dashboard builds must refresh the Node base image security patches');
ok(botSection.includes('pull: true'), 'bot builds must refresh the Node base image security patches');
ok(dashboardSection.includes('cap_drop:') && dashboardSection.includes('- ALL') && dashboardSection.includes('pids_limit: 256'), 'dashboard container must drop Linux capabilities and cap PIDs');
ok(botSection.includes('cap_drop:') && botSection.includes('- ALL') && botSection.includes('pids_limit: 128'), 'bot container must drop Linux capabilities and cap PIDs');
ok(nginxSection.includes('no-new-privileges:true') && nginxSection.includes('pids_limit: 128'), 'nginx container must block privilege escalation and cap PIDs');
ok(!/\n\s+ports:/m.test(dashboardSection) && !/\n\s+ports:/m.test(botSection), 'dashboard and bot must not publish host ports directly');

const cronSection = compose.split(/^  cron:/m)[1]?.split(/^  [a-zA-Z0-9_-]+:/m)[0] || '';
ok(cronSection.includes('read_only: true') && cronSection.includes('cap_drop:') && cronSection.includes('pids_limit: 64'), 'cron container must be read-only, capability-free, and PID-bounded');
ok(dashboardEnvExample.includes('RATE_LIMIT_MAX_BUCKETS=20000'), 'rate-limit bucket cap must be documented in the production env template');
ok(dashboardEnvExample.includes('DISCORD_LIVE_ACCESS_GRACE_SECONDS=600'), 'Discord access outage grace must be explicit in env template');
const sourceTree = fs.readdirSync(path.join(dashboardRoot, 'src', 'app', 'api', 'profile'), { recursive: true })
  .filter((name) => String(name).endsWith('.ts'))
  .map((name) => fs.readFileSync(path.join(dashboardRoot, 'src', 'app', 'api', 'profile', name), 'utf8'))
  .join('\n');
ok(!sourceTree.includes('new URL("/login", request.url)'), 'profile action redirects must use the canonical public origin, not request.url');

if (process.exitCode) process.exit(process.exitCode);
console.log(`[check-security-performance] OK — ${checks} security/performance invariants checked.`);
