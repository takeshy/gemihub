import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { FileText, Loader2, Eye, PenLine, Code } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { UserSettings } from "~/types/settings";
import { WorkflowEditor } from "./WorkflowEditor";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";

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
  const { content, loading, error, saving, saved, save, refresh } =
    useFileWithCache(fileId, refreshKey);
  const editorCtx = useEditorContext();

  // Push content and file name to EditorContext
  useEffect(() => {
    editorCtx.setActiveFileContent(content);
    editorCtx.setActiveFileName(fileName);
    // Reset selection on file change
    editorCtx.setActiveSelection(null);
  }, [content, fileName, fileId]);

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

  // Workflow YAML file
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return (
      <WorkflowEditor
        fileId={fileId}
        fileName={name.replace(/\.ya?ml$/, "")}
        initialContent={content}
        settings={settings}
        onSave={save}
        saving={saving}
        saved={saved}
      />
    );
  }

  // Markdown file
  if (name.endsWith(".md")) {
    return (
      <MarkdownFileEditor
        fileId={fileId}
        initialContent={content}
        onSave={save}
        saving={saving}
        saved={saved}
      />
    );
  }

  // Other text files
  return (
    <TextFileEditor
      fileId={fileId}
      initialContent={content}
      onSave={save}
      saving={saving}
      saved={saved}
    />
  );
}

// ---------------------------------------------------------------------------
// Markdown File Editor (3 modes: Preview / WYSIWYG / Raw)
// ---------------------------------------------------------------------------

const LazyReactMarkdown = lazy(() => import("react-markdown"));
const LazyGfmPreview = lazy(() => import("./GfmMarkdownPreview"));
type MdEditMode = "preview" | "wysiwyg" | "raw";

function MarkdownFileEditor({
  fileId,
  initialContent,
  onSave,
  saving,
  saved,
}: {
  fileId: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  saving: boolean;
  saved: boolean;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const editorCtx = useEditorContext();

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
    setContent(initialContent);
    setMode(initialContent ? "preview" : "wysiwyg");
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

        {/* Save */}
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-green-600 dark:text-green-400">
              {t("mainViewer.saved")}
            </span>
          )}
          {mode !== "preview" && (
            <button
              onClick={() => onSave(content)}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? t("mainViewer.saving") : t("common.save")}
            </button>
          )}
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
              onChange={setContent}
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
            onChange={(e) => setContent(e.target.value)}
            onSelect={handleSelect}
            className="w-full h-full font-mono text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text File Editor
// ---------------------------------------------------------------------------

function TextFileEditor({
  fileId,
  initialContent,
  onSave,
  saving,
  saved,
}: {
  fileId: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  saving: boolean;
  saved: boolean;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const editorCtx = useEditorContext();

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, fileId]);

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
      <div className="flex items-center justify-end px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {saved && (
          <span className="mr-2 text-xs text-green-600 dark:text-green-400">
            {t("mainViewer.saved")}
          </span>
        )}
        <button
          onClick={() => onSave(content)}
          disabled={saving}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? t("mainViewer.saving") : t("common.save")}
        </button>
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onSelect={handleSelect}
          className="w-full h-full font-mono text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
