import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { FileText, Loader2, Eye, PenLine, Code, Upload, Download } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { UserSettings } from "~/types/settings";
import { WorkflowEditor } from "./WorkflowEditor";
import { EncryptedFileViewer } from "./EncryptedFileViewer";
import { isEncryptedFile } from "~/services/crypto-core";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { TempDiffModal } from "./TempDiffModal";
import { commitSnapshot } from "~/services/edit-history-local";

interface MainViewerProps {
  fileId: string | null;
  fileName: string | null;
  fileMimeType: string | null;
  settings: UserSettings;
  refreshKey?: number;
}

function isBinaryFile(name: string | null, mimeType: string | null): boolean {
  if (name?.endsWith(".pdf")) return true;
  if (mimeType === "application/pdf") return true;
  return false;
}

export function MainViewer({
  fileId,
  fileName,
  fileMimeType,
  settings,
  refreshKey,
}: MainViewerProps) {
  const { t } = useI18n();

  // No file selected - welcome screen
  if (!fileId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {t("mainViewer.welcome")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
            {t("mainViewer.welcomeDescription")}
          </p>
        </div>
      </div>
    );
  }

  // Binary files (PDF etc.) - don't load via useFileWithCache
  if (isBinaryFile(fileName, fileMimeType)) {
    return (
      <PdfViewer fileId={fileId} fileName={fileName || "file.pdf"} />
    );
  }

  return (
    <TextBasedViewer
      fileId={fileId}
      fileName={fileName}
      settings={settings}
      refreshKey={refreshKey}
    />
  );
}

// ---------------------------------------------------------------------------
// PDF Viewer
// ---------------------------------------------------------------------------

function PdfViewer({ fileId, fileName }: { fileId: string; fileName: string }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
          {fileName}
        </span>
      </div>
      <iframe
        src={`/api/drive/files?action=raw&fileId=${fileId}`}
        className="flex-1 w-full border-0"
        title={fileName}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text-based file viewer (YAML, Markdown, plain text)
// ---------------------------------------------------------------------------

function TextBasedViewer({
  fileId,
  fileName,
  settings,
  refreshKey,
}: {
  fileId: string;
  fileName: string | null;
  settings: UserSettings;
  refreshKey?: number;
}) {
  const { t } = useI18n();
  const { content, loading, error, saveToCache, refresh, forceRefresh } =
    useFileWithCache(fileId, refreshKey);
  const { setActiveFileContent, setActiveFileName, setActiveSelection } = useEditorContext();

  // Push content and file name to EditorContext
  useEffect(() => {
    setActiveFileContent(content);
    setActiveFileName(fileName);
    // Reset selection on file change
    setActiveSelection(null);
  }, [content, fileName, fileId, setActiveFileContent, setActiveFileName, setActiveSelection]);

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

  // Encrypted file: check extension OR content format
  if (name.endsWith(".encrypted") || isEncryptedFile(content)) {
    return (
      <EncryptedFileViewer
        fileId={fileId}
        fileName={name}
        encryptedContent={content}
        encryptionSettings={settings.encryption}
        saveToCache={saveToCache}
        forceRefresh={forceRefresh}
      />
    );
  }

  // Workflow YAML file
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return (
      <WorkflowEditor
        fileId={fileId}
        fileName={name.replace(/\.ya?ml$/, "")}
        initialContent={content}
        settings={settings}
        saveToCache={saveToCache}
      />
    );
  }

  // Markdown file
  if (name.endsWith(".md")) {
    return (
      <MarkdownFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
      />
    );
  }

  // HTML file
  if (name.endsWith(".html") || name.endsWith(".htm")) {
    return (
      <HtmlFileEditor
        fileId={fileId}
        fileName={name}
        initialContent={content}
        saveToCache={saveToCache}
      />
    );
  }

  // Other text files
  return (
    <TextFileEditor
      fileId={fileId}
      fileName={name}
      initialContent={content}
      saveToCache={saveToCache}
    />
  );
}

// ---------------------------------------------------------------------------
// Markdown File Editor (3 modes: Preview / WYSIWYG / Raw)
// ---------------------------------------------------------------------------

const LazyGfmPreview = lazy(() => import("./GfmMarkdownPreview"));
type MdEditMode = "preview" | "wysiwyg" | "raw";

function MarkdownFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
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

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache]);

  const [uploaded, setUploaded] = useState(false);

  const handleTempUpload = useCallback(async () => {
    setUploading(true);
    setUploaded(false);
    try {
      await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", fileName, fileId, content }),
      });
      setUploaded(true);
      setTimeout(() => setUploaded(false), 2000);
    } finally {
      setUploading(false);
    }
  }, [content, fileName, fileId]);

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
        isBinary: fileName.endsWith(".encrypted"),
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, content, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    await commitSnapshot(fileId, tempDiffData.tempContent);
    contentFromProps.current = false;
    setContent(tempDiffData.tempContent);
    await saveToCache(tempDiffData.tempContent);
    setTempDiffData(null);
  }, [tempDiffData, saveToCache, fileId]);

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      editorCtx.setActiveSelection(sel || null);
    },
    [editorCtx]
  );

  // WYSIWYG mode: listen for selection changes
  useEffect(() => {
    function onSelectionChange() {
      const sel = document.getSelection();
      editorCtx.setActiveSelection(sel && sel.toString() ? sel.toString() : null);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [editorCtx]);
  // New file (empty) → wysiwyg, existing file → preview
  const [mode, setMode] = useState<MdEditMode>(
    initialContent ? "preview" : "wysiwyg"
  );

  // Lazy-load MarkdownEditor to avoid SSR issues with wysimark-lite
  const [MarkdownEditorComponent, setMarkdownEditorComponent] = useState<
    React.ComponentType<{
      value: string;
      onChange: (md: string) => void;
      placeholder?: string;
    }> | null
  >(null);

  useEffect(() => {
    contentFromProps.current = true;
    setContent(initialContent);
    setMode("wysiwyg");
  }, [initialContent, fileId]);

  useEffect(() => {
    if (mode === "wysiwyg" && !MarkdownEditorComponent) {
      import("~/components/editor/MarkdownEditor").then((mod) => {
        setMarkdownEditorComponent(() => mod.MarkdownEditor);
      });
    }
  }, [mode, MarkdownEditorComponent]);

  const modes: { key: MdEditMode; icon: React.ReactNode; label: string }[] = [
    { key: "preview", icon: <Eye size={ICON.MD} />, label: t("mainViewer.preview") },
    { key: "wysiwyg", icon: <PenLine size={ICON.MD} />, label: t("mainViewer.wysiwyg") },
    { key: "raw", icon: <Code size={ICON.MD} />, label: t("mainViewer.raw") },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* Mode selector */}
        <div className="flex items-center rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                mode === m.key
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
              title={m.label}
            >
              {m.icon}
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Temp Upload / Download */}
        <div className="flex items-center gap-2">
          {uploaded && (
            <span className="text-xs text-green-600 dark:text-green-400">
              {t("contextMenu.tempUploaded")}
            </span>
          )}
          <button
            onClick={handleTempUpload}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title={t("contextMenu.tempUpload")}
          >
            <Upload size={ICON.SM} />
            {t("contextMenu.tempUpload")}
          </button>
          <button
            onClick={handleTempDownload}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t("contextMenu.tempDownload")}
          >
            <Download size={ICON.SM} />
            {t("contextMenu.tempDownload")}
          </button>
        </div>
      </div>

      {/* Content area */}
      {mode === "preview" && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose dark:prose-invert max-w-none">
            <Suspense fallback={<Loader2 size={ICON.XL} className="animate-spin text-gray-400 mx-auto mt-8" />}>
              <LazyGfmPreview content={content} />
            </Suspense>
          </div>
        </div>
      )}

      {mode === "wysiwyg" && (
        <div className="flex-1 overflow-hidden p-4 flex flex-col">
          {MarkdownEditorComponent ? (
            <MarkdownEditorComponent
              value={content}
              onChange={updateContent}
              placeholder="Write your content here..."
            />
          ) : (
            <Loader2 size={ICON.XL} className="animate-spin text-gray-400 mx-auto mt-8" />
          )}
        </div>
      )}

      {mode === "raw" && (
        <div className="flex-1 p-4">
          <textarea
            value={content}
            onChange={(e) => updateContent(e.target.value)}
            onSelect={handleSelect}
            className="w-full h-full font-mono text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
            spellCheck={false}
          />
        </div>
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

// ---------------------------------------------------------------------------
// HTML File Editor (2 modes: Preview / Raw)
// ---------------------------------------------------------------------------

type HtmlEditMode = "preview" | "raw";

function HtmlFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
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

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  useEffect(() => {
    contentFromProps.current = true;
    setContent(initialContent);
    setMode("preview");
  }, [initialContent, fileId]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache]);

  const [uploaded, setUploaded] = useState(false);

  const handleTempUpload = useCallback(async () => {
    setUploading(true);
    setUploaded(false);
    try {
      await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", fileName, fileId, content }),
      });
      setUploaded(true);
      setTimeout(() => setUploaded(false), 2000);
    } finally {
      setUploading(false);
    }
  }, [content, fileName, fileId]);

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
        isBinary: false,
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, content, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    await commitSnapshot(fileId, tempDiffData.tempContent);
    contentFromProps.current = false;
    setContent(tempDiffData.tempContent);
    await saveToCache(tempDiffData.tempContent);
    setTempDiffData(null);
  }, [tempDiffData, saveToCache, fileId]);

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      editorCtx.setActiveSelection(sel || null);
    },
    [editorCtx]
  );

  const [mode, setMode] = useState<HtmlEditMode>(
    initialContent ? "preview" : "raw"
  );

  const modes: { key: HtmlEditMode; icon: React.ReactNode; label: string }[] = [
    { key: "preview", icon: <Eye size={ICON.MD} />, label: t("mainViewer.preview") },
    { key: "raw", icon: <Code size={ICON.MD} />, label: t("mainViewer.raw") },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* Mode selector */}
        <div className="flex items-center rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                mode === m.key
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
              title={m.label}
            >
              {m.icon}
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Temp Upload / Download */}
        <div className="flex items-center gap-2">
          {uploaded && (
            <span className="text-xs text-green-600 dark:text-green-400">
              {t("contextMenu.tempUploaded")}
            </span>
          )}
          <button
            onClick={handleTempUpload}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title={t("contextMenu.tempUpload")}
          >
            <Upload size={ICON.SM} />
            {t("contextMenu.tempUpload")}
          </button>
          <button
            onClick={handleTempDownload}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t("contextMenu.tempDownload")}
          >
            <Download size={ICON.SM} />
            {t("contextMenu.tempDownload")}
          </button>
        </div>
      </div>

      {/* Content area */}
      {mode === "preview" && (
        <iframe
          srcDoc={content}
          className="flex-1 w-full border-0 bg-white"
          title={fileName}
          sandbox="allow-same-origin"
        />
      )}

      {mode === "raw" && (
        <div className="flex-1 p-4">
          <textarea
            value={content}
            onChange={(e) => updateContent(e.target.value)}
            onSelect={handleSelect}
            className="w-full h-full font-mono text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
            spellCheck={false}
          />
        </div>
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

// ---------------------------------------------------------------------------
// Text File Editor
// ---------------------------------------------------------------------------

function TextFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
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

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  useEffect(() => {
    contentFromProps.current = true;
    setContent(initialContent);
  }, [initialContent, fileId]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache]);

  const [uploaded, setUploaded] = useState(false);

  const handleTempUpload = useCallback(async () => {
    setUploading(true);
    setUploaded(false);
    try {
      await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", fileName, fileId, content }),
      });
      setUploaded(true);
      setTimeout(() => setUploaded(false), 2000);
    } finally {
      setUploading(false);
    }
  }, [content, fileName, fileId]);

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
        isBinary: fileName.endsWith(".encrypted"),
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, content, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    await commitSnapshot(fileId, tempDiffData.tempContent);
    contentFromProps.current = false;
    setContent(tempDiffData.tempContent);
    await saveToCache(tempDiffData.tempContent);
    setTempDiffData(null);
  }, [tempDiffData, saveToCache, fileId]);

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      editorCtx.setActiveSelection(sel || null);
    },
    [editorCtx]
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="flex items-center justify-end gap-2 px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {uploaded && (
          <span className="text-xs text-green-600 dark:text-green-400">
            {t("contextMenu.tempUploaded")}
          </span>
        )}
        <button
          onClick={handleTempUpload}
          disabled={uploading}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          title={t("contextMenu.tempUpload")}
        >
          <Upload size={ICON.SM} />
          {t("contextMenu.tempUpload")}
        </button>
        <button
          onClick={handleTempDownload}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t("contextMenu.tempDownload")}
        >
          <Download size={ICON.SM} />
          {t("contextMenu.tempDownload")}
        </button>
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => updateContent(e.target.value)}
          onSelect={handleSelect}
          className="w-full h-full font-mono text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
          spellCheck={false}
        />
      </div>

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
