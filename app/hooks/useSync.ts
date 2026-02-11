import { useState, useCallback, useEffect } from "react";
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

export interface ConflictInfo {
  fileId: string;
  fileName: string;
  localChecksum: string;
  remoteChecksum: string;
  localModifiedTime: string;
  remoteModifiedTime: string;
}

export type SyncStatus = "idle" | "pushing" | "pulling" | "conflict" | "error";


export function useSync() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localModifiedCount, setLocalModifiedCount] = useState(0);

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

      // Check diff BEFORE writing anything to Drive
      if (localMeta) {
        const modifiedIdsForDiff = await getLocallyModifiedFileIds();
        const diffRes = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "diff",
            localMeta: { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files },
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

      // Safe to push — collect modified files and batch update on Drive
      const allModifiedIds = await getLocallyModifiedFileIds();
      const cachedRemote = await getCachedRemoteMeta();
      const trackedFiles = cachedRemote?.files ?? {};
      const modifiedIds = new Set([...allModifiedIds].filter((id) => trackedFiles[id]));

      // Collect file contents from IndexedDB
      const filesToPush: Array<{ fileId: string; content: string; fileName: string }> = [];
      for (const fid of modifiedIds) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        filesToPush.push({ fileId: fid, content: cached.content, fileName: cached.fileName ?? fid });
      }

      // Batch push files to Drive via single API call
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

        // Update IndexedDB cache with new checksums/timestamps
        for (const r of pushData.results as Array<{ fileId: string; md5Checksum: string; modifiedTime: string }>) {
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
          const newLocal: LocalSyncMeta = {
            id: "current",
            lastUpdatedAt: pushData.remoteMeta.lastUpdatedAt,
            files: {},
          };
          for (const [id, f] of Object.entries(pushData.remoteMeta.files) as [string, { md5Checksum: string; modifiedTime: string }][]) {
            newLocal.files[id] = { md5Checksum: f.md5Checksum, modifiedTime: f.modifiedTime };
          }
          await setLocalSyncMeta(newLocal);
        }
      }

      // Clear edit history only for files that were actually pushed
      for (const fid of modifiedIds) {
        await deleteEditHistoryEntry(fid);
      }
      const remainingModified = await getLocallyModifiedFileIds();
      setLocalModifiedCount(remainingModified.size);
      window.dispatchEvent(new Event("sync-complete"));

      setLastSyncTime(new Date().toISOString());
      setSyncStatus("idle");

      // RAG registration + retry in background (non-blocking)
      ragRegisterInBackground(filesToPush);
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

        // Update local sync meta from remote meta
        if (data.remoteMeta) {
          const metaToUpdate = localMeta ?? {
            id: "current" as const,
            lastUpdatedAt: new Date().toISOString(),
            files: {} as Record<string, { md5Checksum: string; modifiedTime: string }>,
          };
          const fileEntry = data.remoteMeta.files[fileId];
          if (fileEntry) {
            metaToUpdate.files[fileId] = fileEntry;
            metaToUpdate.lastUpdatedAt = new Date().toISOString();
            await setLocalSyncMeta(metaToUpdate);
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
      // Collect modified files from IndexedDB (filter to tracked files only)
      const allModifiedIds = await getLocallyModifiedFileIds();
      const cachedRemote = await getCachedRemoteMeta();
      const trackedFiles = cachedRemote?.files ?? {};
      const modifiedIds = new Set([...allModifiedIds].filter((id) => trackedFiles[id]));
      const filesToPush: Array<{ fileId: string; content: string; fileName: string }> = [];
      for (const fid of modifiedIds) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        filesToPush.push({ fileId: fid, content: cached.content, fileName: cached.fileName ?? fid });
      }

      // Batch push files to Drive via single API call
      if (filesToPush.length > 0) {
        const pushRes = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "pushFiles",
            files: filesToPush.map(({ fileId, content }) => ({ fileId, content })),
          }),
        });
        if (!pushRes.ok) throw new Error("Full push failed");
        const pushData = await pushRes.json();

        // Update IndexedDB cache with new checksums/timestamps
        for (const r of pushData.results as Array<{ fileId: string; md5Checksum: string; modifiedTime: string }>) {
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

        // Update localSyncMeta directly from remoteMeta
        if (pushData.remoteMeta) {
          const newLocal: LocalSyncMeta = {
            id: "current",
            lastUpdatedAt: pushData.remoteMeta.lastUpdatedAt,
            files: {},
          };
          for (const [id, f] of Object.entries(pushData.remoteMeta.files) as [string, { md5Checksum: string; modifiedTime: string }][]) {
            newLocal.files[id] = { md5Checksum: f.md5Checksum, modifiedTime: f.modifiedTime };
          }
          await setLocalSyncMeta(newLocal);
        }
      }

      // All modified files were pushed to Drive, clear all edit history
      await clearAllEditHistory();
      const remainingModified = await getLocallyModifiedFileIds();
      setLocalModifiedCount(remainingModified.size);
      window.dispatchEvent(new Event("sync-complete"));

      setLastSyncTime(new Date().toISOString());
      setSyncStatus("idle");

      // RAG registration + retry in background (non-blocking)
      ragRegisterInBackground(filesToPush);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Full push failed");
      setSyncStatus("error");
    }
  }, []);

  return {
    syncStatus,
    lastSyncTime,
    conflicts,
    error,
    localModifiedCount,
    push,
    pull,
    resolveConflict,
    fullPush,
    fullPull,
  };
}
