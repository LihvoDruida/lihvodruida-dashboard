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
const botDockerfile = read('bot/Dockerfile');
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
const startScript = read('deploy/scripts/start.sh');
const backupScript = read('deploy/scripts/db-backup.sh');
const restoreScript = read('deploy/scripts/db-restore.sh');
const securityAuditScript = read('deploy/scripts/security-audit.sh');
const hostHardenScript = read('deploy/scripts/harden-host.sh');
const makefile = read('Makefile');
const content = read('dashboard/src/lib/content.ts');
const logsExplorer = read('dashboard/src/components/StructuredLogsExplorer.tsx');
const logsPage = read('dashboard/src/app/dashboard/logs/page.tsx');
const packageJson = JSON.parse(read('dashboard/package.json'));
const packageLock = JSON.parse(read('dashboard/package-lock.json'));
const lockRoot = packageLock.packages?.[''] || {};

const overlayMatch = dockerfile.match(/ARG NEXT_SECURITY_VERSION=([^\s]+)/);
const reactOverlayMatch = dockerfile.match(/ARG REACT_SECURITY_VERSION=([^\s]+)/);
const sharpOverlayMatch = dockerfile.match(/ARG SHARP_SECURITY_VERSION=([^\s]+)/);
const nodeMatch = dockerfile.match(/ARG NODE_VERSION=([0-9.]+)-bookworm-slim/);
const botNodeMatch = botDockerfile.match(/ARG NODE_VERSION=([0-9.]+)-bookworm-slim/);
const pinnedNext = overlayMatch?.[1] || '';
const pinnedReact = reactOverlayMatch?.[1] || '';
const pinnedSharp = sharpOverlayMatch?.[1] || '';
const pinnedNode = nodeMatch?.[1] || '';
const pinnedBotNode = botNodeMatch?.[1] || '';
ok(dockerignore.includes('**/.env') && dockerignore.includes('**/.env.*') && dockerignore.includes('!**/.env.example'), 'Docker build context must exclude real env files while allowing templates');
ok(
  dockerfile.includes('COPY docker-compose.yml /repo/docker-compose.yml') &&
    dockerfile.includes('COPY .env.example /repo/.env.example') &&
    dockerfile.includes('COPY .dockerignore /repo/.dockerignore'),
  'dashboard builder must copy every root manifest consumed by check:security-performance',
);
ok(
  dockerfile.includes('COPY deploy/scripts/start.sh /repo/deploy/scripts/start.sh') &&
    dockerfile.includes('COPY deploy/scripts/db-backup.sh /repo/deploy/scripts/db-backup.sh') &&
    dockerfile.includes('COPY deploy/scripts/db-restore.sh /repo/deploy/scripts/db-restore.sh') &&
    dockerfile.includes('COPY deploy/scripts/security-audit.sh /repo/deploy/scripts/security-audit.sh') &&
    dockerfile.includes('COPY deploy/scripts/harden-host.sh /repo/deploy/scripts/harden-host.sh') &&
    dockerfile.includes('COPY Makefile /repo/Makefile'),
  'dashboard builder must copy deployment hardening inputs consumed by the security audit',
);
ok(dockerfile.includes('COPY bot/Dockerfile /repo/bot/Dockerfile'), 'dashboard builder must copy bot/Dockerfile consumed by check:security-performance');
ok(versionAtLeast(pinnedNext, '16.3.3'), `Docker Next.js security overlay must be >=16.3.3 (found ${pinnedNext || 'missing'})`);
ok(versionAtLeast(pinnedReact, '19.2.8'), `Docker React security overlay must be >=19.2.8 (found ${pinnedReact || 'missing'})`);
ok(versionAtLeast(pinnedSharp, '0.35.4'), `Docker Sharp security overlay must be >=0.35.4 (found ${pinnedSharp || 'missing'})`);
ok(versionAtLeast(pinnedNode, '24.18.1') && versionAtLeast(pinnedBotNode, '24.18.1'), `dashboard/bot Node base must be >=24.18.1 (found ${pinnedNode || 'missing'} / ${pinnedBotNode || 'missing'})`);
ok(dockerfile.includes('npm install --no-save --package-lock=false') && dockerfile.includes('next@${NEXT_SECURITY_VERSION}') && dockerfile.includes('react@${REACT_SECURITY_VERSION}') && dockerfile.includes('react-dom@${REACT_SECURITY_VERSION}') && dockerfile.includes('sharp@${SHARP_SECURITY_VERSION}'), 'Docker build must install pinned Next/React/Sharp security overlays');
ok(dockerfile.includes('MISTBLOSSOM_EXPECTED_NEXT_VERSION=${NEXT_SECURITY_VERSION}') && dockerfile.includes('MISTBLOSSOM_EXPECTED_REACT_VERSION=${REACT_SECURITY_VERSION}') && dockerfile.includes('MISTBLOSSOM_EXPECTED_SHARP_VERSION=${SHARP_SECURITY_VERSION}'), 'builder must expose expected security overlay versions to CI');
ok(!dockerfile.includes('/repo/dashboard/scripts ./dashboard/scripts') && dockerfile.includes('scripts/db-init.mjs'), 'runtime image must not copy the whole CI/build scripts directory');
ok(envExample.includes('NEXT_SECURITY_VERSION=16.3.5') && envExample.includes('REACT_SECURITY_VERSION=19.2.8') && envExample.includes('SHARP_SECURITY_VERSION=0.35.4'), 'root env example must pin approved Next/React/Sharp security releases');
ok(envExample.includes('SECURITY_REQUIRE_CLOUDFLARE=strict') && envExample.includes('SECURITY_STRICT_ORIGIN_CHECKS=true'), 'root env example must default production edge/CSRF enforcement to strict');
ok(
  packageJson.dependencies?.next === lockRoot.dependencies?.next,
  `package.json Next baseline (${packageJson.dependencies?.next || 'missing'}) must equal package-lock baseline (${lockRoot.dependencies?.next || 'missing'}); security upgrades belong in NEXT_SECURITY_VERSION`,
);
ok(
  packageJson.devDependencies?.['eslint-config-next'] === lockRoot.devDependencies?.['eslint-config-next'],
  `package.json eslint-config-next baseline (${packageJson.devDependencies?.['eslint-config-next'] || 'missing'}) must equal package-lock baseline (${lockRoot.devDependencies?.['eslint-config-next'] || 'missing'})`,
);
ok(
  versionAtLeast(pinnedNext, packageJson.dependencies?.next || '0.0.0'),
  `Next.js security overlay ${pinnedNext || 'missing'} must not be older than the reproducible package baseline ${packageJson.dependencies?.next || 'missing'}`,
);
ok(
  startScript.includes('Next baseline синхронний: package.json = package-lock') &&
    startScript.includes('eslint-config-next синхронний: package.json = package-lock'),
  'deployment preflight must reject package.json/package-lock Next baseline drift before Docker build',
);

const installedRequirements = [
  ['next', '16.3.3', String(process.env.MISTBLOSSOM_EXPECTED_NEXT_VERSION || pinnedNext).trim()],
  ['react', '19.2.8', String(process.env.MISTBLOSSOM_EXPECTED_REACT_VERSION || pinnedReact).trim()],
  ['react-dom', '19.2.8', String(process.env.MISTBLOSSOM_EXPECTED_REACT_VERSION || pinnedReact).trim()],
  ['sharp', '0.35.4', String(process.env.MISTBLOSSOM_EXPECTED_SHARP_VERSION || pinnedSharp).trim()],
];
for (const [pkg, minimum, expected] of installedRequirements) {
  const installedPath = path.join(dashboardRoot, 'node_modules', pkg, 'package.json');
  if (fs.existsSync(installedPath)) {
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8')).version;
    ok(versionAtLeast(installed, minimum), `installed ${pkg} must be >=${minimum} (found ${installed})`);
    if (expected) ok(installed === expected, `installed ${pkg} ${installed} must equal pinned ${expected}`);
  } else {
    // Source-only audits do not contain node_modules. Docker build:ci performs
    // the stronger installed-version assertions after applying the overlay.
    ok(Boolean(expected), `source-only audit must still contain a pinned ${pkg} security overlay`);
  }
}
ok(packageJson.scripts?.['security:runtime'] === 'node scripts/check-runtime-security.cjs' && packageJson.scripts?.['build:ci']?.includes('npm run security:runtime'), 'Docker build:ci must refuse known-vulnerable installed runtime packages');

ok(!proxy.includes('next-router-prefetch') && !proxy.includes('purpose:'), 'proxy matcher must not skip auth/security for prefetch requests');
ok(logsExplorer.includes('timeZone: LOG_TIME_ZONE') && logsExplorer.includes('Europe/Kyiv'), 'logs client timestamps must use an explicit timezone so SSR and browser hydration render identical text');
ok(logsExplorer.includes('useState(initialNow)') && !logsExplorer.includes('useState(() => new Date().toISOString())'), 'logs client must hydrate from a server-serialized timestamp instead of calling Date during initial render');
ok(logsPage.includes('initialNow={initialNow}') && logsPage.includes('const initialNow = new Date().toISOString()'), 'logs page must serialize one initial timestamp into the client boundary');
ok(!proxy.includes('response.headers.set("X-Nonce"') && !proxy.includes("response.headers.set('X-Nonce'"), 'CSP nonce must not be reflected in a response header');
ok(proxy.includes('frame-src \'none\'') && proxy.includes('child-src \'none\''), 'CSP must explicitly deny frames/child browsing contexts');
ok(proxy.includes('x-mistblossom-trusted-proxy'), 'Cloudflare enforcement must use the server-created trusted-proxy marker');
ok(proxy.includes('if (!raw) return "strict"') && proxy.includes('return "strict";'), 'production Cloudflare proxy mode must fail closed when configuration is missing/unknown');
ok(security.includes('if (allowed.length === 0) return process.env.NODE_ENV !== "production"'), 'production Host allowlist must fail closed when configuration is missing');
ok(security.includes('envFlag("SECURITY_STRICT_ORIGIN_CHECKS", process.env.NODE_ENV === "production")'), 'production CSRF provenance checks must default to strict');

ok(
  proxy.includes('pathname === "/api/dashboard/discord/nicknames/automation"') &&
    proxy.includes('!isAllowedHost(host) && !isInternalServiceRequest'),
  'nickname automation must accept dashboard:3000 only through the bearer-authenticated internal-host path',
);
ok(
  security.includes('verifyInternalBearerToken') && compose.includes('INTERNAL_CRON_TOKEN: ${INTERNAL_API_TOKEN'),
  'internal schedulers must share the canonical INTERNAL_API_TOKEN and verify it in route handlers',
);

ok(security.includes('RATE_LIMIT_MAX_BUCKETS') && security.includes('pruneRateLimitBuckets'), 'in-memory rate limiter must be bounded and pruned');
ok(security.includes('Bearer [redacted]') && security.includes('postgres(?:ql)?'), 'structured logs must redact bearer/database credentials in free-form messages');
ok(content.includes('DANGEROUS_RAW_HTML_TAGS') && content.includes('INLINE_EVENT_HANDLER') && content.includes('DANGEROUS_DATA_URI'), 'managed Markdown must reject active raw HTML/event handlers/dangerous URI schemes');
ok(content.includes('imageSignatureMatches') && content.includes('RIFF') && content.includes('GIF89a') && content.includes('0x89, 0x50, 0x4e, 0x47'), 'managed image uploads must verify file signatures instead of trusting Content-Type');
ok(auth.includes('expected.length < 32') && auth.includes('provided.length < 32'), 'emergency administrator token must reject weak short secrets');
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
ok(vhost.includes('server_name _;') && vhost.includes('return 444;') && vhost.includes('ssl_reject_handshake on'), 'nginx must reject unknown Host/SNI before proxying to Next');
ok(vhost.includes('https://guild.lihvodruida.pp.ua$request_uri') && !vhost.includes('https://$host$request_uri'), 'HTTP redirect must use the canonical host instead of reflecting attacker-controlled Host');
ok(vhost.includes('if ($mistblossom_from_cloudflare = 0)') && vhost.includes('return 444;'), 'canonical HTTPS origin must reject direct non-Cloudflare peers');

for (const [name, content] of [['proxy-params.inc', proxyParams], ['proxy-params-fast.inc', proxyParamsFast]]) {
  ok(content.includes('CF-Connecting-IP $remote_addr') && content.includes('X-Mistblossom-Trusted-Proxy $mistblossom_trusted_proxy'), `${name} must overwrite client-spoofable Cloudflare headers`);
  ok(content.includes('X-GeoIP-Country ""') && content.includes('CloudFront-Viewer-Country ""'), `${name} must strip client-spoofable geo headers`);
}

ok(compose.includes('image: postgres:17.11-alpine'), 'PostgreSQL must pin the current 17.x security minor');
ok(compose.includes('image: nginx:1.30.4-alpine'), 'nginx must use a stable release containing the July 2026 security fixes');
ok(compose.includes('image: curlimages/curl:8.22.0'), 'cron curl image must not use the vulnerable 2024-era curl 8.11.1');
ok(compose.includes('image: certbot/certbot:v5.7.0') && !compose.includes('certbot/certbot:latest'), 'Certbot image must be version-pinned instead of mutable latest');
ok(compose.includes('SECURITY_REQUIRE_CLOUDFLARE: ${SECURITY_REQUIRE_CLOUDFLARE:-strict}') && compose.includes('SECURITY_STRICT_ORIGIN_CHECKS: ${SECURITY_STRICT_ORIGIN_CHECKS:-true}'), 'compose must apply fail-closed production edge/CSRF defaults even with stale dashboard env files');
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
ok(startScript.includes('chmod 600 "$f"') && startScript.includes('SECURITY_REQUIRE_CLOUDFLARE=$CF_MODE_VALUE') && startScript.includes('SECURITY_STRICT_ORIGIN_CHECKS=$STRICT_ORIGIN_VALUE'), 'deploy preflight must harden secret-file permissions and reject non-strict production edge/CSRF overrides');
ok(startScript.includes('REACT_SECURITY_VERSION') && startScript.includes('SHARP_SECURITY_VERSION') && startScript.includes('>= 19.2.8') && startScript.includes('>= 0.35.4'), 'deploy preflight must enforce React and Sharp security floors');
ok(backupScript.includes('umask 077') && backupScript.includes('flock') && backupScript.includes('chmod 600') && backupScript.includes('sha256sum'), 'database backups must be private, single-flight, validated and checksummed');
ok(restoreScript.includes('umask 077') && restoreScript.includes('sha256sum -c') && restoreScript.includes('trap restart_services') && restoreScript.includes('--no-owner') && restoreScript.includes('--no-privileges'), 'database restore must verify integrity, recover services on failure and avoid replaying ownership/privileges');
ok(securityAuditScript.includes('PasswordAuthentication') && securityAuditScript.includes('docker compose port') && securityAuditScript.includes('backup files are private'), 'read-only host security audit must cover SSH, container exposure, backups and secret permissions');
ok(hostHardenScript.includes('CONFIRM_SSH_KEY_WORKS') && hostHardenScript.includes('PasswordAuthentication no') && hostHardenScript.includes('ufw limit OpenSSH') && hostHardenScript.includes('fail2ban'), 'host hardening helper must refuse unsafe SSH lockout and enable firewall/brute-force controls');
ok(makefile.includes('security-audit:') && makefile.includes('security-audit.sh'), 'Makefile must expose the read-only host security audit');
const sourceTree = fs.readdirSync(path.join(dashboardRoot, 'src', 'app', 'api', 'profile'), { recursive: true })
  .filter((name) => String(name).endsWith('.ts'))
  .map((name) => fs.readFileSync(path.join(dashboardRoot, 'src', 'app', 'api', 'profile', name), 'utf8'))
  .join('\n');
ok(!sourceTree.includes('new URL("/login", request.url)'), 'profile action redirects must use the canonical public origin, not request.url');

if (process.exitCode) process.exit(process.exitCode);
console.log(`[check-security-performance] OK — ${checks} security/performance invariants checked.`);
