import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoalescingQueue } from '../src/coalescingQueue.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('member event burst respects concurrency, capacity and per-member coalescing', async () => {
  const releases = []; const seen = [];
  const queue = createCoalescingQueue({ capacity: 3, workers: 1, run: async payload => { seen.push(payload); await new Promise(resolve => releases.push(resolve)); } });
  assert.equal(queue.enqueue('a', 'a'), true); await tick();
  assert.equal(queue.enqueue('b', 'old-b'), true); assert.equal(queue.enqueue('b', 'new-b'), true);
  assert.equal(queue.enqueue('c', 'c'), true); assert.equal(queue.enqueue('d', 'd'), false);
  assert.equal(queue.active, 1); assert.equal(queue.size, 2);
  releases.shift()(); await tick(); assert.deepEqual(seen, ['a', 'new-b']);
  releases.shift()(); await tick(); assert.deepEqual(seen, ['a', 'new-b', 'c']);
  releases.shift()(); await tick(); assert.equal(queue.active, 0); assert.equal(queue.size, 0);
});
test('failed jobs release slots and shutdown drops queued work', async () => {
  let release; let failures = 0; const seen = [];
  const queue = createCoalescingQueue({ capacity: 4, workers: 1, run: async item => { seen.push(item); if (item === 'bad') throw Error('failed'); await new Promise(resolve => { release = resolve; }); }, onError: () => { failures++; } });
  queue.enqueue('bad', 'bad'); queue.enqueue('waiting', 'waiting'); queue.enqueue('drop', 'drop'); await tick();
  assert.equal(failures, 1); assert.equal(queue.active, 1); queue.stop(); assert.equal(queue.size, 0); assert.equal(queue.enqueue('new', 'new'), false);
  release(); await tick(); assert.deepEqual(seen, ['bad', 'waiting']); assert.equal(queue.active, 0);
  queue.start(); assert.equal(queue.enqueue('restart', 'restart'), true); await tick(); release(); await tick(); assert.equal(queue.active, 0);
});
