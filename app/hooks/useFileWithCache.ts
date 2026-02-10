import { useState, useEffect, useCallback, useRef } from "react";
import {
  getCachedFile,
  setCachedFile,
  deleteCachedFile,
  getLocalSyncMeta,
  setLocalSyncMeta,
} from "~/services/indexeddb-cache";
import { saveLocalEdit, initSnapshot } from "~/services/edit-history-local";

export function useFileWithCache(
  fileId: string | null,
  refreshKey?: number
) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const currentFileId = useRef(fileId);
  // Track fileId changes — reset saved, but keep content (avoid null flash)
  const [prevFileId, setPrevFileId] = useState(fileId);
  const [prevRefreshKey, setPrevRefreshKey] = useState(refreshKey);
  if (fileId !== prevFileId) {
    setPrevFileId(fileId);
    currentFileId.current = fileId;
    setContent(null);
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
        // 1. Try IndexedDB cache
        const cached = await getCachedFile(id);

        if (cached && currentFileId.current === id) {
          setContent(cached.content);
          setLoading(false);
          initSnapshot(id, cached.content).catch(() => {});
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
        initSnapshot(id, data.content).catch(() => {});

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
          syncMeta.lastUpdatedAt = new Date().toISOString();
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
    if (fileId) {
      fetchFile(fileId);
    }
  }, [fileId, fetchFile, refreshKey]);

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
      if (!fileId) return;
      try {
        const cached = await getCachedFile(fileId);
        const fileName = cached?.fileName ?? fileId;

        // 1. Record local edit history BEFORE cache update
        //    (saveLocalEdit reads old cache content for reverse-apply diff)
        let hasChange = false;
        try {
          const entry = await saveLocalEdit(fileId, fileName, newContent);
          hasChange = entry !== null;
        } catch {
          // edit history failure is non-critical
        }

        // 2. Update cache with new content
        await setCachedFile({
          fileId,
          content: newContent,
          md5Checksum: cached?.md5Checksum ?? "",
          modifiedTime: cached?.modifiedTime ?? "",
          cachedAt: Date.now(),
          fileName: cached?.fileName,
        });

        // Notify file tree only when edit history actually recorded a change
        if (hasChange) {
          window.dispatchEvent(
            new CustomEvent("file-modified", { detail: { fileId } })
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
