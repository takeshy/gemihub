/**
 * Mount-aware IndexedDB cache dispatcher.
 *
 * Every consumer keeps importing from this module. When a project mount is
 * active (EnterpriseProvider mirrors the selection to localStorage before
 * descendants' effects run), calls go to the mount-keyed storage cache
 * (indexeddb-cache-mount.ts, path identity, "gemihub-storage" DB); otherwise
 * to the Drive implementation (indexeddb-cache-drive.ts, fileId identity,
 * "gemihub-cache" DB) — the default, unchanged behavior.
 *
 * App-level entries (loaderData) and Drive-push-specific operations always
 * use the Drive DB regardless of the active mount.
 */

import * as drive from "./indexeddb-cache-drive";
import * as mount from "./indexeddb-cache-mount";
import { activeProjectMountKey } from "./indexeddb-cache-mount";

export type {
  CachedFile,
  LocalSyncMeta,
  EditHistoryDiff,
  CachedEditHistoryEntry,
  CachedTreeNode,
  CachedFileTree,
  CachedRemoteMeta,
  CachedLoaderData,
  ConflictBackup,
  PendingDeletion,
} from "./indexeddb-cache-drive";
export { activeProjectMountKey, activeProjectMountParam } from "./indexeddb-cache-mount";

function onMount(): boolean {
  return activeProjectMountKey() !== null;
}

// --- files ---

export const getCachedFile: typeof drive.getCachedFile = (fileId) =>
  onMount() ? mount.getCachedFile(fileId) : drive.getCachedFile(fileId);

export const setCachedFile: typeof drive.setCachedFile = (file) =>
  onMount() ? mount.setCachedFile(file) : drive.setCachedFile(file);

export const renameCachedFile: typeof drive.renameCachedFile = (fileId, newFileName) =>
  onMount() ? mount.renameCachedFile(fileId, newFileName) : drive.renameCachedFile(fileId, newFileName);

export const deleteCachedFile: typeof drive.deleteCachedFile = (fileId) =>
  onMount() ? mount.deleteCachedFile(fileId) : drive.deleteCachedFile(fileId);

export const getAllCachedFiles: typeof drive.getAllCachedFiles = () =>
  onMount() ? mount.getAllCachedFiles() : drive.getAllCachedFiles();

export const getEncryptedCachedFileIds: typeof drive.getEncryptedCachedFileIds = () =>
  onMount() ? mount.getEncryptedCachedFileIds() : drive.getEncryptedCachedFileIds();

export const getAllCachedFileIds: typeof drive.getAllCachedFileIds = () =>
  onMount() ? mount.getAllCachedFileIds() : drive.getAllCachedFileIds();

export const getPendingNewFiles: typeof drive.getPendingNewFiles = () =>
  onMount() ? mount.getPendingNewFiles() : drive.getPendingNewFiles();

// Drive-push-specific: only the Drive push flow calls these, and it is gated
// off while a project mount is active.
export const applyPushedFileMetadata: typeof drive.applyPushedFileMetadata =
  drive.applyPushedFileMetadata;
export const saveLocalConflictBackup: typeof drive.saveLocalConflictBackup =
  drive.saveLocalConflictBackup;
export const queuePendingDeletion: typeof drive.queuePendingDeletion = (entry) =>
  onMount() ? mount.queuePendingDeletion(entry) : drive.queuePendingDeletion(entry);
export const getPendingDeletions: typeof drive.getPendingDeletions = () =>
  onMount() ? mount.getPendingDeletions() : drive.getPendingDeletions();
export const deletePendingDeletion: typeof drive.deletePendingDeletion = (fileId) =>
  onMount() ? mount.deletePendingDeletion(fileId) : drive.deletePendingDeletion(fileId);

// --- syncMeta ---

export const getLocalSyncMeta: typeof drive.getLocalSyncMeta = () =>
  onMount() ? mount.getLocalSyncMeta() : drive.getLocalSyncMeta();

export const setLocalSyncMeta: typeof drive.setLocalSyncMeta = (meta) =>
  onMount() ? mount.setLocalSyncMeta(meta) : drive.setLocalSyncMeta(meta);

export const removeLocalSyncMetaEntry: typeof drive.removeLocalSyncMetaEntry = (fileId) =>
  onMount() ? mount.removeLocalSyncMetaEntry(fileId) : drive.removeLocalSyncMetaEntry(fileId);

export const bulkRemoveLocalSyncMetaEntries: typeof drive.bulkRemoveLocalSyncMetaEntries = (fileIds) =>
  onMount() ? mount.bulkRemoveLocalSyncMetaEntries(fileIds) : drive.bulkRemoveLocalSyncMetaEntries(fileIds);

// --- editHistory ---

export const getEditHistoryForFile: typeof drive.getEditHistoryForFile = (fileId) =>
  onMount() ? mount.getEditHistoryForFile(fileId) : drive.getEditHistoryForFile(fileId);

export const setEditHistoryEntry: typeof drive.setEditHistoryEntry = (entry) =>
  onMount() ? mount.setEditHistoryEntry(entry) : drive.setEditHistoryEntry(entry);

export const deleteEditHistoryEntry: typeof drive.deleteEditHistoryEntry = (fileId) =>
  onMount() ? mount.deleteEditHistoryEntry(fileId) : drive.deleteEditHistoryEntry(fileId);

export const getLocallyModifiedFileIds: typeof drive.getLocallyModifiedFileIds = () =>
  onMount() ? mount.getLocallyModifiedFileIds() : drive.getLocallyModifiedFileIds();

export const pruneOrphanedEditHistory: typeof drive.pruneOrphanedEditHistory = (keepIds) =>
  onMount() ? mount.pruneOrphanedEditHistory(keepIds) : drive.pruneOrphanedEditHistory(keepIds);

export const getAllEditHistory: typeof drive.getAllEditHistory = () =>
  onMount() ? mount.getAllEditHistory() : drive.getAllEditHistory();

export const clearAllEditHistory: typeof drive.clearAllEditHistory = () =>
  onMount() ? mount.clearAllEditHistory() : drive.clearAllEditHistory();

// --- fileTree ---

export const getCachedFileTree: typeof drive.getCachedFileTree = () =>
  onMount() ? mount.getCachedFileTree() : drive.getCachedFileTree();

export const setCachedFileTree: typeof drive.setCachedFileTree = (tree) =>
  onMount() ? mount.setCachedFileTree(tree) : drive.setCachedFileTree(tree);

export const clearCachedFileTree: typeof drive.clearCachedFileTree = () =>
  onMount() ? mount.clearCachedFileTree() : drive.clearCachedFileTree();

// --- remoteMeta ---

export const getCachedRemoteMeta: typeof drive.getCachedRemoteMeta = () =>
  onMount() ? mount.getCachedRemoteMeta() : drive.getCachedRemoteMeta();

export const setCachedRemoteMeta: typeof drive.setCachedRemoteMeta = (meta) =>
  onMount() ? mount.setCachedRemoteMeta(meta) : drive.setCachedRemoteMeta(meta);

// --- loaderData (app-level, never mount-scoped) ---

export const getCachedLoaderData: typeof drive.getCachedLoaderData = drive.getCachedLoaderData;
export const setCachedLoaderData: typeof drive.setCachedLoaderData = drive.setCachedLoaderData;

// --- clearAll ---

export const clearAllCache: typeof drive.clearAllCache = async () => {
  await drive.clearAllCache();
  // Also clear the active project mount's cache so "clear cache" means what
  // it says regardless of the mount the user is looking at.
  await mount.clearActiveMountCache().catch(() => {});
};
