const fs = require('node:fs');
const path = require('node:path');

const apiRoot = path.resolve(__dirname, '../src/app/api');
let checked = 0;
let failed = 0;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const mutationExport = /export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/g;
const protectedSignals = [
  'getSession(',
  'getStoredSession(',
  'verifyInternalBearerToken(',
  'verifyDiscordInteractionSignature(',
  'requireDiscordAdmin(',
  'redirectLegacyAdminApi',
];

for (const file of walk(apiRoot).filter((name) => name.endsWith(`${path.sep}route.ts`))) {
  const source = fs.readFileSync(file, 'utf8');
  const methods = [...source.matchAll(mutationExport)].map((match) => match[1]);
  if (!methods.length) continue;
  checked += 1;

  const rel = path.relative(apiRoot, file).replaceAll(path.sep, '/');
  const protectedRoute = protectedSignals.some((signal) => source.includes(signal));
  if (protectedRoute) continue;

  // Public mutation endpoints are intentionally tiny and must carry their own
  // abuse/CSRF/signature controls. Keeping this allowlist explicit makes a new
  // unauthenticated mutation fail CI instead of silently becoming public.
  if (rel === 'auth/login/route.ts') {
    if (source.includes('verifyTrustedOrigin(') && source.includes('checkRateLimit(') && source.includes('verifyToken(')) continue;
  }
  if (rel === 'auth/logout/route.ts') {
    if (source.includes('clearSession(') && source.includes('expireAuthCookies(')) continue;
  }
  if (rel === 'client-errors/route.ts') {
    if (source.includes('assertRequestBodySize(') && source.includes('checkRateLimit(') && source.includes('cleanStack(')) continue;
  }
  if (rel === 'site/applications/route.ts') {
    if (source.includes('isAllowedPublicSiteOrigin(') && source.includes('assertRequestBodySize(') && source.includes('checkRateLimit(') && source.includes('validateApplication(')) continue;
  }

  failed += 1;
  console.error(`[check-api-security] FAIL — unauthenticated mutation surface: ${methods.join('/')} /api/${rel.replace('/route.ts', '')}`);
}

if (failed) process.exit(1);
console.log(`[check-api-security] OK — ${checked} mutation route files have explicit auth/signature/abuse controls.`);
