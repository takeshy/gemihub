// Sync meta service - manages remote sync metadata for push/pull synchronization
// Also serves as the file registry for flat Drive storage.

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
  DriveApiError,
} from "./google-drive.server";
import { SYNC_META_FILE_NAME } from "./sync-diff";

export { SYNC_META_FILE_NAME, computeSyncDiff } from "./sync-diff";
export type { FileSyncMeta, SyncMeta, SyncDiff } from "./sync-diff";

import type { SyncMeta } from "./sync-diff";

interface SyncMetaOperationOptions {
  signal?: AbortSignal;
}

interface ConsolidatedSyncMetaFile {
  file: DriveFile | null;
  meta: SyncMeta | null;
}

/**
 * Pure helper: given a list of _sync-meta.json matches, pick which to keep
 * (latest modifiedTime) and which to discard. Extracted for unit testing;
 * consolidation happens via findOrConsolidateSyncMetaFile which also performs
 * the async delete.
 */
export function pickSyncMetaToKeep(matches: DriveFile[]): {
  keep: DriveFile | null;
  discard: DriveFile[];
} {
  if (matches.length === 0) return { keep: null, discard: [] };
  if (matches.length === 1) return { keep: matches[0], discard: [] };
  // modifiedTime is ISO 8601 so lexicographic compare is equivalent to chronological
  const sorted = [...matches].sort((a, b) =>
    (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "")
  );
  return { keep: sorted[0], discard: sorted.slice(1) };
}

function mergeFileSyncMeta(
  current: SyncMeta["files"][string] | undefined,
  incoming: SyncMeta["files"][string]
): SyncMeta["files"][string] {
  if (!current) return { ...incoming };

  const currentModified = current.modifiedTime ?? "";
  const incomingModified = incoming.modifiedTime ?? "";
  const base =
    incomingModified >= currentModified
      ? { ...current, ...incoming }
      : { ...incoming, ...current };

  const merged: SyncMeta["files"][string] = {
    ...base,
  };

  const shared = incoming.shared ?? current.shared;
  const webViewLink = incoming.webViewLink ?? current.webViewLink;
  const createdTime = incoming.createdTime ?? current.createdTime;
  const size = incoming.size ?? current.size;

  if (shared !== undefined) merged.shared = shared;
  if (webViewLink !== undefined) merged.webViewLink = webViewLink;
  if (createdTime !== undefined) merged.createdTime = createdTime;
  if (size !== undefined) merged.size = size;

  return merged;
}

export function mergeSyncMetaSnapshots(metas: SyncMeta[]): SyncMeta {
  const merged: SyncMeta = {
    lastUpdatedAt: "",
    files: {},
  };

  for (const meta of metas) {
    if (meta.lastUpdatedAt > merged.lastUpdatedAt) {
      merged.lastUpdatedAt = meta.lastUpdatedAt;
    }
    for (const [fileId, fileMeta] of Object.entries(meta.files)) {
      merged.files[fileId] = mergeFileSyncMeta(merged.files[fileId], fileMeta);
    }
  }

  if (!merged.lastUpdatedAt) {
    merged.lastUpdatedAt = new Date().toISOString();
  }

  return merged;
}

async function deleteDuplicateSyncMetaFile(accessToken: string, fileId: string): Promise<void> {
  try {
    await deleteFile(accessToken, fileId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) return;
    throw error;
  }
}

/**
 * Find the single _sync-meta.json file in rootFolderId.
 * Drive doesn't enforce unique filenames; concurrent pushes or bulk ops can
 * create duplicates (findFileByExactName + createFile race). When duplicates
 * are detected, merge their contents into a single authoritative file before
 * permanently deleting the extras.
 */
export async function findOrConsolidateSyncMetaFile(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<ConsolidatedSyncMetaFile> {
  const matches = await findFilesByExactName(
    accessToken,
    SYNC_META_FILE_NAME,
    rootFolderId,
    options
  );
  const { keep, discard } = pickSyncMetaToKeep(matches);
  if (!keep) {
    return { file: null, meta: null };
  }

  if (discard.length === 0) {
    return { file: keep, meta: null };
  }

  const parsedMetas = await Promise.all(
    matches.map(async (match) => {
      try {
        const content = await readFile(accessToken, match.id, options);
        return JSON.parse(content) as SyncMeta;
      } catch {
        return null;
      }
    })
  );
  const validMetas = parsedMetas.filter((meta): meta is SyncMeta => meta != null);
  const mergedMeta = validMetas.length > 0 ? mergeSyncMetaSnapshots(validMetas) : null;

  if (mergedMeta) {
    await updateFile(
      accessToken,
      keep.id,
      JSON.stringify(mergedMeta, null, 2),
      "application/json",
      options
    );
  }

  await Promise.all(discard.map((file) => deleteDuplicateSyncMetaFile(accessToken, file.id)));
  return { file: keep, meta: mergedMeta };
}

/**
 * Read the remote sync meta file from the root folder
 */
export async function readRemoteSyncMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta | null> {
  const { file: metaFile, meta: consolidatedMeta } = await findOrConsolidateSyncMetaFile(
    accessToken,
    rootFolderId,
    options
  );
  if (!metaFile) return null;
  if (consolidatedMeta) return consolidatedMeta;

  try {
    const content = await readFile(accessToken, metaFile.id, options);
    return JSON.parse(content) as SyncMeta;
  } catch {
    return null;
  }
}

/**
 * Whether a Drive file that disappeared from the root listing was actually
 * deleted, trashed, or moved outside the flat sync root.
 */
export function isFileRemovedFromSyncRoot(file: DriveFile, rootFolderId: string): boolean {
  return file.trashed === true || !(file.parents ?? []).includes(rootFolderId);
}

/**
 * Read sync metadata and reconcile entries against the actual Drive root.
 *
 * listUserFiles intentionally excludes trashed files. A missing entry is
 * therefore verified by ID before it is removed from _sync-meta.json, so a
 * partial or inconsistent list response cannot manufacture remote deletions.
 */
export async function readReconciledRemoteSyncMeta(
  accessToken: string,
  rootFolderId: string,
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  const remoteMeta = await readRemoteSyncMeta(accessToken, rootFolderId, options);
  if (!remoteMeta) {
    return rebuildSyncMeta(accessToken, rootFolderId, options);
  }

  const driveFiles = await listUserFiles(accessToken, rootFolderId, options);
  const driveFileIds = new Set(driveFiles.map((file) => file.id));
  const staleIds = Object.keys(remoteMeta.files).filter((id) => !driveFileIds.has(id));
  const removedIds: string[] = [];

  for (const id of staleIds) {
    try {
      const file = await getFileMetadata(accessToken, id, options);
      if (isFileRemovedFromSyncRoot(file, rootFolderId)) {
        removedIds.push(id);
      }
    } catch (error) {
      if (error instanceof DriveApiError && error.status === 404) {
        removedIds.push(id);
      } else {
        throw error;
      }
    }
  }

  if (removedIds.length > 0) {
    for (const id of removedIds) {
      delete remoteMeta.files[id];
    }
    remoteMeta.lastUpdatedAt = new Date().toISOString();
    await writeRemoteSyncMeta(accessToken, rootFolderId, remoteMeta, options);
  }

  return remoteMeta;
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
  const { file: metaFile } = await findOrConsolidateSyncMetaFile(
    accessToken,
    rootFolderId,
    options
  );
  const content = JSON.stringify(meta, null, 2);

  if (metaFile) {
    await updateFile(accessToken, metaFile.id, content, "application/json", options);
  } else {
    await createFile(
      accessToken,
      SYNC_META_FILE_NAME,
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
    size: f.size,
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
      size: f.size,
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
  return upsertFilesInMeta(accessToken, rootFolderId, [file], options);
}

/**
 * Batch version of upsertFileInMeta: read meta once, apply all upserts, write once.
 * Callers that upload files concurrently MUST use this instead of racing
 * per-file upsertFileInMeta calls (last-writer-wins would clobber entries).
 */
export async function upsertFilesInMeta(
  accessToken: string,
  rootFolderId: string,
  files: DriveFile[],
  options: SyncMetaOperationOptions = {}
): Promise<SyncMeta> {
  const meta =
    (await readRemoteSyncMeta(accessToken, rootFolderId, options)) ?? {
      lastUpdatedAt: new Date().toISOString(),
      files: {},
    };
  for (const file of files) {
    meta.files[file.id] = {
      name: file.name,
      mimeType: file.mimeType,
      md5Checksum: file.md5Checksum ?? "",
      modifiedTime: file.modifiedTime ?? "",
      createdTime: file.createdTime,
      size: file.size,
    };
  }
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
  const meta = await readRemoteSyncMeta(accessToken, rootFolderId, options);
  if (!meta) return null;
  let changed = false;
  for (const id of fileIds) {
    if (meta.files[id]) {
      delete meta.files[id];
      changed = true;
    }
  }
  if (!changed) return meta;
  meta.lastUpdatedAt = new Date().toISOString();
  await writeRemoteSyncMeta(accessToken, rootFolderId, meta, options);
  return meta;
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
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  // Convert path separators to underscores and insert timestamp before extension
  const safeName = fileName.replace(/\//g, "_");
  const dotIdx = safeName.lastIndexOf(".");
  const backupName = dotIdx > 0
    ? `${safeName.slice(0, dotIdx)}_${ts}${safeName.slice(dotIdx)}`
    : `${safeName}_${ts}`;
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
