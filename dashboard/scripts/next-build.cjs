#!/usr/bin/env node
'use strict';

/*
 * Stable Next.js production build wrapper.
 *
 * Why this exists:
 * - Vercel/Linux builds do not need Next telemetry.
 * - In this project, telemetry-enabled Next 16/Turbopack builds can stay alive
 *   after route output in restricted CI/sandbox environments.
 * - A bounded build timeout gives CI a clear failure instead of an endless Vercel job.
 * - Keeping this wrapper cross-platform avoids shell-only
 *   `NEXT_TELEMETRY_DISABLED=1 next build` syntax.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = process.cwd();
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const timeoutMs = Number.parseInt(process.env.NEXT_BUILD_TIMEOUT_MS || '600000', 10);
const heartbeatMs = Number.parseInt(process.env.NEXT_BUILD_HEARTBEAT_MS || '30000', 10);

if (!fs.existsSync(nextBin)) {
  console.error(`[next-build] failed: Next.js binary not found at ${nextBin}. Run npm ci before building.`);
  process.exit(1);
}

function removeStaleBuildLocks() {
  // Keep the useful Next cache, but remove tiny marker files that can be restored
  // by deployment caches and confuse Turbopack after interrupted builds.
  for (const relativePath of ['.next/turbopack']) {
    const absolutePath = path.join(root, relativePath);
    if (fs.existsSync(absolutePath)) fs.rmSync(absolutePath, { recursive: true, force: true });
  }
}

function runBuild() {
  removeStaleBuildLocks();

  const startedAt = performance.now();
  const elapsedSeconds = () => Math.round((performance.now() - startedAt) / 1000);
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
  };

  const child = spawn(process.execPath, [nextBin, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env,
  });

  let finished = false;
  const heartbeat = setInterval(() => {
    if (!finished) console.log(`[next-build] still running… ${elapsedSeconds()}s elapsed`);
  }, Math.max(10000, heartbeatMs));

  const timeout = setTimeout(() => {
    if (finished) return;
    console.error(`[next-build] failed: timeout after ${elapsedSeconds()}s. Next/Turbopack did not finish cleanly.`);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!finished) child.kill('SIGKILL');
    }, 5000).unref();
  }, Math.max(60000, timeoutMs));

  child.on('error', (error) => {
    finished = true;
    clearInterval(heartbeat);
    clearTimeout(timeout);
    console.error('[next-build] failed to start Next.js build:', error);
    process.exit(1);
  });

  child.on('close', (code, signal) => {
    finished = true;
    clearInterval(heartbeat);
    clearTimeout(timeout);

    if (signal) {
      console.error(`[next-build] stopped by signal ${signal} after ${elapsedSeconds()}s`);
      process.exit(1);
    }

    if (code === 0) {
      console.log(`[next-build] OK in ${elapsedSeconds()}s`);
      process.exit(0);
    }

    console.error(`[next-build] failed with exit code ${code} after ${elapsedSeconds()}s`);
    process.exit(code || 1);
  });
}

runBuild();
