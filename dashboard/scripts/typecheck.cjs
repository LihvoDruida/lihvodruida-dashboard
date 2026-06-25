#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const timeoutMs = Number.parseInt(process.env.TYPECHECK_TIMEOUT_MS || '180000', 10);
const heartbeatMs = Number.parseInt(process.env.TYPECHECK_HEARTBEAT_MS || '15000', 10);
const startedAt = performance.now();
const root = process.cwd();
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const command = process.execPath;
const args = [tscBin, '-p', 'tsconfig.typecheck.json', '--noEmit', '--pretty', 'false'];

if (!fs.existsSync(tscBin)) {
  console.error(`[typecheck] failed: TypeScript binary not found at ${tscBin}. Run npm install with dev dependencies before verify/build:ci.`);
  process.exit(1);
}

console.log(`[typecheck] start: ${command} ${args.join(' ')}`);

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
});

let finished = false;

const elapsedSeconds = () => Math.round((performance.now() - startedAt) / 1000);

const heartbeat = setInterval(() => {
  if (!finished) {
    console.log(`[typecheck] still running… ${elapsedSeconds()}s elapsed`);
  }
}, Math.max(5000, heartbeatMs));

const timeout = setTimeout(() => {
  if (finished) return;
  console.error(`[typecheck] failed: timeout after ${elapsedSeconds()}s. This usually means TypeScript scanned generated/cache files or the build machine is overloaded.`);
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!finished) child.kill('SIGKILL');
  }, 5000).unref();
}, Math.max(30000, timeoutMs));

child.on('error', (error) => {
  finished = true;
  clearInterval(heartbeat);
  clearTimeout(timeout);
  console.error('[typecheck] failed to start TypeScript:', error);
  process.exit(1);
});

child.on('close', (code, signal) => {
  finished = true;
  clearInterval(heartbeat);
  clearTimeout(timeout);
  if (signal) {
    console.error(`[typecheck] stopped by signal ${signal} after ${elapsedSeconds()}s`);
    process.exit(1);
  }
  if (code === 0) {
    console.log(`[typecheck] OK in ${elapsedSeconds()}s`);
    process.exit(0);
  }
  console.error(`[typecheck] failed with exit code ${code} after ${elapsedSeconds()}s`);
  process.exit(code || 1);
});
