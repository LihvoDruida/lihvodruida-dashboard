#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const appRoot = path.join(srcRoot, 'app');
const failures = [];
const checkedNavigation = [];
let buttonCount = 0;

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

function routeRegex(route) {
  if (route === '/') return /^\/$/;
  const parts = route.split('/').filter(Boolean).map((part) => {
    if (/^\[\[\.\.\..+\]\]$/.test(part)) return '(?:.*)?';
    if (/^\[\.\.\..+\]$/.test(part)) return '.+';
    if (/^\[.+\]$/.test(part)) return '[^/]+';
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(`^/${parts.join('/')}/?$`);
}

const pages = walk(appRoot)
  .filter((file) => file.endsWith(`${path.sep}page.tsx`) || file.endsWith(`${path.sep}page.ts`))
  .map((file) => ({ route: routeFromPage(file), regex: routeRegex(routeFromPage(file)), file }));

function normalizeTarget(raw) {
  let target = String(raw || '').trim();
  if (!target.startsWith('/') || target.startsWith('//')) return '';
  target = target.replace(/\$\{[^}]+\}/g, 'dynamic');
  target = target.split('#', 1)[0].split('?', 1)[0] || '/';
  return target;
}

function publicFileExists(target) {
  if (!target || target === '/') return false;
  return fs.existsSync(path.join(root, 'public', target.replace(/^\/+/, '')));
}

function pageExists(target) {
  return pages.some((page) => page.regex.test(target));
}

function recordNavigation(raw, file, line, kind) {
  const target = normalizeTarget(raw);
  if (!target || target.startsWith('/api/')) return;
  if (target.startsWith('/_next/') || publicFileExists(target)) return;
  checkedNavigation.push({ target, file, line, kind });
  if (!pageExists(target)) failures.push(`${kind} ${raw} у ${path.relative(root, file)}:${line} не має page route.`);
}

// Читає JSX opening tag без помилки на `>=`, `=>` та інших `>` усередині {...}.
function openingTags(text, tagName) {
  const out = [];
  let from = 0;
  const needle = `<${tagName}`;
  while (true) {
    const start = text.indexOf(needle, from);
    if (start < 0) break;
    const after = text[start + needle.length] || '';
    if (/[A-Za-z0-9:_-]/.test(after)) { from = start + needle.length; continue; }
    let braces = 0;
    let quote = null;
    let i = start + needle.length;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') { braces += 1; continue; }
      if (ch === '}') { braces = Math.max(0, braces - 1); continue; }
      if (ch === '>' && braces === 0) break;
    }
    if (i < text.length) out.push({ start, text: text.slice(start, i + 1) });
    from = Math.max(i + 1, start + needle.length);
  }
  return out;
}

const sourceFiles = walk(srcRoot).filter((file) => /\.(tsx?|jsx?|mjs|cjs)$/.test(file));
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const lineAt = (index) => text.slice(0, index).split('\n').length;

  const patterns = [
    ['href', /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|\{`([^`]+)`\})/g],
    ['nav-href', /\bhref\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g],
    ['redirect', /\bredirect\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g],
    ['router', /\brouter\.(?:push|replace)\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g],
    ['navigation', /\bwindow\.location\.(?:assign|replace)\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g],
  ];

  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      recordNavigation(match[1] || match[2] || match[3] || '', file, lineAt(match.index), kind);
    }
  }

  for (const tag of openingTags(text, 'button')) {
    buttonCount += 1;
    const type = (tag.text.match(/\btype\s*=\s*["']([^"']+)["']/)?.[1] || '').toLowerCase();
    if (type !== 'button') continue;
    if (/\bonClick\s*=|\bformAction\s*=|\bonPointer\w*\s*=|\bonMouse\w*\s*=/.test(tag.text)) continue;
    const className = tag.text.match(/\bclassName\s*=\s*["']([^"']+)["']/)?.[1] || '';
    const domHook = ['nav-account__btn', 'nav-burger', 'dashboard-nav-measure__more'].some((name) => className.includes(name));
    if (!domHook) failures.push(`button type=button без handler/formAction у ${path.relative(root, file)}:${lineAt(tag.start)}.`);
  }
}

const authPath = path.join(srcRoot, 'lib', 'auth.ts');
if (fs.existsSync(authPath)) {
  const authText = fs.readFileSync(authPath, 'utf8');
  if (!/useSecureAuthCookies[\s\S]{0,180}NODE_ENV === ["']production["']/.test(authText)) {
    failures.push('auth має використовувати non-Secure legacy cookie names у development, інакше HTTP 0.0.0.0 губить OAuth/session cookies.');
  }
}

const securityPath = path.join(srcRoot, 'lib', 'security.ts');
if (fs.existsSync(securityPath)) {
  const securityText = fs.readFileSync(securityPath, 'utf8');
  if (!/isLocalHost[\s\S]{0,700}normalized === ["']0\.0\.0\.0["']/.test(securityText)) {
    failures.push('security.isLocalHost має дозволяти точний 0.0.0.0 у development, інакше локальні POST Origin/Referer відхиляються.');
  }
  if (/startsWith\(["'](?:localhost|127\.0\.0\.1|0\.0\.0\.0)["']\)/.test(securityText)) {
    failures.push('security.isLocalHost не повинен довіряти довільним host-ам лише за prefix (наприклад localhost.evil).');
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[check-site:error] ${failure}`);
  process.exit(1);
}
console.log(`[check-site] OK — ${pages.length} page routes, ${checkedNavigation.length} internal navigation refs, ${buttonCount} buttons checked.`);
