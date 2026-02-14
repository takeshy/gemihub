import { getCachedFile, setCachedFile, getLocalSyncMeta, setLocalSyncMeta } from "~/services/indexeddb-cache";
import { saveLocalEdit, addCommitBoundary } from "~/services/edit-history-local";

/**
 * Attach drive-file-updated and drive-file-created SSE handlers to an EventSource.
 * These handlers sync file changes from workflow execution into IndexedDB cache
 * and local sync meta, then dispatch events to update the UI (file tree, editor).
 */
export function attachDriveFileHandlers(es: EventSource): void {
  es.addEventListener("drive-file-updated", (e) => {
    const { fileId, fileName, content } = JSON.parse(e.data) as {
      fileId: string; fileName: string; content: string;
    };
    (async () => {
      try {
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
}
