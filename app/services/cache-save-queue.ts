// Serialize browser cache writes for the same Drive file. Each save reads the
// previous content to build edit history, so overlapping saves can otherwise
// write an older snapshot last or build history from the wrong base.
const pending = new Map<string, Promise<void>>();

export function queueCacheSave(fileId: string, save: () => Promise<void>): Promise<void> {
  const previous = pending.get(fileId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(save);
  pending.set(fileId, current);
  void current.finally(() => {
    if (pending.get(fileId) === current) pending.delete(fileId);
  }).catch(() => {});
  return current;
}

export async function awaitPendingCacheSaves(): Promise<void> {
  // New saves can be queued while an earlier batch is settling.
  while (pending.size > 0) {
    await Promise.all([...pending.values()]);
  }
}
