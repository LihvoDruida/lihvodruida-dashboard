/** Bounded reconciliation queue; events arriving during a check always run again. */
export function createStaticRoleQueue({ enforce, onResult = () => {}, onError = () => {}, onOverflow = () => {}, maxQueue = 250, workers = 2, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const pending = new Map();
  const active = new Map();
  let stopped = false;

  async function process(item) {
    try {
      do {
        item.dirty = false;
        for (let attempt = 1; attempt <= 3 && !stopped; attempt++) {
          try {
            const result = await enforce({ guildId: item.guildId, userId: item.userId });
            onResult(result, item);
            break;
          } catch (error) {
            if (attempt === 3) onError(error, item);
            else await delay(500 * (2 ** (attempt - 1)));
          }
        }
      } while (!stopped && item.dirty);
    } finally {
      active.delete(item.userId);
      pump();
    }
  }

  function pump() {
    while (!stopped && active.size < workers && pending.size) {
      const [userId, item] = pending.entries().next().value;
      pending.delete(userId);
      active.set(userId, item);
      void process(item);
    }
  }

  return {
    enqueue({ guildId, userId }) {
      if (stopped) return;
      const running = active.get(userId);
      if (running) { running.dirty = true; return; }
      if (pending.has(userId)) return;
      if (pending.size >= maxQueue) {
        const oldest = pending.keys().next().value;
        pending.delete(oldest);
        onOverflow(oldest);
      }
      pending.set(userId, { guildId, userId, dirty: false });
      pump();
    },
    stop() { stopped = true; pending.clear(); },
    get size() { return pending.size; },
    get activeWorkers() { return active.size; },
  };
}
