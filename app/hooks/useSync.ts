import { useState, useCallback, useEffect, useRef } from "react";
import {
  getLocalSyncMeta,
  setLocalSyncMeta,
  getCachedFile,
  setCachedFile,
  getAllCachedFiles,
  type LocalSyncMeta,
} from "~/services/indexeddb-cache";

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkSync = useCallback(async () => {
    setSyncStatus("checking");
    setError(null);
    try {
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
  }, []);

  const push = useCallback(async () => {
    setSyncStatus("pushing");
    setError(null);
    try {
      // Apply all temp files first
      const tempRes = await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "applyAll" }),
      });
      if (tempRes.ok) {
        const tempData = await tempRes.json();
        const results = tempData.results as Array<{
          fileId: string;
          md5Checksum: string;
          modifiedTime: string;
        }>;
        if (results.length > 0) {
          const localMeta = (await getLocalSyncMeta()) ?? {
            id: "current" as const,
            lastUpdatedAt: new Date().toISOString(),
            files: {},
          };
          for (const r of results) {
            localMeta.files[r.fileId] = {
              md5Checksum: r.md5Checksum,
              modifiedTime: r.modifiedTime,
            };
            // Update IndexedDB cache with new checksum
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
          localMeta.lastUpdatedAt = new Date().toISOString();
          await setLocalSyncMeta(localMeta);
        }
      }

      const localMeta = (await getLocalSyncMeta()) ?? null;
      if (!localMeta) {
        setSyncStatus("idle");
        return;
      }

      // First compute diff
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

      // lastUpdatedAt check: reject push if remote is newer
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

      if (diffData.diff.toPush.length === 0) {
        setSyncStatus("idle");
        return;
      }

      // Push changes
      const pushRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push",
          fileIds: diffData.diff.toPush,
          localMeta: { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files },
        }),
      });

      if (!pushRes.ok) throw new Error("Failed to push changes");

      setLastSyncTime(new Date().toISOString());
      await checkSync(); // Refresh diff
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
      setSyncStatus("error");
    }
  }, [checkSync]);

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

      const filesToPull = [...diffData.diff.toPull, ...diffData.diff.remoteOnly];
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
      // Apply all temp files first
      await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "applyAll" }),
      });

      const localMeta = (await getLocalSyncMeta()) ?? null;
      if (!localMeta) {
        setSyncStatus("idle");
        return;
      }

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fullPush",
          localMeta: { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files },
        }),
      });

      if (!res.ok) throw new Error("Full push failed");

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
    push,
    pull,
    checkSync,
    resolveConflict,
    fullPush,
    fullPull,
  };
}
