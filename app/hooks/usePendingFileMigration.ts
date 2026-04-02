import { useEffect, useRef } from "react";
import {
  getPendingNewFiles,
  getCachedFile,
  deleteCachedFile,
  setCachedFile,
  getEditHistoryForFile,
  setEditHistoryEntry,
  deleteEditHistoryEntry,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  getLocalSyncMeta,
  setLocalSyncMeta,
} from "~/services/indexeddb-cache";

/**
 * Detects `new:` prefix files in IndexedDB and migrates them to Google Drive.
 * Triggers:
 *   - On mount (picks up files from previous sessions)
 *   - When coming back online (isOffline false → true transition)
 *   - When `pending-files-created` event fires (workflow created a new: file while online)
 */
export function usePendingFileMigration(isOffline: boolean) {
  const runningRef = useRef(false);
  const pendingRetrigger = useRef(false);

  const migrateRef = useRef<(() => Promise<void>) | undefined>(undefined);
  migrateRef.current = async function migrate() {
    if (isOffline) return;
    if (runningRef.current) {
      // Already running — schedule a re-run after current one finishes
      pendingRetrigger.current = true;
      return;
    }
    runningRef.current = true;

    try {
      const pendingFiles = await getPendingNewFiles();
      if (pendingFiles.length === 0) return;

      let migratedCount = 0;

      for (const pf of pendingFiles) {
        try {
          // pf.fileId is "new:<fullPath>" e.g. "new:workflows/test.yaml"
          const fullName = pf.fileId.slice("new:".length);
          const baseName = fullName.split("/").pop() || fullName;
          const mimeType =
            baseName.endsWith(".yaml") || baseName.endsWith(".yml")
              ? "text/yaml"
              : "text/plain";

          // Create file on Drive (empty — content uploaded separately below)
          // Use dedup to avoid duplicates when the previous session's background
          // create completed on server but the client reloaded before migration
          const createRes = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create",
              name: fullName,
              content: "",
              mimeType,
              dedup: true,
            }),
          });
          if (!createRes.ok) continue;

          const createData = await createRes.json();
          const file = createData.file;

          // Re-read cache — user may have edited since we started
          const latest = await getCachedFile(pf.fileId);
          if (!latest) continue; // entry was deleted before migration completed

          const currentContent = latest.content;
          const emptyMd5 = file.md5Checksum ?? "";
          const emptyModifiedTime = file.modifiedTime ?? "";

          // Migrate editHistory from new: ID to real Drive ID
          const editHistory = await getEditHistoryForFile(pf.fileId);
          if (editHistory) {
            await deleteEditHistoryEntry(pf.fileId);
            await setEditHistoryEntry({
              ...editHistory,
              fileId: file.id,
              filePath: file.name,
            });
          }

          // Swap cache entries: delete temp, create real
          // md5 is the empty file's checksum — content will be pushed via Push flow
          await deleteCachedFile(pf.fileId);
          await setCachedFile({
            fileId: file.id,
            content: currentContent,
            md5Checksum: emptyMd5,
            modifiedTime: emptyModifiedTime,
            cachedAt: Date.now(),
            fileName: file.name,
          });

          // Remove the old new: entry from CachedRemoteMeta and add the real ID
          const meta = await getCachedRemoteMeta();
          if (meta) {
            delete meta.files[pf.fileId];
            meta.files[file.id] = {
              name: file.name,
              mimeType: file.mimeType,
              md5Checksum: emptyMd5,
              modifiedTime: emptyModifiedTime,
              createdTime: file.createdTime ?? emptyModifiedTime,
            };
            await setCachedRemoteMeta(meta);
          }

          // Add to localSyncMeta with the empty file's md5.
          // Since editHistory is preserved, computeSyncDiff treats this as a push candidate.
          const localMeta = await getLocalSyncMeta();
          if (localMeta) {
            localMeta.files[file.id] = {
              md5Checksum: emptyMd5,
              modifiedTime: emptyModifiedTime,
            };
            await setLocalSyncMeta(localMeta);
          }

          // Notify tree, _index, and useFileWithCache to update IDs
          window.dispatchEvent(
            new CustomEvent("file-id-migrated", {
              detail: {
                oldId: pf.fileId,
                newId: file.id,
                fileName: file.name,
                mimeType: file.mimeType,
              },
            })
          );

          migratedCount++;
        } catch {
          // Individual file failure — will retry next time
        }
      }

      // Refresh file tree so newly created Drive files appear
      if (migratedCount > 0) {
        window.dispatchEvent(new Event("sync-complete"));
      }
    } finally {
      runningRef.current = false;
      // If new files were created while migration was running, re-run
      if (pendingRetrigger.current) {
        pendingRetrigger.current = false;
        migrateRef.current?.();
      }
    }
  };

  // Run on mount and when coming back online
  useEffect(() => {
    if (isOffline) return;
    migrateRef.current?.();
  }, [isOffline]);

  // Listen for new: files created while online (e.g., by workflow execution)
  useEffect(() => {
    const handler = () => migrateRef.current?.();
    window.addEventListener("pending-files-created", handler);
    return () => window.removeEventListener("pending-files-created", handler);
  }, []);
}
