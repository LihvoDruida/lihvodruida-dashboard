#!/usr/bin/env node
// Runtime automation contract: the cron container supervises itself and reports
// health, and `make deploy` applies bind-mounted cron / nginx changes, the DB
// schema and waits for every long-running service before declaring success.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks += 1; };

const compose = read('docker-compose.yml');
const cronService = compose.slice(compose.indexOf('\n  cron:'), compose.indexOf('\n  certbot:'));
const nginxService = compose.slice(compose.indexOf('\n  nginx:'), compose.indexOf('\n  bot:'));
check(/\n    init: true/.test(cronService), 'cron runs under tini so finished workers are reaped');
check(cronService.includes('/opt/cron/healthcheck.sh') && cronService.includes('./deploy/cron/healthcheck.sh:/opt/cron/healthcheck.sh:ro'), 'cron has a heartbeat healthcheck mounted read-only');
check(nginxService.includes('healthcheck:') && nginxService.includes('127.0.0.1:8081/nginx-health'), 'nginx has a loopback healthcheck');
const nginxConf = read('deploy/nginx/nginx.conf');
check(/listen 127\.0\.0\.1:8081;[\s\S]{0,80}location = \/nginx-health \{ return 204; \}/.test(nginxConf), 'nginx health endpoint listens on loopback only');

const cron = read('deploy/cron/run-cron.sh');
check(!/^set -e/m.test(cron), 'dispatcher loop is not killed by one failing command');
check(cron.includes('( /bin/sh "${CRON_WORKER_PATH:-/opt/cron/run-job.sh}"') && cron.includes('& ) ||'), 'workers are double-forked away from the dispatcher');
check(cron.includes('beat dispatcher') && cron.includes('beat cleanup'), 'both loops write heartbeats');
check(cron.includes('kill -0 "$cleanup_pid"') && cron.includes('start_cleanup_loop'), 'dispatcher restarts a dead cleanup loop');

const deploy = read('deploy/scripts/deploy.sh');
const order = (a, b) => deploy.indexOf(a) >= 0 && deploy.indexOf(b) > deploy.indexOf(a);
check(deploy.includes('exec env MISTBLOSSOM_DEPLOY_PULLED=1 bash deploy/scripts/deploy.sh'), 'deploy re-executes itself after pulling a newer deploy.sh');
check(order('git pull --ff-only', 'docker tag "$DASHBOARD_IMAGE"'), 'code is pulled before rollback images are tagged');
check(order('--entrypoint nginx nginx -t', '$COMPOSE up -d --remove-orphans --no-build'), 'new nginx config is validated before the stack switches');
check(order('ON_ERROR_STOP=1', '$COMPOSE up -d --remove-orphans --no-build'), 'schema is applied with ON_ERROR_STOP before the new dashboard starts');
check(deploy.includes('--force-recreate cron') && deploy.includes('nginx -s reload'), 'bind-mounted cron scripts and nginx configs are applied');
check(/for service in nginx cron; do\s+if ! wait_service "\$service"/.test(deploy), 'deploy waits for nginx and cron health');
check(/exited\|dead\|unhealthy\|missing\)/.test(deploy), 'unhealthy services fail fast instead of waiting for the timeout');

// Real healthcheck script against controlled heartbeat files.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-automation-'));
try {
  const health = (files) => {
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(temp, `${name}.alive`), String(value));
    return spawnSync('sh', [path.join(repo, 'deploy/cron/healthcheck.sh')], { env: { ...process.env, CRON_STATE_DIR: temp } }).status;
  };
  const now = Math.floor(Date.now() / 1000);
  check(health({}) === 1, 'missing heartbeat is unhealthy');
  check(health({ dispatcher: now, cleanup: now }) === 0, 'fresh heartbeats are healthy');
  check(health({ dispatcher: now, cleanup: now - 600 }) === 1, 'stale cleanup heartbeat is unhealthy');
  check(health({ dispatcher: 'garbage', cleanup: now }) === 1, 'corrupt heartbeat is unhealthy');

  // Real dispatcher: a failing worker never stops the loop, heartbeats appear.
  const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
  const worker = path.join(bin, 'worker');
  fs.writeFileSync(worker, '#!/bin/sh\necho "$3" >> "$DISPATCH_CALLS"\nexit 7\n'); fs.chmodSync(worker, 0o755);
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\n/bin/sleep 0.1\n'); fs.chmodSync(path.join(bin, 'sleep'), 0o755);
  const calls = path.join(temp, 'calls');
  const state = path.join(temp, 'state');
  const run = spawnSync('timeout', ['1.5', 'sh', path.join(repo, 'deploy/cron/run-cron.sh')], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CRON_WORKER_PATH: worker, CRON_STATE_DIR: state, DISPATCH_CALLS: calls, INTERNAL_CRON_TOKEN: 'test-token-never-output' }, timeout: 5000,
  });
  check(run.status === 124, 'dispatcher keeps running despite failing workers');
  check(fs.existsSync(path.join(state, 'dispatcher.alive')) && fs.existsSync(path.join(state, 'cleanup.alive')), 'dispatcher writes both heartbeats');
  const keys = fs.readFileSync(calls, 'utf8').trim().split('\n');
  check(keys.filter((k) => k === 'member-cleanup').length >= 3 && keys.includes('guild-sync'), 'cleanup and minute jobs continue after worker failures');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

console.log(`[check-runtime-automation] OK — ${checks} cron supervision, healthcheck and deploy checks.`);
