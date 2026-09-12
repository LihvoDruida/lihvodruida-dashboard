#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const failures = [];
const checked = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function routeFromFile(file) {
  const marker = `${path.sep}app${path.sep}api${path.sep}`;
  const idx = file.indexOf(marker);
  if (idx < 0 || !file.endsWith(`${path.sep}route.ts`)) return null;
  const relative = file.slice(idx + marker.length, -`${path.sep}route.ts`.length);
  const parts = relative.split(path.sep).map((part) => {
    if (/^\[\.\.\..+\]$/.test(part)) return '**';
    if (/^\[.+\]$/.test(part)) return '*';
    return part;
  });
  return `/api/${parts.join('/')}`;
}

function routeRegex(route) {
  const source = route
    .split('/')
    .map((part) => part === '**' ? '.+' : part === '*' ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/');
  return new RegExp(`^${source}$`);
}

const routes = walk(path.join(sourceRoot, 'app', 'api'))
  .filter((file) => file.endsWith(`${path.sep}route.ts`))
  .map((file) => {
    const route = routeFromFile(file);
    const text = fs.readFileSync(file, 'utf8');
    const methods = new Set([...text.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]));
    return { route, regex: routeRegex(route), file, methods };
  });

function normalizeTarget(raw) {
  let target = String(raw || '').trim();
  target = target.replace(/\?.*$/, '');
  target = target.replace(/\$\{[^}]+\}/g, '*');
  return target;
}

function matchRoute(target) {
  const normalized = normalizeTarget(target);
  const concrete = normalized.replace(/\*/g, 'dynamic');
  const matches = routes.filter((route) => route.regex.test(concrete));
  return matches.sort((a, b) => {
    const aWild = (a.route.match(/\*/g) || []).length;
    const bWild = (b.route.match(/\*/g) || []).length;
    return aWild - bWild || b.route.length - a.route.length;
  })[0];
}

function record(target, method, file, line, kind) {
  if (!target.startsWith('/api/')) return;
  const route = matchRoute(target);
  checked.push({ target, method, file, line, kind });
  if (!route) {
    failures.push(`${kind} ${method} ${target} у ${path.relative(root, file)}:${line} не має API route.`);
    return;
  }
  if (method && method !== 'UNKNOWN' && !route.methods.has(method)) {
    failures.push(`${kind} ${method} ${target} у ${path.relative(root, file)}:${line} веде в ${route.route}, але route не експортує ${method}.`);
  }
}

const sourceFiles = walk(sourceRoot).filter((file) => /\.(tsx?|jsx?|mjs|cjs)$/.test(file));
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');

  for (const match of text.matchAll(/<form\b([\s\S]*?)>/g)) {
    const attrs = match[1];
    const literal = attrs.match(/\baction\s*=\s*"([^"]+)"/);
    const template = attrs.match(/\baction\s*=\s*\{`([^`]+)`\}/);
    const target = literal?.[1] || template?.[1];
    if (!target) continue;
    const method = (attrs.match(/\bmethod\s*=\s*"([^"]+)"/)?.[1] || 'GET').toUpperCase();
    const line = text.slice(0, match.index).split('\n').length;
    record(target, method, file, line, 'form');
  }

  // API links are buttons/actions too (downloads, OAuth starts, etc.).
  for (const match of text.matchAll(/<a\b([\s\S]*?)>/g)) {
    const attrs = match[1];
    const literal = attrs.match(/\bhref\s*=\s*"([^"]+)"/);
    const template = attrs.match(/\bhref\s*=\s*\{`([^`]+)`\}/);
    const target = literal?.[1] || template?.[1];
    if (!target) continue;
    const line = text.slice(0, match.index).split('\n').length;
    record(target, 'GET', file, line, 'link');
  }

  // A submit button can override its parent form with formAction/formMethod.
  // These actions are easy to miss in review because the form itself points elsewhere.
  for (const match of text.matchAll(/<(?:button|input)\b([\s\S]*?)>/g)) {
    const attrs = match[1];
    const literal = attrs.match(/\bformAction\s*=\s*"([^"]+)"/);
    const template = attrs.match(/\bformAction\s*=\s*\{`([^`]+)`\}/);
    const target = literal?.[1] || template?.[1];
    if (!target) continue;
    let inheritedMethod = 'GET';
    const lastFormStart = text.lastIndexOf('<form', match.index);
    const lastFormEnd = text.lastIndexOf('</form>', match.index);
    if (lastFormStart >= 0 && lastFormStart > lastFormEnd) {
      const formOpenEnd = text.indexOf('>', lastFormStart);
      const formAttrs = formOpenEnd > lastFormStart ? text.slice(lastFormStart, formOpenEnd + 1) : '';
      inheritedMethod = formAttrs.match(/\bmethod\s*=\s*"([^"]+)"/)?.[1] || inheritedMethod;
    }
    const method = (attrs.match(/\bformMethod\s*=\s*"([^"]+)"/)?.[1] || inheritedMethod).toUpperCase();
    const line = text.slice(0, match.index).split('\n').length;
    record(target, method, file, line, 'formAction');
  }

  for (const match of text.matchAll(/fetch\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)(?:\s*,\s*\{([\s\S]{0,700}?)\})?/g)) {
    const target = match[1] || match[2] || match[3] || '';
    if (!target.startsWith('/api/')) continue;
    const options = match[4] || '';
    const method = (options.match(/\bmethod\s*:\s*["']([A-Za-z]+)["']/)?.[1] || 'GET').toUpperCase();
    const line = text.slice(0, match.index).split('\n').length;
    record(target, method, file, line, 'fetch');
  }

  // Shared client helper used by several dashboard buttons. Keeping it in this
  // audit prevents actions hidden behind a wrapper from escaping route checks.
  for (const match of text.matchAll(/dashboardApiJson\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)(?:\s*,\s*\{([\s\S]{0,700}?)\})?/g)) {
    const target = match[1] || match[2] || match[3] || '';
    if (!target.startsWith('/api/')) continue;
    const options = match[4] || '';
    const method = (options.match(/\bmethod\s*:\s*["']([A-Za-z]+)["']/)?.[1] || 'GET').toUpperCase();
    const line = text.slice(0, match.index).split('\n').length;
    record(target, method, file, line, 'dashboardApiJson');
  }

  // Hard navigations to API handlers (logout fallbacks, downloads, OAuth).
  for (const match of text.matchAll(/window\.location\.(?:assign|replace)\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s*\)/g)) {
    const target = match[1] || match[2] || match[3] || '';
    if (!target.startsWith('/api/')) continue;
    const line = text.slice(0, match.index).split('\n').length;
    record(target, 'GET', file, line, 'navigation');
  }

  // Live-refresh widgets carry their request as a { url, method } config object.
  // Match the local pair instead of assuming GET for a URL literal.
  for (const match of text.matchAll(/\burl\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)[\s\S]{0,220}?\bmethod\s*:\s*["']([A-Za-z]+)["']/g)) {
    const target = match[1] || match[2] || match[3] || '';
    if (!target.startsWith('/api/')) continue;
    const method = String(match[4] || 'GET').toUpperCase();
    const line = text.slice(0, match.index).split('\n').length;
    record(target, method, file, line, 'request-config');
  }
}

// Catch API paths hidden behind local variables/ternaries. Method validation above
// remains authoritative where the call site is direct; this fallback at least makes
// sure a computed action cannot point at a route that does not exist.
const alreadyReferenced = new Set(checked.map((item) => normalizeTarget(item.target)));
for (const file of sourceFiles) {
  if (file.includes(`${path.sep}app${path.sep}api${path.sep}`) || file.endsWith(`${path.sep}proxy.ts`)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:["'](\/api\/[^"']+)["']|`(\/api\/[^`]+)`)/g)) {
    const target = match[1] || match[2] || '';
    let normalized = normalizeTarget(target);
    let route = matchRoute(normalized);
    // Nested template expressions (for example `${query ? `?${query}` : ""}`)
    // can defeat the simple normalizer. If everything before the expression is
    // already a complete API route, validate that stable prefix.
    if (!route && target.includes('${')) {
      const prefix = target.split('${', 1)[0].replace(/\?.*$/, '');
      if (prefix && matchRoute(prefix)) { normalized = prefix; route = matchRoute(prefix); }
    }
    if (!normalized.startsWith('/api/') || alreadyReferenced.has(normalized)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    record(route ? normalized : target, 'UNKNOWN', file, line, 'api-ref');
    alreadyReferenced.add(normalized);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[check-actions:error] ${failure}`);
  process.exit(1);
}
console.log(`[check-actions] OK — ${checked.length} site/API references checked against ${routes.length} API routes.`);
