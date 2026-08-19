/**
 * useSync — push/pull/resolve orchestrator for the GCS storage backend.
 *
 * Big-bang rewrite (Phase 5d-step3c). Same return shape as the legacy
 * Drive-based hook so existing consumers (Header, ConflictDialog,
 * useSyncUI, _index.tsx) keep compiling. Internals now go through:
 *   - storage-sync.ts (fetch / pull / push / detectChanges)
 *   - storage-cache.ts (IndexedDB)
 *   - /api/storage/* routes
 *
 * Tenant comes from EnterpriseContext. With no project selected, every
 * action is a no-op that surfaces "no project selected" via `error` and
 * leaves status at "idle".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import {
  getCachedObject,
  objectPathForCachedFile,
  saveLocalConflictBackup,
  setLocalSyncEntry,
  setCachedObject,
} from "~/services/storage-cache";
import {
  detectChanges,
  dropLocal,
  fullPullFromRemote,
  pullObject,
  pushObject,
  StorageSyncError,
} from "~/services/storage-sync";
import { diffToLegacyConflicts } from "./sync-conflict-mapper";

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

export interface CachingProgress {
  total: number;
  done: number;
}

const NOT_SELECTED_ERROR = "No enterprise project selected";

export function useStorageSync() {
  const selection = useEnterpriseSelection();
  // Composite tenant key matches what storage-cache stores under.
  const mountKey = selection ? `gcs:${selection.orgId}/${selection.projectId}` : null;
  const mount = selection ? `project:${selection.projectId}` : null;

  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localModifiedCount, setLocalModifiedCount] = useState(0);
  const [remoteModifiedCount, setRemoteModifiedCount] = useState(0);
  const [cachingProgress, setCachingProgress] = useState<CachingProgress | null>(null);

  // Mutex to prevent overlapping push / pull / resolve / fullPull runs.
  const syncLockRef = useRef(false);

  /** Surface an error and flip status to "error". */
  const fail = useCallback((message: string) => {
    setError(message);
    setSyncStatus("error");
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (syncStatus === "error") setSyncStatus("idle");
  }, [syncStatus]);

  /**
   * Recompute push/pull counts + conflicts from the current diff. `freshRemote`
   * forces a server round-trip; otherwise the cached remote snapshot is used.
   */
  const refreshCounts = useCallback(
    async (freshRemote: boolean) => {
      if (!mount || !mountKey) {
        setLocalModifiedCount(0);
        setRemoteModifiedCount(0);
        setConflicts([]);
        return;
      }
      try {
        const { diff } = await detectChanges(mount, mountKey, {
          useCachedRemote: !freshRemote,
        });
        setLocalModifiedCount(diff.toPush.length + diff.localOnly.length);
        setRemoteModifiedCount(diff.toPull.length + diff.remoteOnly.length);
        const legacyConflicts = diffToLegacyConflicts(diff);
        setConflicts(legacyConflicts);
        if (legacyConflicts.length > 0) setSyncStatus("conflict");
      } catch (err) {
        fail(err instanceof Error ? err.message : "diff failed");
      }
    },
    [mount, mountKey, fail],
  );

  // Auto-refresh counts whenever the selected tenant changes.
  useEffect(() => {
    if (!mount || !mountKey) return;
    void refreshCounts(false);
  }, [mount, mountKey, refreshCounts]);

  // Keep the toolbar counts aligned with local edits and with the fresh list
  // calculated when a sync dialog opens. This mirrors upstream GemiHub's
  // file-modified/sync-counts-corrected handling on the GCS diff engine.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshAfterLocalChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshCounts(false), 50);
    };
    const refreshAfterSyncedMutation = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      void refreshCounts(true);
    };
    const correctFromDialog = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: "push" | "pull"; count?: number }>).detail;
      if (!detail || typeof detail.count !== "number") return;
      if (detail.type === "push") setLocalModifiedCount(detail.count);
      if (detail.type === "pull") setRemoteModifiedCount(detail.count);
    };
    window.addEventListener("file-modified", refreshAfterLocalChange);
    window.addEventListener("sync-complete", refreshAfterSyncedMutation);
    window.addEventListener("sync-counts-corrected", correctFromDialog);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("file-modified", refreshAfterLocalChange);
      window.removeEventListener("sync-complete", refreshAfterSyncedMutation);
      window.removeEventListener("sync-counts-corrected", correctFromDialog);
    };
  }, [refreshCounts]);

  const checkRemoteChanges = useCallback(async () => {
    await refreshCounts(true);
  }, [refreshCounts]);

  // ---------------------------------------------------------------------------
  // push
  // ---------------------------------------------------------------------------
  const push = useCallback(async () => {
    if (!mount || !mountKey) {
      fail(NOT_SELECTED_ERROR);
      return;
    }
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setSyncStatus("pushing");
    setError(null);
    try {
      const { diff } = await detectChanges(mount, mountKey, {
        useCachedRemote: false,
      });
      // Push all locally-modified and brand-new files.
      const toPush = [...diff.toPush, ...diff.localOnly];
      const total = toPush.length;
      setCachingProgress({ total, done: 0 });
      let done = 0;
      for (const path of toPush) {
        try {
          await pushObject(mount, mountKey, path);
        } catch (err) {
          if (err instanceof StorageSyncError && err.status === 412) {
            // ifRevisionMatch failed: server changed under us. Surface as a
            // conflict and stop the push.
            await refreshCounts(true);
            fail("settings.sync.pushRejected");
            return;
          }
          throw err;
        }
        done += 1;
        setCachingProgress({ total, done });
      }
      setLastSyncTime(new Date().toISOString());
      await refreshCounts(true);
      if (syncStatus !== "conflict") setSyncStatus("idle");
    } catch (err) {
      fail(err instanceof Error ? err.message : "push failed");
    } finally {
      syncLockRef.current = false;
      setCachingProgress(null);
    }
  }, [mount, mountKey, syncStatus, refreshCounts, fail]);

  // ---------------------------------------------------------------------------
  // pull
  // ---------------------------------------------------------------------------
  const pull = useCallback(
    async (ignoredIds?: Set<string>) => {
      if (!mount || !mountKey) {
        fail(NOT_SELECTED_ERROR);
        return;
      }
      if (syncLockRef.current) return;
      syncLockRef.current = true;
      setSyncStatus("pulling");
      setError(null);
      try {
        const { diff } = await detectChanges(mount, mountKey, {
          useCachedRemote: false,
        });
        const toPull = [...diff.toPull, ...diff.remoteOnly].filter(
          (p) => !ignoredIds?.has(p),
        );
        const total = toPull.length;
        setCachingProgress({ total, done: 0 });
        let done = 0;
        for (const path of toPull) {
          await pullObject(mount, mountKey, path);
          done += 1;
          setCachingProgress({ total, done });
        }
        setLastSyncTime(new Date().toISOString());
        await refreshCounts(true);
        if (syncStatus !== "conflict") setSyncStatus("idle");
      } catch (err) {
        fail(err instanceof Error ? err.message : "pull failed");
      } finally {
        syncLockRef.current = false;
        setCachingProgress(null);
      }
    },
    [mount, mountKey, syncStatus, refreshCounts, fail],
  );

  // ---------------------------------------------------------------------------
  // resolveConflict
  //   - "local"  → push the local cache, overriding remote (skip ifRevisionMatch
  //               by using `0` only-if-absent? no — we WANT to overwrite, so just
  //               push without precondition. We achieve that by calling the API
  //               directly with no ifRevisionMatch.)
  //   - "remote" → drop local cache, then pull fresh from server.
  // ---------------------------------------------------------------------------
  const resolveConflict = useCallback(
    async (fileId: string, resolution: "local" | "remote") => {
      if (!mount || !mountKey) {
        fail(NOT_SELECTED_ERROR);
        return;
      }
      if (syncLockRef.current) {
        throw new Error("Sync already in progress");
      }
      syncLockRef.current = true;
      setSyncStatus(resolution === "local" ? "pushing" : "pulling");
      setError(null);
      try {
        const cached = await getCachedObject(
          mountKey,
          objectPathForCachedFile(mountKey, fileId),
        );
        if (resolution === "remote") {
          if (cached) {
            await saveLocalConflictBackup({
              mountKey,
              relativePath: fileId,
              content: cached.content,
              encoding: cached.encoding,
              contentType: cached.contentType,
            });
          }
          await dropLocal(mountKey, fileId);
          await pullObject(mount, mountKey, fileId);
        } else {
          // Force-push: write through api.storage.write without ifRevisionMatch.
          // pushObject would refuse to clobber a newer server copy; we want to.
          if (!cached) {
            // Can't override with nothing — fall back to dropping the conflict.
            setConflicts((prev) => prev.filter((c) => c.fileId !== fileId));
          } else {
            const params = new URLSearchParams({ mount, path: fileId, format: "json" });
            const remoteRes = await fetch(`/api/storage/read?${params.toString()}`);
            if (!remoteRes.ok) throw new Error(`HTTP ${remoteRes.status}: ${await remoteRes.text()}`);
            const remote = (await remoteRes.json()) as {
              content: string;
              encoding?: "utf-8" | "base64";
              object: { relativePath: string; contentType: string };
            };
            await saveLocalConflictBackup({
              mountKey,
              relativePath: remote.object.relativePath,
              content: remote.content,
              encoding: remote.encoding ?? "utf-8",
              contentType: remote.object.contentType,
            });
            const res = await fetch("/api/storage/write", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mount,
                path: fileId,
                content: cached.content,
                encoding: cached.encoding,
                contentType: cached.contentType,
                // No ifRevisionMatch — caller has explicitly opted to clobber.
              }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            const { object } = (await res.json()) as {
              object: { md5Hash: string; revision: string };
            };
            const updated = {
              ...cached,
              md5Hash: object.md5Hash,
              revision: object.revision,
              dirty: false,
              cachedAt: Date.now(),
            };
            await setCachedObject(updated);
            // This force-write bypasses pushObject, so record the returned GCS
            // revision explicitly. Otherwise the next diff sees no local
            // base and classifies the just-resolved object as remote-only.
            await setLocalSyncEntry({
              mountKey,
              objectPath: updated.objectPath,
              relativePath: updated.relativePath,
              md5Hash: updated.md5Hash,
              revision: updated.revision,
              updatedAt: updated.cachedAt,
            });
          }
        }
        setConflicts((prev) => prev.filter((c) => c.fileId !== fileId));
        setLastSyncTime(new Date().toISOString());
        await refreshCounts(true);
        if (syncStatus === "conflict" && conflicts.length <= 1) setSyncStatus("idle");
      } catch (err) {
        fail(err instanceof Error ? err.message : "conflict resolution failed");
        throw err;
      } finally {
        syncLockRef.current = false;
      }
    },
    [mount, mountKey, conflicts.length, syncStatus, refreshCounts, fail],
  );

  // ---------------------------------------------------------------------------
  // fullPull — refetch remote snapshot and pull every entry, ignoring local diff.
  // ---------------------------------------------------------------------------
  const fullPull = useCallback(async () => {
    if (!mount || !mountKey) {
      fail(NOT_SELECTED_ERROR);
      return;
    }
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setSyncStatus("pulling");
    setError(null);
    try {
      setCachingProgress({ total: 1, done: 0 });
      await fullPullFromRemote(mount, mountKey);
      setCachingProgress({ total: 1, done: 1 });
      setLastSyncTime(new Date().toISOString());
      await refreshCounts(true);
      setSyncStatus("idle");
    } catch (err) {
      fail(err instanceof Error ? err.message : "full pull failed");
    } finally {
      syncLockRef.current = false;
      setCachingProgress(null);
    }
  }, [mount, mountKey, refreshCounts, fail]);

  // ---------------------------------------------------------------------------
  // cacheFilesByIds — bulk pull a set of relativePaths into the local cache.
  // Used by quick-open / search to ensure files are local before display.
  // ---------------------------------------------------------------------------
  const cacheFilesByIds = useCallback(
    async (ids: string[]) => {
      if (!mount || !mountKey) return;
      setCachingProgress({ total: ids.length, done: 0 });
      let done = 0;
      try {
        for (const id of ids) {
          try {
            await pullObject(mount, mountKey, id);
          } catch (err) {
            // Best-effort — log and continue so one missing file doesn't
            // poison the whole batch.
            console.warn("cacheFilesByIds: pull failed for", id, err);
          }
          done += 1;
          setCachingProgress({ total: ids.length, done });
        }
      } finally {
        setCachingProgress(null);
      }
    },
    [mount, mountKey],
  );

  return {
    syncStatus,
    lastSyncTime,
    conflicts,
    error,
    localModifiedCount,
    remoteModifiedCount,
    cachingProgress,
    push,
    pull,
    resolveConflict,
    fullPull,
    clearError,
    checkRemoteChanges,
    cacheFilesByIds,
  };
}
