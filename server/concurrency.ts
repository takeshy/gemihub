/** Stop scheduling after a failure, and drain in-flight work before releasing the caller's lock. */
export async function forEachConcurrent<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid concurrency limit");
  let next = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try { await work(items[index]); }
      catch (error) { failure ||= { error }; }
    }
  }));
  if (failure) throw failure.error;
}
