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
import { addCommitBoundary } from "~/services/edit-history-local";
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
}

export type SyncStatus = "idle" | "pushing" | "pulling" | "conflict" | "warning" | "error";

function toLocalSyncMeta(remoteMeta: {
  lastUpdatedAt: string;
  files: Record<string, { md5Checksum?: string; modifiedTime?: string }>;
}): LocalSyncMeta {
  const files: LocalSyncMeta["files"] = {};
  for (const [id, f] of Object.entries(remoteMeta.files)) {
    files[id] = {
      md5Checksum: f.md5Checksum ?? "",
      modifiedTime: f.modifiedTime ?? "",
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


export function useSync() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localModifiedCount, setLocalModifiedCount] = useState(0);
  const [remoteModifiedCount, setRemoteModifiedCount] = useState(0);

  const refreshLocalModifiedCount = useCallback(async () => {
    try {
      const ids = await getLocallyModifiedFileIds();
      setLocalModifiedCount(ids.size);
    } catch {
      // ignore
    }
  }, []);

  // Listen for file-modified events to update count in real-time
  useEffect(() => {
    const handler = () => { refreshLocalModifiedCount(); };
    window.addEventListener("file-modified", handler);
    refreshLocalModifiedCount();
    return () => window.removeEventListener("file-modified", handler);
  }, [refreshLocalModifiedCount]);

  // Ref to access syncStatus inside interval without re-creating it
  const syncStatusRef = useRef(syncStatus);
  syncStatusRef.current = syncStatus;

  // Check remote changes by comparing remote meta with local sync meta
  const checkRemoteChanges = useCallback(async () => {
    try {
      if (!navigator.onLine) return;
      if (syncStatusRef.current !== "idle") return;
      const res = await fetch("/api/sync");
      if (!res.ok) return;
      const data = await res.json();
      const remoteMeta = data.remoteMeta as SyncMeta | null;
      if (!remoteMeta) { setRemoteModifiedCount(0); return; }

      // Cache remoteMeta in IndexedDB for pull to use
      const existingCached = await getCachedRemoteMeta();
      if (existingCached?.rootFolderId) {
        await setCachedRemoteMeta({
          id: "current",
          rootFolderId: existingCached.rootFolderId,
          lastUpdatedAt: remoteMeta.lastUpdatedAt,
          files: remoteMeta.files,
          cachedAt: Date.now(),
        });
      }

      const localMeta = await getLocalSyncMeta();
      const diff = computeSyncDiff(localMeta ?? null, remoteMeta);
      setRemoteModifiedCount(diff.toPull.length + diff.remoteOnly.length);
    } catch {
      // ignore network errors
    }
  }, []);

  // Poll remote changes every 5 minutes + initial check
  useEffect(() => {
    checkRemoteChanges();
    const interval = setInterval(checkRemoteChanges, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkRemoteChanges]);

  // When all conflicts are resolved, return to idle
  useEffect(() => {
    if (syncStatus === "conflict" && conflicts.length === 0) {
      setSyncStatus("idle");
    }
  }, [syncStatus, conflicts.length]);

  const push = useCallback(async () => {
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
      if (
        diff.conflicts.length > 0
        || diff.toPull.length > 0
        || diff.remoteOnly.length > 0
      ) {
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
      const filteredIds = trackedIds.size > 0
        ? new Set([...modifiedIds].filter((id) => trackedIds.has(id)))
        : modifiedIds;

      const filesToPush: Array<{ fileId: string; content: string; fileName: string }> = [];
      const binarySkippedIds: string[] = [];
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
              files: Record<string, { md5Checksum?: string; modifiedTime?: string }>;
            })
          );
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
    }
  }, []);

  const pull = useCallback(async () => {
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

      // 4. Handle conflicts
      if (diff.conflicts.length > 0) {
        setConflicts(diff.conflicts);
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
          };
        }
      }

      // 8. Save localMeta
      updatedMeta.lastUpdatedAt = new Date().toISOString();
      await setLocalSyncMeta(updatedMeta);

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
    }
  }, []);

  const resolveConflict = useCallback(
    async (fileId: string, choice: "local" | "remote") => {
      setError(null);
      try {
        const localMeta = (await getLocalSyncMeta()) ?? null;

        // Send local content for both choices:
        // - "local": server updates Drive with this content
        // - "remote": server backs up this content
        let localContent: string | undefined;
        const cached = await getCachedFile(fileId);
        if (cached) {
          localContent = cached.content;
        }

        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resolve",
            fileId,
            choice,
            localContent,
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

        // If local wins, update cache md5/modifiedTime from server response
        if (choice === "local" && data.file && cached) {
          await setCachedFile({
            ...cached,
            md5Checksum: data.file.md5Checksum,
            modifiedTime: data.file.modifiedTime,
            cachedAt: Date.now(),
          });
        }

        // Clear edit history for the resolved file (conflict is resolved)
        await deleteEditHistoryEntry(fileId);

        // Update local sync meta from remote meta (merge to preserve local-only entries)
        if (data.remoteMeta) {
          const existing = await getLocalSyncMeta();
          const incoming = toLocalSyncMeta(data.remoteMeta as {
            lastUpdatedAt: string;
            files: Record<string, { md5Checksum?: string; modifiedTime?: string }>;
          });
          if (existing) {
            const merged: LocalSyncMeta = {
              id: "current",
              lastUpdatedAt: incoming.lastUpdatedAt,
              files: { ...existing.files, ...incoming.files },
            };
            await setLocalSyncMeta(merged);
          } else {
            await setLocalSyncMeta(incoming);
          }
        }

        // Remove resolved conflict (idle transition handled by useEffect)
        setConflicts((prev) => prev.filter((c) => c.fileId !== fileId));

        // Notify file tree to refresh
        window.dispatchEvent(new Event("sync-complete"));
        if (choice === "remote") {
          window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: [fileId] } }));
        }

        // Update modified count after clearing edit history
        const remainingModified = await getLocallyModifiedFileIds();
        setLocalModifiedCount(remainingModified.size);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Resolve failed");
        setSyncStatus("error");
      }
    },
    []
  );

  const fullPull = useCallback(async () => {
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
      for (const [fileId, fileMeta] of Object.entries(data.remoteMeta.files as Record<string, { md5Checksum: string; modifiedTime: string }>)) {
        updatedMeta.files[fileId] = {
          md5Checksum: fileMeta.md5Checksum,
          modifiedTime: fileMeta.modifiedTime,
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
