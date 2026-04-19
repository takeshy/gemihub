import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { Loader2, Eye, PenLine, Code, Plus } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { useEditorContext, type SelectionInfo } from "~/contexts/EditorContext";
import { isEncryptedFile } from "~/services/crypto-core";
import { addCommitBoundary } from "~/services/edit-history-local";
import { EditorToolbarActions } from "../EditorToolbarActions";
import { performTempUpload } from "~/services/temp-upload";
import { useTempEditConfirm } from "~/hooks/useTempEditConfirm";
import { TempEditUrlDialog } from "~/components/shared/TempEditUrlDialog";
import { TempDiffModal } from "../TempDiffModal";
import { FrontmatterEditor, parseFrontmatter, serializeFrontmatter } from "~/components/editor/FrontmatterEditor";

const LazyGfmPreview = lazy(() => import("../GfmMarkdownPreview"));

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

type MdEditMode = "preview" | "wysiwyg" | "raw";

export function MarkdownFileEditor({
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
  const prevFileIdRef = useRef(fileId);
  // Track last content we saved to distinguish our own save being reflected
  // back via initialContent from genuine external changes (pull, restore, etc.)
  const lastSavedContentRef = useRef<string | null>(null);

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      lastSavedContentRef.current = content;
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
  const [mode, setMode] = useState<MdEditMode>("wysiwyg");

  // Track whether the user has genuinely interacted with the wysiwyg editor.
  // wysimark-lite (Slate-based) normalizes markdown on load (reformatting tables,
  // code fences, image captions, etc.) and fires onChange with the normalized
  // content. We skip that normalization onChange to avoid creating spurious diffs.
  const wysiwygEditedRef = useRef(false);
  const prevModeForWysiwygRef = useRef(mode);
  // Reset when switching to wysiwyg mode (synchronous, before Slate mounts)
  if (mode !== prevModeForWysiwygRef.current) {
    prevModeForWysiwygRef.current = mode;
    if (mode === "wysiwyg") {
      wysiwygEditedRef.current = false;
    }
  }
  // Reset on external content changes (file switch, pull, etc.)
  if (contentFromProps.current) {
    wysiwygEditedRef.current = false;
  }
  const markWysiwygEdited = useCallback(() => {
    wysiwygEditedRef.current = true;
  }, []);

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
    const prev = prevFileIdRef.current;
    prevFileIdRef.current = fileId;
    // Skip content/mode reset during new: -> real ID migration (preserves cursor)
    if (prev.startsWith("new:") && !fileId.startsWith("new:")) return;
    // When switching files, always reset
    if (fileId !== prev) {
      lastSavedContentRef.current = null;
      contentFromProps.current = true;
      setContent(initialContent);
      setMode("wysiwyg");
      return;
    }
    // Same file -- skip if this is our own save being reflected back via
    // useFileWithCache.saveToCache -> setContent -> initialContent prop change.
    // This prevents a race where the debounce timer and wysimark's throttle
    // fire at the same time, causing content to revert and cursor to reset.
    if (lastSavedContentRef.current !== null && lastSavedContentRef.current === initialContent) {
      lastSavedContentRef.current = null;
      return;
    }
    lastSavedContentRef.current = null;
    contentFromProps.current = true;
    setContent(initialContent);
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

  // Frontmatter parsing for preview/wysiwyg modes
  const fmParsed = useMemo(() => parseFrontmatter(content), [content]);
  // Ref keeps the latest body so callbacks never use stale closures
  const fmBodyRef = useRef(fmParsed.body);
  fmBodyRef.current = fmParsed.body;
  const handleFrontmatterChange = useCallback(
    (properties: Parameters<typeof serializeFrontmatter>[0]) => {
      updateContent(serializeFrontmatter(properties, fmBodyRef.current));
    },
    [updateContent]
  );
  // Add empty frontmatter block to a file that doesn't have one
  const addFrontmatter = useCallback(() => {
    updateContent(`---\n---\n${content}`);
  }, [content, updateContent]);

  // For wysiwyg, handle body-only changes from the editor
  // Uses a ref for the frontmatter block to avoid stale closure when
  // FrontmatterEditor and wysiwyg fire changes near-simultaneously
  const fmBlockRef = useRef("");
  fmBlockRef.current = fmParsed.hasFrontmatter
    ? content.slice(0, content.length - fmParsed.body.length)
    : "";
  const handleBodyChange = useCallback(
    (newBody: string) => {
      const block = fmBlockRef.current;
      if (block) {
        updateContent(block + newBody);
      } else {
        updateContent(newBody);
      }
    },
    [updateContent]
  );
  // Guarded wysiwyg onChange: skip wysimark-lite's normalization-only changes
  const guardedHandleBodyChange = useCallback(
    (newBody: string) => {
      if (!wysiwygEditedRef.current) return;
      handleBodyChange(newBody);
    },
    [handleBodyChange]
  );
  const guardedUpdateContent = useCallback(
    (newContent: string) => {
      if (!wysiwygEditedRef.current) return;
      updateContent(newContent);
    },
    [updateContent]
  );

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
        />
      </div>

      {/* Content area */}
      {mode === "preview" && (
        <div className="flex-1 overflow-y-auto">
          {fmParsed.hasFrontmatter && (
            <FrontmatterEditor parsed={fmParsed} onFrontmatterChange={handleFrontmatterChange} readOnly />
          )}
          <div className="p-6">
            <div className="prose dark:prose-invert max-w-none [&_p]:my-1 [&_p]:leading-relaxed">
              <Suspense fallback={<Loader2 size={ICON.XL} className="animate-spin text-gray-400 mx-auto mt-8" />}>
                <LazyGfmPreview content={fmParsed.hasFrontmatter ? fmParsed.body : content} />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {mode === "wysiwyg" && (
        <>
          {fmParsed.hasFrontmatter ? (
            <FrontmatterEditor parsed={fmParsed} onFrontmatterChange={handleFrontmatterChange} />
          ) : (
            <div className="border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
              <button
                onClick={addFrontmatter}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <Plus size={ICON.SM} />
                {t("frontmatter.addProperties")}
              </button>
            </div>
          )}
          <WysiwygSelectionTracker setActiveSelection={editorCtx.setActiveSelection}>
            {MarkdownEditorComponent ? (
              <div
                className="flex-1 min-h-0 flex flex-col overflow-hidden"
                onKeyDownCapture={markWysiwygEdited}
                onPointerDownCapture={markWysiwygEdited}
                onPasteCapture={markWysiwygEdited}
                onDropCapture={markWysiwygEdited}
              >
                <MarkdownEditorComponent
                  value={fmParsed.hasFrontmatter ? fmParsed.body : content}
                  onChange={fmParsed.hasFrontmatter ? guardedHandleBodyChange : guardedUpdateContent}
                  placeholder="Write your content here..."
                  onFileSelect={onFileSelect}
                  onImageChange={onImageChange}
                />
              </div>
            ) : (
              <Loader2 size={ICON.XL} className="animate-spin text-gray-400 mx-auto mt-8" />
            )}
          </WysiwygSelectionTracker>
        </>
      )}

      {mode === "raw" && (
        <div className="flex-1 p-4">
          <textarea
            value={content.replace(/^\u00A0$/gm, "")}
            onChange={(e) => updateContent(e.target.value)}
            onSelect={handleSelect}
            className="w-full h-full font-mono text-sm leading-relaxed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
            spellCheck={false}
          />
        </div>
      )}

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
