import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { isEncryptedFile } from "~/services/crypto-core";
import { addCommitBoundary } from "~/services/edit-history-local";
import { EditorToolbarActions } from "../EditorToolbarActions";
import { performTempUpload } from "~/services/temp-upload";
import { useTempEditConfirm } from "~/hooks/useTempEditConfirm";
import { TempEditUrlDialog } from "~/components/shared/TempEditUrlDialog";
import { TempDiffModal } from "../TempDiffModal";

export function TextFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
  onDiffClick,
  onHistoryClick,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
  onDiffClick?: () => void;
  onHistoryClick?: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const editorCtx = useEditorContext();
  const [uploading, setUploading] = useState(false);
  const [tempDiffData, setTempDiffData] = useState<{
    fileName: string;
    fileId: string;
    currentContent: string;
    tempContent: string;
    tempSavedAt: string;
    currentModifiedTime: string;
    isBinary: boolean;
  } | null>(null);

  // Debounced auto-save to IndexedDB on content change
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);
  const prevFileIdRef = useRef(fileId);

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  useEffect(() => {
    const prev = prevFileIdRef.current;
    prevFileIdRef.current = fileId;
    if (prev.startsWith("new:") && !fileId.startsWith("new:")) return;
    contentFromProps.current = true;
    setContent(initialContent);
  }, [initialContent, fileId]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache, fileId]);

  // Flush pending content on unmount or fileId change (saveToCache identity changes)
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  const tempEditConfirm = useTempEditConfirm();

  const handleTempUpload = useCallback(async () => {
    try {
      const feedback = await performTempUpload({ fileName, fileId, content, t, confirm: tempEditConfirm.confirm, onStart: () => setUploading(true) });
      alert(feedback);
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }, [content, fileName, fileId, t, tempEditConfirm.confirm]);

  const handleTempDownload = useCallback(async () => {
    try {
      const res = await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", fileName }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.found) {
        alert(t("contextMenu.noTempFile"));
        return;
      }
      const { payload } = data.tempFile;
      setTempDiffData({
        fileName,
        fileId,
        currentContent: content,
        tempContent: payload.content,
        tempSavedAt: payload.savedAt,
        currentModifiedTime: "",
        isBinary: fileName.endsWith(".encrypted") || isEncryptedFile(content),
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, content, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    await addCommitBoundary(fileId);
    contentFromProps.current = false;
    setContent(tempDiffData.tempContent);
    await saveToCache(tempDiffData.tempContent);
    setTempDiffData(null);
  }, [tempDiffData, saveToCache, fileId]);

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      editorCtx.setActiveSelection(
        sel ? { text: sel, start: ta.selectionStart, end: ta.selectionEnd } : null
      );
    },
    [editorCtx]
  );

  const flushOnBlur = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveToCache(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [saveToCache]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" onBlur={flushOnBlur}>
      <div className="flex items-center justify-end px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <EditorToolbarActions
          onDiffClick={onDiffClick}
          onHistoryClick={onHistoryClick}
          onTempUpload={handleTempUpload}
          onTempDownload={handleTempDownload}
          uploading={uploading}
        />
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => updateContent(e.target.value)}
          onSelect={handleSelect}
          className="w-full h-full font-mono leading-relaxed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
          style={{ fontSize: "var(--user-font-size, 16px)" }}
          spellCheck={false}
        />
      </div>

      {tempEditConfirm.visible && (
        <TempEditUrlDialog t={t} onYes={tempEditConfirm.onYes} onNo={tempEditConfirm.onNo} />
      )}
      {tempDiffData && (
        <TempDiffModal
          fileName={tempDiffData.fileName}
          currentContent={tempDiffData.currentContent}
          tempContent={tempDiffData.tempContent}
          tempSavedAt={tempDiffData.tempSavedAt}
          currentModifiedTime={tempDiffData.currentModifiedTime}
          isBinary={tempDiffData.isBinary}
          onAccept={handleTempDiffAccept}
          onReject={() => setTempDiffData(null)}
        />
      )}
    </div>
  );
}
