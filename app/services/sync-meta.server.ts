// Sync meta service - manages remote sync metadata for push/pull synchronization
// Also serves as the file registry for flat Drive storage.

import {
  listUserFiles,
  readFile,
  createFile,
  updateFile,
  findFileByExactName,
  ensureSubFolder,
  type DriveFile,
} from "./google-drive.server";

const SYNC_META_FILE = "_sync-meta.json";

interface SyncMetaOperationOptions {
  signal?: AbortSignal;
}

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
  localOnly: string[]; // exists only locally
  remoteOnly: string[]; // exists only remotely
}

/**
 * Read the remote sync meta file from the root folder
 */
export async function readRemoteSyncMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta | null> {
  const metaFile = await findFileByExactName(
    accessToken,
    SYNC_META_FILE,
    rootFolderId,
    options
  );
  if (!metaFile) return null;

  try {
    const content = await readFile(accessToken, metaFile.id, options);
    return JSON.parse(content) as SyncMeta;
  } catch {
    return null;
  }
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
  const metaFile = await findFileByExactName(
    accessToken,
    SYNC_META_FILE,
    rootFolderId,
    options
  );
  const content = JSON.stringify(meta, null, 2);

  if (metaFile) {
    await updateFile(accessToken, metaFile.id, content, "application/json", options);
  } else {
    await createFile(
      accessToken,
      SYNC_META_FILE,
      content,
      rootFolderId,
      "application/json",
      options
    );
  }
}

/**
 * Get file list from meta (no Drive API listing needed)
 */
export async function getFileListFromMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<{ meta: SyncMeta; files: DriveFile[] }> {
  let meta = await readRemoteSyncMeta(accessToken, rootFolderId, options);
  if (!meta) {
    // First time or missing meta — rebuild from Drive API
    meta = await rebuildSyncMeta(accessToken, rootFolderId, options);
  }
  const files: DriveFile[] = Object.entries(meta.files).map(([id, f]) => ({
    id,
    name: f.name,
    mimeType: f.mimeType,
    md5Checksum: f.md5Checksum,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
  }));
  return { meta, files };
}

/**
 * Rebuild sync meta from Drive API (full scan).
 * Used for initial setup, refresh, and sync.
 */
export async function rebuildSyncMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  // Preserve shared/webViewLink from existing meta
  const existing = await readRemoteSyncMeta(accessToken, rootFolderId, options);
  const files = await listUserFiles(accessToken, rootFolderId, options);
  const meta: SyncMeta = {
    lastUpdatedAt: new Date().toISOString(),
    files: {},
  };
  for (const f of files) {
    const prev = existing?.files[f.id];
    meta.files[f.id] = {
      name: f.name,
      mimeType: f.mimeType,
      md5Checksum: f.md5Checksum ?? "",
      modifiedTime: f.modifiedTime ?? "",
      createdTime: f.createdTime,
      shared: prev?.shared,
      webViewLink: prev?.webViewLink,
    };
  }
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta, options);
  return meta;
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
  const meta =
    (await readRemoteSyncMeta(accessToken, rootFolderId, options)) ?? {
      lastUpdatedAt: new Date().toISOString(),
      files: {},
    };
  meta.files[file.id] = {
    name: file.name,
    mimeType: file.mimeType,
    md5Checksum: file.md5Checksum ?? "",
    modifiedTime: file.modifiedTime ?? "",
    createdTime: file.createdTime,
  };
  meta.lastUpdatedAt = new Date().toISOString();
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta, options);
  return meta;
}

/**
 * Remove a file entry from meta
 */
export async function removeFileFromMeta(
  accessToken: string,
  rootFolderId: string,
  fileId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  const meta =
    (await readRemoteSyncMeta(accessToken, rootFolderId, options)) ?? {
      lastUpdatedAt: new Date().toISOString(),
      files: {},
    };
  delete meta.files[fileId];
  meta.lastUpdatedAt = new Date().toISOString();
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta, options);
  return meta;
}

/**
 * Save a conflict backup copy to the conflict folder.
 */
export async function saveConflictBackup(
  accessToken: string,
  rootFolderId: string,
  conflictFolderName: string,
  fileName: string,
  content: string,
  options: SyncMetaOperationOptions = {}
): Promise<void> {
  const folderId = await ensureSubFolder(accessToken, rootFolderId, conflictFolderName, options);
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  // Convert path separators to underscores and insert timestamp before extension
  const safeName = fileName.replace(/\//g, "_");
  const dotIdx = safeName.lastIndexOf(".");
  const backupName = dotIdx > 0
    ? `${safeName.slice(0, dotIdx)}_${ts}${safeName.slice(dotIdx)}`
    : `${safeName}_${ts}`;
  await createFile(accessToken, backupName, content, folderId, "text/plain", options);
}

/**
 * Update the shared/webViewLink fields for a file in meta
 */
export async function setFileSharedInMeta(
  accessToken: string,
  rootFolderId: string,
  fileId: string,
  shared: boolean,
  webViewLink?: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  const meta =
    (await readRemoteSyncMeta(accessToken, rootFolderId, options)) ?? {
      lastUpdatedAt: new Date().toISOString(),
      files: {},
    };
  if (meta.files[fileId]) {
    meta.files[fileId].shared = shared;
    meta.files[fileId].webViewLink = shared ? webViewLink : undefined;
  }
  meta.lastUpdatedAt = new Date().toISOString();
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta, options);
  return meta;
}

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
  localMeta: SyncMeta | null,
  remoteMeta: SyncMeta | null,
  locallyModifiedFileIds: Set<string> = new Set()
): SyncDiff {
  const localFiles = localMeta?.files ?? {};
  const remoteFiles = remoteMeta?.files ?? {};

  // System files to exclude from sync diff
  const SYSTEM_FILE_NAMES = new Set([SYNC_META_FILE, "settings.json"]);

  const toPush: string[] = [];
  const toPull: string[] = [];
  const conflicts: SyncDiff["conflicts"] = [];
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
      : false;

    if (hasLocal && !hasRemote) {
      localOnly.push(fileId);
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

  return { toPush, toPull, conflicts, localOnly, remoteOnly };
}
