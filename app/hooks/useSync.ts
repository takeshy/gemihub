import { useState, useCallback, useEffect, useRef } from "react";
import {
  getLocalSyncMeta,
  setLocalSyncMeta,
  getCachedFile,
  setCachedFile,
  deleteCachedFile,
  getAllCachedFiles,
  getAllCachedFileIds,
  clearAllEditHistory,
  getLocallyModifiedFileIds,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  deleteEditHistoryEntry,
  type LocalSyncMeta,
} from "~/services/indexeddb-cache";
import { addCommitBoundary, hasNetContentChange } from "~/services/edit-history-local";
import { ragRegisterInBackground } from "~/services/rag-sync";
import {
  isSyncExcludedPath,
  isBinaryMimeType,
  getSyncCompletionStatus,
} from "~/services/sync-client-utils";
import { computeSyncDiff, type SyncMeta } from "~/services/sync-diff";

export interface ConflictInfo {
  fileId: string;
  fileName: string;
  localChecksum: string;
  remoteChecksum: string;
  localModifiedTime: string;
  remoteModifiedTime: string;
  isEditDelete?: boolean;
}

export type SyncStatus = "idle" | "pushing" | "pulling" | "conflict" | "warning" | "error";

function toLocalSyncMeta(remoteMeta: {
  lastUpdatedAt: string;
  files: Record<string, { name?: string; md5Checksum?: string; modifiedTime?: string }>;
}): LocalSyncMeta {
  const files: LocalSyncMeta["files"] = {};
  for (const [id, f] of Object.entries(remoteMeta.files)) {
    files[id] = {
      md5Checksum: f.md5Checksum ?? "",
      modifiedTime: f.modifiedTime ?? "",
      name: f.name,
    };
  }
  return {
    id: "current",
    lastUpdatedAt: remoteMeta.lastUpdatedAt,
    files,
  };
}

function collectTrackedIds(
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

/**
 * Keep cachedRemoteMeta in sync after push/pull/resolve/fullPull.
 * Without this, refreshSyncCounts uses stale cachedRemoteMeta
 * and may misclassify pushed files as localOnly or conflicts.
 */
async function updateCachedRemoteMetaFromSyncMeta(remoteMeta: SyncMeta): Promise<void> {
  const existing = await getCachedRemoteMeta();
  if (existing?.rootFolderId) {
    await setCachedRemoteMeta({
      id: "current",
      rootFolderId: existing.rootFolderId,
      lastUpdatedAt: remoteMeta.lastUpdatedAt,
      files: remoteMeta.files,
      cachedAt: Date.now(),
    });
  }
}


export function useSync() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localModifiedCount, setLocalModifiedCount] = useState(0);
  const [remoteModifiedCount, setRemoteModifiedCount] = useState(0);

  // Mutex to prevent concurrent sync operations (push/pull/resolve/fullPull)
  const syncLockRef = useRef(false);

  /**
   * Compute both push and pull counts from a single diff to keep them in sync.
   * Accepts optional freshRemoteMeta so callers with fresh server data (e.g.
   * checkRemoteChanges, push rejection) can avoid reading stale cached meta.
   */
  const refreshSyncCounts = useCallback(async (freshRemoteMeta?: SyncMeta | null) => {
    try {
      const ids = await getLocallyModifiedFileIds();
      const cachedRemote = await getCachedRemoteMeta();
      const remoteMeta = freshRemoteMeta !== undefined
        ? freshRemoteMeta
        : cachedRemote
          ? { lastUpdatedAt: cachedRemote.lastUpdatedAt, files: cachedRemote.files }
          : null;
      const localMeta = await getLocalSyncMeta();
      const diff = computeSyncDiff(
        localMeta ?? null,
        remoteMeta,
        ids
      );
      const remoteFiles = remoteMeta?.files ?? {};
      const localFiles = localMeta?.files ?? {};

      // --- Push count ---
      let pushCount = 0;
      if (ids.size > 0) {
        // Only count localOnly files that have editHistory (new local files).
        // Files in localMeta but not editHistory are remotely deleted — shown in pull badge.
        const pushLocalOnly = diff.localOnly.filter(id => ids.has(id));
        for (const id of [...diff.toPush, ...pushLocalOnly]) {
          const cached = await getCachedFile(id);
          const name = cached?.fileName || remoteFiles[id]?.name;
          if (name && isSyncExcludedPath(name)) continue;
          // Skip files whose content was reverted to the synced state (no net change)
          if (!pushLocalOnly.includes(id) && !(await hasNetContentChange(id))) continue;
          pushCount++;
        }
      }
      setLocalModifiedCount(pushCount);

      // --- Pull count ---
      // When remoteMeta is null (no sync meta on Drive), there is nothing to pull.
      if (!remoteMeta) {
        setRemoteModifiedCount(0);
      } else {
        // Include localOnly files that are in localMeta (remotely deleted) so user knows pull is needed.
        // Exclude localOnly files only in editHistory (new local files — shown in push badge).
        // Exclude conflicts — they are shown in the conflict dialog, not pull.
        // Include editDeleteConflicts so user sees pull badge and triggers conflict dialog.
        const pullLocalOnly = diff.localOnly.filter(id => id in localFiles);
        setRemoteModifiedCount(diff.toPull.length + diff.remoteOnly.length + pullLocalOnly.length + diff.editDeleteConflicts.length);
      }
    } catch {
      // ignore
    }
  }, []);

  // Listen for file-modified events to update counts in real-time
  useEffect(() => {
    const handler = () => { refreshSyncCounts(); };
    window.addEventListener("file-modified", handler);
    window.addEventListener("sync-complete", handler);
    refreshSyncCounts();
    return () => {
      window.removeEventListener("file-modified", handler);
      window.removeEventListener("sync-complete", handler);
    };
  }, [refreshSyncCounts]);

  // Ref to access syncStatus inside interval without re-creating it
  const syncStatusRef = useRef(syncStatus);
  syncStatusRef.current = syncStatus;

  // Check remote changes by fetching fresh remoteMeta, then recompute both counts
  const checkRemoteChanges = useCallback(async () => {
    try {
      if (!navigator.onLine) return;
      if (syncStatusRef.current !== "idle") return;
      const res = await fetch("/api/sync");
      if (!res.ok) return;
      const data = await res.json();
      const remoteMeta = data.remoteMeta as SyncMeta | null;

      // Cache remoteMeta in IndexedDB for pull dialog to use
      if (remoteMeta) {
        const existingCached = await getCachedRemoteMeta();
        await setCachedRemoteMeta({
          id: "current",
          rootFolderId: existingCached?.rootFolderId ?? "",
          lastUpdatedAt: remoteMeta.lastUpdatedAt,
          files: remoteMeta.files,
          cachedAt: Date.now(),
        });
      }

      // Recompute both push and pull counts from the fresh remoteMeta
      await refreshSyncCounts(remoteMeta ?? null);
    } catch {
      // ignore network errors
    }
  }, [refreshSyncCounts]);

  // Poll remote changes every 5 minutes + initial check
  useEffect(() => {
    checkRemoteChanges();
    const interval = setInterval(checkRemoteChanges, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkRemoteChanges]);

  const push = useCallback(async () => {
    if (syncLockRef.current) { console.warn("[useSync] push skipped: sync already in progress"); return; }
    syncLockRef.current = true;
    setSyncStatus("pushing");
    setError(null);
    try {
      // 1. Fetch fresh remoteMeta (push always uses latest)
      const syncRes = await fetch("/api/sync");
      if (!syncRes.ok) throw new Error("Failed to fetch remote meta");
      const syncData = await syncRes.json();
      const remoteMeta = syncData.remoteMeta as SyncMeta | null;
      const syncMetaFileId = syncData.syncMetaFileId as string | null;

      // 2. Get local state
      const localMeta = (await getLocalSyncMeta()) ?? null;
      const modifiedIds = await getLocallyModifiedFileIds();

      // 3. Compute diff client-side
      const diff = computeSyncDiff(localMeta, remoteMeta, modifiedIds);

      // 4. Reject push when remote has pending changes (pull first)
      const localMetaFiles = localMeta?.files ?? {};
      const remoteDeletedCount = diff.localOnly.filter(id => id in localMetaFiles).length;
      if (
        diff.conflicts.length > 0
        || diff.editDeleteConflicts.length > 0
        || diff.toPull.length > 0
        || diff.remoteOnly.length > 0
        || remoteDeletedCount > 0
      ) {
        // Update cached remoteMeta so subsequent pull uses the fresh data
        if (remoteMeta) {
          const existingCached = await getCachedRemoteMeta();
          await setCachedRemoteMeta({
            id: "current",
            rootFolderId: existingCached?.rootFolderId ?? "",
            lastUpdatedAt: remoteMeta.lastUpdatedAt,
            files: remoteMeta.files,
            cachedAt: Date.now(),
          });
          // Recompute both push and pull counts from the fresh remoteMeta
          await refreshSyncCounts(remoteMeta);
        }
        setError("settings.sync.pushRejected");
        setSyncStatus("error");
        return;
      }

      // 5. Collect modified files and batch update on Drive
      const cachedRemote = await getCachedRemoteMeta();
      const trackedIds = collectTrackedIds(
        remoteMeta?.files,
        localMeta?.files
      );
      const localFiles = localMeta?.files ?? {};
      // Include tracked files + new/untracked files (not yet in localMeta, e.g. after migration)
      const filteredIds = trackedIds.size > 0
        ? new Set([...modifiedIds].filter((id) => trackedIds.has(id) || !localFiles[id]))
        : modifiedIds;

      const filesToPush: Array<{ fileId: string; content: string; fileName: string }> = [];
      const binarySkippedIds: string[] = [];
      const revertedIds: string[] = [];
      for (const fid of filteredIds) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        const fileName = cached.fileName ?? cachedRemote?.files?.[fid]?.name ?? remoteMeta?.files?.[fid]?.name ?? fid;
        if (isSyncExcludedPath(fileName)) continue;
        // Skip base64-encoded files (binary files already updated on Drive via upload)
        if (cached.encoding === "base64") {
          binarySkippedIds.push(fid);
          continue;
        }
        // Skip files whose content was reverted to synced state (no net change)
        if (!(await hasNetContentChange(fid))) {
          revertedIds.push(fid);
          continue;
        }
        filesToPush.push({ fileId: fid, content: cached.content, fileName });
      }

      // Batch push files to Drive via single API call
      const pushedResultIds = new Set<string>();
      let skippedCount = 0;
      if (filesToPush.length > 0) {
        const pushRes = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "pushFiles",
            files: filesToPush.map(({ fileId, content }) => ({ fileId, content })),
            remoteMeta,
            syncMetaFileId,
          }),
        });
        if (!pushRes.ok) throw new Error("Failed to push files");
        const pushData = await pushRes.json();
        skippedCount = Array.isArray(pushData.skippedFileIds)
          ? pushData.skippedFileIds.length
          : 0;

        // Update IndexedDB cache with new checksums/timestamps
        for (const r of pushData.results as Array<{ fileId: string; md5Checksum: string; modifiedTime: string }>) {
          pushedResultIds.add(r.fileId);
          const cached = await getCachedFile(r.fileId);
          if (cached) {
            await setCachedFile({
              ...cached,
              md5Checksum: r.md5Checksum,
              modifiedTime: r.modifiedTime,
              cachedAt: Date.now(),
            });
          }
        }

        // Update localSyncMeta directly from remoteMeta (no extra diff call)
        if (pushData.remoteMeta) {
          await setLocalSyncMeta(
            toLocalSyncMeta(pushData.remoteMeta as {
              lastUpdatedAt: string;
              files: Record<string, { name?: string; md5Checksum?: string; modifiedTime?: string }>;
            })
          );
          await updateCachedRemoteMetaFromSyncMeta(pushData.remoteMeta as SyncMeta);
        }
      }

      // Clear edit history only for files that were actually pushed successfully
      for (const fileId of pushedResultIds) {
        await deleteEditHistoryEntry(fileId);
      }
      // Clear edit history for binary files skipped during push (already up-to-date on Drive)
      for (const fileId of binarySkippedIds) {
        await deleteEditHistoryEntry(fileId);
      }
      // Clear edit history for reverted files (content matches synced state, no actual diff)
      for (const fileId of revertedIds) {
        await deleteEditHistoryEntry(fileId);
      }
      const remainingModified = await getLocallyModifiedFileIds();
      setLocalModifiedCount(remainingModified.size);
      window.dispatchEvent(new Event("sync-complete"));

      setLastSyncTime(new Date().toISOString());
      const pushCompletion = getSyncCompletionStatus(skippedCount, "Push");
      setError(pushCompletion.error);
      setSyncStatus(pushCompletion.status);

      // RAG registration + retry in background (non-blocking)
      const successfulFiles = filesToPush.filter((f) => pushedResultIds.has(f.fileId));
      ragRegisterInBackground(successfulFiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
      setSyncStatus("error");
    } finally {
      syncLockRef.current = false;
    }
  }, [refreshSyncCounts]);

  const pull = useCallback(async () => {
    if (syncLockRef.current) { console.warn("[useSync] pull skipped: sync already in progress"); return; }
    syncLockRef.current = true;
    setSyncStatus("pulling");
    setError(null);
    try {
      // 1. Get remoteMeta (cached or fresh)
      let remoteMeta: SyncMeta | null = null;
      const cachedRemote = await getCachedRemoteMeta();
      if (cachedRemote) {
        remoteMeta = { lastUpdatedAt: cachedRemote.lastUpdatedAt, files: cachedRemote.files };
      } else {
        const res = await fetch("/api/sync");
        if (!res.ok) throw new Error("Failed to fetch remote meta");
        const data = await res.json();
        remoteMeta = data.remoteMeta as SyncMeta | null;
      }

      // 2. Get local state
      const localMeta = (await getLocalSyncMeta()) ?? null;
      const modifiedIds = await getLocallyModifiedFileIds();

      // 3. Compute diff client-side
      const diff = computeSyncDiff(localMeta, remoteMeta, modifiedIds);

      // 4. Handle conflicts (including edit-delete conflicts)
      const editDeleteConflictInfos: ConflictInfo[] = [];
      if (diff.editDeleteConflicts.length > 0) {
        const localFiles = localMeta?.files ?? {};
        for (const fid of diff.editDeleteConflicts) {
          const cached = await getCachedFile(fid);
          editDeleteConflictInfos.push({
            fileId: fid,
            fileName: cached?.fileName || fid,
            localChecksum: localFiles[fid]?.md5Checksum ?? "",
            remoteChecksum: "",
            localModifiedTime: localFiles[fid]?.modifiedTime ?? "",
            remoteModifiedTime: "",
            isEditDelete: true,
          });
        }
      }
      const allConflicts = [...diff.conflicts, ...editDeleteConflictInfos];
      if (allConflicts.length > 0) {
        setConflicts(allConflicts);
        setSyncStatus("conflict");
        return;
      }

      // 5. Clean up localOnly files (deleted on remote)
      let baseMeta: LocalSyncMeta | null = localMeta;
      if (diff.localOnly.length > 0) {
        const updatedMetaForDelete: LocalSyncMeta = localMeta ?? {
          id: "current",
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };
        for (const fid of diff.localOnly) {
          await deleteCachedFile(fid);
          await deleteEditHistoryEntry(fid);
          delete updatedMetaForDelete.files[fid];
        }
        updatedMetaForDelete.lastUpdatedAt = new Date().toISOString();
        await setLocalSyncMeta(updatedMetaForDelete);
        baseMeta = updatedMetaForDelete;
      }

      // 6. Download files via pullDirect (content only, no server-side meta read/write)
      const filesToPull = [...diff.toPull, ...diff.remoteOnly];
      if (filesToPull.length === 0) {
        if (diff.localOnly.length > 0) {
          window.dispatchEvent(new Event("sync-complete"));
          setLastSyncTime(new Date().toISOString());
          const remainingModified = await getLocallyModifiedFileIds();
          setLocalModifiedCount(remainingModified.size);
        }
        setRemoteModifiedCount(0);
        setSyncStatus("idle");
        return;
      }

      const remoteFiles = remoteMeta?.files ?? {};
      const isMobile = window.matchMedia("(max-width: 768px)").matches;

      // On mobile, skip downloading binary file content (save storage)
      const filesToDownload = isMobile
        ? filesToPull.filter((id) => !isBinaryMimeType(remoteFiles[id]?.mimeType))
        : filesToPull;

      // Build mimeTypes map so server can use readFileBase64 for binary files
      const mimeTypes: Record<string, string> = {};
      for (const id of filesToDownload) {
        if (remoteFiles[id]?.mimeType) mimeTypes[id] = remoteFiles[id].mimeType;
      }

      const updatedMeta: LocalSyncMeta = baseMeta ?? {
        id: "current",
        lastUpdatedAt: new Date().toISOString(),
        files: {},
      };

      // On mobile, track binary files in localSyncMeta without caching content
      if (isMobile) {
        for (const id of filesToPull) {
          if (isBinaryMimeType(remoteFiles[id]?.mimeType)) {
            const rm = remoteFiles[id];
            updatedMeta.files[id] = {
              md5Checksum: rm?.md5Checksum ?? "",
              modifiedTime: rm?.modifiedTime ?? "",
              name: rm?.name,
            };
          }
        }
      }

      if (filesToDownload.length > 0) {
        const pullRes = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pullDirect", fileIds: filesToDownload, mimeTypes }),
        });
        if (!pullRes.ok) throw new Error("Failed to pull changes");
        const pullData = await pullRes.json();

        // 7. Update IndexedDB with content + metadata from remoteMeta
        for (const file of pullData.files as Array<{ fileId: string; content: string; encoding?: "base64" }>) {
          const rm = remoteFiles[file.fileId];
          if (!file.encoding) await addCommitBoundary(file.fileId);
          await setCachedFile({
            fileId: file.fileId,
            content: file.content,
            md5Checksum: rm?.md5Checksum ?? "",
            modifiedTime: rm?.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName: rm?.name,
            ...(file.encoding ? { encoding: file.encoding } : {}),
          });
          updatedMeta.files[file.fileId] = {
            md5Checksum: rm?.md5Checksum ?? "",
            modifiedTime: rm?.modifiedTime ?? "",
            name: rm?.name,
          };
        }
      }

      // 8. Save localMeta
      updatedMeta.lastUpdatedAt = new Date().toISOString();
      await setLocalSyncMeta(updatedMeta);
      if (remoteMeta) await updateCachedRemoteMetaFromSyncMeta(remoteMeta);

      setLastSyncTime(new Date().toISOString());
      window.dispatchEvent(new Event("sync-complete"));
      if (filesToPull.length > 0) {
        window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: filesToPull } }));
      }
      const remainingModified = await getLocallyModifiedFileIds();
      setLocalModifiedCount(remainingModified.size);
      setRemoteModifiedCount(0);
      setSyncStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pull failed");
      setSyncStatus("error");
    } finally {
      syncLockRef.current = false;
    }
  }, []);

  // When all conflicts are resolved, auto-continue pull for remaining items
  useEffect(() => {
    if (syncStatus === "conflict" && conflicts.length === 0) {
      pull();
    }
  }, [syncStatus, conflicts.length, pull]);

  const resolveConflict = useCallback(
    async (fileId: string, choice: "local" | "remote", isEditDelete?: boolean) => {
      if (syncLockRef.current) { console.warn("[useSync] resolveConflict skipped: sync already in progress"); return; }
      syncLockRef.current = true;
      setError(null);
      try {
        const localMeta = (await getLocalSyncMeta()) ?? null;

        // Send local content for both choices:
        // - "local": server updates Drive with this content
        // - "remote": server backs up this content
        let localContent: string | undefined;
        let fileName: string | undefined;
        const cached = await getCachedFile(fileId);
        if (cached) {
          localContent = cached.content;
          fileName = cached.fileName;
        }

        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resolve",
            fileId,
            choice,
            localContent,
            isEditDelete: isEditDelete || undefined,
            fileName: isEditDelete ? fileName : undefined,
            localMeta: localMeta
              ? { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files }
              : null,
          }),
        });

        if (!res.ok) throw new Error("Failed to resolve conflict");
        const data = await res.json();

        // If remote wins, update local cache with remote content
        if (choice === "remote" && data.file) {
          await addCommitBoundary(data.file.fileId);
          await setCachedFile({
            fileId: data.file.fileId,
            content: data.file.content,
            md5Checksum: data.file.md5Checksum,
            modifiedTime: data.file.modifiedTime,
            cachedAt: Date.now(),
            fileName: data.file.fileName,
          });
        }

        // Edit-delete remote (accept deletion): clean up local cache
        if (isEditDelete && choice === "remote") {
          await deleteCachedFile(fileId);
        }

        // If local wins, update cache md5/modifiedTime from server response
        if (choice === "local" && data.file && cached) {
          if (isEditDelete && data.file.fileId !== fileId) {
            // Edit-delete: server created a new file with a new ID
            await deleteCachedFile(fileId);
            await setCachedFile({
              fileId: data.file.fileId,
              content: cached.content,
              md5Checksum: data.file.md5Checksum,
              modifiedTime: data.file.modifiedTime,
              cachedAt: Date.now(),
              fileName: data.file.fileName,
            });
          } else {
            await setCachedFile({
              ...cached,
              md5Checksum: data.file.md5Checksum,
              modifiedTime: data.file.modifiedTime,
              cachedAt: Date.now(),
            });
          }
        }

        // Clear edit history for the resolved file (conflict is resolved)
        await deleteEditHistoryEntry(fileId);

        // Update local sync meta from remote meta (merge to preserve local-only entries)
        if (data.remoteMeta) {
          const existing = await getLocalSyncMeta();
          const incoming = toLocalSyncMeta(data.remoteMeta as {
            lastUpdatedAt: string;
            files: Record<string, { name?: string; md5Checksum?: string; modifiedTime?: string }>;
          });
          const newFileId = (isEditDelete && data.file?.fileId !== fileId) ? data.file?.fileId : null;
          if (existing) {
            // Remove old fileId for edit-delete (file was re-created with new ID)
            if (isEditDelete) delete existing.files[fileId];
            const mergeFileId = newFileId || fileId;
            const merged: LocalSyncMeta = {
              id: "current",
              lastUpdatedAt: incoming.lastUpdatedAt,
              files: {
                ...existing.files,
                ...(incoming.files[mergeFileId] ? { [mergeFileId]: incoming.files[mergeFileId] } : {}),
              },
            };
            await setLocalSyncMeta(merged);
          } else {
            await setLocalSyncMeta(incoming);
          }
          await updateCachedRemoteMetaFromSyncMeta(data.remoteMeta as SyncMeta);
        }

        // Remove resolved conflict (idle transition handled by useEffect)
        setConflicts((prev) => prev.filter((c) => c.fileId !== fileId));

        // Recompute both push and pull counts after conflict resolution
        if (data.remoteMeta) {
          await refreshSyncCounts(data.remoteMeta as SyncMeta);
        }

        // Notify file tree to refresh
        window.dispatchEvent(new Event("sync-complete"));
        if (choice === "remote") {
          window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: [fileId] } }));
        }
        if (isEditDelete && choice === "local" && data.file?.fileId) {
          window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: [data.file.fileId] } }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Resolve failed");
        setSyncStatus("error");
      } finally {
        syncLockRef.current = false;
      }
    },
    [refreshSyncCounts]
  );

  const fullPull = useCallback(async () => {
    if (syncLockRef.current) { console.warn("[useSync] fullPull skipped: sync already in progress"); return; }
    syncLockRef.current = true;
    setSyncStatus("pulling");
    setError(null);
    try {
      // Build skipHashes from all cached files
      const cachedFiles = await getAllCachedFiles();
      const skipHashes: Record<string, string> = {};
      for (const f of cachedFiles) {
        if (f.md5Checksum) {
          skipHashes[f.fileId] = f.md5Checksum;
        }
      }

      const isMobile = window.matchMedia("(max-width: 768px)").matches;

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fullPull",
          skipHashes,
          skipBinaryContent: isMobile,
        }),
      });

      if (!res.ok) throw new Error("Full pull failed");
      const data = await res.json();

      // Update local cache with all downloaded files
      const updatedMeta: LocalSyncMeta = {
        id: "current",
        lastUpdatedAt: new Date().toISOString(),
        files: {},
      };

      // Include skipped files in meta too (including binary files not downloaded on mobile)
      for (const [fileId, fileMeta] of Object.entries(data.remoteMeta.files as Record<string, { name?: string; md5Checksum: string; modifiedTime: string }>)) {
        updatedMeta.files[fileId] = {
          md5Checksum: fileMeta.md5Checksum,
          modifiedTime: fileMeta.modifiedTime,
          name: fileMeta.name,
        };
      }

      for (const file of data.files as Array<{ fileId: string; content: string; md5Checksum: string; modifiedTime: string; fileName: string; encoding?: "base64" }>) {
        if (!file.encoding) await addCommitBoundary(file.fileId);
        await setCachedFile({
          fileId: file.fileId,
          content: file.content,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          cachedAt: Date.now(),
          fileName: file.fileName,
          ...(file.encoding ? { encoding: file.encoding } : {}),
        });
      }

      // Delete cached files that no longer exist on remote,
      // or binary files that should not be cached on mobile
      const remoteMetaFiles = data.remoteMeta.files as Record<string, { mimeType?: string }>;
      const remoteFileIds = new Set(Object.keys(remoteMetaFiles));
      const allCachedIds = await getAllCachedFileIds();
      for (const cachedId of allCachedIds) {
        if (!remoteFileIds.has(cachedId)) {
          await deleteCachedFile(cachedId);
        } else if (isMobile && isBinaryMimeType(remoteMetaFiles[cachedId]?.mimeType)) {
          await deleteCachedFile(cachedId);
        }
      }

      // Full pull means remote is authoritative — clear all local edit history
      await clearAllEditHistory();

      await setLocalSyncMeta(updatedMeta);
      if (data.remoteMeta) await updateCachedRemoteMetaFromSyncMeta(data.remoteMeta as SyncMeta);
      setLastSyncTime(new Date().toISOString());
      window.dispatchEvent(new Event("sync-complete"));
      const pulledIds = (data.files as { fileId: string }[]).map((f) => f.fileId);
      if (pulledIds.length > 0) {
        window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: pulledIds } }));
      }
      const remainingModified = await getLocallyModifiedFileIds();
      setLocalModifiedCount(remainingModified.size);
      setRemoteModifiedCount(0);
      setSyncStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Full pull failed");
      setSyncStatus("error");
    } finally {
      syncLockRef.current = false;
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setSyncStatus((prev) => (prev === "error" ? "idle" : prev));
  }, []);

  return {
    syncStatus,
    lastSyncTime,
    conflicts,
    error,
    localModifiedCount,
    remoteModifiedCount,
    push,
    pull,
    resolveConflict,
    fullPull,
    clearError,
  };
}
