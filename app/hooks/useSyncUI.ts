import { useState, useEffect } from "react";
import { useSync } from "~/hooks/useSync";

/**
 * Wraps `useSync` and manages the related dialog state (conflict dialog,
 * password prompt, push-rejected dialog, and pull trigger).
 *
 * Auto-opens the conflict dialog when conflicts are detected and the
 * push-rejected dialog when sync returns the pushRejected error.
 */
export function useSyncUI() {
  const {
    syncStatus,
    lastSyncTime,
    conflicts,
    error: syncError,
    localModifiedCount,
    remoteModifiedCount,
    push,
    pull,
    resolveConflict,
    fullPull,
    clearError,
  } = useSync();

  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [showPushRejected, setShowPushRejected] = useState(false);
  const [pullDialogTrigger, setPullDialogTrigger] = useState(0);

  // Auto-open conflict dialog when conflicts are detected
  useEffect(() => {
    if (syncStatus === "conflict" && conflicts.length > 0) {
      setShowConflictDialog(true);
    }
  }, [syncStatus, conflicts.length]);

  // Auto-open push rejected dialog
  useEffect(() => {
    if (syncError === "settings.sync.pushRejected") {
      setShowPushRejected(true);
    }
  }, [syncError]);

  return {
    // useSync outputs
    syncStatus,
    lastSyncTime,
    conflicts,
    syncError,
    localModifiedCount,
    remoteModifiedCount,
    push,
    pull,
    resolveConflict,
    fullPull,
    clearError,

    // Dialog state
    showConflictDialog,
    setShowConflictDialog,
    showPasswordPrompt,
    setShowPasswordPrompt,
    showPushRejected,
    setShowPushRejected,
    pullDialogTrigger,
    setPullDialogTrigger,
  };
}
