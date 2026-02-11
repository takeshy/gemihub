import { useEffect, useRef } from "react";
import {
  getPendingNewFiles,
  getCachedFile,
  deleteCachedFile,
  setCachedFile,
  getEditHistoryForFile,
  setEditHistoryEntry,
  deleteEditHistoryEntry,
  getLocalSyncMeta,
  setLocalSyncMeta,
} from "~/services/indexeddb-cache";

/**
 * Detects `new:` prefix files in IndexedDB (created while offline)
 * and migrates them to Google Drive when the app comes back online.
 */
export function usePendingFileMigration(isOffline: boolean) {
  const runningRef = useRef(false);

  useEffect(() => {
    if (isOffline) return;

    async function migrate() {
      if (runningRef.current) return;
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
            const createRes = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "create",
                name: fullName,
                content: "",
                mimeType,
              }),
            });
            if (!createRes.ok) continue;

            const createData = await createRes.json();
            const file = createData.file;

            // Re-read cache — user may have edited since we started
            const latest = await getCachedFile(pf.fileId);
            if (!latest) continue; // entry was deleted before migration completed

            const currentContent = latest.content;

            // Migrate editHistory entry (new: → real ID)
            const editHistory = await getEditHistoryForFile(pf.fileId);
            if (editHistory) {
              await deleteEditHistoryEntry(pf.fileId);
              await setEditHistoryEntry({
                ...editHistory,
                fileId: file.id,
                filePath: file.name,
              });
            }

            // If user edited content, upload to Drive and get final checksum
            let finalMd5 = file.md5Checksum ?? "";
            let finalModifiedTime = file.modifiedTime ?? "";
            if (currentContent) {
              try {
                const updateRes = await fetch("/api/drive/files", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "update",
                    fileId: file.id,
                    content: currentContent,
                  }),
                });
                if (updateRes.ok) {
                  const updateData = await updateRes.json();
                  finalMd5 = updateData.md5Checksum ?? finalMd5;
                  finalModifiedTime = updateData.file?.modifiedTime ?? finalModifiedTime;
                }
              } catch {
                // Content upload failed — file exists on Drive with empty content
              }
            }

            // Swap cache entries: delete temp, create real
            await deleteCachedFile(pf.fileId);
            await setCachedFile({
              fileId: file.id,
              content: currentContent,
              md5Checksum: finalMd5,
              modifiedTime: finalModifiedTime,
              cachedAt: Date.now(),
              fileName: file.name,
            });

            // Update localSyncMeta so push/pull recognizes this file
            try {
              const localMeta = await getLocalSyncMeta();
              if (localMeta) {
                localMeta.files[file.id] = {
                  md5Checksum: finalMd5,
                  modifiedTime: finalModifiedTime,
                };
                localMeta.lastUpdatedAt = new Date().toISOString();
                await setLocalSyncMeta(localMeta);
              }
            } catch {
              // Non-critical — next pull will fix the inconsistency
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
            // Individual file failure — will retry next time we come online
          }
        }

        // Refresh file tree so newly created Drive files appear
        if (migratedCount > 0) {
          window.dispatchEvent(new Event("sync-complete"));
        }
      } finally {
        runningRef.current = false;
      }
    }

    migrate();
  }, [isOffline]);
}
