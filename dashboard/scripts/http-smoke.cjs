#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const appRoot = path.join(root, 'src', 'app');
const baseUrl = String(process.env.SMOKE_BASE_URL || 'http://0.0.0.0:3000').replace(/\/+$/, '');
const cookie = String(process.env.SMOKE_COOKIE || '').trim();
const timeoutMs = Math.max(1000, Number(process.env.SMOKE_TIMEOUT_MS || 8000));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function routeFromPage(file) {
  const rel = path.relative(appRoot, path.dirname(file)).replaceAll(path.sep, '/');
  if (!rel || rel === '.') return '/';
  const parts = rel.split('/').filter((part) => !(part.startsWith('(') && part.endsWith(')')) && !part.startsWith('@'));
  return `/${parts.join('/')}`;
}

const replacements = {
  profileId: process.env.SMOKE_PROFILE_ID,
  raidId: process.env.SMOKE_RAID_ID,
  pollId: process.env.SMOKE_POLL_ID,
  characterKey: process.env.SMOKE_CHARACTER_KEY,
};

function concreteRoute(route) {
  if (route.includes('[...path]')) {
    const value = String(process.env.SMOKE_ADMIN_PATH || '').replace(/^\/+|\/+$/g, '');
    return value ? route.replace('[...path]', value) : null;
  }
  if (!route.includes('[')) return route;
  let result = route;
  for (const match of route.matchAll(/\[([^\]]+)\]/g)) {
    const key = match[1];
    const value = replacements[key];
    if (!value) return null;
    result = result.replace(match[0], encodeURIComponent(String(value)));
  }
  return result;
}

async function probe(target, { required200 = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${target}`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mistblossom-HTTP-Smoke/1.0',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const status = response.status;
    const location = response.headers.get('location');
    const failed = required200 ? status !== 200 : status === 404 || status === 405 || status >= 500;
    return { target, status, location, failed };
  } catch (error) {
    return { target, status: 0, location: null, failed: true, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const pageRoutes = [...new Set(walk(appRoot)
    .filter((file) => /[/\\]page\.(?:ts|tsx)$/.test(file))
    .map(routeFromPage))].sort();

  const concrete = [];
  const skipped = [];
  for (const route of pageRoutes) {
    const value = concreteRoute(route);
    if (value) concrete.push(value);
    else skipped.push(route);
  }

  console.log(`[http-smoke] base=${baseUrl}`);
  const results = [];
  results.push(await probe('/api/health', { required200: true }));
  for (const route of concrete) results.push(await probe(route));

  for (const result of results) {
    const suffix = result.error
      ? ` ERROR ${result.error}`
      : result.location
        ? ` -> ${result.location}`
        : '';
    console.log(`${result.failed ? 'FAIL' : 'OK  '} ${String(result.status).padStart(3, ' ')} ${result.target}${suffix}`);
  }

  if (skipped.length) {
    console.log(`[http-smoke] skipped ${skipped.length} dynamic page routes (set SMOKE_PROFILE_ID / SMOKE_RAID_ID / SMOKE_POLL_ID / SMOKE_CHARACTER_KEY / SMOKE_ADMIN_PATH to include them):`);
    for (const route of skipped) console.log(`SKIP     ${route}`);
  }

  const failed = results.filter((item) => item.failed);
  console.log(`[http-smoke] checked ${results.length} HTTP endpoints; ${failed.length} failed; ${skipped.length} dynamic pages skipped.`);
  if (failed.length) process.exit(1);
})().catch((error) => {
  console.error(`[http-smoke:error] ${error?.stack || error}`);
  process.exit(1);
});
