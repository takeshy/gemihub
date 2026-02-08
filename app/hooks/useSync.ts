import { useState, useCallback, useEffect, useRef } from "react";
import {
  getLocalSyncMeta,
  setLocalSyncMeta,
  getCachedFile,
  setCachedFile,
  deleteCachedFile,
  getAllCachedFiles,
  clearAllEditHistory,
  getLocallyModifiedFileIds,
  getCachedRemoteMeta,
  deleteEditHistoryEntry,
  type LocalSyncMeta,
} from "~/services/indexeddb-cache";
import { commitSnapshot } from "~/services/edit-history-local";

export interface ConflictInfo {
  fileId: string;
  fileName: string;
  localChecksum: string;
  remoteChecksum: string;
  localModifiedTime: string;
  remoteModifiedTime: string;
}

export interface SyncDiff {
  toPush: string[];
  toPull: string[];
  conflicts: ConflictInfo[];
  localOnly: string[];
  remoteOnly: string[];
}

export type SyncStatus = "idle" | "checking" | "pushing" | "pulling" | "conflict" | "error";

const SYNC_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useSync() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localModifiedCount, setLocalModifiedCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const checkSync = useCallback(async () => {
    setSyncStatus("checking");
    setError(null);
    try {
      await refreshLocalModifiedCount();

      const localMeta = (await getLocalSyncMeta()) ?? null;
      const localMetaPayload = localMeta
        ? { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files }
        : null;

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diff", localMeta: localMetaPayload }),
      });

      if (!res.ok) throw new Error("Failed to check sync status");
      const data = await res.json();

      setDiff(data.diff);
      if (data.diff.conflicts.length > 0) {
        setConflicts(data.diff.conflicts);
        setSyncStatus("conflict");
      } else {
        setConflicts([]);
        setSyncStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync check failed");
      setSyncStatus("error");
    }
  }, [refreshLocalModifiedCount]);

  const push = useCallback(async () => {
    setSyncStatus("pushing");
    setError(null);
    try {
      const localMeta = (await getLocalSyncMeta()) ?? null;

      // Check diff BEFORE writing anything to Drive
      if (localMeta) {
        const diffRes = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "diff",
            localMeta: { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files },
          }),
        });

        if (!diffRes.ok) throw new Error("Failed to compute diff");
        const diffData = await diffRes.json();

        if (diffData.diff.conflicts.length > 0) {
          setConflicts(diffData.diff.conflicts);
          setDiff(diffData.diff);
          setSyncStatus("conflict");
          return;
        }

        // Reject push if remote is newer and has changes to pull
        if (
          diffData.remoteMeta?.lastUpdatedAt &&
          localMeta.lastUpdatedAt &&
          diffData.remoteMeta.lastUpdatedAt > localMeta.lastUpdatedAt &&
          (diffData.diff.toPull.length > 0 || diffData.diff.remoteOnly.length > 0)
        ) {
          setError("settings.sync.pushRejected");
          setSyncStatus("error");
          return;
        }
      }

      // Safe to push — update files directly on Drive
      // Filter to only files tracked in remoteMeta (exclude history/logs)
      const allModifiedIds = await getLocallyModifiedFileIds();
      const cachedRemote = await getCachedRemoteMeta();
      const trackedFiles = cachedRemote?.files ?? {};
      const modifiedIds = new Set([...allModifiedIds].filter((id) => trackedFiles[id]));
      const meta = localMeta ?? {
        id: "current" as const,
        lastUpdatedAt: new Date().toISOString(),
        files: {} as Record<string, { md5Checksum: string; modifiedTime: string }>,
      };

      for (const fid of modifiedIds) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            fileId: fid,
            content: cached.content,
          }),
        });
        if (!res.ok) throw new Error(`Failed to update file ${cached.fileName ?? fid}`);
        const data = await res.json();
        meta.files[fid] = {
          md5Checksum: data.md5Checksum,
          modifiedTime: data.file.modifiedTime,
        };
        await setCachedFile({
          ...cached,
          md5Checksum: data.md5Checksum,
          modifiedTime: data.file.modifiedTime,
          cachedAt: Date.now(),
        });
      }

      // Clear local edit history (now persisted in Drive)
      await clearAllEditHistory();
      setLocalModifiedCount(0);
      window.dispatchEvent(new Event("sync-complete"));

      // Rebuild localSyncMeta from server remoteMeta to stay in sync
      const syncRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diff", localMeta: null }),
      });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        if (syncData.remoteMeta) {
          const newLocal: LocalSyncMeta = {
            id: "current",
            lastUpdatedAt: syncData.remoteMeta.lastUpdatedAt,
            files: {},
          };
          for (const [id, f] of Object.entries(syncData.remoteMeta.files) as [string, { md5Checksum: string; modifiedTime: string }][]) {
            newLocal.files[id] = { md5Checksum: f.md5Checksum, modifiedTime: f.modifiedTime };
          }
          await setLocalSyncMeta(newLocal);
        }
        setDiff(syncData.diff);
      }

      setLastSyncTime(new Date().toISOString());
      setSyncStatus("idle");
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
      const diffRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "diff",
          localMeta: localMeta
            ? { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files }
            : null,
        }),
      });

      if (!diffRes.ok) throw new Error("Failed to compute diff");
      const diffData = await diffRes.json();

      if (diffData.diff.conflicts.length > 0) {
        setConflicts(diffData.diff.conflicts);
        setDiff(diffData.diff);
        setSyncStatus("conflict");
        return;
      }

      // Clean up localOnly files (deleted on remote, e.g. moved to trash on another device)
      const localOnlyIds: string[] = diffData.diff.localOnly ?? [];
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
      }

      const filesToPull = [...diffData.diff.toPull, ...diffData.diff.remoteOnly];
      if (filesToPull.length === 0 && localOnlyIds.length > 0) {
        // Only local cleanups happened, trigger tree refresh
        window.dispatchEvent(new Event("sync-complete"));
        setLastSyncTime(new Date().toISOString());
        await checkSync();
        return;
      }
      if (filesToPull.length === 0) {
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
        }),
      });

      if (!pullRes.ok) throw new Error("Failed to pull changes");
      const pullData = await pullRes.json();

      // Update local cache and sync meta
      const updatedMeta: LocalSyncMeta = localMeta ?? {
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
      await checkSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pull failed");
      setSyncStatus("error");
    }
  }, [checkSync]);

  const resolveConflict = useCallback(
    async (fileId: string, choice: "local" | "remote") => {
      setError(null);
      try {
        const localMeta = (await getLocalSyncMeta()) ?? null;

        // If remote wins, send local content for backup
        let localContent: string | undefined;
        if (choice === "remote") {
          const cached = await getCachedFile(fileId);
          if (cached) {
            localContent = cached.content;
          }
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

        // If remote wins, update local cache
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

        // Update local sync meta from remote meta
        if (data.remoteMeta && localMeta) {
          const fileEntry = data.remoteMeta.files[fileId];
          if (fileEntry) {
            localMeta.files[fileId] = fileEntry;
            localMeta.lastUpdatedAt = new Date().toISOString();
            await setLocalSyncMeta(localMeta);
          }
        }

        // Remove resolved conflict
        setConflicts((prev) => prev.filter((c) => c.fileId !== fileId));

        // If no more conflicts, go back to idle
        setConflicts((prev) => {
          if (prev.length === 0) {
            setSyncStatus("idle");
          }
          return prev;
        });
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

      await setLocalSyncMeta(updatedMeta);
      setLastSyncTime(new Date().toISOString());
      setSyncStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Full pull failed");
      setSyncStatus("error");
    }
  }, []);

  const fullPush = useCallback(async () => {
    setSyncStatus("pushing");
    setError(null);
    try {
      // Update modified files directly on Drive
      const modifiedIds = await getLocallyModifiedFileIds();
      const localMeta = (await getLocalSyncMeta()) ?? {
        id: "current" as const,
        lastUpdatedAt: new Date().toISOString(),
        files: {} as Record<string, { md5Checksum: string; modifiedTime: string }>,
      };

      for (const fid of modifiedIds) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            fileId: fid,
            content: cached.content,
          }),
        });
        if (!res.ok) throw new Error(`Failed to update file ${cached.fileName ?? fid}`);
        const data = await res.json();
        localMeta.files[fid] = {
          md5Checksum: data.md5Checksum,
          modifiedTime: data.file.modifiedTime,
        };
        await setCachedFile({
          ...cached,
          md5Checksum: data.md5Checksum,
          modifiedTime: data.file.modifiedTime,
          cachedAt: Date.now(),
        });
      }

      localMeta.lastUpdatedAt = new Date().toISOString();
      await setLocalSyncMeta(localMeta);

      // Push metadata
      const pushRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fullPush",
          localMeta: { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files },
        }),
      });

      if (!pushRes.ok) throw new Error("Full push failed");

      await clearAllEditHistory();
      setLocalModifiedCount(0);
      window.dispatchEvent(new Event("sync-complete"));

      setLastSyncTime(new Date().toISOString());
      setSyncStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Full push failed");
      setSyncStatus("error");
    }
  }, []);

  // Auto-check every 5 minutes
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      checkSync();
    }, SYNC_CHECK_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [checkSync]);

  return {
    syncStatus,
    lastSyncTime,
    diff,
    conflicts,
    error,
    localModifiedCount,
    push,
    pull,
    checkSync,
    resolveConflict,
    fullPush,
    fullPull,
  };
}
