#!/usr/bin/env node
/*
 * Next.js 16 replaced middleware.ts with proxy.ts.
 * Vercel/Next fails the production build when both files are present.
 * This guard removes stale middleware files that can remain in Git working trees
 * or deployment caches after the migration to src/proxy.ts.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const candidates = [
  'middleware.ts',
  'middleware.js',
  'src/middleware.ts',
  'src/middleware.js',
  'src/src/middleware.ts',
  'src/src/middleware.js',
];

let removed = 0;
for (const relativePath of candidates) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) continue;

  fs.rmSync(absolutePath, { force: true });
  removed += 1;
  console.log(`[next16-middleware-cleanup] removed stale ${relativePath}`);
}

if (removed === 0) {
  console.log('[next16-middleware-cleanup] no stale middleware files found');
}
