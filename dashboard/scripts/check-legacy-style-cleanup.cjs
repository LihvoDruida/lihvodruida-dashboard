#!/usr/bin/env node
'use strict';

// Regression: unpacking a new release over a dirty checkout must not make
// Docker build:ci fail because retired, unimported styles survived on disk.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
const retired = ['accessibility.css', 'cascade.css', 'responsive.css'];
const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
const dockerignore = fs.readFileSync(path.join(repo, '.dockerignore'), 'utf8');
for (const name of retired) {
  assert(!layout.includes(name), `Retired CSS is imported by layout: ${name}`);
  assert(dockerignore.split(/\r?\n/).includes(`dashboard/src/app/styles/${name}`), `Missing .dockerignore rule: ${name}`);
  assert(!fs.existsSync(path.join(root, 'src/app/styles', name)), `Orphan CSS still present after cleanup: ${name}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-legacy-css-'));
try {
  const scriptDir = path.join(tmp, 'scripts');
  const stylesDir = path.join(tmp, 'src/app/styles');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(stylesDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'cleanup-legacy.cjs'), path.join(scriptDir, 'cleanup-legacy.cjs'));
  for (const name of retired) fs.writeFileSync(path.join(stylesDir, name), '/* stale */\n');
  fs.writeFileSync(path.join(stylesDir, 'base.css'), '/* live theme */\n');
  fs.writeFileSync(path.join(stylesDir, 'custom-future.css'), '/* unrelated file */\n');
  execFileSync(process.execPath, [path.join(scriptDir, 'cleanup-legacy.cjs')], { stdio: 'pipe' });
  for (const name of retired) assert(!fs.existsSync(path.join(stylesDir, name)), `Cleanup missed ${name}`);
  for (const name of ['base.css', 'custom-future.css']) {
    assert(fs.existsSync(path.join(stylesDir, name)), `Cleanup removed a non-retired stylesheet: ${name}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('[check-legacy-style-cleanup] OK — retired layers are excluded and cleaned without touching active styles.');
