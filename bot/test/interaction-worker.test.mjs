import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createInteractionWorker, wakeAfterInteractionAck } from "../src/interactionWorker.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));

await test("ACK callback starts work only after response finish, once", async () => {
  for (const type of [5, 6]) {
    const response = new EventEmitter(); let calls = 0;
    wakeAfterInteractionAck(response, { type }, () => { calls++; });
    assert.equal(calls, 0);
    response.emit("finish"); response.emit("finish");
    assert.equal(calls, 1);
  }
  for (const type of [1, 4, undefined]) {
    const response = new EventEmitter();
    wakeAfterInteractionAck(response, { type }, () => assert.fail("Unsupported response must not wake work"));
    response.emit("finish");
  }
});
await test("busy queue drains consecutive jobs without waiting for a polling timer", async () => {
  const pending = [1, 2, 3, 4, 5]; const processed = [];
  const worker = createInteractionWorker(async () => {
    const job = pending.shift(); if (!job) return false; processed.push(job); return true;
  });
  await worker.drain(); assert.deepEqual(processed, [1, 2, 3, 4, 5]);
});
await test("concurrent wakes do not create overlapping workers", async () => {
  let active = 0, maxActive = 0, checks = 0;
  const worker = createInteractionWorker(async () => {
    active++; maxActive = Math.max(maxActive, active); checks++; await tick(); active--; return checks < 3;
  });
  await Promise.all(Array.from({ length: 30 }, () => worker.drain()));
  assert.equal(maxActive, 1); assert.equal(checks, 3);
});
await test("wake arriving during an empty in-flight read is not lost", async () => {
  let release, checks = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const worker = createInteractionWorker(async () => { checks++; if (checks === 1) await blocked; return false; });
  const running = worker.drain(); await tick(); worker.drain(); release(); await running;
  assert.equal(checks, 2);
});
await test("large backlog yields to HTTP then continues without the recovery interval", async () => {
  let pending = 25, processed = 0;
  const worker = createInteractionWorker(async () => { if (!pending) return false; pending--; processed++; return true; });
  await worker.drain(); assert.equal(processed, 10);
  for (let n = 0; n < 4 && pending; n++) await tick();
  assert.equal(processed, 25);
});
await test("worker failure ends its pass and a later wake recovers without spinning", async () => {
  let checks = 0, errors = 0;
  const worker = createInteractionWorker(async () => { checks++; if (checks === 1) throw Error("offline"); return false; }, { onError: () => errors++ });
  await worker.drain(); await tick(); assert.equal(checks, 1); assert.equal(errors, 1);
  await worker.drain(); assert.equal(checks, 2);
});
