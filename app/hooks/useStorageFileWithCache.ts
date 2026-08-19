/**
 * useFileWithCache — file load + save + cache coordination for the GCS
 * storage backend.
 *
 * Enterprise-only. `fileId` is interpreted as a relativePath under the
 * project prefix (the tree route returns relativePath as `id`).
 * "new:" prefix means "locally created, not yet pushed".
 * save / saveToCache write to storage-cache (with `dirty: true`); the
 * next push (useSync) sends them to GCS.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import {
  deleteCachedObject,
  getCachedObject,
  objectPathForCachedFile,
  setCachedObject,
  type CachedObject,
} from "~/services/storage-cache";
import { saveLocalEdit } from "~/services/edit-history-storage";

function mountKeyOf(selection: { orgId: string; projectId: string } | null): string | null {
  return selection ? `gcs:${selection.orgId}/${selection.projectId}` : null;
}

function inferContentType(fileId: string): string {
  const dot = fileId.lastIndexOf(".");
  const ext = dot >= 0 ? fileId.slice(dot + 1).toLowerCase() : "";
  switch (ext) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "yaml":
    case "yml":
      return "text/yaml";
    case "json":
      return "application/json";
    case "html":
      return "text/html";
    default:
      return "text/plain";
  }
}

export function useStorageFileWithCache(
  fileId: string | null,
  refreshKey?: number,
  _debugLabel?: string,
) {
  void _debugLabel;
  const selection = useEnterpriseSelection();
  const mountKey = mountKeyOf(selection);
  const mount = selection ? `project:${selection.projectId}` : null;

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const currentFileIdRef = useRef(fileId);
  // Last content known to match GCS. This lets an edit followed by a full
  // revert clear `dirty` instead of leaving a false-positive push pending.
  const cleanContentRef = useRef<string | null>(null);
  const [prevFileId, setPrevFileId] = useState(fileId);
  const [prevRefreshKey, setPrevRefreshKey] = useState(refreshKey);

  if (fileId !== prevFileId) {
    setPrevFileId(fileId);
    currentFileIdRef.current = fileId;
    cleanContentRef.current = null;
    setContent(null);
    setSaved(false);
    setError(null);
    if (fileId?.startsWith("new:")) setLoading(false);
  }
  if (refreshKey !== prevRefreshKey) {
    setPrevRefreshKey(refreshKey);
  }

  const fetchFile = useCallback(
    async (id: string) => {
      if (!mountKey || !mount) {
        setError("No enterprise project selected");
        setLoading(false);
        return;
      }
      setError(null);

      try {
        // "new:" files exist only in the local cache.
        if (id.startsWith("new:")) {
          const cached = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, id));
          if (currentFileIdRef.current === id) {
            setContent(cached?.content ?? "");
            setLoading(false);
          }
          return;
        }

        // Cache hit: trust it (push/pull syncs the diff).
        const cached = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, id));
        if (cached && currentFileIdRef.current === id) {
          cleanContentRef.current = cached.dirty
            ? (cached.syncedContent ?? null)
            : cached.content;
          setContent(cached.content);
          setLoading(false);
          return;
        }
        if (currentFileIdRef.current === id) setLoading(true);

        // Cache miss → fetch from server.
        const params = new URLSearchParams({ mount, path: id, format: "json" });
        const res = await fetch(`/api/storage/read?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = (await res.json()) as {
          object: {
            objectPath: string;
            relativePath: string;
            contentType: string;
            md5Hash: string;
            revision: string;
          };
          content: string;
        };

        if (currentFileIdRef.current !== id) return;
        cleanContentRef.current = result.content;
        setContent(result.content);

        await setCachedObject({
          mountKey,
          objectPath: result.object.objectPath,
          relativePath: result.object.relativePath,
          content: result.content,
          syncedContent: result.content,
          encoding: "utf-8",
          contentType: result.object.contentType,
          md5Hash: result.object.md5Hash,
          revision: result.object.revision,
          cachedAt: Date.now(),
          dirty: false,
        });
        window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: id } }));
      } catch (err) {
        if (currentFileIdRef.current === id) {
          setError(err instanceof Error ? err.message : "Failed to load file");
        }
      } finally {
        if (currentFileIdRef.current === id) setLoading(false);
      }
    },
    [mount, mountKey],
  );

  useEffect(() => {
    if (fileId) void fetchFile(fileId);
  }, [fileId, fetchFile, refreshKey]);

  /**
   * save — explicit "save now" path. Writes to local cache marked dirty,
   * then asks the storage-sync engine to push immediately. Changes are
   * cached locally first and pushed to GCS directly; there is no temp file
   * concept.
   */
  const save = useCallback(
    async (newContent: string) => {
      if (!fileId || !mountKey || !mount) return;
      setSaving(true);
      setSaved(false);
      try {
        const objPath = objectPathForCachedFile(mountKey, fileId);
        const existing = await getCachedObject(mountKey, objPath);
        const dirty = cleanContentRef.current === null || newContent !== cleanContentRef.current;
        const next: CachedObject = existing
          ? { ...existing, content: newContent, syncedContent: cleanContentRef.current ?? existing.syncedContent, encoding: "utf-8", cachedAt: Date.now(), dirty }
          : {
              mountKey,
              objectPath: objPath,
              relativePath: fileId,
              content: newContent,
              encoding: "utf-8",
              contentType: inferContentType(fileId),
              md5Hash: "",
              revision: "0",
              cachedAt: Date.now(),
              dirty,
            };
        await setCachedObject(next);
        setContent(newContent);

        // Push immediately for non-new files (new: stays local until tree
        // promotes it to a real path).
        if (!fileId.startsWith("new:") && dirty) {
          const { pushObject } = await import("~/services/storage-sync");
          try {
            await pushObject(mount, mountKey, fileId);
            cleanContentRef.current = newContent;
          } catch {
            // Non-fatal: the next sync will retry.
          }
        }
        setSaved(true);
      } finally {
        setSaving(false);
      }
    },
    [fileId, mountKey, mount],
  );

  /**
   * saveToCache — local-only save. Writes to the cache marked dirty so the
   * next push picks it up. No server round-trip.
   */
  const saveToCache = useCallback(
    async (newContent: string) => {
      if (!fileId || !mountKey) return;
      setContent(newContent);
      try {
        const objPath = objectPathForCachedFile(mountKey, fileId);
        const existing = await getCachedObject(mountKey, objPath);
        const dirty = cleanContentRef.current === null || newContent !== cleanContentRef.current;
        const next: CachedObject = existing
          ? { ...existing, content: newContent, syncedContent: cleanContentRef.current ?? existing.syncedContent, encoding: "utf-8", cachedAt: Date.now(), dirty }
          : {
              mountKey,
              objectPath: objPath,
              relativePath: fileId,
              content: newContent,
              encoding: "utf-8",
              contentType: inferContentType(fileId),
              md5Hash: "",
              revision: "0",
              cachedAt: Date.now(),
              dirty,
            };
        await setCachedObject(next);
        await saveLocalEdit(mountKey, fileId, fileId, newContent).catch(() => {});
        window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId } }));
      } catch {
        /* ignore — UI already reflects the new content */
      }
    },
    [fileId, mountKey],
  );

  // After a pull updates the local cache, re-read for the active file.
  useEffect(() => {
    const handler = async (e: Event) => {
      if (!fileId || !mountKey || fileId.startsWith("new:")) return;
      const pulled: string[] = (e as CustomEvent).detail?.fileIds ?? [];
      if (pulled.length > 0 && !pulled.includes(fileId)) return;
      const cached = await getCachedObject(mountKey, objectPathForCachedFile(mountKey, fileId));
      if (cached && currentFileIdRef.current === fileId) {
        cleanContentRef.current = cached.dirty
          ? (cached.syncedContent ?? null)
          : cached.content;
        setContent(cached.content);
      }
    };
    window.addEventListener("files-pulled", handler);
    return () => window.removeEventListener("files-pulled", handler);
  }, [fileId, mountKey]);

  // file-restored from EditHistoryModal — set local content directly.
  // Edit-history itself isn't migrated yet; this handler is harmless when
  // nothing dispatches the event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.fileId === fileId && typeof detail?.content === "string") {
        setContent(detail.content);
      }
    };
    window.addEventListener("file-restored", handler);
    return () => window.removeEventListener("file-restored", handler);
  }, [fileId]);

  const refresh = useCallback(async () => {
    if (fileId) await fetchFile(fileId);
  }, [fileId, fetchFile]);

  const forceRefresh = useCallback(async () => {
    if (!fileId || !mountKey || !mount) return;
    setLoading(true);
    setContent(null);
    await deleteCachedObject(mountKey, objectPathForCachedFile(mountKey, fileId));
    await fetchFile(fileId);
  }, [fileId, mountKey, mount, fetchFile]);

  return { content, loading, error, saving, saved, save, saveToCache, refresh, forceRefresh };
}
