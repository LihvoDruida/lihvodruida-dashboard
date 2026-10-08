import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticRoleQueue } from '../src/staticRoleQueue.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const member = { guildId: '123456789012345678', userId: '223456789012345678' };

test('Static role: regrant while check is running is checked again without cooldown', async () => {
  const first = deferred(); let calls = 0;
  const queue = createStaticRoleQueue({ enforce: async () => { calls++; if (calls === 1) await first.promise; } });
  queue.enqueue(member); queue.enqueue(member); queue.enqueue(member);
  assert.equal(calls, 1); first.resolve(); await tick();
  assert.equal(calls, 2); assert.equal(queue.activeWorkers, 0); queue.stop();
});

test('Static role: failures retry with backoff and notify after final failure', async () => {
  let calls = 0, failures = 0; const delays = [];
  const queue = createStaticRoleQueue({ enforce: async () => { calls++; throw Error('unavailable'); }, delay: async ms => { delays.push(ms); }, onError: () => { failures++; } });
  queue.enqueue(member); await tick();
  assert.equal(calls, 3); assert.equal(failures, 1); assert.deepEqual(delays, [500, 1000]); queue.stop();
});

test('Static role: retry can succeed without final failure', async () => {
  let calls = 0, successes = 0, failures = 0;
  const queue = createStaticRoleQueue({ enforce: async () => { if (++calls === 1) throw Error('unavailable'); return { revoked: 1 }; }, delay: async () => {}, onResult: () => successes++, onError: () => failures++ });
  queue.enqueue(member); await tick();
  assert.equal(calls, 2); assert.equal(successes, 1); assert.equal(failures, 0); queue.stop();
});

test('Static role: bounded queue coalesces pending member and reports overflow', async () => {
  const first = deferred(); const seen = [], overflow = [];
  const queue = createStaticRoleQueue({ workers: 1, maxQueue: 1, enforce: async x => { seen.push(x.userId); if (seen.length === 1) await first.promise; }, onOverflow: x => overflow.push(x) });
  queue.enqueue(member);
  queue.enqueue({ ...member, userId: '3' }); queue.enqueue({ ...member, userId: '3' });
  assert.equal(queue.size, 1); queue.enqueue({ ...member, userId: '4' });
  assert.deepEqual(overflow, ['3']); assert.equal(queue.size, 1);
  first.resolve(); await tick(); assert.deepEqual(seen, [member.userId, '4']); queue.stop();
});

test('Static role: stop discards pending checks and ignores new events', async () => {
  const first = deferred(); let calls = 0;
  const queue = createStaticRoleQueue({ workers: 1, enforce: async () => { calls++; await first.promise; } });
  queue.enqueue(member); queue.enqueue({ ...member, userId: '3' }); queue.stop(); queue.enqueue(member);
  first.resolve(); await tick(); assert.equal(calls, 1); assert.equal(queue.size, 0);
});
