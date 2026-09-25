export async function parallelProcess<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/** Finish every item even when one fails, preserving input order. */
export function parallelProcessSettled<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5
): Promise<PromiseSettledResult<R>[]> {
  return parallelProcess(items, async (item): Promise<PromiseSettledResult<R>> => {
    try {
      return { status: "fulfilled", value: await fn(item) };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  }, concurrency);
}
