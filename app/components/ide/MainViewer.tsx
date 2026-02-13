import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { FileText, Loader2, Eye, PenLine, Code, X } from "lucide-react";
import { createTwoFilesPatch } from "diff";
import { ICON } from "~/utils/icon-sizes";
import type { UserSettings } from "~/types/settings";
import { WorkflowEditor } from "./WorkflowEditor";
import { EncryptedFileViewer } from "./EncryptedFileViewer";
import { isEncryptedFile } from "~/services/crypto-core";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { useI18n } from "~/i18n/context";
import { useEditorContext, type SelectionInfo } from "~/contexts/EditorContext";
import { TempDiffModal } from "./TempDiffModal";
import { QuickOpenDialog } from "./QuickOpenDialog";
import { DiffView } from "~/components/shared/DiffView";
import { getCachedFile, setCachedFile } from "~/services/indexeddb-cache";
import { addCommitBoundary } from "~/services/edit-history-local";
import { EditHistoryModal } from "./EditHistoryModal";
import { EditorToolbarActions } from "./EditorToolbarActions";
import { useIsMobile } from "~/hooks/useIsMobile";
import { usePlugins } from "~/contexts/PluginContext";

function WysiwygSelectionTracker({
  setActiveSelection,
  children,
}: {
  setActiveSelection: (sel: SelectionInfo | null) => void;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setActiveSelection(null);
        return;
      }
      // Only track if selection is within this container
      const container = containerRef.current;
      if (!container) return;
      if (!container.contains(sel.anchorNode)) {
        return;
      }
      const text = sel.toString();
      // WYSIWYG doesn't have reliable character offsets into markdown source
      setActiveSelection(text ? { text, start: -1, end: -1 } : null);
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [setActiveSelection]);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden p-4 flex flex-col">
      {children}
    </div>
  );
}

interface MainViewerProps {
  fileId: string | null;
  fileName: string | null;
  fileMimeType: string | null;
  settings: UserSettings;
  refreshKey?: number;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
}

const VIDEO_EXTS = [".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv"];
const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".aac", ".m4a", ".opus"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];

function getMediaType(name: string | null, mimeType: string | null): "pdf" | "video" | "audio" | "image" | null {
  const lower = name?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (VIDEO_EXTS.some((ext) => lower.endsWith(ext)) || mimeType?.startsWith("video/")) return "video";
  if (AUDIO_EXTS.some((ext) => lower.endsWith(ext)) || mimeType?.startsWith("audio/")) return "audio";
  if (IMAGE_EXTS.some((ext) => lower.endsWith(ext)) || mimeType?.startsWith("image/")) return "image";
  return null;
}

export function MainViewer({
  fileId,
  fileName,
  fileMimeType,
  settings,
  refreshKey,
  onFileSelect,
  onImageChange,
}: MainViewerProps) {
  const { t } = useI18n();
  const { mainViews, getPluginAPI } = usePlugins();

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

  // Check if any plugin can handle this file
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext) {
      const pluginView = mainViews.find((v) => v.extensions?.includes(ext));
      const api = pluginView ? getPluginAPI(pluginView.pluginId) : null;
      if (pluginView && api) {
        return (
          <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
            <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {fileName} ({pluginView.name})
              </span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pluginView.component api={api} />
            </div>
          </div>
        );
      }
    }
  }

  // Binary files (PDF, video, audio, image) - don't load via useFileWithCache
  const mediaType = getMediaType(fileName, fileMimeType);
  if (mediaType) {
    return (
      <MediaViewer fileId={fileId} fileName={fileName || "file"} mediaType={mediaType} fileMimeType={fileMimeType} />
    );
  }

  return (
    <TextBasedViewer
      fileId={fileId}
      fileName={fileName}
      settings={settings}
      refreshKey={refreshKey}
      onFileSelect={onFileSelect}
      onImageChange={onImageChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Media Viewer (PDF, Video, Audio, Image)
// ---------------------------------------------------------------------------

function guessMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg", mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska",
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return bytes;
}

function MediaViewer({ fileId, fileName, mediaType, fileMimeType }: { fileId: string; fileName: string; mediaType: "pdf" | "video" | "audio" | "image"; fileMimeType: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    // Revoke previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setSrc(null);
    setError(null);

    let cancelled = false;
    (async () => {
      const cached = await getCachedFile(fileId);
      if (cancelled) return;

      // Helper: create blob URL from bytes and set as src
      const showBlob = (buf: ArrayBuffer) => {
        const mime = fileMimeType || guessMimeType(fileName);
        const blob = new Blob([buf], { type: mime });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrlRef.current = url;
        setSrc(url);
      };

      if (cached?.encoding === "base64" && cached.content) {
        showBlob(base64ToBytes(cached.content).buffer as ArrayBuffer);
      } else {
        // Fetch binary and cache to IndexedDB for offline use
        try {
          const res = await fetch(`/api/drive/files?action=raw&fileId=${fileId}`);
          if (cancelled) return;
          if (!res.ok) {
            setError(t("mainViewer.loadError"));
            return;
          }
          const arrayBuffer = await res.arrayBuffer();
          if (cancelled) return;
          const bytes = new Uint8Array(arrayBuffer);
          // Cache in IndexedDB for offline use
          await setCachedFile({
            fileId,
            content: bytesToBase64(bytes),
            md5Checksum: "",
            modifiedTime: new Date().toISOString(),
            cachedAt: Date.now(),
            fileName,
            encoding: "base64",
          });
          if (cancelled) return;
          window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId } }));
          showBlob(arrayBuffer);
        } catch {
          // Network error (offline) - no cache available
          setError(t("mainViewer.offlineNoCache"));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, fileName, fileMimeType, t]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
          {fileName}
        </span>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      ) : src === null ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {mediaType === "pdf" && (
            <iframe src={src} className="flex-1 w-full border-0" title={fileName} />
          )}
          {mediaType === "video" && (
            <div className="flex-1 flex items-center justify-center p-4">
              <video src={src} controls className="max-w-full max-h-full" />
            </div>
          )}
          {mediaType === "audio" && (
            <div className="flex-1 flex items-center justify-center p-4">
              <audio src={src} controls />
            </div>
          )}
          {mediaType === "image" && (
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
              <img src={src} alt={fileName} className="max-w-full max-h-full object-contain" />
            </div>
          )}
        </>
      )}
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

  const handleHistoryClick = () => {
    setEditHistoryFile({ fileId, filePath: name, fullPath: name });
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
  } else if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    editor = (
      <WorkflowEditor
        fileId={fileId}
        fileName={name.replace(/\.ya?ml$/, "")}
        initialContent={content}
        settings={settings}
        saveToCache={saveToCache}
        onDiffClick={handleDiffClick}
        onHistoryClick={handleHistoryClick}
      />
    );
  } else if (name.endsWith(".md")) {
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
  } else if (name.endsWith(".html") || name.endsWith(".htm")) {
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
  onFileSelect,
  onImageChange,
  onDiffClick,
  onHistoryClick,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
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

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache]);

  // Flush pending content on unmount or fileId change (saveToCache identity changes)
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

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
      onFileSelect?: () => Promise<string | null>;
      onImageChange?: (file: File) => Promise<string>;
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

  const flushOnBlur = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveToCache(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [saveToCache]);

  const modes: { key: MdEditMode; icon: React.ReactNode; label: string }[] = [
    { key: "preview", icon: <Eye size={ICON.MD} />, label: t("mainViewer.preview") },
    { key: "wysiwyg", icon: <PenLine size={ICON.MD} />, label: t("mainViewer.wysiwyg") },
    { key: "raw", icon: <Code size={ICON.MD} />, label: t("mainViewer.raw") },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" onBlur={flushOnBlur}>
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

        <EditorToolbarActions
          onDiffClick={onDiffClick}
          onHistoryClick={onHistoryClick}
          onTempUpload={handleTempUpload}
          onTempDownload={handleTempDownload}
          uploading={uploading}
          uploaded={uploaded}
        />
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
        <WysiwygSelectionTracker setActiveSelection={editorCtx.setActiveSelection}>
          {MarkdownEditorComponent ? (
            <MarkdownEditorComponent
              value={content}
              onChange={updateContent}
              placeholder="Write your content here..."
              onFileSelect={onFileSelect}
              onImageChange={onImageChange}
            />
          ) : (
            <Loader2 size={ICON.XL} className="animate-spin text-gray-400 mx-auto mt-8" />
          )}
        </WysiwygSelectionTracker>
      )}

      {mode === "raw" && (
        <div className="flex-1 p-4">
          <textarea
            value={content.replace(/\u00A0/g, "")}
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

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);

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
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache]);

  // Flush pending content on unmount or fileId change (saveToCache identity changes)
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

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

  const [mode, setMode] = useState<HtmlEditMode>(
    initialContent ? "preview" : "raw"
  );

  const flushOnBlur = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveToCache(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [saveToCache]);

  const isMobile = useIsMobile();

  // Inject touch tracking script into srcDoc so swipe gestures are forwarded
  // to the parent via postMessage. The script is tiny and harmless on desktop
  // (touch events simply don't fire). sandbox="allow-scripts" (without
  // allow-same-origin) keeps the iframe in an opaque origin — safe.
  const srcDocWithTouch = useMemo(() => {
    const script = `<script>
var _sx,_sy,_st;
document.addEventListener('touchstart',function(e){var t=e.touches[0];_sx=t.clientX;_sy=t.clientY;_st=Date.now();});
document.addEventListener('touchend',function(e){var t=e.changedTouches[0];
parent.postMessage({type:'gemihub-iframe-touch',sx:_sx,sy:_sy,st:_st,ex:t.clientX,ey:t.clientY,et:Date.now()},'*');});
</script>`;
    return content + script;
  }, [content]);

  useEffect(() => {
    if (!isMobile) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== "gemihub-iframe-touch") return;
      const { sx, sy, st, ex, ey, et } = e.data;
      const dx = ex - sx;
      const dy = ey - sy;
      const elapsed = et - st;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && elapsed < 300) {
        window.dispatchEvent(
          new CustomEvent("iframe-swipe", { detail: { direction: dx > 0 ? "right" : "left" } })
        );
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isMobile]);

  const modes: { key: HtmlEditMode; icon: React.ReactNode; label: string }[] = [
    { key: "preview", icon: <Eye size={ICON.MD} />, label: t("mainViewer.preview") },
    { key: "raw", icon: <Code size={ICON.MD} />, label: t("mainViewer.raw") },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" onBlur={flushOnBlur}>
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

        <EditorToolbarActions
          onDiffClick={onDiffClick}
          onHistoryClick={onHistoryClick}
          onTempUpload={handleTempUpload}
          onTempDownload={handleTempDownload}
          uploading={uploading}
          uploaded={uploaded}
        />
      </div>

      {/* Content area */}
      {mode === "preview" && (
        <iframe
          srcDoc={srcDocWithTouch}
          className="flex-1 w-full border-0 bg-white"
          title={fileName}
          sandbox="allow-scripts"
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
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache]);

  // Flush pending content on unmount or fileId change (saveToCache identity changes)
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

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
          uploaded={uploaded}
        />
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

// ---------------------------------------------------------------------------
// Diff Editor (split view: editable textarea on top, diff on bottom)
// ---------------------------------------------------------------------------

interface DiffEditorProps {
  fileId: string;
  fileName: string;
  currentContent: string;
  targetFileId: string;
  targetFileName: string;
  saveToCache: (content: string) => Promise<void>;
  onClose: () => void;
}

function DiffEditor({
  fileId: _fileId,
  fileName,
  currentContent,
  targetFileId,
  targetFileName,
  saveToCache,
  onClose,
}: DiffEditorProps) {
  const { t } = useI18n();
  const [content, setContent] = useState(currentContent);
  const [targetContent, setTargetContent] = useState<string | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(true);

  // Debounced auto-save
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  // Sync content when parent's currentContent changes (e.g. external save)
  useEffect(() => {
    contentFromProps.current = true;
    setContent(currentContent);
  }, [currentContent]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache]);

  // Flush pending content on unmount
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  // Load target file content
  useEffect(() => {
    let cancelled = false;
    setLoadingTarget(true);

    (async () => {
      // Try IndexedDB cache first
      const cached = await getCachedFile(targetFileId);
      if (!cancelled && cached?.content != null) {
        setTargetContent(cached.content);
        setLoadingTarget(false);
        return;
      }
      // Fallback: fetch via pullDirect
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pullDirect", fileIds: [targetFileId] }),
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          const file = data.files?.[0];
          setTargetContent(file?.content ?? "");
        }
      } catch {
        if (!cancelled) setTargetContent("");
      } finally {
        if (!cancelled) setLoadingTarget(false);
      }
    })();

    return () => { cancelled = true; };
  }, [targetFileId]);

  // Compute diff
  const diff = useMemo(() => {
    if (targetContent === null) return "";
    return createTwoFilesPatch(targetFileName, fileName, targetContent, content);
  }, [content, targetContent, fileName, targetFileName]);

  const flushOnBlur = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveToCache(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [saveToCache]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" onBlur={flushOnBlur}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
          {fileName} vs {targetFileName}
        </span>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X size={ICON.SM} />
          {t("editHistory.close")}
        </button>
      </div>

      {/* Split view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top: editable textarea */}
        <div className="flex-1 min-h-0 p-4">
          <textarea
            value={content}
            onChange={(e) => updateContent(e.target.value)}
            className="w-full h-full font-mono text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
            spellCheck={false}
          />
        </div>

        {/* Bottom: diff view */}
        <div className="flex-1 min-h-0 overflow-auto border-t border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
          {loadingTarget ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <DiffView diff={diff} />
          )}
        </div>
      </div>
    </div>
  );
}
