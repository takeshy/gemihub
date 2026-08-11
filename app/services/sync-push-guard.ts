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
