/** Bound event bursts and coalesce repeated updates for the same member. */
export function createCoalescingQueue({ capacity = 250, workers = 2, run, onError = () => {} }) {
  const max = Math.max(1, Math.floor(Number(capacity) || 250));
  const concurrency = Math.max(1, Math.min(4, Math.floor(Number(workers) || 2)));
  const pending = new Map();
  const active = new Set();
  let stopped = false;
  function drain() {
    if (stopped) return;
    while (active.size < concurrency) {
      let next;
      for (const entry of pending) { if (!active.has(entry[0])) { next = entry; break; } }
      if (!next) break;
      const [key, payload] = next;
      pending.delete(key);
      active.add(key);
      Promise.resolve().then(() => run(payload)).catch(error => onError(error, payload)).finally(() => { active.delete(key); drain(); });
    }
  }
  return {
    enqueue(key, payload) {
      if (stopped || (!pending.has(key) && pending.size + active.size >= max)) return false;
      pending.set(key, payload);
      drain();
      return true;
    },
    start() { stopped = false; drain(); },
    stop() { stopped = true; pending.clear(); },
    get size() { return pending.size; },
    get active() { return active.size; },
  };
}
