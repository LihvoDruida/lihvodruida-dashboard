/** Keep every I/O slot busy without a barrier between fixed-size batches. */
export async function settleWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency = 2,
): Promise<PromiseSettledResult<R>[]> {
  const width = Number.isFinite(concurrency) ? Math.max(1, Math.min(8, Math.floor(concurrency))) : 2;
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: "fulfilled", value: await mapper(items[index], index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => worker()));
  return results;
}
