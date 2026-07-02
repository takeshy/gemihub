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
import { MarkdownFileEditor, type MdEditMode } from "./editors/MarkdownFileEditor";
import { IdeDocumentMemo } from "./editors/IdeDocumentMemo";
import { HtmlFileEditor } from "./editors/HtmlFileEditor";
import { TextFileEditor } from "./editors/TextFileEditor";
import { DiffEditor } from "./editors/DiffEditor";
import { CanvasFileEditor } from "./editors/CanvasFileEditor";
import { BaseFileEditor } from "./editors/BaseFileEditor";
import { DashboardFileEditor } from "./editors/DashboardFileEditor";
import { isBinaryFileName, isBinaryMimeType } from "~/services/sync-client-utils";
import { BinaryFileInfoViewer } from "./BinaryFileInfoViewer";

/**
 * Markdown editor wrapped with the per-document memo timeline. Tracks the
 * effective edit mode (reported by MarkdownFileEditor for explicit toggles
 * and internal resets alike) so memo anchoring knows when the preview exists.
 */
function MemoMarkdownEditor({
  fileId,
  name,
  drivePath,
  content,
  saveToCache,
  onFileSelect,
  onImageChange,
  onDiffClick,
  onHistoryClick,
}: {
  fileId: string;
  name: string;
  drivePath: string;
  content: string;
  saveToCache: (content: string) => Promise<void>;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
  onDiffClick: () => void;
  onHistoryClick: () => void;
}) {
  const initialMode: MdEditMode = fileId.startsWith("new:") ? "wysiwyg" : "preview";
  const [mode, setMode] = useState<MdEditMode>(initialMode);
  return (
    <IdeDocumentMemo drivePath={drivePath} kind="markdown" markdownMode={mode} refreshSignals={[content]}>
      <MarkdownFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
        onFileSelect={onFileSelect}
        onImageChange={onImageChange}
        onDiffClick={onDiffClick}
        onHistoryClick={onHistoryClick}
        initialMode={initialMode}
        onModeChange={setMode}
      />
    </IdeDocumentMemo>
  );
}

export function TextBasedViewer({
  fileId,
  fileName,
  fileMimeType,
  settings,
  refreshKey,
  onFileSelect,
  onImageChange,
  binaryFallback = false,
}: {
  fileId: string;
  fileName: string | null;
  fileMimeType?: string | null;
  settings: UserSettings;
  refreshKey?: number;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
  binaryFallback?: boolean;
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
  const encryptedCandidate = name.endsWith(".encrypted") || isEncryptedFile(content);
  // Memo files are keyed by the document's Drive path (same identity the
  // dashboard File widget uses), so resolve it from the file list.
  const fileEntry = editorCtx.fileList.find((f) => f.id === fileId);
  const memoDrivePath = fileEntry ? fileEntry.path || fileEntry.name : name;

  if (!encryptedCandidate && binaryFallback && (isBinaryMimeType(fileMimeType) || isBinaryFileName(fileName))) {
    return <BinaryFileInfoViewer fileId={fileId} fileName={fileName} fileMimeType={fileMimeType ?? null} />;
  }

  const handleHistoryClick = async () => {
    const cached = await getCachedFile(fileId);
    const fullPath = cached?.fileName || name;
    setEditHistoryFile({ fileId, filePath: name, fullPath });
  };

  // Determine which editor to render
  let editor: React.ReactNode;

  if (encryptedCandidate) {
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
  } else if (lower.endsWith(".dashboard")) {
    editor = (
      <DashboardFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else if (lower.endsWith(".canvas")) {
    editor = (
      <CanvasFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else if (lower.endsWith(".base")) {
    editor = (
      <BaseFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else if (lower.endsWith(".md")) {
    editor = (
      <MemoMarkdownEditor
        fileId={fileId}
        name={name}
        drivePath={memoDrivePath}
        content={content}
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
      <IdeDocumentMemo drivePath={memoDrivePath} kind="text" refreshSignals={[content]}>
        <TextFileEditor
          fileId={fileId}
          fileName={name}
          initialContent={content}
          saveToCache={saveToCache}
          onDiffClick={handleDiffClick}
          onHistoryClick={handleHistoryClick}
        />
      </IdeDocumentMemo>
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
