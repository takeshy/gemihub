import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { UserSettings } from "~/types/settings";
import { WorkflowEditor } from "./WorkflowEditor";
import { EncryptedFileViewer } from "./EncryptedFileViewer";
import { isEncryptedFile } from "~/services/crypto-core";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { QuickOpenDialog } from "./QuickOpenDialog";
import { getCachedFile } from "~/services/indexeddb-cache";
import { EditHistoryModal } from "./EditHistoryModal";
import { MarkdownFileEditor } from "./editors/MarkdownFileEditor";
import { HtmlFileEditor } from "./editors/HtmlFileEditor";
import { TextFileEditor } from "./editors/TextFileEditor";
import { DiffEditor } from "./editors/DiffEditor";

export function TextBasedViewer({
  fileId,
  fileName,
  settings,
  refreshKey,
  onFileSelect,
  onImageChange,
}: {
  fileId: string;
  fileName: string | null;
  settings: UserSettings;
  refreshKey?: number;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
}) {
  const { t } = useI18n();
  const { content, loading, error, saveToCache, refresh, forceRefresh } =
    useFileWithCache(fileId, refreshKey, "MainViewer");
  const editorCtx = useEditorContext();
  const { setActiveFileId, setActiveFileContent, setActiveFileName, setActiveSelection } = editorCtx;

  // Diff state
  const [diffTarget, setDiffTarget] = useState<{ id: string; name: string } | null>(null);
  const [showDiffPicker, setShowDiffPicker] = useState(false);

  // Edit history state
  const [editHistoryFile, setEditHistoryFile] = useState<{ fileId: string; filePath: string; fullPath: string } | null>(null);

  // Reset diff when file changes
  useEffect(() => {
    setDiffTarget(null);
    setShowDiffPicker(false);
  }, [fileId]);

  const handleDiffClick = useCallback(() => {
    setShowDiffPicker(true);
  }, []);

  // Push content, file name, and file ID to EditorContext
  useEffect(() => {
    setActiveFileId(fileId);
    setActiveFileContent(content);
    setActiveFileName(fileName);
    // Reset selection on file change
    setActiveSelection(null);
  }, [content, fileName, fileId, setActiveFileId, setActiveFileContent, setActiveFileName, setActiveSelection]);

  if (loading && content === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (error && content === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <p className="text-sm text-red-500 mb-2">{error}</p>
          <button
            onClick={refresh}
            className="text-xs text-blue-600 hover:underline"
          >
            {t("mainViewer.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (content === null) {
    return null;
  }

  const name = fileName || "";
  const lower = name.toLowerCase();

  const handleHistoryClick = async () => {
    const cached = await getCachedFile(fileId);
    const fullPath = cached?.fileName || name;
    setEditHistoryFile({ fileId, filePath: name, fullPath });
  };

  // Determine which editor to render
  let editor: React.ReactNode;

  if (name.endsWith(".encrypted") || isEncryptedFile(content)) {
    editor = (
      <EncryptedFileViewer
        fileId={fileId}
        fileName={name}
        encryptedContent={content}
        encryptionSettings={settings.encryption}
        saveToCache={saveToCache}
        forceRefresh={forceRefresh}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else if (diffTarget) {
    // Diff mode: show DiffEditor instead of regular editor
    editor = (
      <DiffEditor
        fileId={fileId}
        fileName={name}
        currentContent={content}
        targetFileId={diffTarget.id}
        targetFileName={diffTarget.name}
        saveToCache={saveToCache}
        onClose={() => setDiffTarget(null)}
      />
    );
  } else if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    editor = (
      <WorkflowEditor
        fileId={fileId}
        fileName={name.replace(/\.ya?ml$/i, "")}
        initialContent={content}
        settings={settings}
        saveToCache={saveToCache}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else if (lower.endsWith(".md")) {
    editor = (
      <MarkdownFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
        onFileSelect={onFileSelect}
        onImageChange={onImageChange}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    editor = (
      <HtmlFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else {
    editor = (
      <TextFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  }

  return (
    <>
      {editor}
      {showDiffPicker && (
        <QuickOpenDialog
          open={showDiffPicker}
          onClose={() => setShowDiffPicker(false)}
          fileList={editorCtx.fileList}
          onSelectFile={(id, selectedName) => {
            setDiffTarget({ id, name: selectedName });
            setShowDiffPicker(false);
          }}
          zClass="z-[1001]"
        />
      )}
      {editHistoryFile && (
        <EditHistoryModal
          fileId={editHistoryFile.fileId}
          filePath={editHistoryFile.filePath}
          fullFilePath={editHistoryFile.fullPath}
          onClose={() => setEditHistoryFile(null)}
        />
      )}
    </>
  );
}
