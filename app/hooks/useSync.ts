import { useState, useCallback, useEffect, useRef } from "react";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import {
  getLocalSyncMeta,
  setLocalSyncMeta,
  getCachedFile,
  setCachedFile,
  deleteCachedFile,
  getAllCachedFileIds,
  clearAllEditHistory,
  getLocallyModifiedFileIds,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  deleteEditHistoryEntry,
  pruneOrphanedEditHistory,
  saveLocalConflictBackup,
  getPendingDeletions,
  deletePendingDeletion,
  bulkRemoveLocalSyncMetaEntries,
  patchLocalSyncMeta,
  type LocalSyncMeta,
} from "~/services/indexeddb-cache-drive";
import { addCommitBoundary, getPushHistoryDiff, hasNetContentChange } from "~/services/edit-history-local";
import { awaitPendingMigrations } from "~/services/pending-file-migration";
import { ragRegisterInBackground } from "~/services/rag-sync";
import { fullPullCacheRecord, type FullPullFilePayload } from "~/services/full-pull-cache";
import {
  isSyncExcludedPath,
  shouldTreatAsBinaryFile,
  isLargeFile,
  getSyncCompletionStatus,
  SYNC_EXCLUDED_FILE_NAMES,
} from "~/services/sync-client-utils";
import { computeSyncDiff, type SyncMeta } from "~/services/sync-diff";
import {
  toLocalSyncMeta,
  collectTrackedIds,
  collectPushCandidates,
  filterActionablePull,
  resurrectDeletedFileAsNew,
  updateCachedRemoteMetaFromSyncMeta,
  cancelPendingDeletionsChangedOnRemote,
} from "./sync-utils";

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

export function useSync() {
  // Drive push/pull is inert while a project mount is selected — the IDE
  // then syncs through useStorageSync and this hook's outputs are unused.
  const projectActive = useEnterpriseSelection() !== null;
  // Ref mirror so long-lived callbacks observe the latest value without
  // re-creating on every selection change.
  const projectActiveRef = useRef(projectActive);
  projectActiveRef.current = projectActive;
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localModifiedCount, setLocalModifiedCount] = useState(0);
  const [remoteModifiedCount, setRemoteModifiedCount] = useState(0);
  const [cachingProgress, setCachingProgress] = useState<{ total: number; done: number } | null>(null);

  // Mutex to prevent concurrent sync operations (push/pull/resolve/fullPull)
  const syncLockRef = useRef(false);

  /**
   * Compute both push and pull counts from a single diff to keep them in sync.
   * Accepts optional freshRemoteMeta so callers with fresh server data (e.g.
   * checkRemoteChanges, push rejection) can avoid reading stale cached meta.
   */
  const refreshSyncCounts = useCallback(async (freshRemoteMeta?: SyncMeta | null) => {
    if (projectActiveRef.current) return;
    try {
      const cachedRemote = await getCachedRemoteMeta();
      const remoteMeta = freshRemoteMeta !== undefined
        ? freshRemoteMeta
        : cachedRemote
          ? {
              lastUpdatedAt: cachedRemote.lastUpdatedAt,
              // Exclude local-only "new:" entries so they aren't treated as remote files
              files: Object.fromEntries(
                Object.entries(cachedRemote.files).filter(([id]) => !id.startsWith("new:"))
              ),
            }
          : null;
      const localMeta = await getLocalSyncMeta();
      // Pass cachedRemote (unfiltered), not remoteMeta — pending-migration
      // `new:` entries would otherwise look orphaned and get pruned.
      await pruneOrphanedEditHistory(
        collectTrackedIds(localMeta?.files, cachedRemote?.files),
      );
      const ids = await getLocallyModifiedFileIds();
      const diff = computeSyncDiff(
        localMeta ?? null,
        remoteMeta,
        ids
      );
      const remoteFiles = remoteMeta?.files ?? {};
      const localFiles = localMeta?.files ?? {};

      // --- Push count ---
      const pushCandidates = await collectPushCandidates(ids, remoteFiles);
      const pendingDeletions = await getPendingDeletions();
      setLocalModifiedCount(pushCandidates.length + pendingDeletions.length);

      // --- Pull count ---
      // When remoteMeta is null (no sync meta on Drive), there is nothing to pull.
      if (!remoteMeta) {
        setRemoteModifiedCount(0);
      } else {
        // Shared filters (see filterActionablePull) keep the badge, the pull
        // dialog, and the push pre-check consistent. remoteOnly is not counted:
        // background polling auto-registers new remote files as uncached entries.
        const actionable = await filterActionablePull(diff, localFiles, remoteFiles);
        setRemoteModifiedCount(
          actionable.toPull.length +
          actionable.deletedOnRemote.length +
          actionable.editDeleteConflicts.length +
          actionable.conflicts.length
        );
      }
    } catch {
      // ignore
    }
  }, []);

  // Listen for file-modified events to update counts in real-time
  useEffect(() => {
    if (projectActive) return;
    // "file-modified" fires on every debounced auto-save. Recomputing the
    // counts reverse-applies the edit history of every dirty file, so coalesce
    // bursts instead of running that scan once per keystroke batch.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedHandler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshSyncCounts();
      }, 250);
    };
    const immediateHandler = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      void refreshSyncCounts();
    };
    const correctionHandler = (e: Event) => {
      const { type, count } = (e as CustomEvent).detail;
      if (type === "pull") setRemoteModifiedCount(count);
      else if (type === "push") setLocalModifiedCount(count);
    };
    window.addEventListener("file-modified", debouncedHandler);
    window.addEventListener("sync-complete", immediateHandler);
    window.addEventListener("sync-counts-corrected", correctionHandler);
    refreshSyncCounts();
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("file-modified", debouncedHandler);
      window.removeEventListener("sync-complete", immediateHandler);
      window.removeEventListener("sync-counts-corrected", correctionHandler);
    };
  }, [refreshSyncCounts, projectActive]);

  // Ref to access syncStatus inside interval without re-creating it
  const syncStatusRef = useRef(syncStatus);
  syncStatusRef.current = syncStatus;

  // Check remote changes by fetching fresh remoteMeta, then recompute both counts
  const checkRemoteChanges = useCallback(async () => {
    if (projectActiveRef.current) return;
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
        const remoteChanged = existingCached?.lastUpdatedAt !== remoteMeta.lastUpdatedAt;
        const localMeta = await getLocalSyncMeta();
        const localFiles = localMeta?.files ?? {};
        // A queued deletion loses to a remote edit made after it was queued.
        // Cancel the reservation so the file re-enters CachedRemoteMeta below
        // and shows up as a pending pull instead of being hidden.
        const { remaining: pendingDeletionIds, cancelled: cancelledDeletions } =
          await cancelPendingDeletionsChangedOnRemote(localFiles, remoteMeta.files);
        // Preserve local-only "new:" entries that haven't been migrated to Drive yet
        const mergedFiles = Object.fromEntries(
          Object.entries(remoteMeta.files).filter(([id]) => !pendingDeletionIds.has(id)),
        );
        if (existingCached) {
          for (const [id, entry] of Object.entries(existingCached.files)) {
            if (id.startsWith("new:") && !(id in mergedFiles)) {
              mergedFiles[id] = entry;
            }
          }
        }
        await setCachedRemoteMeta({
          id: "current",
          rootFolderId: existingCached?.rootFolderId ?? "",
          lastUpdatedAt: remoteMeta.lastUpdatedAt,
          files: mergedFiles,
          cachedAt: Date.now(),
        });

        // Auto-register new remote files into localSyncMeta as uncached entries.
        // Without this, newly-created files on Drive would inflate the pull badge.
        // Tree is always visible; content is lazy-fetched by useFileWithCache.
        const newEntries: Record<string, LocalSyncMeta["files"][string]> = {};
        for (const [id, f] of Object.entries(remoteMeta.files)) {
          if (pendingDeletionIds.has(id)) continue;
          if (localFiles[id]) continue;
          if (SYNC_EXCLUDED_FILE_NAMES.has(f.name)) continue;
          newEntries[id] = {
            md5Checksum: f.md5Checksum,
            modifiedTime: f.modifiedTime,
            name: f.name,
            size: f.size,
          };
        }

        // Auto-clean stale entries: in localMeta but not in remoteMeta,
        // with no cached content. These are locally-deleted files whose
        // metadata is stale — no user action needed.
        const staleIds: string[] = [];
        for (const id of Object.keys(localFiles)) {
          if (id.startsWith("new:")) continue;
          if (remoteMeta.files[id]) continue;
          const cached = await getCachedFile(id);
          if (!cached) staleIds.push(id);
        }

        const newCount = Object.keys(newEntries).length;
        const metaChanged = newCount > 0 || staleIds.length > 0;
        if (metaChanged) {
          for (const id of staleIds) await deleteEditHistoryEntry(id);
          // Apply as a delta against the *current* stored meta: the per-file
          // cache reads above take a while, and a migration or file creation
          // that landed meanwhile must not be clobbered by a stale snapshot.
          await patchLocalSyncMeta((meta) => {
            let changed = false;
            for (const [id, entry] of Object.entries(newEntries)) {
              if (!meta.files[id]) { meta.files[id] = entry; changed = true; }
            }
            for (const id of staleIds) {
              if (meta.files[id]) { delete meta.files[id]; changed = true; }
            }
            return changed;
          }, { createIfMissing: newCount > 0 });
        }

        // Toast when a previous sync exists — the first ever fetch would flag the
        // entire workspace as "new", which is noise. existingCached being present
        // is the best signal that the user has synced this workspace before.
        // Filter out excluded prefixes (history/, plugins/, sync_conflicts/ ...)
        // so internal churn does not surface as user-facing notifications.
        if (newCount > 0 && existingCached) {
          const visibleNames = Object.values(newEntries)
            .map((e) => e.name)
            .filter((n): n is string => !!n && !isSyncExcludedPath(n))
            .sort();
          if (visibleNames.length > 0) {
            window.dispatchEvent(new CustomEvent("show-toast", {
              detail: {
                key: "sync.newFilesDetected",
                params: { count: visibleNames.length, names: visibleNames.join("\n") },
                // Persistent: require a manual close so the full list stays readable.
                durationMs: 0,
              },
            }));
          }
        }

        if (cancelledDeletions.length > 0) {
          const names = cancelledDeletions
            .map((id) => remoteMeta.files[id]?.name ?? localFiles[id]?.name ?? id)
            .sort();
          window.dispatchEvent(new CustomEvent("show-toast", {
            detail: {
              key: "sync.deletionCancelledByRemote",
              params: { count: names.length, names: names.join("\n") },
              durationMs: 0,
            },
          }));
        }

        // Rebuild tree when the remote meta changed or we auto-registered/cleaned entries.
        // No detail → handler re-reads CachedRemoteMeta + localMeta itself.
        if (remoteChanged || metaChanged || cancelledDeletions.length > 0) {
          window.dispatchEvent(new Event("tree-meta-updated"));
        }
      }

      // Recompute both push and pull counts from the fresh remoteMeta
      await refreshSyncCounts(remoteMeta ?? null);
    } catch {
      // ignore network errors
    }
  }, [refreshSyncCounts]);

  // Poll remote changes every 5 minutes + initial check. Also re-check when the
  // tab becomes visible again or the network comes back: the Pull button is
  // disabled while the badge reads 0, so without this a user returning to the
  // tab could wait a full interval before another device's push shows up.
  useEffect(() => {
    if (projectActive) return;
    checkRemoteChanges();
    const interval = setInterval(checkRemoteChanges, 5 * 60 * 1000);
    let lastVisibilityCheck = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastVisibilityCheck < 30 * 1000) return;
      lastVisibilityCheck = Date.now();
      void checkRemoteChanges();
    };
    const onOnline = () => { void checkRemoteChanges(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [checkRemoteChanges, projectActive]);

  const push = useCallback(async () => {
    if (projectActiveRef.current) return;
    if (syncLockRef.current) { console.warn("[useSync] push skipped: sync already in progress"); return; }
    syncLockRef.current = true;
    setSyncStatus("pushing");
    setError(null);
    try {
      // 0. Drain any in-flight `new:` file migrations before diff.
      // Push filters out `new:` IDs (they have no real Drive file yet), so
      // files still mid-migration would be silently dropped. Waiting here
      // also serializes against concurrent _sync-meta.json writes.
      await awaitPendingMigrations();

      // 1. Fetch fresh remoteMeta (push always uses latest)
      const syncRes = await fetch("/api/sync");
      if (!syncRes.ok) throw new Error("Failed to fetch remote meta");
      const syncData = await syncRes.json();
      const remoteMeta = syncData.remoteMeta as SyncMeta | null;

      // 2. Get local state
      const localMeta = (await getLocalSyncMeta()) ?? null;
      const modifiedIds = await getLocallyModifiedFileIds();

      // Queued deletions whose Drive file changed since they were queued are
      // cancelled here (same rule as background polling) so that the pull
      // dialog opened from the rejection below actually lists the file.
      await cancelPendingDeletionsChangedOnRemote(localMeta?.files ?? {}, remoteMeta?.files ?? {});

      // 3. Compute diff client-side
      const diff = computeSyncDiff(localMeta, remoteMeta, modifiedIds);

      // 4. Reject push when remote has pending changes (pull first).
      // Apply the same filters as the pull badge (filterActionablePull) so the
      // gate and the UI agree — otherwise a badge showing 0 could still be
      // rejected with "Pull first". remoteOnly files do not block push.
      const actionable = await filterActionablePull(
        diff,
        localMeta?.files ?? {},
        remoteMeta?.files ?? {}
      );
      if (
        actionable.conflicts.length > 0
        || actionable.editDeleteConflicts.length > 0
        || actionable.toPull.length > 0
        || actionable.deletedOnRemote.length > 0
      ) {
        // Update cached remoteMeta so subsequent pull uses the fresh data
        if (remoteMeta) {
          const existingCached = await getCachedRemoteMeta();
          // Preserve local-only "new:" entries
          const pendingDeletionIds = new Set((await getPendingDeletions()).map((entry) => entry.fileId));
          const mergedFiles = Object.fromEntries(
            Object.entries(remoteMeta.files).filter(([id]) => !pendingDeletionIds.has(id)),
          );
          if (existingCached) {
            for (const [id, entry] of Object.entries(existingCached.files)) {
              if (id.startsWith("new:") && !(id in mergedFiles)) {
                mergedFiles[id] = entry;
              }
            }
          }
          await setCachedRemoteMeta({
            id: "current",
            rootFolderId: existingCached?.rootFolderId ?? "",
            lastUpdatedAt: remoteMeta.lastUpdatedAt,
            files: mergedFiles,
            cachedAt: Date.now(),
          });
          // Recompute both push and pull counts from the fresh remoteMeta
          await refreshSyncCounts(remoteMeta);
        }
        setError("settings.sync.pushRejected");
        setSyncStatus("error");
        return;
      }

      // 5. Collect queued soft deletions. They are sent in the same request as
      // file updates below so Push needs only one mutating API round-trip.
      const pendingDeletions = await getPendingDeletions();

      // 6. Collect modified files and batch update on Drive.
      // All editHistory ids are eligible: tracked files and new/untracked
      // files alike (e.g. right after new: → Drive migration).
      const cachedRemote = await getCachedRemoteMeta();
      const filesToPush: Array<{
        fileId: string;
        content: string;
        fileName: string;
        encoding?: "base64";
        historyDiff?: { diff: string; stats: { additions: number; deletions: number } };
      }> = [];
      const revertedIds: string[] = [];
      // Skip "new:" files — they haven't been migrated to Drive yet and have no real file ID
      for (const fid of [...modifiedIds].filter(id => !id.startsWith("new:"))) {
        const cached = await getCachedFile(fid);
        if (!cached) continue;
        const fileName = cached.fileName ?? cachedRemote?.files?.[fid]?.name ?? remoteMeta?.files?.[fid]?.name ?? fid;
        if (isSyncExcludedPath(fileName)) continue;
        // Binary files: push with encoding flag (skip hasNetContentChange — text diff not applicable)
        if (cached.encoding === "base64") {
          filesToPush.push({ fileId: fid, content: cached.content, fileName, encoding: "base64" });
          continue;
        }
        // Skip files whose content was reverted to synced state (no net change)
        if (!(await hasNetContentChange(fid))) {
          revertedIds.push(fid);
          continue;
        }
        const historyDiff = await getPushHistoryDiff(fid);
        filesToPush.push({
          fileId: fid,
          content: cached.content,
          fileName,
          ...(historyDiff === null ? {} : { historyDiff }),
        });
      }

      // Batch push files to Drive via single API call
      const pushedResultIds = new Set<string>();
      let skippedCount = 0;
      if (filesToPush.length > 0 || pendingDeletions.length > 0) {
        const pushRes = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "pushFiles",
            files: filesToPush.map(({ fileId, content, fileName, encoding, historyDiff }) => ({
              fileId,
              content,
              fileName,
              ...(encoding ? { encoding } : {}),
              ...(historyDiff === undefined ? {} : { historyDiff }),
            })),
            deleteFileIds: pendingDeletions.map((entry) => entry.fileId),
            remoteMeta,
          }),
        });
        if (!pushRes.ok) throw new Error("Failed to push files");
        const pushData = await pushRes.json();
        skippedCount = Array.isArray(pushData.skippedFileIds)
          ? pushData.skippedFileIds.length
          : 0;
        const failedDeletionIds = new Set<string>(pushData.failedDeletionFileIds ?? []);
        const deletedIds = pendingDeletions
          .map((entry) => entry.fileId)
          .filter((id) => !failedDeletionIds.has(id));
        await Promise.all(deletedIds.map((id) => deletePendingDeletion(id)));
        await bulkRemoveLocalSyncMetaEntries(deletedIds);
        if (failedDeletionIds.size > 0) skippedCount += failedDeletionIds.size;

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

        // Merge only the pushed files' entries into localSyncMeta. The
        // returned remoteMeta may contain concurrent changes from other
        // devices (the server re-reads the latest meta before writing);
        // copying it wholesale would mark those files as synced without
        // their content ever being pulled, hiding the updates forever.
        if (pushData.remoteMeta) {
          const returnedMeta = pushData.remoteMeta as SyncMeta;
          const existingLocal = await getLocalSyncMeta();
          const mergedLocal: LocalSyncMeta = existingLocal ?? {
            id: "current",
            lastUpdatedAt: returnedMeta.lastUpdatedAt,
            files: {},
          };
          for (const fid of pushedResultIds) {
            const entry = returnedMeta.files[fid];
            if (entry) {
              mergedLocal.files[fid] = {
                md5Checksum: entry.md5Checksum,
                modifiedTime: entry.modifiedTime,
                name: entry.name,
                size: entry.size,
              };
            }
          }
          mergedLocal.lastUpdatedAt = returnedMeta.lastUpdatedAt;
          await setLocalSyncMeta(mergedLocal);
          await updateCachedRemoteMetaFromSyncMeta(returnedMeta);
        }
      }

      // Clear edit history only for files that were actually pushed successfully
      for (const fileId of pushedResultIds) {
        await deleteEditHistoryEntry(fileId);
      }
      // Clear edit history for reverted files (content matches synced state, no actual diff)
      for (const fileId of revertedIds) {
        await deleteEditHistoryEntry(fileId);
      }
      const remainingModified = await getLocallyModifiedFileIds();
      const remainingDeletions = await getPendingDeletions();
      setLocalModifiedCount(remainingModified.size + remainingDeletions.length);
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

  const pull = useCallback(async (ignoredIds?: Set<string>) => {
    if (projectActiveRef.current) return;
    if (syncLockRef.current) { console.warn("[useSync] pull skipped: sync already in progress"); return; }
    syncLockRef.current = true;
    setSyncStatus("pulling");
    setError(null);
    try {
      // 1. Get fresh remoteMeta from server (always fetch to avoid stale cache)
      let remoteMeta: SyncMeta | null = null;
      const res = await fetch("/api/sync");
      if (!res.ok) throw new Error("Failed to fetch remote meta");
      const data = await res.json();
      remoteMeta = data.remoteMeta as SyncMeta | null;

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

      // 5. Clean up localOnly files (deleted on remote).
      // Skip "new:" files and entries that exist only in editHistory — both are
      // local-only creations awaiting push (counted in the push badge), not
      // remote deletions. Deleting them here would destroy unpushed work.
      const localMetaFiles = localMeta?.files ?? {};
      const deletedRemotely = diff.localOnly.filter(
        id => !id.startsWith("new:") && (id in localMetaFiles)
      );
      // An ignored deletion means "keep this file". Simply skipping it would
      // leave the only copy in the local cache, which the next cache clear
      // would destroy — the file is gone from Drive. Instead the deletion is
      // accepted and the content is re-registered as a NEW local file, which
      // the pending migration uploads to Drive again.
      const ignoredDeletions = ignoredIds
        ? deletedRemotely.filter(id => ignoredIds.has(id))
        : [];
      const localOnlyReal = deletedRemotely.filter(id => !ignoredIds?.has(id));
      let resurrectedAny = false;
      const removedMetaIds: string[] = [];
      for (const fid of ignoredDeletions) {
        const newId = await resurrectDeletedFileAsNew(fid, localMetaFiles[fid]?.name);
        if (!newId) {
          // Nothing cached to keep — apply the deletion like any other.
          await deleteCachedFile(fid);
        }
        await deleteEditHistoryEntry(fid);
        removedMetaIds.push(fid);
        if (newId) resurrectedAny = true;
      }
      for (const fid of localOnlyReal) {
        await deleteCachedFile(fid);
        await deleteEditHistoryEntry(fid);
        removedMetaIds.push(fid);
      }
      if (removedMetaIds.length > 0) {
        // Delta against the stored meta (not the snapshot read above) so
        // entries written concurrently by migration/file creation survive.
        await patchLocalSyncMeta((meta) => {
          let changed = false;
          for (const fid of removedMetaIds) {
            if (meta.files[fid]) { delete meta.files[fid]; changed = true; }
          }
          return changed;
        });
      }

      // 6. Download non-conflict files via pullDirect
      // remoteOnly files (new files from other devices) are registered as metadata-only
      // (uncached) — content is lazy-fetched when the user opens the file.
      const allFilesToPull = [...diff.toPull, ...diff.remoteOnly];
      const remoteFiles = remoteMeta?.files ?? {};
      const remoteOnlySet = new Set(diff.remoteOnly);

      // toPull entries that need no download: sync-excluded paths and files
      // whose cached content already matches the remote checksum (lazy-fetched
      // while localMeta was stale). Their localMeta entry is still updated
      // below so they stop appearing as pending remote changes.
      const metadataOnlyIds = new Set<string>();
      for (const id of diff.toPull) {
        const name = remoteFiles[id]?.name;
        if (name && isSyncExcludedPath(name)) {
          metadataOnlyIds.add(id);
          continue;
        }
        const cached = await getCachedFile(id);
        if (cached?.md5Checksum && cached.md5Checksum === remoteFiles[id]?.md5Checksum) {
          metadataOnlyIds.add(id);
        }
      }

      // Separate ignored modified files. Ignore means leave the local baseline
      // untouched so the remote change remains pending for a later pull.
      const ignoredModifiedIds = new Set(
        ignoredIds ? diff.toPull.filter(id => ignoredIds.has(id)) : []
      );
      const filesToPull = allFilesToPull.filter(id => !ignoredModifiedIds.has(id));

      // LocalSyncMeta entries to upsert once the pull has been applied.
      const upsertEntries: LocalSyncMeta["files"] = {};

      if (filesToPull.length > 0) {
        const isMobile = window.matchMedia("(max-width: 768px)").matches;

        // Skip downloading: new remote files (uncached by design), binary on
        // mobile, large files, and metadata-only entries (already current/excluded)
        const filesToDownload = filesToPull.filter((id) => {
          if (remoteOnlySet.has(id)) return false;
          if (metadataOnlyIds.has(id)) return false;
          if (isMobile && shouldTreatAsBinaryFile(remoteFiles[id]?.name, remoteFiles[id]?.mimeType)) return false;
          if (isLargeFile(remoteFiles[id]?.size)) return false;
          return true;
        });

        // Build mimeTypes map so server can use readFileBase64 for binary files
        const mimeTypes: Record<string, string> = {};
        const fileNames: Record<string, string> = {};
        for (const id of filesToDownload) {
          if (remoteFiles[id]?.mimeType) mimeTypes[id] = remoteFiles[id].mimeType;
          if (remoteFiles[id]?.name) fileNames[id] = remoteFiles[id].name;
        }

        // Track metadata-only entries (new remote files, mobile binary, large
        // files, already-current/excluded files) in localSyncMeta
        for (const id of filesToPull) {
          const rm = remoteFiles[id];
          const isNewRemote = remoteOnlySet.has(id);
          const skippedMobile = isMobile && shouldTreatAsBinaryFile(rm?.name, rm?.mimeType);
          const skippedLarge = isLargeFile(rm?.size);
          if (!(isNewRemote || skippedMobile || skippedLarge || metadataOnlyIds.has(id))) continue;
          upsertEntries[id] = {
            md5Checksum: rm?.md5Checksum ?? "",
            modifiedTime: rm?.modifiedTime ?? "",
            name: rm?.name,
            size: rm?.size,
          };
          if (isNewRemote) continue;
          const cached = await getCachedFile(id);
          if (!cached) continue;
          if (metadataOnlyIds.has(id)) {
            // Content is already current; a remote rename still has to reach
            // the cache record, which push/badge code reads the name from.
            if (rm?.name && cached.fileName !== rm.name) {
              await setCachedFile({ ...cached, fileName: rm.name });
            }
          } else {
            // Download skipped (binary on mobile / over the size limit) but a
            // stale copy is cached. Reads trust the cache unconditionally, so
            // the old bytes would be served forever; drop them and let the
            // file lazy-fetch on next open — the same rule Full Pull applies.
            await deleteCachedFile(id);
          }
        }

        if (filesToDownload.length > 0) {
          const pullRes = await fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pullDirect", fileIds: filesToDownload, mimeTypes, fileNames }),
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
            upsertEntries[file.fileId] = {
              md5Checksum: rm?.md5Checksum ?? "",
              modifiedTime: rm?.modifiedTime ?? "",
              name: rm?.name,
              size: rm?.size,
            };
          }
        }

        // 8. Save localMeta only for applied pulls. Ignored entries deliberately
        // retain their old checksum/name and therefore remain pending.
        // Pulling a newer remote version explicitly cancels a queued deletion
        // for that file; the remote copy becomes authoritative again.
        await Promise.all(filesToPull.map((id) => deletePendingDeletion(id)));
        await patchLocalSyncMeta((meta) => {
          for (const [id, entry] of Object.entries(upsertEntries)) meta.files[id] = entry;
          return true;
        }, { createIfMissing: true });
      }

      if (remoteMeta) await updateCachedRemoteMetaFromSyncMeta(remoteMeta);

      // 9. Dispatch events and update counts
      if (resurrectedAny) {
        // Re-render the tree with the `new:` entries, then upload them to
        // Drive as new files.
        window.dispatchEvent(new Event("tree-meta-updated"));
        window.dispatchEvent(new Event("pending-files-created"));
      }
      if (allFilesToPull.length > 0 || localOnlyReal.length > 0 || resurrectedAny) {
        setLastSyncTime(new Date().toISOString());
        window.dispatchEvent(new Event("sync-complete"));
        if (filesToPull.length > 0) {
          window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: filesToPull } }));
        }
      }
      const remainingModified = await getLocallyModifiedFileIds();
      setLocalModifiedCount(remainingModified.size);

      // 10. Handle conflicts after downloading non-conflict files
      if (allConflicts.length > 0) {
        setConflicts(allConflicts);
        setSyncStatus("conflict");
      } else {
        setRemoteModifiedCount(0);
        setSyncStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pull failed");
      setSyncStatus("error");
    } finally {
      syncLockRef.current = false;
    }
  }, []);

  // When all conflicts are resolved, transition to idle (non-conflict files already downloaded)
  useEffect(() => {
    if (syncStatus === "conflict" && conflicts.length === 0) {
      setSyncStatus("idle");
    }
  }, [syncStatus, conflicts.length]);

  const resolveConflict = useCallback(
    async (fileId: string, choice: "local" | "remote", isEditDelete?: boolean) => {
      if (projectActiveRef.current) return;
      if (syncLockRef.current) {
        throw new Error("Sync already in progress");
      }
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

        // The browser owns conflict backups. For remote-wins the losing local
        // value is already available, so persist it before changing anything.
        if (choice === "remote" && localContent != null) {
          await saveLocalConflictBackup({
            fileId,
            fileName: fileName || fileId,
            content: localContent,
            ...(cached?.encoding ? { encoding: cached.encoding } : {}),
          });
        }

        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resolve",
            fileId,
            choice,
            localContent,
            // Binary cache content is base64 — the server must round-trip it
            // through binary upload/backup instead of writing it as text
            encoding: cached?.encoding,
            isEditDelete: isEditDelete || undefined,
            fileName: isEditDelete ? fileName : undefined,
            localMeta: localMeta
              ? { lastUpdatedAt: localMeta.lastUpdatedAt, files: localMeta.files }
              : null,
          }),
        });

        if (!res.ok) throw new Error("Failed to resolve conflict");
        const data = await res.json();

        // For local-wins the server returns the overwritten remote value; keep
        // it only in IndexedDB rather than creating a Drive conflict folder.
        if (choice === "local" && data.backup) {
          await saveLocalConflictBackup(data.backup);
        }

        // If remote wins, update local cache with remote content
        if (choice === "remote" && data.file) {
          // Binary content has no text edit history — skip the commit boundary
          if (!data.file.encoding) await addCommitBoundary(data.file.fileId);
          await setCachedFile({
            fileId: data.file.fileId,
            content: data.file.content,
            md5Checksum: data.file.md5Checksum,
            modifiedTime: data.file.modifiedTime,
            cachedAt: Date.now(),
            fileName: data.file.fileName,
            ...(data.file.encoding ? { encoding: "base64" as const } : {}),
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
              ...(cached.encoding ? { encoding: cached.encoding } : {}),
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
        throw err;
      } finally {
        syncLockRef.current = false;
      }
    },
    [refreshSyncCounts]
  );

  const fullPull = useCallback(async () => {
    if (projectActiveRef.current) return;
    if (syncLockRef.current) { console.warn("[useSync] fullPull skipped: sync already in progress"); return; }
    syncLockRef.current = true;
    setSyncStatus("pulling");
    setError(null);
    try {
      const isMobile = window.matchMedia("(max-width: 768px)").matches;

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fullPull",
          // Full Pull is authoritative. A cached checksum is the last remote
          // baseline and can still match after the local bytes were edited.
          // Always fetch eligible remote content before clearing edit history.
          skipBinaryContent: isMobile,
          skipLargeFiles: true,
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
      for (const [fileId, fileMeta] of Object.entries(data.remoteMeta.files as Record<string, { name?: string; md5Checksum: string; modifiedTime: string; size?: string }>)) {
        // System files (e.g. legacy _encrypted-auth.json entries) never belong in local sync meta
        if (fileMeta.name && SYNC_EXCLUDED_FILE_NAMES.has(fileMeta.name)) continue;
        updatedMeta.files[fileId] = {
          md5Checksum: fileMeta.md5Checksum,
          modifiedTime: fileMeta.modifiedTime,
          name: fileMeta.name,
          size: fileMeta.size,
        };
      }

      for (const file of data.files as FullPullFilePayload[]) {
        if (!file.encoding) await addCommitBoundary(file.fileId);
        await setCachedFile(fullPullCacheRecord(file));
      }

      // Delete cached files that no longer exist on remote,
      // or binary files that should not be cached on mobile
      const remoteMetaFiles = data.remoteMeta.files as Record<string, { name?: string; mimeType?: string; size?: string }>;
      const remoteFileIds = new Set(Object.keys(remoteMetaFiles));
      const allCachedIds = await getAllCachedFileIds();
      for (const cachedId of allCachedIds) {
        if (!remoteFileIds.has(cachedId)) {
          await deleteCachedFile(cachedId);
        } else if (
          isMobile
          && shouldTreatAsBinaryFile(
            remoteMetaFiles[cachedId]?.name,
            remoteMetaFiles[cachedId]?.mimeType,
          )
        ) {
          await deleteCachedFile(cachedId);
        } else if (isLargeFile(remoteMetaFiles[cachedId]?.size)) {
          await deleteCachedFile(cachedId);
        }
      }

      // Full pull means remote is authoritative — clear all local edit history
      await clearAllEditHistory();

      await setLocalSyncMeta(updatedMeta);
      // Full pull is authoritative — overwrite CachedRemoteMeta WITHOUT merging "new:" entries.
      // Any pending local-only files are discarded along with their edit history (cleared above).
      if (data.remoteMeta) {
        const existing = await getCachedRemoteMeta();
        if (existing) {
          await setCachedRemoteMeta({
            id: "current",
            rootFolderId: existing.rootFolderId,
            lastUpdatedAt: (data.remoteMeta as SyncMeta).lastUpdatedAt,
            files: (data.remoteMeta as SyncMeta).files,
            cachedAt: Date.now(),
          });
        }
      }
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

  const cacheFilesByIds = useCallback(async (fileIds: string[]) => {
    if (projectActiveRef.current) return;
    if (fileIds.length === 0) return;
    if (syncLockRef.current) { console.warn("[useSync] cacheFilesByIds skipped: sync already in progress"); return; }

    const remote = await getCachedRemoteMeta();
    const remoteFiles = remote?.files ?? {};
    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    const targets = fileIds.filter((id) => {
      if (isMobile && shouldTreatAsBinaryFile(remoteFiles[id]?.name, remoteFiles[id]?.mimeType)) return false;
      if (isLargeFile(remoteFiles[id]?.size)) return false;
      return true;
    });
    if (targets.length === 0) return;

    syncLockRef.current = true;
    setSyncStatus("pulling");
    setError(null);
    setCachingProgress({ total: targets.length, done: 0 });

    const CHUNK_SIZE = 200;
    try {
      for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE);
        const mimeTypes: Record<string, string> = {};
        const fileNames: Record<string, string> = {};
        for (const id of chunk) {
          if (remoteFiles[id]?.mimeType) mimeTypes[id] = remoteFiles[id].mimeType;
          if (remoteFiles[id]?.name) fileNames[id] = remoteFiles[id].name;
        }
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pullDirect", fileIds: chunk, mimeTypes, fileNames }),
        });
        if (!res.ok) throw new Error("Failed to cache files");
        const data = await res.json();

        for (const file of data.files as Array<{ fileId: string; content: string; encoding?: "base64" }>) {
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
          window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: file.fileId } }));
        }
        setCachingProgress({ total: targets.length, done: Math.min(i + chunk.length, targets.length) });
      }
      setSyncStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cache failed");
      setSyncStatus("error");
    } finally {
      syncLockRef.current = false;
      setCachingProgress(null);
    }
  }, []);

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
