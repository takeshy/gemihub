// Pure sync diff types and computation — shared between server and client.

export const SYNC_META_FILE_NAME = "_sync-meta.json";

export interface FileSyncMeta {
  name: string;
  mimeType: string;
  md5Checksum: string;
  modifiedTime: string;
  createdTime?: string;
  shared?: boolean;
  webViewLink?: string;
}

export interface SyncMeta {
  lastUpdatedAt: string;
  files: Record<string, FileSyncMeta>; // key = fileId
}

export interface SyncDiff {
  toPush: string[]; // locally changed file IDs
  toPull: string[]; // remotely changed file IDs
  conflicts: Array<{
    fileId: string;
    fileName: string;
    localChecksum: string;
    remoteChecksum: string;
    localModifiedTime: string;
    remoteModifiedTime: string;
  }>;
  editDeleteConflicts: string[]; // locally edited but remotely deleted file IDs
  localOnly: string[]; // exists only locally
  remoteOnly: string[]; // exists only remotely
}

/** Minimal shape accepted as localMeta (LocalSyncMeta is a superset) */
type SyncMetaLike = { files: Record<string, { md5Checksum: string; modifiedTime: string; name?: string }> } | null;

/**
 * Compute sync diff by comparing two metadata snapshots:
 *   localMeta: client's snapshot from last sync (IndexedDB)
 *   remoteMeta: server's current snapshot (_sync-meta.json)
 *   locallyModifiedFileIds: file IDs edited locally (from editHistory)
 *
 * - localChanged = file has local edits (in locallyModifiedFileIds)
 * - remoteChanged = remote meta differs from local meta (another device pushed)
 */
export function computeSyncDiff(
  localMeta: SyncMetaLike,
  remoteMeta: SyncMeta | null,
  locallyModifiedFileIds: Set<string> = new Set()
): SyncDiff {
  const localFiles = localMeta?.files ?? {};
  const remoteFiles = remoteMeta?.files ?? {};

  // System files to exclude from sync diff
  const SYSTEM_FILE_NAMES = new Set([SYNC_META_FILE_NAME, "settings.json"]);

  const toPush: string[] = [];
  const toPull: string[] = [];
  const conflicts: SyncDiff["conflicts"] = [];
  const editDeleteConflicts: string[] = [];
  const localOnly: string[] = [];
  const remoteOnly: string[] = [];

  // Collect all known file IDs
  const allFileIds = new Set<string>();
  for (const id of Object.keys(localFiles)) allFileIds.add(id);
  for (const [id, f] of Object.entries(remoteFiles)) {
    if (!SYSTEM_FILE_NAMES.has(f.name)) allFileIds.add(id);
  }
  for (const id of locallyModifiedFileIds) allFileIds.add(id);

  for (const fileId of allFileIds) {
    const local = localFiles[fileId];
    const remote = remoteFiles[fileId];
    const locallyModified = locallyModifiedFileIds.has(fileId);
    const hasLocal = !!local || locallyModified;
    const hasRemote = !!remote;

    const localChanged = locallyModified;
    const remoteChanged = local && remote
      ? local.md5Checksum !== remote.md5Checksum
        || (local.name != null && local.name !== remote.name)
      : false;

    if (hasLocal && !hasRemote) {
      // Locally edited + previously synced + remotely deleted = edit-delete conflict
      if (locallyModified && local) {
        editDeleteConflicts.push(fileId);
      } else {
        localOnly.push(fileId);
      }
    } else if (!hasLocal && hasRemote) {
      remoteOnly.push(fileId);
    } else if (localChanged && remoteChanged) {
      conflicts.push({
        fileId,
        fileName: remote?.name ?? fileId,
        localChecksum: local?.md5Checksum ?? "",
        remoteChecksum: remote?.md5Checksum ?? "",
        localModifiedTime: local?.modifiedTime ?? "",
        remoteModifiedTime: remote?.modifiedTime ?? "",
      });
    } else if (localChanged) {
      toPush.push(fileId);
    } else if (remoteChanged) {
      toPull.push(fileId);
    }
  }

  return { toPush, toPull, conflicts, editDeleteConflicts, localOnly, remoteOnly };
}
