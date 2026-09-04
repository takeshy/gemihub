export interface PushSnapshotEntry {
  name?: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

export function indexUniqueRemotePaths<T extends { id: string; name: string }>(files: T[]): {
  byPath: Map<string, T>;
  duplicates: string[];
} {
  const byPath = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const file of files) {
    if (byPath.has(file.name)) duplicates.add(file.name);
    else byPath.set(file.name, file);
  }
  return { byPath, duplicates: [...duplicates].sort((a, b) => a.localeCompare(b)) };
}

/** True when Drive changed after the client performed its push preflight. */
export function remoteChangedSincePushSnapshot(
  expected: PushSnapshotEntry | undefined,
  current: PushSnapshotEntry,
): boolean {
  if (!expected) return false;

  const expectedName = expected.name?.toLowerCase();
  const currentName = current.name?.toLowerCase();
  if (expectedName && currentName && expectedName !== currentName) return true;

  if (expected.md5Checksum && current.md5Checksum) {
    return expected.md5Checksum !== current.md5Checksum;
  }

  return Boolean(
    expected.modifiedTime
    && current.modifiedTime
    && expected.modifiedTime !== current.modifiedTime,
  );
}

/**
 * Pending soft deletions whose Drive file changed after the deletion was
 * queued. The queued deletion loses: the remote edit is newer than the local
 * decision, so the reservation must be cancelled and the file must surface as
 * a pending pull again instead of staying hidden behind the deletion filter.
 */
export function findPendingDeletionsChangedOnRemote(
  pendingFileIds: Iterable<string>,
  localFiles: Record<string, PushSnapshotEntry | undefined>,
  remoteFiles: Record<string, PushSnapshotEntry | undefined>,
): string[] {
  const cancelled: string[] = [];
  for (const id of pendingFileIds) {
    const base = localFiles[id];
    const current = remoteFiles[id];
    // No base revision (never synced) or gone from remote: the deletion stands.
    if (!base || !current) continue;
    if (remoteChangedSincePushSnapshot(base, current)) cancelled.push(id);
  }
  return cancelled;
}
