import { useEffect } from "react";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import { migratePendingFiles } from "~/services/pending-file-migration";

/**
 * Detects `new:` prefix files in IndexedDB and migrates them to Google Drive.
 *
 * Runs on mount / when coming back online, and re-triggers when workflow
 * execution fires `pending-files-created`. While offline we skip both the
 * initial run and the listener so offline creates don't fire doomed fetches.
 */
export function usePendingFileMigration(isOffline: boolean) {
  // Drive migration only: on a project mount, `new:` files are pushed by the
  // storage sync stack instead.
  const projectActive = useEnterpriseSelection() !== null;
  useEffect(() => {
    if (isOffline || projectActive) return;
    migratePendingFiles();
    const handler = () => { migratePendingFiles(); };
    window.addEventListener("pending-files-created", handler);
    return () => window.removeEventListener("pending-files-created", handler);
  }, [isOffline, projectActive]);
}
