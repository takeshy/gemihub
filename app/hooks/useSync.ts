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
  deleteEditHistoryEntry,
  type LocalSyncMeta,
} from "~/services/indexeddb-cache";
import { commitSnapshot } from "~/services/edit-history-local";
import { ragRegisterInBackground } from "~/services/rag-sync";
import {
  isSyncExcludedPath,
  getSyncCompletionStatus,
} from "~/services/sync-client-utils";

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
      const remoteMeta = data.remoteMeta as {
        files: Record<string, { md5Checksum?: string }>;
      } | null;
      if (!remoteMeta) { setRemoteModifiedCount(0); return; }

      const localMeta = await getLocalSyncMeta();
      const localFiles = localMeta?.files ?? {};
      let count = 0;
      for (const [id, rf] of Object.entries(remoteMeta.files)) {
        const lf = localFiles[id];
        if (!lf) {
          // remoteOnly
          count++;
        } else if (lf.md5Checksum !== (rf.md5Checksum ?? "")) {
          // toPull (md5 differs)
          count++;
        }
      }
      setRemoteModifiedCount(count);
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
      const localMeta = (await getLocalSyncMeta()) ?? null;
      let diffRemoteFiles: Record<string, unknown> | null = null;

      // Check diff BEFORE writing anything to Drive
      const modifiedIdsForDiff = await getLocallyModifiedFileIds();
      const diffRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "diff",
          localMeta: localMeta
            ? { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files }
            : null,
          locallyModifiedFileIds: [...modifiedIdsForDiff],
        }),
      });

      if (!diffRes.ok) throw new Error("Failed to compute diff");
      const diffData = await diffRes.json();
      diffRemoteFiles = (diffData.remoteMeta?.files as Record<string, unknown> | undefined) ?? null;

      // Reject push when remote has any pending changes (pull first)
      // Conflicts also mean remote has changed — resolve via Pull flow
      if (
        diffData.diff.conflicts.length > 0
        || diffData.diff.toPull.length > 0
        || diffData.diff.remoteOnly.length > 0
      ) {
        setError("settings.sync.pushRejected");
        setSyncStatus("error");
        return;
      }

      // Safe to push — collect modified files and batch update on Drive
      const allModifiedIds = await getLocallyModifiedFileIds();
      const cachedRemote = await getCachedRemoteMeta();
      const trackedIds = collectTrackedIds(
        cachedRemote?.files,
        diffRemoteFiles,
        localMeta?.files
      );
      const modifiedIds = trackedIds.size > 0
        ? new Set([...allModifiedIds].filter((id) => trackedIds.has(id)))
        : allModifiedIds;

      // Collect file contents from IndexedDB
      const filesToPush: Array<{ fileId: string; content: string; fileName: string }> = [];
      for (const fid of modifiedIds) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        const fileName = cached.fileName ?? cachedRemote?.files?.[fid]?.name ?? fid;
        if (isSyncExcludedPath(fileName)) continue;
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
      const localMeta = (await getLocalSyncMeta()) ?? null;

      // Compute diff
      const modifiedIdsForDiff = await getLocallyModifiedFileIds();
      const diffRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "diff",
          localMeta: localMeta
            ? { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files }
            : null,
          locallyModifiedFileIds: [...modifiedIdsForDiff],
        }),
      });

      if (!diffRes.ok) throw new Error("Failed to compute diff");
      const diffData = await diffRes.json();

      if (diffData.diff.conflicts.length > 0) {
        setConflicts(diffData.diff.conflicts);
        setSyncStatus("conflict");
        return;
      }

      // Clean up localOnly files (deleted on remote, e.g. moved to trash on another device)
      const localOnlyIds: string[] = diffData.diff.localOnly ?? [];
      let baseMeta: LocalSyncMeta | null = localMeta;
      if (localOnlyIds.length > 0) {
        const updatedMetaForDelete: LocalSyncMeta = localMeta ?? {
          id: "current",
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };
        for (const fid of localOnlyIds) {
          await deleteCachedFile(fid);
          await deleteEditHistoryEntry(fid);
          delete updatedMetaForDelete.files[fid];
        }
        updatedMetaForDelete.lastUpdatedAt = new Date().toISOString();
        await setLocalSyncMeta(updatedMetaForDelete);
        baseMeta = updatedMetaForDelete;
      }

      const filesToPull = [...diffData.diff.toPull, ...diffData.diff.remoteOnly];
      if (filesToPull.length === 0) {
        if (localOnlyIds.length > 0) {
          // Inform server to prune deleted files from remote meta
          const pruneRes = await fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "pull",
              fileIds: [],
              localOnlyIds,
            }),
          });
          if (!pruneRes.ok) throw new Error("Failed to sync deletions");
          // Only local cleanups happened, trigger tree refresh
          window.dispatchEvent(new Event("sync-complete"));
          setLastSyncTime(new Date().toISOString());
          const remainingModified = await getLocallyModifiedFileIds();
          setLocalModifiedCount(remainingModified.size);
        }
        setRemoteModifiedCount(0);
        setSyncStatus("idle");
        return;
      }

      // Pull files
      const pullRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pull",
          fileIds: filesToPull,
          localOnlyIds,
        }),
      });

      if (!pullRes.ok) throw new Error("Failed to pull changes");
      const pullData = await pullRes.json();

      // Update local cache and sync meta
      const updatedMeta: LocalSyncMeta = baseMeta ?? {
        id: "current",
        lastUpdatedAt: new Date().toISOString(),
        files: {},
      };

      for (const file of pullData.files) {
        await commitSnapshot(file.fileId, file.content);
        await setCachedFile({
          fileId: file.fileId,
          content: file.content,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          cachedAt: Date.now(),
          fileName: file.fileName,
        });
        updatedMeta.files[file.fileId] = {
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
        };
      }

      updatedMeta.lastUpdatedAt = new Date().toISOString();
      await setLocalSyncMeta(updatedMeta);

      setLastSyncTime(new Date().toISOString());
      window.dispatchEvent(new Event("sync-complete"));
      const pulledIds = (pullData.files as { fileId: string }[]).map((f) => f.fileId);
      if (pulledIds.length > 0) {
        window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: pulledIds } }));
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
          await commitSnapshot(data.file.fileId, data.file.content);
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

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fullPull", skipHashes }),
      });

      if (!res.ok) throw new Error("Full pull failed");
      const data = await res.json();

      // Update local cache with all downloaded files
      const updatedMeta: LocalSyncMeta = {
        id: "current",
        lastUpdatedAt: new Date().toISOString(),
        files: {},
      };

      // Include skipped files in meta too
      for (const [fileId, fileMeta] of Object.entries(data.remoteMeta.files as Record<string, { md5Checksum: string; modifiedTime: string }>)) {
        updatedMeta.files[fileId] = {
          md5Checksum: fileMeta.md5Checksum,
          modifiedTime: fileMeta.modifiedTime,
        };
      }

      for (const file of data.files) {
        await commitSnapshot(file.fileId, file.content);
        await setCachedFile({
          fileId: file.fileId,
          content: file.content,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          cachedAt: Date.now(),
          fileName: file.fileName,
        });
      }

      // Delete cached files that no longer exist on remote
      const remoteFileIds = new Set(Object.keys(data.remoteMeta.files));
      const allCachedIds = await getAllCachedFileIds();
      for (const cachedId of allCachedIds) {
        if (!remoteFileIds.has(cachedId)) {
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
