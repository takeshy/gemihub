import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import { getCachedFile } from "~/services/indexeddb-cache";
import type { RightPanelId } from "~/components/ide/Header";

/**
 * Manages the active file state (fileId, fileName, mimeType) and keeps it
 * synchronised with the browser URL, Drive migration events, and decryption
 * events.
 */
export function useActiveFile({
  rightPanel,
  setRightPanel,
}: {
  rightPanel: RightPanelId;
  setRightPanel: (panel: RightPanelId) => void;
}) {
  const [searchParams] = useSearchParams();

  // Active file state — use local state to avoid React Router navigation on file switch
  const [activeFileId, setActiveFileId] = useState<string | null>(
    () => searchParams.get("file")
  );
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [activeFileMimeType, setActiveFileMimeType] = useState<string | null>(
    null
  );

  // Sync active file with browser back/forward navigation
  useEffect(() => {
    const handler = () => {
      const fileId = new URL(window.location.href).searchParams.get("file");
      setActiveFileId(fileId);
      setActiveFileName(null);
      setActiveFileMimeType(null);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Resolve file name when opened via URL (fileId present, fileName unknown)
  useEffect(() => {
    if (activeFileId?.startsWith("new:")) return; // Not yet on Drive
    if (activeFileId && !activeFileName) {
      const applyName = (name: string, mimeType?: string | null) => {
        setActiveFileName(name);
        setActiveFileMimeType(mimeType || null);
        if (!rightPanel.startsWith("plugin:") && !rightPanel.startsWith("main-plugin:")) {
          if (name.endsWith(".yaml") || name.endsWith(".yml")) {
            setRightPanel("workflow");
          } else {
            setRightPanel("chat");
          }
        }
      };

      // Cache-first: use IndexedDB if available, otherwise fetch from API
      getCachedFile(activeFileId).then((cached) => {
        if (cached?.fileName) {
          applyName(cached.fileName);
        } else {
          fetch(`/api/drive/files?action=metadata&fileId=${activeFileId}`)
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
              if (data?.name) applyName(data.name, data.mimeType);
            })
            .catch(() => {});
        }
      }).catch(() => {});
    }
  }, [activeFileId, activeFileName, rightPanel, setRightPanel]);

  // When a new: file is migrated to a real Drive ID, update active file state + URL
  useEffect(() => {
    const handler = (e: Event) => {
      const { oldId, newId, fileName, mimeType } = (e as CustomEvent).detail;
      setActiveFileId((prev) => (prev === oldId ? newId : prev));
      // Use base name (last segment) — fileName from Drive API may be a full path
      const baseName = fileName ? (fileName as string).split("/").pop()! : null;
      setActiveFileName((prev) => (prev === null && baseName ? baseName : prev));
      setActiveFileMimeType((prev) => (prev === null && mimeType ? mimeType : prev));
      // Update URL to use real Drive ID
      const url = new URL(window.location.href);
      if (url.searchParams.get("file") === oldId) {
        url.searchParams.set("file", newId);
        window.history.replaceState({}, "", url.toString());
      }
    };
    window.addEventListener("file-id-migrated", handler);
    return () => window.removeEventListener("file-id-migrated", handler);
  }, []);

  // When a file is permanently decrypted, update active file name (.encrypted removed)
  useEffect(() => {
    const handler = (e: Event) => {
      const { fileId: decryptedId, newName } = (e as CustomEvent).detail;
      if (decryptedId === activeFileId && newName) {
        const baseName = (newName as string).split("/").pop()!;
        setActiveFileName(baseName);
      }
    };
    window.addEventListener("file-decrypted", handler);
    return () => window.removeEventListener("file-decrypted", handler);
  }, [activeFileId]);

  // ---- File selection ----
  const handleSelectFile = useCallback(
    (fileId: string, fileName: string, mimeType: string) => {
      setActiveFileId(fileId);
      setActiveFileName(fileName);
      setActiveFileMimeType(mimeType);
      // Auto-switch right panel based on file type, but keep plugin views open
      if (!rightPanel.startsWith("plugin:") && !rightPanel.startsWith("main-plugin:")) {
        if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
          setRightPanel("workflow");
        } else {
          setRightPanel("chat");
        }
      }
      // Update URL without triggering React Router navigation/loader
      const url = new URL(window.location.href);
      url.searchParams.set("file", fileId);
      window.history.pushState({}, "", url.toString());
    },
    [rightPanel, setRightPanel]
  );

  const clearActiveFile = useCallback(() => {
    setActiveFileId(null);
    setActiveFileName(null);
    setActiveFileMimeType(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("file");
    window.history.pushState({}, "", url.toString());
  }, []);

  return {
    activeFileId,
    activeFileName,
    activeFileMimeType,
    handleSelectFile,
    clearActiveFile,
  };
}
