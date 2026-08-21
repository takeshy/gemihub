/**
 * Project-mount implementation of the indexeddb-cache API, backed by the
 * mount-keyed storage cache (storage-cache.ts, "gemihub-storage" DB, path
 * identity). Adapted from the fork's compatibility facade.
 *
 * On a project mount, `fileId` IS the relative path. Import through
 * ./indexeddb-cache — the mount-aware dispatcher.
 */

import { isEncryptedFile } from "./crypto-core";
import {
  deleteCachedObject,
  deleteEditHistory,
  deleteLocalSyncEntry,
  getCachedObject,
  getEditHistory,
  getRemoteSyncSnapshot,
  listCachedObjectsForMount,
  listEditHistoryForMount,
  listLocalSyncEntriesForMount,
  objectPathForCachedFile,
  setCachedObject,
  setEditHistory,
  setLocalSyncEntry,
  setRemoteSyncSnapshot,
  clearMountCache,
  queueStorageDeletion,
  listPendingStorageDeletions,
  deletePendingStorageDeletion,
  type CachedObject,
} from "./storage-cache";
import type {
  CachedEditHistoryEntry,
  CachedFile,
  CachedFileTree,
  CachedRemoteMeta,
  CachedTreeNode,
  LocalSyncMeta,
  PendingDeletion,
} from "./indexeddb-cache-drive";
import { isMarkdownFile, parseFrontmatter } from "~/utils/frontmatter";

/**
 * The active project mountKey, mirrored to localStorage by
 * EnterpriseProvider's layout effect (before descendants' passive effects
 * run) so this module-level, non-React code can read it synchronously.
 */
export function activeProjectMountKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("gemihub-active-tenant-project");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { orgId?: string; projectId?: string };
    return parsed.orgId && parsed.projectId ? `gcs:${parsed.orgId}/${parsed.projectId}` : null;
  } catch {
    return null;
  }
}

/** The server-facing mount parameter for the active project, if any. */
export function activeProjectMountParam(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("gemihub-active-tenant-project");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { orgId?: string; projectId?: string };
    return parsed.orgId && parsed.projectId ? `project:${parsed.orgId}/${parsed.projectId}` : null;
  } catch {
    return null;
  }
}

export async function queuePendingDeletion(entry: PendingDeletion): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  await queueStorageDeletion({
    mountKey,
    objectPath: objectPathForCachedFile(mountKey, entry.fileId),
    relativePath: entry.fileId,
    queuedAt: entry.queuedAt,
  });
}

export async function getPendingDeletions(): Promise<PendingDeletion[]> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return [];
  return (await listPendingStorageDeletions(mountKey)).map((entry) => ({
    fileId: entry.relativePath,
    fileName: entry.relativePath,
    queuedAt: entry.queuedAt,
  }));
}

export async function deletePendingDeletion(fileId: string): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  await deletePendingStorageDeletion(mountKey, objectPathForCachedFile(mountKey, fileId));
}

function isoFromUpdatedAt(value: number | string | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) return value;
  return new Date().toISOString();
}

function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

function addTreeFile(root: CachedTreeNode[], file: CachedFile): void {
  const path = file.fileName || file.fileId;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return;

  let children = root;
  let currentPath = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    const name = parts[i];
    currentPath = currentPath ? `${currentPath}/${name}` : name;
    let folder = children.find((node) => node.isFolder && node.name === name);
    if (!folder) {
      folder = {
        id: currentPath,
        name,
        mimeType: "application/vnd.google-apps.folder",
        isFolder: true,
        children: [],
      };
      children.push(folder);
    }
    children = folder.children ?? [];
    folder.children = children;
  }

  const name = parts[parts.length - 1] || fileNameFromPath(path);
  children.push({
    id: file.fileId,
    name,
    mimeType: file.encoding === "base64" ? "application/octet-stream" : "text/plain",
    isFolder: false,
    modifiedTime: file.modifiedTime,
  });
}

function cachedFileFromObject(obj: CachedObject): CachedFile {
  const modifiedTime = isoFromUpdatedAt(obj.cachedAt);
  const base: CachedFile = {
    fileId: obj.relativePath,
    content: obj.content,
    rawContentBase64: obj.rawContentBase64,
    md5Checksum: obj.md5Hash,
    modifiedTime,
    cachedAt: obj.cachedAt,
    fileName: obj.relativePath,
    encoding: obj.encoding === "base64" ? "base64" : undefined,
    contentType: obj.contentType,
    revision: obj.revision,
    dirty: obj.dirty === true,
  };
  if (isMarkdownFile(base.fileName)) {
    const mtimeMs = new Date(modifiedTime).getTime();
    return { ...base, frontmatter: parseFrontmatter(base.content), fmParsedMtime: mtimeMs };
  }
  return base;
}

function contentTypeFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    json: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    dashboard: "text/yaml",
    base: "text/yaml",
    kanban: "text/yaml",
    html: "text/html",
    htm: "text/html",
    pdf: "application/pdf",
    epub: "application/epub+zip",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return (extension && known[extension]) || "text/plain";
}

function objectFromCachedFile(
  mountKey: string,
  file: CachedFile,
  existing?: CachedObject,
): CachedObject {
  const relativePath = file.fileName || file.fileId;
  return {
    mountKey,
    objectPath: objectPathForCachedFile(mountKey, file.fileId),
    relativePath,
    content: file.content,
    rawContentBase64: file.rawContentBase64,
    encoding: file.encoding === "base64" ? "base64" : "utf-8",
    contentType:
      file.contentType ??
      existing?.contentType ??
      (file.encoding === "base64" ? "application/octet-stream" : contentTypeFromPath(relativePath)),
    md5Hash: file.md5Checksum || existing?.md5Hash || "",
    revision: file.revision ?? existing?.revision ?? "0",
    cachedAt: file.cachedAt || Date.now(),
    dirty: file.dirty ?? true,
  };
}

export async function getCachedFile(fileId: string): Promise<CachedFile | undefined> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return undefined;
  const obj = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, fileId));
  return obj ? cachedFileFromObject(obj) : undefined;
}

export async function setCachedFile(file: CachedFile): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) throw new Error("No active project selected");
  const objectPath = objectPathForCachedFile(mountKey, file.fileId);
  const existing = await getCachedObject(mountKey, objectPath);
  const object = objectFromCachedFile(mountKey, file, existing);
  await setCachedObject(object);
  // A clean record represents content confirmed from storage. Seed the sync
  // base at the same time so subsequent local edits are classified as toPush
  // rather than remoteOnly and retain the optimistic-concurrency revision.
  if (!object.dirty && object.revision && object.revision !== "0") {
    await setLocalSyncEntry({
      mountKey,
      objectPath: object.objectPath,
      relativePath: object.relativePath,
      md5Hash: object.md5Hash,
      revision: object.revision,
      updatedAt: object.cachedAt,
    });
  }
}

export async function renameCachedFile(fileId: string, newFileName: string): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  const cached = await getCachedFile(fileId);
  if (!cached) return;
  // On a project mount the path IS the identity, so a rename MOVES the cache
  // record to a new key. Writing the new name under the old key would leave
  // the editor's next read (and pushObject) looking at a key that no longer
  // exists — the renamed file would silently never sync.
  if (newFileName === fileId) {
    await setCachedFile({ ...cached, fileName: newFileName });
    return;
  }
  await setCachedFile({ ...cached, fileId: newFileName, fileName: newFileName });
  const oldObjectPath = objectPathForCachedFile(mountKey, fileId);
  await deleteCachedObject(mountKey, oldObjectPath);
  await deleteLocalSyncEntry(mountKey, oldObjectPath);
  const history = await getEditHistory(mountKey, fileId);
  if (history) {
    await setEditHistory({
      mountKey,
      fileId: newFileName,
      filePath: newFileName,
      diffs: history.diffs,
    });
    await deleteEditHistory(mountKey, fileId).catch(() => {});
  }
}

export async function deleteCachedFile(fileId: string): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  await deleteCachedObject(mountKey, objectPathForCachedFile(mountKey, fileId));
  await deleteEditHistory(mountKey, fileId).catch(() => {});
}

export async function getAllCachedFiles(): Promise<CachedFile[]> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return [];
  return (await listCachedObjectsForMount(mountKey)).map(cachedFileFromObject);
}

export async function getEncryptedCachedFileIds(): Promise<Set<string>> {
  const files = await getAllCachedFiles();
  return new Set(files.filter((file) => isEncryptedFile(file.content)).map((file) => file.fileId));
}

export async function getAllCachedFileIds(): Promise<Set<string>> {
  return new Set((await getAllCachedFiles()).map((file) => file.fileId));
}

export async function getPendingNewFiles(): Promise<CachedFile[]> {
  return (await getAllCachedFiles()).filter((file) => file.fileId.startsWith("new:"));
}

export async function getLocalSyncMeta(): Promise<LocalSyncMeta | undefined> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return undefined;
  const entries = await listLocalSyncEntriesForMount(mountKey);
  return {
    id: "current",
    lastUpdatedAt: new Date().toISOString(),
    files: Object.fromEntries(entries.map((entry) => [
      entry.relativePath,
      {
        md5Checksum: entry.md5Hash,
        modifiedTime: isoFromUpdatedAt(entry.updatedAt),
        name: entry.relativePath,
      },
    ])),
  };
}

export async function setLocalSyncMeta(meta: LocalSyncMeta): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  for (const [fileId, entry] of Object.entries(meta.files)) {
    await setLocalSyncEntry({
      mountKey,
      objectPath: objectPathForCachedFile(mountKey, fileId),
      relativePath: fileId,
      md5Hash: entry.md5Checksum,
      revision: "",
      updatedAt: new Date(entry.modifiedTime || Date.now()).getTime(),
    });
  }
}

export async function removeLocalSyncMetaEntry(fileId: string): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  await deleteLocalSyncEntry(mountKey, objectPathForCachedFile(mountKey, fileId));
}

export async function bulkRemoveLocalSyncMetaEntries(fileIds: string[]): Promise<void> {
  await Promise.all(fileIds.map((fileId) => removeLocalSyncMetaEntry(fileId)));
}

export async function getEditHistoryForFile(fileId: string): Promise<CachedEditHistoryEntry | undefined> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return undefined;
  const record = await getEditHistory(mountKey, fileId);
  return record ? { fileId: record.fileId, filePath: record.filePath, diffs: record.diffs } : undefined;
}

export async function setEditHistoryEntry(entry: CachedEditHistoryEntry): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  await setEditHistory({ mountKey, fileId: entry.fileId, filePath: entry.filePath, diffs: entry.diffs });
}

export async function deleteEditHistoryEntry(fileId: string): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  await deleteEditHistory(mountKey, fileId);
}

export async function getLocallyModifiedFileIds(): Promise<Set<string>> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return new Set();
  return new Set((await listEditHistoryForMount(mountKey)).map((entry) => entry.fileId));
}

export async function pruneOrphanedEditHistory(keepIds: Set<string>): Promise<string[]> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return [];
  const entries = await listEditHistoryForMount(mountKey);
  const removed: string[] = [];
  for (const entry of entries) {
    if (!keepIds.has(entry.fileId) && !entry.fileId.startsWith("new:")) {
      await deleteEditHistory(mountKey, entry.fileId);
      removed.push(entry.fileId);
    }
  }
  return removed;
}

export async function getAllEditHistory(): Promise<CachedEditHistoryEntry[]> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return [];
  return (await listEditHistoryForMount(mountKey)).map((entry) => ({
    fileId: entry.fileId,
    filePath: entry.filePath,
    diffs: entry.diffs,
  }));
}

export async function clearAllEditHistory(): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  for (const entry of await listEditHistoryForMount(mountKey)) {
    await deleteEditHistory(mountKey, entry.fileId).catch(() => {});
  }
}

export async function getCachedFileTree(): Promise<CachedFileTree | undefined> {
  const files = await getAllCachedFiles();
  if (files.length === 0) return undefined;
  const items: CachedTreeNode[] = [];
  for (const file of files) addTreeFile(items, file);
  return {
    id: "current",
    rootFolderId: "gcs",
    cachedAt: Date.now(),
    items,
  };
}

// The mount tree is derived from the cache; nothing to persist or clear.
export async function setCachedFileTree(_tree: CachedFileTree): Promise<void> {}
export async function clearCachedFileTree(): Promise<void> {}

export async function getCachedRemoteMeta(): Promise<CachedRemoteMeta | undefined> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return undefined;
  const snapshot = await getRemoteSyncSnapshot(mountKey);
  if (!snapshot) return undefined;
  const pendingPaths = new Set((await listPendingStorageDeletions(mountKey)).map((entry) => entry.relativePath));
  return {
    id: "current",
    rootFolderId: "gcs",
    lastUpdatedAt: isoFromUpdatedAt(snapshot.fetchedAt),
    cachedAt: snapshot.fetchedAt,
    files: Object.fromEntries(snapshot.entries.filter((entry) => !pendingPaths.has(entry.relativePath)).map((entry) => [
      entry.relativePath,
      {
        name: entry.relativePath,
        mimeType: entry.contentType ?? "text/plain",
        md5Checksum: entry.md5Hash,
        modifiedTime: isoFromUpdatedAt(entry.updatedAt),
        size: entry.size === undefined ? undefined : String(entry.size),
      },
    ])),
  };
}

export async function setCachedRemoteMeta(meta: CachedRemoteMeta): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) throw new Error("No active project selected");
  await setRemoteSyncSnapshot({
    mountKey,
    fetchedAt: meta.cachedAt || Date.now(),
    entries: Object.entries(meta.files).map(([relativePath, entry]) => ({
      objectPath: objectPathForCachedFile(mountKey, relativePath),
      relativePath,
      md5Hash: entry.md5Checksum,
      revision: "",
      updatedAt: new Date(entry.modifiedTime || Date.now()).getTime(),
      contentType: entry.mimeType,
      size: entry.size === undefined ? undefined : Number(entry.size),
    })),
  });
}

export async function clearActiveMountCache(): Promise<void> {
  const mountKey = activeProjectMountKey();
  if (!mountKey) return;
  await clearMountCache(mountKey);
}
