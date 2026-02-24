import { useState, useEffect, useCallback, useRef } from "react";
import {
  getCachedFile,
  setCachedFile,
  deleteCachedFile,
  getLocalSyncMeta,
  setLocalSyncMeta,
} from "~/services/indexeddb-cache";
import { saveLocalEdit, addCommitBoundary } from "~/services/edit-history-local";

export function useFileWithCache(
  fileId: string | null,
  refreshKey?: number,
  _debugLabel?: string
) {
  const label = _debugLabel || "unknown";
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const currentFileId = useRef(fileId);
  // Guard to prevent concurrent new: → Drive migration
  const migratingRef = useRef(false);
  // Track fileId changes — reset saved, but keep content (avoid null flash)
  const [prevFileId, setPrevFileId] = useState(fileId);
  const [prevRefreshKey, setPrevRefreshKey] = useState(refreshKey);
  // Skip fetchFile when migrating from new: → real ID (content already in React state)
  const skipFetchRef = useRef(false);
  if (fileId !== prevFileId) {
    // Only treat as migration when file-id-migrated event explicitly signaled it
    // (same file, ID changed from new: to real Drive ID).
    // Previously this was inferred from the ID pattern, which also matched
    // navigating from a new: file to a *different* existing file — causing
    // content not to be cleared and the wrong file's content to be displayed.
    const wasMigration = migratingRef.current;
    setPrevFileId(fileId);
    currentFileId.current = fileId;
    if (wasMigration) {
      skipFetchRef.current = true;
      migratingRef.current = false;
    } else {
      skipFetchRef.current = false;
      setContent(null);
      // new: files load from cache instantly — clear stale loading to avoid flash spinner
      if (fileId?.startsWith("new:")) {
        setLoading(false);
      }
    }
    setSaved(false);
    setError(null);
  }
  if (refreshKey !== prevRefreshKey) {
    setPrevRefreshKey(refreshKey);
  }

  const fetchFile = useCallback(
    async (id: string) => {
      setError(null);
      let contentShown = false;

      try {
        // new: prefix files are not yet on Drive — read from seeded cache only
        if (id.startsWith("new:")) {
          const cached = await getCachedFile(id);
          if (currentFileId.current === id) {
            setContent(cached?.content ?? "");
            setLoading(false);
          }
          return;
        }

        // 1. Try IndexedDB cache
        const cached = await getCachedFile(id);

        if (cached && currentFileId.current === id) {
          setContent(cached.content);
          setLoading(false);
          addCommitBoundary(id).catch(() => {});
          return; // Trust the cache. Remote changes are handled by Push/Pull sync.
        } else if (currentFileId.current === id) {
          setLoading(true);
        }

        // 2. Check remote metadata for freshness
        const metaRes = await fetch(
          `/api/drive/files?action=metadata&fileId=${id}`
        );
        if (!metaRes.ok) throw new Error("Failed to fetch metadata");
        const meta = await metaRes.json();

        // 3. If cache matches, we're done
        if (cached && cached.md5Checksum === meta.md5Checksum) {
          await setCachedFile({ ...cached, cachedAt: Date.now(), fileName: cached.fileName ?? meta.name });
          if (currentFileId.current === id) {
            setLoading(false);
          }
          return;
        }

        // 4. Cache miss or stale — fetch full content
        const readRes = await fetch(
          `/api/drive/files?action=read&fileId=${id}`
        );
        if (!readRes.ok) throw new Error("Failed to fetch file");
        const data = await readRes.json();

        const md5 = data.md5Checksum ?? "";
        const modTime = data.modifiedTime ?? "";

        if (currentFileId.current === id) {
          setContent(data.content);
          contentShown = true;
        }

        // 5. Update IndexedDB cache
        await setCachedFile({
          fileId: id,
          content: data.content,
          md5Checksum: md5,
          modifiedTime: modTime,
          cachedAt: Date.now(),
          fileName: meta.name,
        });
        window.dispatchEvent(
          new CustomEvent("file-cached", { detail: { fileId: id } })
        );

        // 6. Initialize edit history snapshot
        addCommitBoundary(id).catch(() => {});

        // 7. Update local sync meta
        if (md5) {
          const syncMeta = (await getLocalSyncMeta()) ?? {
            id: "current" as const,
            lastUpdatedAt: new Date().toISOString(),
            files: {},
          };
          syncMeta.files[id] = {
            md5Checksum: md5,
            modifiedTime: modTime,
          };
          await setLocalSyncMeta(syncMeta);
        }
      } catch (err) {
        if (currentFileId.current === id) {
          if (contentShown) return;
          setError(
            err instanceof Error ? err.message : "Failed to load file"
          );
        }
      } finally {
        if (currentFileId.current === id) {
          setLoading(false);
        }
      }
    },
    []
  );

  // Trigger async fetch when fileId or refreshKey changes
  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    if (fileId) {
      fetchFile(fileId);
    }
  }, [fileId, fetchFile, refreshKey, label]);

  const save = useCallback(
    async (newContent: string) => {
      if (!fileId) return;
      setSaving(true);
      setSaved(false);

      try {
        // 1. Update IndexedDB cache immediately
        const cached = await getCachedFile(fileId);
        await setCachedFile({
          fileId,
          content: newContent,
          md5Checksum: cached?.md5Checksum ?? "",
          modifiedTime: cached?.modifiedTime ?? "",
          cachedAt: Date.now(),
          fileName: cached?.fileName,
        });

        setContent(newContent);

        // 2. Upload temp file to Drive (1-2 API calls)
        const fileName = cached?.fileName ?? fileId;
        await fetch("/api/drive/temp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save",
            fileName,
            fileId,
            content: newContent,
          }),
        });

        setSaved(true);
      } catch {
        // ignore
      } finally {
        setSaving(false);
      }
    },
    [fileId]
  );

  const saveToCache = useCallback(
    async (newContent: string) => {
      // After migration, the closure still has the old new: fileId until React re-renders.
      // Use the migrated real ID from currentFileId.current instead.
      const effectiveFileId = (fileId?.startsWith("new:") && migratingRef.current)
        ? currentFileId.current
        : fileId;
      if (!effectiveFileId) return;
      // Immediately reflect in React state so the UI never lags behind the cache
      setContent(newContent);

      // new: prefix files — just update cache; Drive creation is handled by DriveFileTree background
      if (effectiveFileId.startsWith("new:")) {
        try {
          const cached = await getCachedFile(effectiveFileId);
          if (!cached) return; // File was deleted — don't re-create
          await setCachedFile({
            fileId: effectiveFileId,
            content: newContent,
            md5Checksum: "",
            modifiedTime: "",
            cachedAt: Date.now(),
            fileName: cached.fileName ?? effectiveFileId.slice("new:".length),
          });
        } catch { /* ignore */ }
        return;
      }

      try {
        const cached = await getCachedFile(effectiveFileId);
        if (!cached) return; // File was deleted — don't re-create cache or edit history
        const fileName = cached.fileName ?? effectiveFileId;

        // 1. Record local edit history BEFORE cache update
        //    (saveLocalEdit reads old cache content for reverse-apply diff)
        let editHistoryModified = false;
        try {
          const result = await saveLocalEdit(effectiveFileId, fileName, newContent);
          // result: entry (changed), null (no change), "reverted" (cleaned up)
          editHistoryModified = result !== null;
        } catch {
          // edit history failure is non-critical
        }

        // 2. Update cache with new content
        await setCachedFile({
          fileId: effectiveFileId,
          content: newContent,
          md5Checksum: cached.md5Checksum ?? "",
          modifiedTime: cached.modifiedTime ?? "",
          cachedAt: Date.now(),
          fileName: cached.fileName,
        });

        // Notify file tree when edit history changed (new edit or revert cleanup)
        if (editHistoryModified) {
          window.dispatchEvent(
            new CustomEvent("file-modified", { detail: { fileId: effectiveFileId } })
          );
        }
      } catch {
        // ignore
      }
    },
    [fileId]
  );

  // Listen for file-restored events (from EditHistoryModal restore)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.fileId === fileId && detail?.content != null) {
        setContent(detail.content);
      }
    };
    window.addEventListener("file-restored", handler);
    return () => window.removeEventListener("file-restored", handler);
  }, [fileId]);

  // After pull/fullPull/resolve-remote, re-read cached content for the current file
  useEffect(() => {
    const handler = async (e: Event) => {
      if (!fileId || fileId.startsWith("new:")) return;
      const pulledIds: string[] = (e as CustomEvent).detail?.fileIds ?? [];
      if (pulledIds.length > 0 && !pulledIds.includes(fileId)) return;
      const cached = await getCachedFile(fileId);
      if (cached && currentFileId.current === fileId) {
        setContent(cached.content);
        addCommitBoundary(fileId).catch(() => {});
      }
    };
    window.addEventListener("files-pulled", handler);
    return () => window.removeEventListener("files-pulled", handler);
  }, [fileId]);

  // When a new: file is migrated to a real Drive ID externally (by DriveFileTree),
  // update currentFileId so subsequent saveToCache calls use the real ID.
  useEffect(() => {
    const handler = (e: Event) => {
      const { oldId, newId } = (e as CustomEvent).detail;
      if (oldId === fileId) {
        currentFileId.current = newId;
        migratingRef.current = true;
      }
    };
    window.addEventListener("file-id-migrated", handler);
    return () => window.removeEventListener("file-id-migrated", handler);
  }, [fileId]);

  const refresh = useCallback(async () => {
    if (fileId) {
      await fetchFile(fileId);
    }
  }, [fileId, fetchFile]);

  // Force refresh: clear cache first so fetchFile hits the remote
  const forceRefresh = useCallback(async () => {
    if (fileId) {
      setLoading(true);
      setContent(null);
      await deleteCachedFile(fileId);
      await fetchFile(fileId);
    }
  }, [fileId, fetchFile]);

  return { content, loading, error, saving, saved, save, saveToCache, refresh, forceRefresh };
}
