import { getCachedFile, setCachedFile, deleteCachedFile, getLocalSyncMeta, setLocalSyncMeta, removeLocalSyncMetaEntry } from "~/services/indexeddb-cache";
import { saveLocalEdit, addCommitBoundary } from "~/services/edit-history-local";

/**
 * Attach drive-file-updated, drive-file-created, and drive-file-deleted SSE
 * handlers to an EventSource. These handlers sync file changes from workflow
 * execution into IndexedDB cache and local sync meta, then dispatch events to
 * update the UI (file tree, editor).
 */
export function attachDriveFileHandlers(es: EventSource): void {
  es.addEventListener("drive-file-updated", (e) => {
    const parsed = JSON.parse(e.data) as {
      fileId: string; fileName: string; content?: string;
    };
    const { fileId, fileName, content } = parsed;
    (async () => {
      try {
        if (content != null) {
          // Content provided: update cache and record edit history
          await addCommitBoundary(fileId);
          await saveLocalEdit(fileId, fileName, content);
          const cached = await getCachedFile(fileId);
          await setCachedFile({
            fileId,
            content,
            md5Checksum: cached?.md5Checksum ?? "",
            modifiedTime: cached?.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName,
          });
          await addCommitBoundary(fileId);
          window.dispatchEvent(
            new CustomEvent("file-modified", { detail: { fileId } })
          );
          window.dispatchEvent(
            new CustomEvent("file-restored", { detail: { fileId, content } })
          );
        } else {
          // Content not provided (e.g. rename): tree structure changed,
          // dispatch sync-complete to rebuild the file tree from server meta.
          window.dispatchEvent(new Event("sync-complete"));
        }
      } catch (err) {
        console.warn("[drive-file-sse] Failed to handle drive-file-updated:", err);
      }
    })();
  });

  es.addEventListener("drive-file-created", (e) => {
    const { fileId, fileName, content, md5Checksum, modifiedTime } = JSON.parse(e.data) as {
      fileId: string; fileName: string; content: string; md5Checksum: string; modifiedTime: string;
    };
    (async () => {
      try {
        await setCachedFile({
          fileId,
          content,
          md5Checksum,
          modifiedTime,
          cachedAt: Date.now(),
          fileName,
        });
        const syncMeta = (await getLocalSyncMeta()) ?? {
          id: "current" as const,
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };
        syncMeta.files[fileId] = { md5Checksum, modifiedTime };
        await setLocalSyncMeta(syncMeta);
        window.dispatchEvent(new Event("sync-complete"));
      } catch (err) {
        console.warn("[drive-file-sse] Failed to handle drive-file-created:", err);
      }
    })();
  });

  es.addEventListener("drive-file-deleted", (e) => {
    const { fileId } = JSON.parse(e.data) as {
      fileId: string; fileName: string;
    };
    (async () => {
      try {
        await deleteCachedFile(fileId);
        await removeLocalSyncMetaEntry(fileId);
        window.dispatchEvent(new Event("sync-complete"));
      } catch (err) {
        console.warn("[drive-file-sse] Failed to handle drive-file-deleted:", err);
      }
    })();
  });
}
