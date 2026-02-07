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

export interface FileSyncMeta {
  name: string;
  mimeType: string;
  md5Checksum: string;
  modifiedTime: string;
  createdTime?: string;
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
  rootFolderId: string
): Promise<SyncMeta | null> {
  const metaFile = await findFileByExactName(
    accessToken,
    SYNC_META_FILE,
    rootFolderId
  );
  if (!metaFile) return null;

  try {
    const content = await readFile(accessToken, metaFile.id);
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
  meta: SyncMeta
): Promise<void> {
  const metaFile = await findFileByExactName(
    accessToken,
    SYNC_META_FILE,
    rootFolderId
  );
  const content = JSON.stringify(meta, null, 2);

  if (metaFile) {
    await updateFile(accessToken, metaFile.id, content, "application/json");
  } else {
    await createFile(
      accessToken,
      SYNC_META_FILE,
      content,
      rootFolderId,
      "application/json"
    );
  }
}

/**
 * Get file list from meta (no Drive API listing needed)
 */
export async function getFileListFromMeta(
  accessToken: string,
  rootFolderId: string
): Promise<{ meta: SyncMeta; files: DriveFile[] }> {
  let meta = await readRemoteSyncMeta(accessToken, rootFolderId);
  if (!meta) {
    // First time or missing meta — rebuild from Drive API
    meta = await rebuildSyncMeta(accessToken, rootFolderId);
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
  rootFolderId: string
): Promise<SyncMeta> {
  const files = await listUserFiles(accessToken, rootFolderId);
  const meta: SyncMeta = {
    lastUpdatedAt: new Date().toISOString(),
    files: {},
  };
  for (const f of files) {
    meta.files[f.id] = {
      name: f.name,
      mimeType: f.mimeType,
      md5Checksum: f.md5Checksum ?? "",
      modifiedTime: f.modifiedTime ?? "",
      createdTime: f.createdTime,
    };
  }
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta);
  return meta;
}

/**
 * Add or update a single file entry in meta
 */
export async function upsertFileInMeta(
  accessToken: string,
  rootFolderId: string,
  file: DriveFile
): Promise<SyncMeta> {
  const meta =
    (await readRemoteSyncMeta(accessToken, rootFolderId)) ?? {
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
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta);
  return meta;
}

/**
 * Remove a file entry from meta
 */
export async function removeFileFromMeta(
  accessToken: string,
  rootFolderId: string,
  fileId: string
): Promise<SyncMeta> {
  const meta =
    (await readRemoteSyncMeta(accessToken, rootFolderId)) ?? {
      lastUpdatedAt: new Date().toISOString(),
      files: {},
    };
  delete meta.files[fileId];
  meta.lastUpdatedAt = new Date().toISOString();
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta);
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
  content: string
): Promise<void> {
  const folderId = await ensureSubFolder(accessToken, rootFolderId, conflictFolderName);
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  // Convert path separators to underscores and insert timestamp before extension
  const safeName = fileName.replace(/\//g, "_");
  const dotIdx = safeName.lastIndexOf(".");
  const backupName = dotIdx > 0
    ? `${safeName.slice(0, dotIdx)}_${ts}${safeName.slice(dotIdx)}`
    : `${safeName}_${ts}`;
  await createFile(accessToken, backupName, content, folderId, "text/plain");
}

/**
 * Compute sync diff using three-way comparison:
 *   localMeta (last sync snapshot on client) vs remoteMeta (last sync snapshot on server) vs remoteFiles (current Drive state)
 */
export function computeSyncDiff(
  localMeta: SyncMeta | null,
  remoteMeta: SyncMeta | null,
  remoteFiles: DriveFile[],
  excludePatterns: string[] = []
): SyncDiff {
  const localFiles = localMeta?.files ?? {};
  const remoteMetaFiles = remoteMeta?.files ?? {};

  // System files to exclude from sync diff
  const SYSTEM_FILE_NAMES = new Set([SYNC_META_FILE, "settings.json"]);

  // Compile exclude patterns
  const excludeRegexes = excludePatterns
    .filter((p) => p.trim())
    .map((p) => { try { return new RegExp(p); } catch { return null; } })
    .filter((r): r is RegExp => r !== null);

  function isExcluded(name: string): boolean {
    return excludeRegexes.some((re) => re.test(name));
  }

  // Build a map of current remote files by id
  const currentRemoteMap = new Map<string, DriveFile>();
  for (const f of remoteFiles) {
    if (SYSTEM_FILE_NAMES.has(f.name)) continue;
    if (isExcluded(f.name)) continue;
    currentRemoteMap.set(f.id, f);
  }

  const toPush: string[] = [];
  const toPull: string[] = [];
  const conflicts: SyncDiff["conflicts"] = [];
  const localOnly: string[] = [];
  const remoteOnly: string[] = [];

  // Collect all known file IDs (excluding files that match exclude patterns)
  const allFileIds = new Set<string>();
  for (const id of Object.keys(localFiles)) {
    if (!isExcluded(localFiles[id].name)) allFileIds.add(id);
  }
  for (const id of Object.keys(remoteMetaFiles)) {
    if (!isExcluded(remoteMetaFiles[id].name)) allFileIds.add(id);
  }
  for (const id of currentRemoteMap.keys()) allFileIds.add(id);

  for (const fileId of allFileIds) {
    const local = localFiles[fileId];
    const remoteSynced = remoteMetaFiles[fileId];
    const currentRemote = currentRemoteMap.get(fileId);

    const localChanged =
      local && remoteSynced
        ? local.md5Checksum !== remoteSynced.md5Checksum
        : !!local && !remoteSynced;

    const remoteChanged =
      currentRemote && remoteSynced
        ? currentRemote.md5Checksum !== remoteSynced.md5Checksum
        : !!currentRemote && !remoteSynced;

    if (local && !currentRemote) {
      localOnly.push(fileId);
    } else if (!local && currentRemote) {
      remoteOnly.push(fileId);
    } else if (localChanged && remoteChanged) {
      conflicts.push({
        fileId,
        fileName: currentRemote?.name ?? fileId,
        localChecksum: local?.md5Checksum ?? "",
        remoteChecksum: currentRemote?.md5Checksum ?? "",
        localModifiedTime: local?.modifiedTime ?? "",
        remoteModifiedTime: currentRemote?.modifiedTime ?? "",
      });
    } else if (localChanged) {
      toPush.push(fileId);
    } else if (remoteChanged) {
      toPull.push(fileId);
    }
  }

  return { toPush, toPull, conflicts, localOnly, remoteOnly };
}
