import { useEffect } from "react";
import { migratePendingFiles } from "~/services/pending-file-migration";

/**
 * Detects `new:` prefix files in IndexedDB and migrates them to Google Drive.
 * Triggers:
 *   - On mount (picks up files from previous sessions)
 *   - When coming back online (isOffline false → true transition)
 *   - When `pending-files-created` event fires (workflow created a new: file while online)
 *
 * Actual migration runs via the module-level `migratePendingFiles()` singleton
 * so the push flow can await the same in-flight run before pushing.
 */
export function usePendingFileMigration(isOffline: boolean) {
  useEffect(() => {
    if (isOffline) return;
    migratePendingFiles();
  }, [isOffline]);

  useEffect(() => {
    const handler = () => { migratePendingFiles(); };
    window.addEventListener("pending-files-created", handler);
    return () => window.removeEventListener("pending-files-created", handler);
  }, []);
}
