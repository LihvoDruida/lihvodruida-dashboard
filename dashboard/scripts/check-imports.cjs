#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const failures = [];
let checked = 0;

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

function resolves(base) {
  for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']) {
    const candidate = `${base}${suffix}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
  }
  for (const name of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
    if (fs.existsSync(path.join(base, name))) return true;
  }
  return false;
}

const files = walk(srcRoot).filter((file) => /\.(?:ts|tsx|js|jsx)$/.test(file));
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const imports = /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\()\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(imports)) {
    const specifier = match[1];
    let base = null;
    if (specifier.startsWith('@/')) base = path.join(srcRoot, specifier.slice(2));
    else if (specifier.startsWith('./') || specifier.startsWith('../')) base = path.resolve(path.dirname(file), specifier);
    else continue;
    checked += 1;
    if (!resolves(base)) failures.push(`${path.relative(root, file)} -> ${specifier}`);
  }
}

const sharedPackage = path.resolve(root, '..', 'shared', 'package.json');
if (!fs.existsSync(sharedPackage)) failures.push('../shared/package.json відсутній, але dashboard очікує file:../shared.');

if (failures.length) {
  for (const failure of failures) console.error(`[check-imports:error] ${failure}`);
  process.exit(1);
}
console.log(`[check-imports] OK — ${checked} local import/export refs checked across ${files.length} source files.`);
