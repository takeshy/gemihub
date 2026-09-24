// Sync meta service - manages remote sync metadata for push/pull synchronization
// Also serves as the file registry for flat Drive storage.
//
// Reading, duplicate consolidation, reconciliation and writing of
// `_sync-meta.json` are shared with Obsidian and Desktop through
// gemihub-sync-core; this module binds them to GemiHub's Drive functions and
// keeps the existing function names.

import {
  listUserFiles,
  getFileMetadata,
  readFile,
  createFile,
  createFileBinary,
  updateFile,
  findFilesByExactName,
  deleteFile,
  ensureSubFolder,
  type DriveFile,
} from "./google-drive.server";
import { publicFilePath } from "./public-link.server";
import {
  addUntrackedFilesToSyncMeta,
  isFileRemovedFromSyncRoot,
  mergeSyncMetaSnapshots,
  pickSyncMetaToKeep,
  refreshDriftedSyncMetaEntries,
} from "gemihub-sync-core/protocol";
import {
  createSyncMetaStore,
  removeFilesFromMeta,
  upsertDriveFileInMeta,
} from "gemihub-sync-core/sync-meta";
import { buildConflictBackupName } from "gemihub-sync-core/conflict";

// Pure reconciliation helpers live in gemihub-sync-core; re-exported so
// existing imports keep working.
export {
  addUntrackedFilesToSyncMeta,
  isFileRemovedFromSyncRoot,
  mergeSyncMetaSnapshots,
  pickSyncMetaToKeep,
  refreshDriftedSyncMetaEntries,
};

export { SYNC_META_FILE_NAME, computeSyncDiff } from "./sync-diff";
export type { FileSyncMeta, SyncMeta, SyncDiff } from "./sync-diff";

import type { SyncMeta } from "./sync-diff";

interface SyncMetaOperationOptions {
  signal?: AbortSignal;
}

// Bound through this module's imports (not the shared client directly) so the
// store follows whatever google-drive.server provides, including test doubles.
const store = createSyncMetaStore({
  findFilesByExactName: (...args) => findFilesByExactName(...args),
  readFile: (...args) => readFile(...args),
  updateFile: (...args) => updateFile(...args),
  createFile: (...args) => createFile(...args),
  deleteFile: (...args) => deleteFile(...args),
  listUserFiles: (...args) => listUserFiles(...args),
  getFileMetadata: (...args) => getFileMetadata(...args),
});

/**
 * Find the single _sync-meta.json file in rootFolderId, merging and deleting
 * duplicates (concurrent writers can race findFileByExactName + createFile).
 */
export function findOrConsolidateSyncMetaFile(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<{ file: DriveFile | null; meta: SyncMeta | null }> {
  return store.findMetaFile(accessToken, rootFolderId, options);
}

/**
 * Read the remote sync meta file from the root folder
 */
export function readRemoteSyncMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta | null> {
  return store.read(accessToken, rootFolderId, options);
}

/**
 * Read sync metadata and reconcile entries against the actual Drive root:
 * missing entries are verified by ID before removal, drifted entries adopt
 * the Drive state, and untracked root files are registered. A missing or
 * unreadable meta is rebuilt from the listing.
 */
export async function readReconciledRemoteSyncMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  const { meta } = await readReconciledRemoteSyncMetaWithFile(accessToken, rootFolderId, options);
  return meta;
}

/**
 * Same as readReconciledRemoteSyncMeta, but also returns the Drive id of the
 * `_sync-meta.json` file found on the way.
 */
export async function readReconciledRemoteSyncMetaWithFile(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<{ meta: SyncMeta; syncMetaFileId: string | null }> {
  const { meta, fileId } = await store.readReconciled(accessToken, rootFolderId, options);
  return { meta: meta!, syncMetaFileId: fileId };
}

/**
 * Write the remote sync meta file to the root folder
 */
export async function writeRemoteSyncMeta(
  accessToken: string,
  rootFolderId: string,
  meta: SyncMeta,
  options: SyncMetaOperationOptions = {}
): Promise<void> {
  await store.write(accessToken, rootFolderId, meta, options);
}

/**
 * Get file list from meta (no Drive API listing needed)
 */
export async function getFileListFromMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<{ meta: SyncMeta; files: DriveFile[] }> {
  const meta = (await readRemoteSyncMeta(accessToken, rootFolderId, options))
    // First time or missing meta — rebuild from Drive API
    ?? (await rebuildSyncMeta(accessToken, rootFolderId, options));
  const files: DriveFile[] = Object.entries(meta.files).map(([id, f]) => ({
    id,
    name: f.name,
    mimeType: f.mimeType,
    md5Checksum: f.md5Checksum,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
    size: f.size,
  }));
  return { meta, files };
}

/**
 * Rebuild sync meta from Drive API (full scan), keeping registry-only fields
 * (shared, webViewLink, the signed publicPath) of files that still exist.
 */
export function rebuildSyncMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  return store.rebuild(accessToken, rootFolderId, options);
}

/**
 * Add or update a single file entry in meta
 */
export async function upsertFileInMeta(
  accessToken: string,
  rootFolderId: string,
  file: DriveFile,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  return upsertFilesInMeta(accessToken, rootFolderId, [file], options);
}

/**
 * Batch version of upsertFileInMeta: read meta once, apply all upserts, write once.
 * Callers that upload files concurrently MUST use this instead of racing
 * per-file upsertFileInMeta calls (last-writer-wins would clobber entries).
 * Publish state already recorded for a file is kept.
 */
export function upsertFilesInMeta(
  accessToken: string,
  rootFolderId: string,
  files: DriveFile[],
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  return store.update(accessToken, rootFolderId, (meta) => {
    for (const file of files) upsertDriveFileInMeta(meta, file);
  }, options);
}

/**
 * Remove a file entry from meta
 */
export function removeFileFromMeta(
  accessToken: string,
  rootFolderId: string,
  fileId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  return store.update(accessToken, rootFolderId, (meta) => {
    removeFilesFromMeta(meta, [fileId]);
  }, options);
}

/**
 * Batch-remove multiple file IDs from meta in a single read/write cycle.
 * Skips the write entirely when none of the ids are present.
 */
export async function removeFileIdsFromMeta(
  accessToken: string,
  rootFolderId: string,
  fileIds: string[],
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta | null> {
  if (fileIds.length === 0) return null;
  const existing = await readRemoteSyncMeta(accessToken, rootFolderId, options);
  if (!existing) return null;
  if (!removeFilesFromMeta(existing, fileIds)) return existing;
  await writeRemoteSyncMeta(accessToken, rootFolderId, existing, options);
  return existing;
}

/**
 * Save a conflict backup copy to the conflict folder.
 * Pass `encoding: "base64"` (with the original mimeType) for binary content so
 * the backup is written as a real binary file instead of base64 text.
 */
export async function saveConflictBackup(
  accessToken: string,
  rootFolderId: string,
  conflictFolderName: string,
  fileName: string,
  content: string,
  options: SyncMetaOperationOptions & { encoding?: "base64"; mimeType?: string } = {}
): Promise<void> {
  const folderId = await ensureSubFolder(accessToken, rootFolderId, conflictFolderName, options);
  // Shared, reversible name format: every client can restore it to its path.
  const backupName = buildConflictBackupName(fileName);
  if (options.encoding === "base64") {
    await createFileBinary(
      accessToken,
      backupName,
      Buffer.from(content, "base64"),
      folderId,
      options.mimeType || "application/octet-stream",
      options
    );
  } else {
    await createFile(accessToken, backupName, content, folderId, "text/plain", options);
  }
}

/**
 * Update the shared/webViewLink fields for a file in meta
 */
export function setFileSharedInMeta(
  accessToken: string,
  rootFolderId: string,
  fileId: string,
  shared: boolean,
  webViewLink?: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  return store.update(accessToken, rootFolderId, (meta) => {
    const entry = meta.files[fileId];
    if (!entry) return;
    entry.shared = shared;
    entry.webViewLink = shared ? webViewLink : undefined;
    // The public proxy refuses unsigned links for script-capable content, so
    // the signed path is minted here and travels with the meta to every device.
    entry.publicPath = shared ? publicFilePath(fileId, entry.name) : undefined;
  }, options);
}
