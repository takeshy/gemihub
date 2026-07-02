// File widget — opens a Drive file (Markdown / text / HTML / EPUB / PDF /
// image) as a dashboard tile, with a per-document memo timeline (ported from
// mdwys). The memo orchestration lives in ~/dashboard/memo/useDocumentMemo;
// this component supplies the viewers and persists panel/view state in the
// widget config. The file can be changed from the header picker even outside
// edit mode (persisted via ctx.onConfigChange).

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Loader2, NotebookPen } from "lucide-react";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { useBinaryFile } from "~/hooks/useBinaryFile";
import { MarkdownFileEditor, type MdEditMode } from "~/components/ide/editors/MarkdownFileEditor";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { guessMimeType } from "~/utils/media-utils";
import { useDocumentMemo } from "~/dashboard/memo/useDocumentMemo";
import type { WidgetContext } from "../../types";
import { MarkdownFilePicker } from "../config-editors/MarkdownFilePicker";
import { docKindFor, isFileWidgetFile, type DocKind } from "./docKind";
import { HtmlDocumentFrame } from "./HtmlDocumentFrame";
import { ScaleStepper, clampScale } from "./ScaleStepper";
import type { PdfViewerHandle } from "~/components/shared/PdfViewer";

// pdfjs-dist sets up its worker at module scope; keep it out of the server bundle.
const LazyPdfViewer = lazy(() => import("~/components/shared/PdfViewer"));

export interface FileConfig {
  /** Drive file path of the referenced file. */
  path?: string;
  /** Whether to show the widget's header bar. Defaults to true. */
  showHeader?: boolean;
  /** 70–240: PDF zoom / EPUB & HTML font size (%). */
  viewFontScale?: number;
  /** 70–180: EPUB & HTML content width (%). */
  viewWidthScale?: number;
  memoPanelOpen?: boolean;
  memoPanelCollapsed?: boolean;
}

// Session-scoped preview/wysiwyg/code mode for markdown files. Defaults to
// preview on the first view of the session, then remembers the user's last
// explicit toggle across file switches (the editor remounts per file, so this
// survives those remounts). Reset to "preview" on a full page reload.
let sessionMode: MdEditMode = "preview";

const FONT_SCALE_MIN = 70;
const FONT_SCALE_MAX = 240;
const WIDTH_SCALE_MIN = 70;
const WIDTH_SCALE_MAX = 180;
/** Below this widget width (grid columns) the memo panel collapses to a rail. */
const MEMO_PANEL_MIN_COLS = 4;

/** Plain-text editor with debounced local-first saves. */
function TextFileEditor({
  initialContent,
  saveToCache,
  textareaRef,
  onContextMenu,
}: {
  initialContent: string;
  saveToCache: (content: string) => Promise<void> | void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onContextMenu?: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
}) {
  const [value, setValue] = useState(initialContent);
  const timerRef = useRef(0);
  const dirtyRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const saveRef = useRef(saveToCache);
  saveRef.current = saveToCache;

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    if (dirtyRef.current) void saveRef.current(valueRef.current);
  }, []);

  return (
    <textarea
      ref={textareaRef}
      className="h-full w-full resize-none bg-white p-3 font-mono text-sm text-gray-900 focus:outline-none dark:bg-gray-900 dark:text-gray-100"
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        dirtyRef.current = true;
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          dirtyRef.current = false;
          void saveRef.current(next);
        }, 1000);
      }}
      onContextMenu={onContextMenu}
      spellCheck={false}
    />
  );
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-gray-400">
      {children}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 size={20} className="animate-spin text-gray-400" />
    </div>
  );
}

export default function FileWidget({
  config,
  ctx,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t } = useI18n();
  const editorCtx = useEditorContext();
  const cfg = useMemo(() => (config ?? {}) as FileConfig, [config]);
  const filePath = (cfg.path ?? "").trim();
  const showHeader = cfg.showHeader !== false;
  const viewFontScale = clampScale(
    typeof cfg.viewFontScale === "number" ? cfg.viewFontScale : 100,
    FONT_SCALE_MIN,
    FONT_SCALE_MAX,
  );
  const viewWidthScale = clampScale(
    typeof cfg.viewWidthScale === "number" ? cfg.viewWidthScale : 100,
    WIDTH_SCALE_MIN,
    WIDTH_SCALE_MAX,
  );
  const memoPanelOpen = cfg.memoPanelOpen === true;
  const memoPanelCollapsed = cfg.memoPanelCollapsed === true;
  const kind: DocKind = docKindFor(filePath);
  const fileRef = editorCtx.fileList.find((f) => (f.path || f.name) === filePath);
  const fileId = fileRef?.id ?? null;

  const isTextKind = kind === "markdown" || kind === "text" || kind === "html";
  const isBinaryKind = kind === "pdf" || kind === "epub" || kind === "image";

  const { content, loading, error, saveToCache } = useFileWithCache(
    isTextKind ? fileId : null,
    undefined,
    "FileWidget",
  );
  const { bytes, error: binaryError, loading: binaryLoading } = useBinaryFile(
    fileId,
    isBinaryKind,
    t("mainViewer.loadError"),
  );

  const updateConfig = useCallback(
    (patch: Partial<FileConfig>) => {
      ctx?.onConfigChange?.({ ...cfg, ...patch });
    },
    [cfg, ctx],
  );
  const selectFile = useCallback((path: string) => updateConfig({ path }), [updateConfig]);

  // Markdown edit mode, tracked so memo anchoring knows when the preview root
  // exists (selection→memo and highlights work in preview mode only).
  const [markdownMode, setMarkdownMode] = useState<MdEditMode>(sessionMode);

  // EPUB bytes → self-contained HTML document (lazy: fflate stays out of the
  // main chunk until an EPUB is actually opened).
  const [epubHtml, setEpubHtml] = useState("");
  const [epubError, setEpubError] = useState("");
  useEffect(() => {
    setEpubHtml("");
    setEpubError("");
    if (kind !== "epub" || !bytes) return;
    let cancelled = false;
    (async () => {
      try {
        const { epubToHtml } = await import("~/utils/epub");
        const html = await epubToHtml(bytes, filePath);
        if (!cancelled) setEpubHtml(html);
      } catch (convertError) {
        console.error(convertError);
        if (!cancelled) setEpubError(t("mainViewer.loadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, bytes, filePath]);

  // Image bytes → blob URL.
  const [imageUrl, setImageUrl] = useState("");
  useEffect(() => {
    if (kind !== "image" || !bytes) {
      setImageUrl("");
      return;
    }
    const blob = new Blob([bytes.slice()], { type: guessMimeType(filePath) });
    const url = URL.createObjectURL(blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [kind, bytes, filePath]);

  const contentWrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pdfRef = useRef<PdfViewerHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [frameLoadTick, setFrameLoadTick] = useState(0);
  const [pdfPagesTick, setPdfPagesTick] = useState(0);

  const instanceIdRef = useRef(`file-widget-${Math.random().toString(36).slice(2)}`);
  const contributorId = ctx?.widgetId ?? instanceIdRef.current;
  const getTextarea = useCallback(() => textareaRef.current, []);
  const onPanelChange = useCallback(
    (patch: { open?: boolean; collapsed?: boolean }) => {
      const next: Partial<FileConfig> = {};
      if (patch.open !== undefined) next.memoPanelOpen = patch.open;
      if (patch.collapsed !== undefined) next.memoPanelCollapsed = patch.collapsed;
      updateConfig(next);
    },
    [updateConfig],
  );

  const memo = useDocumentMemo({
    drivePath: filePath,
    kind,
    markdownMode,
    contributorId,
    contentWrapRef,
    frameRef,
    pdfRef,
    getTextarea,
    panelOpen: memoPanelOpen,
    panelCollapsed: memoPanelCollapsed,
    wideEnough: (ctx?.size?.w ?? 12) >= MEMO_PANEL_MIN_COLS,
    onPanelChange,
    refreshSignals: [content, bytes, epubHtml, viewFontScale, viewWidthScale, pdfPagesTick],
    frameLoadTick,
  });

  // ---- header ----------------------------------------------------------------

  const picker = (buttonClassName?: string) => (
    <MarkdownFilePicker
      currentPath={filePath}
      onSelect={selectFile}
      placeholder={t("dashboard.fileSelectFile")}
      fileFilter={isFileWidgetFile}
      buttonClassName={buttonClassName}
    />
  );

  const memoToggle = (
    <button
      type="button"
      title={t("memo.panelToggle")}
      onClick={() =>
        updateConfig(
          memoPanelOpen ? { memoPanelOpen: false } : { memoPanelOpen: true, memoPanelCollapsed: false },
        )
      }
      className={`rounded p-1 ${
        memoPanelOpen
          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      }`}
    >
      <NotebookPen size={13} />
    </button>
  );

  // No file chosen yet — prompt to pick one.
  if (!filePath) {
    return (
      <CenteredNote>
        {picker(
          "flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800",
        )}
      </CenteredNote>
    );
  }

  if (!fileId) {
    return (
      <CenteredNote>
        <span>{t("dashboard.fileNotFound")}: {filePath}</span>
        {picker()}
      </CenteredNote>
    );
  }

  const renderContent = () => {
    if (kind === "markdown") {
      if (loading && content === null) {
        return <div className="flex h-full items-center justify-center text-sm text-gray-400">{t("dashboard.loading")}</div>;
      }
      if (content === null) {
        return (
          <CenteredNote>
            <span>{error || t("dashboard.fileNotFound")}</span>
            {picker()}
          </CenteredNote>
        );
      }
      return (
        <div className="flex h-full min-h-0 flex-col">
          <MarkdownFileEditor
            key={fileId}
            fileId={fileId}
            fileName={filePath}
            initialContent={content}
            saveToCache={saveToCache}
            hideHeader={!showHeader}
            hideToolbarActions
            initialMode={sessionMode}
            onModeChange={(m) => {
              sessionMode = m;
              setMarkdownMode(m);
            }}
            headerLeft={
              <div className="flex min-w-0 items-center gap-1">
                {picker()}
                {memoToggle}
              </div>
            }
          />
        </div>
      );
    }

    if (kind === "pdf") {
      if (binaryError) return <CenteredNote>{binaryError}</CenteredNote>;
      if (!bytes) return <LoadingSpinner />;
      return (
        <Suspense fallback={<LoadingSpinner />}>
          <LazyPdfViewer
            ref={pdfRef}
            data={bytes}
            title={filePath}
            scalePercent={viewFontScale}
            onTextLayerRendered={() => setPdfPagesTick((value) => value + 1)}
          />
        </Suspense>
      );
    }

    if (kind === "epub") {
      if (binaryError || epubError) return <CenteredNote>{binaryError || epubError}</CenteredNote>;
      if (!epubHtml) return <LoadingSpinner />;
      return (
        <HtmlDocumentFrame
          content={epubHtml}
          title={filePath}
          fontScale={viewFontScale}
          widthScale={viewWidthScale}
          frameRef={frameRef}
          onFrameLoad={() => setFrameLoadTick((value) => value + 1)}
        />
      );
    }

    if (kind === "image") {
      if (binaryError) return <CenteredNote>{binaryError}</CenteredNote>;
      if (binaryLoading || !imageUrl) return <LoadingSpinner />;
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-gray-100 p-2 dark:bg-gray-900">
          <img src={imageUrl} alt={filePath} className="max-h-full max-w-full object-contain" />
        </div>
      );
    }

    if (kind === "html") {
      if (content === null) return loading ? <LoadingSpinner /> : <CenteredNote>{error || t("dashboard.fileNotFound")}</CenteredNote>;
      return (
        <HtmlDocumentFrame
          content={content}
          title={filePath}
          fontScale={viewFontScale}
          widthScale={viewWidthScale}
          frameRef={frameRef}
          onFrameLoad={() => setFrameLoadTick((value) => value + 1)}
        />
      );
    }

    // Plain text.
    if (content === null) return loading ? <LoadingSpinner /> : <CenteredNote>{error || t("dashboard.fileNotFound")}</CenteredNote>;
    return (
      <TextFileEditor
        key={fileId}
        initialContent={content}
        saveToCache={saveToCache}
        textareaRef={textareaRef}
        onContextMenu={memo.onTextareaContextMenu}
      />
    );
  };

  const header = showHeader && kind !== "markdown" && (
    <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-gray-900">
      {picker()}
      {memoToggle}
      <div className="ml-auto flex items-center gap-2">
        {(kind === "pdf" || kind === "epub" || kind === "html") && (
          <ScaleStepper
            value={viewFontScale}
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            title={kind === "pdf" ? t("dashboard.fileZoom") : t("dashboard.fileFontSize")}
            onChange={(viewFontScale) => updateConfig({ viewFontScale })}
          />
        )}
        {(kind === "epub" || kind === "html") && (
          <ScaleStepper
            value={viewWidthScale}
            min={WIDTH_SCALE_MIN}
            max={WIDTH_SCALE_MAX}
            title={t("dashboard.fileWidth")}
            onChange={(viewWidthScale) => updateConfig({ viewWidthScale })}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1">
        {memo.rail}
        {memo.panel}
        <div
          ref={contentWrapRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          {...memo.wrapperHandlers}
        >
          {renderContent()}
          {memo.overlays}
        </div>
      </div>
      {memo.contextMenu}
    </div>
  );
}
