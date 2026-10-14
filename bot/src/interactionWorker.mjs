// Wake-ups remove idle polling delays. Actions still use durable queue leases.
export function createInteractionWorker(runOnce, { maxPasses = 10, onError = () => {} } = {}) {
  let running = null;
  let requested = false;
  let continuation = null;
  function drain() {
    requested = true;
    if (running) return running;
    if (continuation) { clearImmediate(continuation); continuation = null; }
    running = Promise.resolve().then(async () => {
      for (let pass = 0; pass < maxPasses; pass++) {
        requested = false;
        let worked;
        try { worked = await runOnce(); }
        catch (error) { requested = false; onError(error); return; }
        if (!worked && !requested) return;
      }
      // Yield to ACKs/HTTP, then continue a busy queue without an idle gap.
      requested = true;
    }).finally(() => {
      running = null;
      if (requested) continuation = setImmediate(() => { continuation = null; void drain(); });
    });
    return running;
  }
  return { drain };
}

// Register after the signed receipt is committed. The initial response never
// waits for business logic or webhook delivery.
export function wakeAfterInteractionAck(response, payload, wake) {
  if (payload?.type === 5 || payload?.type === 6) {
    response.once("finish", () => { void wake(); });
  }
}
