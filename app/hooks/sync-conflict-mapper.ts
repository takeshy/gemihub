/**
 * Pure helper that maps the GCS-era StorageSyncConflict / editDeleteConflict
 * shapes into the legacy ConflictInfo shape that the existing UI components
 * (ConflictDialog, SyncStatusBar, Header) consume.
 *
 * Lives outside the hook so it can be unit-tested without React.
 */

import type { StorageSyncConflict, StorageSyncDiff } from "~/services/sync-diff-storage";
import type { ConflictInfo } from "~/hooks/useSync";

/** Get the basename of a path: "a/b/c.md" → "c.md". */
function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Convert a StorageSyncConflict to a ConflictInfo.
 *   - fileId      → the relativePath (the IDE treats fileIds as opaque keys)
 *   - fileName    → basename of the path
 *   - localChecksum / remoteChecksum → md5 hashes
 *   - timestamps unavailable from a pure conflict; left as empty strings
 *     (callers that have remote-snapshot context can fill them in)
 */
export function mapStorageConflictToLegacy(conflict: StorageSyncConflict): ConflictInfo {
  return {
    fileId: conflict.objectPath,
    fileName: basename(conflict.objectPath),
    localChecksum: conflict.localMd5,
    remoteChecksum: conflict.remoteMd5,
    localModifiedTime: "",
    remoteModifiedTime: "",
  };
}

/** Convert a StorageSyncDiff's edit-delete entries into ConflictInfo[]. */
export function mapEditDeleteConflictsToLegacy(diff: StorageSyncDiff): ConflictInfo[] {
  return diff.editDeleteConflicts.map((path) => ({
    fileId: path,
    fileName: basename(path),
    localChecksum: "",
    remoteChecksum: "",
    localModifiedTime: "",
    remoteModifiedTime: "",
    isEditDelete: true,
  }));
}

/** Combine both conflict types into one list, suitable for `conflicts: ConflictInfo[]`. */
export function diffToLegacyConflicts(diff: StorageSyncDiff): ConflictInfo[] {
  return [
    ...diff.conflicts.map(mapStorageConflictToLegacy),
    ...mapEditDeleteConflictsToLegacy(diff),
  ];
}
