import {
  deleteCachedFile,
  getCachedFile,
  getCachedRemoteMeta,
  setCachedFile,
  setCachedRemoteMeta,
  getPendingDeletions,
  deletePendingDeletion,
  type LocalSyncMeta,
} from "~/services/indexeddb-cache";
import { hasNetContentChange } from "~/services/edit-history-local";
import { isSyncExcludedPath } from "~/services/sync-client-utils";
import { type SyncDiff, type SyncMeta } from "~/services/sync-diff";
import { findPendingDeletionsChangedOnRemote } from "~/services/sync-push-guard";

/**
 * Drop queued soft deletions whose Drive file changed after they were queued.
 *
 * The badge/dialog hide pending-deleted files from CachedRemoteMeta, while the
 * push pre-check looks at the raw remote meta. Without this reconciliation a
 * remotely-edited file would be invisible in the pull UI yet still reject the
 * push with "Pull first". Cancelling the reservation lets the file re-enter
 * CachedRemoteMeta as an ordinary toPull entry (localMeta still holds the old
 * checksum), which is exactly what the documented Pull behaviour does anyway.
 *
 * Returns the ids that remain queued plus the ids that were cancelled.
 */
export async function cancelPendingDeletionsChangedOnRemote(
  localFiles: Record<string, { name?: string; md5Checksum?: string; modifiedTime?: string }>,
  remoteFiles: Record<string, { name?: string; md5Checksum?: string; modifiedTime?: string }>,
): Promise<{ remaining: Set<string>; cancelled: string[] }> {
  const pending = (await getPendingDeletions()).map((entry) => entry.fileId);
  const cancelled = findPendingDeletionsChangedOnRemote(pending, localFiles, remoteFiles);
  if (cancelled.length > 0) {
    await Promise.all(cancelled.map((id) => deletePendingDeletion(id)));
  }
  const cancelledSet = new Set(cancelled);
  return { remaining: new Set(pending.filter((id) => !cancelledSet.has(id))), cancelled };
}

export function toLocalSyncMeta(remoteMeta: {
  lastUpdatedAt: string;
  files: Record<string, { name?: string; md5Checksum?: string; modifiedTime?: string; size?: string }>;
}): LocalSyncMeta {
  const files: LocalSyncMeta["files"] = {};
  for (const [id, f] of Object.entries(remoteMeta.files)) {
    files[id] = {
      md5Checksum: f.md5Checksum ?? "",
      modifiedTime: f.modifiedTime ?? "",
      name: f.name,
      size: f.size,
    };
  }
  return {
    id: "current",
    lastUpdatedAt: remoteMeta.lastUpdatedAt,
    files,
  };
}

/**
 * Apply UI-level filters to a raw sync diff so the pull badge, the pull
 * dialog, and the push pre-check all agree on what counts as pending
 * remote work:
 * - sync-excluded paths are dropped everywhere
 * - toPull entries whose cached content already matches the remote checksum
 *   (lazy-fetched while localMeta was stale) are dropped
 * - localOnly entries count as remote deletions only when they are tracked
 *   in localMeta, have a resolvable name, and still have cached content
 *   (editHistory-only entries are new local files — push candidates)
 *
 * remoteOnly is intentionally not returned: brand-new remote files are
 * auto-registered as uncached entries by background polling and never count
 * as pending pull work.
 */
export async function filterActionablePull(
  diff: SyncDiff,
  localFiles: Record<string, { name?: string }>,
  remoteFiles: Record<string, { name?: string; md5Checksum?: string }>,
): Promise<{
  toPull: string[];
  deletedOnRemote: string[];
  conflicts: SyncDiff["conflicts"];
  editDeleteConflicts: string[];
}> {
  const isExcluded = (id: string) => {
    const name = remoteFiles[id]?.name || localFiles[id]?.name;
    return name ? isSyncExcludedPath(name) : false;
  };

  const toPull: string[] = [];
  for (const id of diff.toPull) {
    if (isExcluded(id)) continue;
    const cached = await getCachedFile(id);
    if (cached?.md5Checksum && cached.md5Checksum === remoteFiles[id]?.md5Checksum) continue;
    toPull.push(id);
  }

  const deletedOnRemote: string[] = [];
  for (const id of diff.localOnly) {
    if (!(id in localFiles)) continue;
    // Skip orphaned entries with no resolvable name (stale migration artifacts)
    const name = remoteFiles[id]?.name || localFiles[id]?.name;
    if (!name || isSyncExcludedPath(name)) continue;
    // Skip locally-deleted files with no cached content (stale metadata)
    const cached = await getCachedFile(id);
    if (!cached) continue;
    deletedOnRemote.push(id);
  }

  return {
    toPull,
    deletedOnRemote,
    conflicts: diff.conflicts.filter((c) => !isExcluded(c.fileId)),
    editDeleteConflicts: diff.editDeleteConflicts.filter((id) => !isExcluded(id)),
  };
}

export function collectTrackedIds(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Set<string> {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const id of Object.keys(source)) {
      ids.add(id);
    }
  }
  return ids;
}

export async function collectPushCandidates(
  modifiedIds: Set<string>,
  remoteFiles: Record<string, { name?: string }> = {},
): Promise<Array<{ id: string; name: string; type: "new" | "modified" }>> {
  const files: Array<{ id: string; name: string; type: "new" | "modified" }> = [];
  for (const id of modifiedIds) {
    const cached = await getCachedFile(id);
    if (!cached) continue;
    const name = cached.fileName || remoteFiles[id]?.name || id;
    if (isSyncExcludedPath(name)) continue;

    if (cached.encoding !== "base64" && !(await hasNetContentChange(id))) continue;
    files.push({ id, name, type: id.startsWith("new:") ? "new" : "modified" });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

/**
 * Keep cachedRemoteMeta in sync after push/pull/resolve/fullPull.
 * Without this, refreshSyncCounts uses stale cachedRemoteMeta
 * and may misclassify pushed files as localOnly or conflicts.
 */
export async function updateCachedRemoteMetaFromSyncMeta(remoteMeta: SyncMeta): Promise<void> {
  const existing = await getCachedRemoteMeta();
  // Update whenever an entry exists — even one initialized with an empty
  // rootFolderId (checkRemoteChanges does this before the tree sets the real
  // value). Skipping those would leave cachedRemoteMeta stale after sync ops.
  if (existing) {
    // Preserve local-only "new:" entries that haven't been migrated to Drive yet
    const pendingDeletionIds = new Set((await getPendingDeletions()).map((entry) => entry.fileId));
    const mergedFiles = Object.fromEntries(
      Object.entries(remoteMeta.files).filter(([id]) => !pendingDeletionIds.has(id)),
    );
    for (const [id, entry] of Object.entries(existing.files)) {
      if (id.startsWith("new:") && !(id in mergedFiles)) {
        mergedFiles[id] = entry;
      }
    }
    await setCachedRemoteMeta({
      id: "current",
      rootFolderId: existing.rootFolderId,
      lastUpdatedAt: remoteMeta.lastUpdatedAt,
      files: mergedFiles,
      cachedAt: Date.now(),
    });
  }
}

/**
 * Turn a remotely-deleted file into a brand-new local file.
 *
 * Used when the user ignores a deletion during pull. Keeping the old cache
 * entry would only survive until the next cache clear — the file no longer
 * exists on Drive, so nothing could restore it. Re-registering the content
 * under a `new:` id makes it an ordinary unpushed creation, which the pending
 * migration uploads to Drive as a new file.
 *
 * Returns the new id, or null when there is no cached content to keep.
 */
export async function resurrectDeletedFileAsNew(
  fileId: string,
  /** Name from localMeta — cached entries written by older versions may lack one. */
  fallbackName?: string,
): Promise<string | null> {
  const cached = await getCachedFile(fileId);
  const name = cached?.fileName || fallbackName;
  // No cached content means there is nothing to keep; the caller applies the
  // deletion normally instead.
  if (!cached || !name) return null;
  const newId = `new:${name}`;
  if (!(await getCachedFile(newId))) {
    await setCachedFile({
      ...cached,
      fileId: newId,
      fileName: name,
      md5Checksum: "",
      modifiedTime: "",
      cachedAt: Date.now(),
    });
  }
  await deleteCachedFile(fileId);

  // The file tree renders localMeta entries plus `new:` entries from
  // cachedRemoteMeta. Without this the resurrected file is in the cache but in
  // neither table, so it disappears from the tree until the next reload.
  try {
    const remoteMeta = await getCachedRemoteMeta();
    if (remoteMeta) {
      const now = new Date().toISOString();
      remoteMeta.files[newId] = {
        name,
        mimeType: remoteMeta.files[fileId]?.mimeType ?? "text/plain",
        md5Checksum: "",
        modifiedTime: now,
        createdTime: now,
      };
      delete remoteMeta.files[fileId];
      remoteMeta.lastUpdatedAt = now;
      remoteMeta.cachedAt = Date.now();
      await setCachedRemoteMeta(remoteMeta);
    }
  } catch {
    // Non-critical: the next tree fetch rebuilds meta from the server.
  }
  return newId;
}
