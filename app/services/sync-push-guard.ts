export interface PushSnapshotEntry {
  name?: string;
  md5Checksum?: string;
  modifiedTime?: string;
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
