// File widget — opens a Drive file (Markdown / text / HTML / EPUB / PDF /
// image) as a dashboard tile, with a per-document memo timeline (ported from
// mdwys). Select text in the document and right-click to quote it into a memo;
// quoted text is painted via the CSS Custom Highlight API. Markdown renders
// the normal markdown editor (preview / wysiwyg / code) inline; binary kinds
// load bytes local-first via the IndexedDB cache. The file can be changed from
// the header picker even outside edit mode (persisted via ctx.onConfigChange).

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { ChevronsRight, Copy, Loader2, Minus, NotebookPen, Plus, SquarePen } from "lucide-react";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { MarkdownFileEditor, type MdEditMode } from "~/components/ide/editors/MarkdownFileEditor";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { ContextMenu } from "~/components/ide/ContextMenu";
import { readFileBinaryLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { isLargeFile } from "~/services/sync-client-utils";
import { base64ToBytes, guessMimeType } from "~/utils/media-utils";
import {
  deleteEntry,
  parseMemoFile,
  replaceEntryBody,
  setEntryPinned,
  type MemoEntry,
} from "~/dashboard/memo/memoTimeline";
import {
  buildTextIndex,
  clearHighlight,
  clearMemoHighlights,
  ensureHighlightStyles,
  findQuoteMatch,
  normalizeAnchorText,
  selectionContextFor,
  setHighlight,
  setMemoHighlights,
  type TextIndex,
} from "~/dashboard/memo/textAnchor";
import {
  memoPathForDocument,
  postMemoEntry,
  readMemoFileLocal,
  rewriteMemoEntry,
} from "~/dashboard/memo/memoStore";
import type { WidgetContext } from "../../types";
import { MarkdownFilePicker } from "../config-editors/MarkdownFilePicker";
import { docKindFor, isFileWidgetFile, type DocKind } from "./docKind";
import { HtmlDocumentFrame } from "./HtmlDocumentFrame";
import { MemoTimelinePanel, memoHoverPreview, type MemoDraft } from "./MemoTimelinePanel";
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
const SCALE_STEP = 10;
const FLASH_MS = 1000;
const TOAST_MS = 2500;
/** Below this widget width (grid columns) the memo panel collapses to a rail. */
const MEMO_PANEL_MIN_COLS = 4;

function clampScale(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pageFromAnchor(anchor: string): number | null {
  const match = anchor.match(/^page=(\d+)$/);
  return match ? Number(match[1]) : null;
}

function spineFromAnchor(anchor: string): number | null {
  const match = anchor.match(/^spine=(\d+)$/);
  return match ? Number(match[1]) : null;
}

function latestEntryId(entries: MemoEntry[], ids: string[]): string {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const sorted = [...ids].sort((a, b) => (byId.get(b)?.createdAt ?? "").localeCompare(byId.get(a)?.createdAt ?? ""));
  return sorted[0] ?? ids[0];
}

interface ResolvedGroup {
  key: string;
  range: Range;
  win: Window;
  inFrame: boolean;
  entryIds: string[];
}

interface MenuState {
  x: number;
  y: number;
  draft: MemoDraft;
}

interface HoverPopover {
  x: number;
  y: number;
  count: number;
  preview: string;
}

/** Loads a binary document (pdf/epub/image) local-first as raw bytes. */
function useBinaryFile(fileId: string | null, isBinary: boolean, loadErrorLabel: string) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setBytes(null);
    setError("");
    if (!fileId || !isBinary) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const meta = await getCachedRemoteMeta();
        if (isLargeFile(meta?.files[fileId]?.size)) {
          // Too large for the IndexedDB cache (mirrors sync behavior) — stream
          // directly without caching.
          const res = await fetch(`/api/drive/files?action=raw&fileId=${encodeURIComponent(fileId)}`);
          if (!res.ok) throw new Error(`raw fetch failed: ${res.status}`);
          const buf = await res.arrayBuffer();
          if (!cancelled) setBytes(new Uint8Array(buf));
        } else {
          const b64 = await readFileBinaryLocal(fileId);
          if (!cancelled) setBytes(base64ToBytes(b64));
        }
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) setError(loadErrorLabel);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, isBinary]);

  return { bytes, error, loading };
}

function ScaleStepper({
  value,
  min,
  max,
  title,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  title: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" title={title}>
      <button
        type="button"
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-35 dark:text-gray-400 dark:hover:bg-gray-800"
        onClick={() => onChange(clampScale(value - SCALE_STEP, min, max))}
        disabled={value <= min}
      >
        <Minus size={11} />
      </button>
      <span className="w-9 text-center text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{value}%</span>
      <button
        type="button"
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-35 dark:text-gray-400 dark:hover:bg-gray-800"
        onClick={() => onChange(clampScale(value + SCALE_STEP, min, max))}
        disabled={value >= max}
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

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
  const wideEnoughForPanel = (ctx?.size?.w ?? 12) >= MEMO_PANEL_MIN_COLS;
  // Highlights stay on while the panel is open OR merely collapsed to the
  // rail; only closing with × turns them off. Clicking a highlight while
  // collapsed re-expands the panel.
  const memoPanelVisible = memoPanelOpen && !memoPanelCollapsed && wideEnoughForPanel;
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
  const [mdPreviewTick, setMdPreviewTick] = useState(0);

  // ---- memo state -----------------------------------------------------------

  const instanceIdRef = useRef(`file-widget-${Math.random().toString(36).slice(2)}`);
  const contributorId = ctx?.widgetId ?? instanceIdRef.current;

  const [memoEntries, setMemoEntries] = useState<MemoEntry[]>([]);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState("");
  const [draft, setDraft] = useState<MemoDraft | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hover, setHover] = useState<HoverPopover | null>(null);
  const [toast, setToast] = useState("");
  const [flashEntryId, setFlashEntryId] = useState<string | null>(null);
  const [unresolvedIds, setUnresolvedIds] = useState<ReadonlySet<string>>(new Set());

  const resolvedGroupsRef = useRef<ResolvedGroup[]>([]);
  const toastTimerRef = useRef(0);
  const flashTimerRef = useRef(0);
  const memoEntriesRef = useRef<MemoEntry[]>([]);
  memoEntriesRef.current = memoEntries;
  const memoFileIdRef = useRef<string | null>(null);

  const memoConfigured = Boolean(filePath);
  const memoPath = useMemo(() => (filePath ? memoPathForDocument(filePath) : ""), [filePath]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), TOAST_MS);
  }, []);

  const flashEntry = useCallback((entryId: string) => {
    setFlashEntryId(entryId);
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashEntryId(null), FLASH_MS + 200);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(toastTimerRef.current);
    window.clearTimeout(flashTimerRef.current);
  }, []);

  useEffect(() => {
    ensureHighlightStyles(document);
  }, []);

  // ---- memo file IO ---------------------------------------------------------

  const reloadMemo = useCallback(async () => {
    if (!memoPath) {
      setMemoEntries([]);
      return;
    }
    setMemoLoading(true);
    try {
      const result = await readMemoFileLocal(memoPath);
      memoFileIdRef.current = result.fileId;
      setMemoEntries(result.exists ? parseMemoFile(result.content).entries : []);
      setMemoError("");
    } catch (loadError) {
      console.error(loadError);
      setMemoError(t("memo.loadFailed"));
    } finally {
      setMemoLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoPath]);

  useEffect(() => {
    void reloadMemo();
  }, [reloadMemo]);

  // Another widget on the same document (or a Pull) may change the memo file.
  useEffect(() => {
    const onFileModified = (event: Event) => {
      const detail = (event as CustomEvent).detail as { fileId?: string } | undefined;
      if (detail?.fileId && detail.fileId === memoFileIdRef.current) void reloadMemo();
    };
    const onPulled = () => void reloadMemo();
    window.addEventListener("file-modified", onFileModified);
    window.addEventListener("files-pulled", onPulled);
    return () => {
      window.removeEventListener("file-modified", onFileModified);
      window.removeEventListener("files-pulled", onPulled);
    };
  }, [reloadMemo]);

  const postMemo = useCallback(async (body: string, postDraft: MemoDraft | null) => {
    if (!filePath) throw new Error("no document is open");
    await postMemoEntry(filePath, body, postDraft);
    await reloadMemo();
  }, [filePath, reloadMemo]);

  const editMemo = useCallback(
    (id: string, body: string) => rewriteMemoEntry(filePath, (c) => replaceEntryBody(c, id, body)).then(reloadMemo),
    [filePath, reloadMemo],
  );
  const deleteMemo = useCallback(
    (id: string) => rewriteMemoEntry(filePath, (c) => deleteEntry(c, id)).then(reloadMemo),
    [filePath, reloadMemo],
  );
  const togglePinMemo = useCallback(
    (id: string, pinned: boolean) => rewriteMemoEntry(filePath, (c) => setEntryPinned(c, id, pinned)).then(reloadMemo),
    [filePath, reloadMemo],
  );

  // ---- anchor resolution & highlights ----------------------------------------

  const mdPreviewRoot = useCallback(
    () => contentWrapRef.current?.querySelector<HTMLElement>("[data-md-preview-root]") ?? null,
    [],
  );

  const epubSectionFor = useCallback((doc: Document, spine: number): Element | null => {
    return doc.getElementById(`epub-chapter-${spine + 1}`);
  }, []);

  const applyHighlights = useCallback(() => {
    if (!memoPanelOpen) {
      resolvedGroupsRef.current = [];
      setMemoHighlights(contributorId, window, []);
      const hiddenFrameWin = frameRef.current?.contentWindow;
      if (hiddenFrameWin) setMemoHighlights(`${contributorId}:frame`, hiddenFrameWin, []);
      else clearMemoHighlights(`${contributorId}:frame`);
      setUnresolvedIds((previous) => (previous.size ? new Set() : previous));
      return;
    }
    const anchored = memoEntriesRef.current.filter((entry) => entry.parsed && entry.anchor !== null && entry.quote);
    const groups = new Map<string, ResolvedGroup>();
    const unresolved = new Set<string>();
    const indexCache = new Map<Node, TextIndex>();

    const indexFor = (root: Node): TextIndex => {
      let index = indexCache.get(root);
      if (!index) {
        index = buildTextIndex(root);
        indexCache.set(root, index);
      }
      return index;
    };

    const record = (entry: MemoEntry, root: Node, win: Window, inFrame: boolean, scope: string) => {
      const match = findQuoteMatch(indexFor(root), entry.quote, entry.quotePrefix, entry.quoteSuffix);
      if (!match) {
        unresolved.add(entry.id);
        return;
      }
      const key = `${scope}:${match.start}-${match.end}`;
      const group = groups.get(key);
      if (group) {
        group.entryIds.push(entry.id);
      } else {
        groups.set(key, { key, range: match.range, win, inFrame, entryIds: [entry.id] });
      }
    };

    const previewRoot = kind === "markdown" && markdownMode === "preview" ? mdPreviewRoot() : null;
    if (previewRoot) {
      for (const entry of anchored) record(entry, previewRoot, window, false, "md");
    } else if ((kind === "html" || kind === "epub") && frameRef.current?.contentDocument?.body) {
      const doc = frameRef.current.contentDocument;
      const win = frameRef.current.contentWindow;
      if (doc && win) {
        ensureHighlightStyles(doc);
        for (const entry of anchored) {
          const spine = kind === "epub" && entry.anchor ? spineFromAnchor(entry.anchor) : null;
          const scopeRoot = spine !== null ? epubSectionFor(doc, spine) ?? doc.body : doc.body;
          record(entry, scopeRoot, win, true, spine !== null ? `spine-${spine}` : "doc");
        }
      }
    } else if (kind === "pdf" && pdfRef.current) {
      const pdf = pdfRef.current;
      const pageCount = pdf.getPageCount();
      for (const entry of anchored) {
        const page = entry.anchor ? pageFromAnchor(entry.anchor) : null;
        if (page === null || page < 1 || (pageCount > 0 && page > pageCount)) {
          unresolved.add(entry.id);
          continue;
        }
        const layer = pdf.getTextLayer(page);
        // Unrendered pages stay in an unknown state (resolution runs against
        // the currently displayed range only).
        if (!layer || !layer.childElementCount) continue;
        record(entry, layer, window, false, `page-${page}`);
      }
    } else if (kind === "text" && textareaRef.current) {
      const haystack = normalizeAnchorText(textareaRef.current.value);
      for (const entry of anchored) {
        if (!haystack.includes(normalizeAnchorText(entry.quote))) unresolved.add(entry.id);
      }
    }

    const groupList = [...groups.values()];
    resolvedGroupsRef.current = groupList;

    setMemoHighlights(contributorId, window, groupList.filter((group) => !group.inFrame).map((group) => group.range));
    const frameWin = frameRef.current?.contentWindow;
    if (frameWin) {
      setMemoHighlights(`${contributorId}:frame`, frameWin, groupList.filter((group) => group.inFrame).map((group) => group.range));
    } else {
      // The widget may have switched away from an iframe document.
      clearMemoHighlights(`${contributorId}:frame`);
    }

    setUnresolvedIds((previous) => {
      if (previous.size === unresolved.size && [...unresolved].every((id) => previous.has(id))) return previous;
      return unresolved;
    });
  }, [kind, markdownMode, mdPreviewRoot, epubSectionFor, contributorId, memoPanelOpen]);

  useEffect(() => () => {
    clearMemoHighlights(contributorId);
    clearMemoHighlights(`${contributorId}:frame`);
     
  }, [contributorId]);

  useEffect(() => {
    const timer = window.setTimeout(applyHighlights, 150);
    return () => window.clearTimeout(timer);
  }, [applyHighlights, memoEntries, content, bytes, epubHtml, viewFontScale, viewWidthScale, frameLoadTick, pdfPagesTick, mdPreviewTick]);

  // The markdown preview loads lazily and re-renders on edits, so watch its
  // subtree to re-resolve anchors (CSS custom highlights don't mutate the DOM,
  // so this cannot loop).
  useEffect(() => {
    if (!memoPanelOpen || kind !== "markdown" || markdownMode !== "preview") return;
    const wrap = contentWrapRef.current;
    if (!wrap) return;
    const observer = new MutationObserver(() => setMdPreviewTick((value) => value + 1));
    observer.observe(wrap, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [memoPanelOpen, kind, markdownMode]);

  // ---- pointer interactions (hover popover, highlight click) -----------------

  const hostPointFor = useCallback((clientX: number, clientY: number, inFrame: boolean) => {
    const wrapRect = contentWrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return { x: 0, y: 0 };
    if (!inFrame) return { x: clientX - wrapRect.left, y: clientY - wrapRect.top };
    const frameRect = frameRef.current?.getBoundingClientRect();
    return {
      x: clientX + (frameRect?.left ?? 0) - wrapRect.left,
      y: clientY + (frameRect?.top ?? 0) - wrapRect.top,
    };
  }, []);

  /** Viewport coordinates for the portal ContextMenu. */
  const viewportPointFor = useCallback((clientX: number, clientY: number, inFrame: boolean) => {
    if (!inFrame) return { x: clientX, y: clientY };
    const frameRect = frameRef.current?.getBoundingClientRect();
    return { x: clientX + (frameRect?.left ?? 0), y: clientY + (frameRect?.top ?? 0) };
  }, []);

  const hitTest = useCallback((clientX: number, clientY: number, inFrame: boolean): ResolvedGroup | null => {
    for (const group of resolvedGroupsRef.current) {
      if (group.inFrame !== inFrame) continue;
      for (const rect of group.range.getClientRects()) {
        if (clientX >= rect.left - 2 && clientX <= rect.right + 2 && clientY >= rect.top - 2 && clientY <= rect.bottom + 2) {
          return group;
        }
      }
    }
    return null;
  }, []);

  const handlePointerHover = useCallback((clientX: number, clientY: number, inFrame: boolean) => {
    const group = hitTest(clientX, clientY, inFrame);
    if (!group) {
      setHover(null);
      return;
    }
    const entries = memoEntriesRef.current;
    const latestId = latestEntryId(entries, group.entryIds);
    const latest = entries.find((entry) => entry.id === latestId);
    if (!latest) {
      setHover(null);
      return;
    }
    const point = hostPointFor(clientX, clientY, inFrame);
    setHover({ x: point.x, y: point.y + 14, count: group.entryIds.length, preview: memoHoverPreview(latest) });
  }, [hitTest, hostPointFor]);

  const openPanel = useCallback(() => {
    if (!memoPanelVisible) updateConfig({ memoPanelOpen: true, memoPanelCollapsed: false });
  }, [memoPanelVisible, updateConfig]);

  const handleHighlightClick = useCallback((clientX: number, clientY: number, inFrame: boolean, selectionWin: Window): boolean => {
    const selection = selectionWin.getSelection();
    if (selection && !selection.isCollapsed) return false;
    const group = hitTest(clientX, clientY, inFrame);
    if (!group) return false;
    openPanel();
    flashEntry(latestEntryId(memoEntriesRef.current, group.entryIds));
    return true;
  }, [flashEntry, hitTest, openPanel]);

  // ---- selection → memo draft -------------------------------------------------

  const selectionScopeFor = useCallback((node: Node): { root: Node; anchor: string } | null => {
    if (kind === "markdown") {
      const previewRoot = markdownMode === "preview" ? mdPreviewRoot() : null;
      return previewRoot ? { root: previewRoot, anchor: "text" } : null;
    }
    if (kind === "html" || kind === "epub") {
      const doc = frameRef.current?.contentDocument;
      if (!doc?.body) return null;
      if (kind === "epub") {
        // nodeType instead of instanceof: iframe nodes are cross-realm.
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        const section = element?.closest("section.epub-chapter");
        const match = section?.id.match(/^epub-chapter-(\d+)$/);
        if (match) return { root: section as Element, anchor: `spine=${Number(match[1]) - 1}` };
      }
      return { root: doc.body, anchor: "text" };
    }
    if (kind === "pdf") {
      const pageNode = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const pageElement = pageNode?.closest<HTMLElement>("[data-pdf-page]");
      const page = pageElement ? Number(pageElement.dataset.pdfPage) : 0;
      if (!page) return null;
      const layer = pdfRef.current?.getTextLayer(page);
      return layer ? { root: layer, anchor: `page=${page}` } : null;
    }
    return null;
  }, [kind, markdownMode, mdPreviewRoot]);

  const buildSelectionDraft = useCallback((win: Window): MemoDraft | null => {
    const selection = win.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const quote = selection.toString();
    if (!normalizeAnchorText(quote)) return null;
    const range = selection.getRangeAt(0);
    const scope = selectionScopeFor(range.startContainer);
    if (!scope) return null;
    const root = scope.root;
    // NOTE: no `instanceof Node` guard here — iframe (EPUB/HTML) nodes live in
    // another realm, where host-window instanceof checks are always false.
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const context = selectionContextFor(buildTextIndex(root), quote, range);
    return {
      anchor: scope.anchor,
      quote,
      quotePrefix: context.prefix,
      quoteSuffix: context.suffix,
    };
  }, [selectionScopeFor]);

  // Right-clicking a selection opens the Copy / Add-to-memo context menu.
  // Returns true when our menu is shown (suppressing the native one).
  const handleSelectionContextMenu = useCallback((clientX: number, clientY: number, win: Window, inFrame: boolean): boolean => {
    const selectionDraft = buildSelectionDraft(win);
    if (!selectionDraft) return false;
    const point = viewportPointFor(clientX, clientY, inFrame);
    setMenu({ x: point.x, y: point.y + 2, draft: selectionDraft });
    return true;
  }, [buildSelectionDraft, viewportPointFor]);

  const handleTextareaContextMenu = useCallback((event: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart === selectionEnd) return;
    const quote = value.slice(selectionStart, selectionEnd);
    if (!normalizeAnchorText(quote)) return;
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY + 2,
      draft: {
        anchor: "text",
        quote,
        quotePrefix: normalizeAnchorText(value.slice(Math.max(0, selectionStart - 40), selectionStart)).slice(-30),
        quoteSuffix: normalizeAnchorText(value.slice(selectionEnd, selectionEnd + 40)).slice(0, 30),
      },
    });
  }, []);

  const adoptDraft = useCallback(() => {
    if (!menu) return;
    setDraft(menu.draft);
    setMenu(null);
    openPanel();
    window.getSelection()?.removeAllRanges();
    frameRef.current?.contentWindow?.getSelection()?.removeAllRanges();
  }, [menu, openPanel]);

  const copySelection = useCallback(async () => {
    if (!menu) return;
    try {
      await navigator.clipboard.writeText(menu.draft.quote);
      showToast(t("memo.copied"));
    } catch {
      showToast(t("memo.copyFailed"));
    }
    setMenu(null);
  }, [menu, showToast, t]);

  // Attach listeners inside the iframe document (EPUB/HTML); rewired per load.
  useEffect(() => {
    if (kind !== "html" && kind !== "epub") return;
    const doc = frameRef.current?.contentDocument;
    const win = frameRef.current?.contentWindow;
    if (!doc || !win) return;

    const onContextMenu = (event: globalThis.MouseEvent) => {
      if (!memoConfigured) return;
      if (handleSelectionContextMenu(event.clientX, event.clientY, win, true)) event.preventDefault();
    };
    const onMouseMove = (event: globalThis.MouseEvent) => handlePointerHover(event.clientX, event.clientY, true);
    const onClick = (event: globalThis.MouseEvent) => {
      handleHighlightClick(event.clientX, event.clientY, true, win);
    };
    const onMouseDown = () => setMenu(null);
    doc.addEventListener("contextmenu", onContextMenu);
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("click", onClick);
    doc.addEventListener("mousedown", onMouseDown);
    return () => {
      doc.removeEventListener("contextmenu", onContextMenu);
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("mousedown", onMouseDown);
    };
  }, [kind, frameLoadTick, memoConfigured, handleSelectionContextMenu, handlePointerHover, handleHighlightClick]);

  // ---- timeline → document jumps ---------------------------------------------

  const flashRange = useCallback((win: Window, range: Range) => {
    setHighlight(win, "gemihub-memo-flash", [range]);
    window.setTimeout(() => clearHighlight(win, "gemihub-memo-flash"), FLASH_MS);
  }, []);

  const scrollRangeIntoView = useCallback((range: Range) => {
    const node = range.startContainer;
    // nodeType instead of instanceof: iframe nodes are cross-realm.
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const jumpToAnchor = useCallback((entry: MemoEntry) => {
    if (!entry.anchor) return;

    if (kind === "pdf") {
      const page = pageFromAnchor(entry.anchor);
      const pdf = pdfRef.current;
      if (page === null || !pdf || page < 1 || page > Math.max(1, pdf.getPageCount())) {
        showToast(t("memo.broken"));
        return;
      }
      pdf.scrollToPage(page);
      let tries = 0;
      const attempt = () => {
        const layer = pdf.getTextLayer(page);
        if (layer && layer.childElementCount) {
          const match = findQuoteMatch(buildTextIndex(layer), entry.quote, entry.quotePrefix, entry.quoteSuffix);
          if (match) {
            scrollRangeIntoView(match.range);
            flashRange(window, match.range);
          }
          // Quote missing on the page: keep the page jump, no highlight.
          return;
        }
        if (++tries < 15) window.setTimeout(attempt, 200);
      };
      window.setTimeout(attempt, 250);
      return;
    }

    if (kind === "epub" || kind === "html") {
      const doc = frameRef.current?.contentDocument;
      const win = frameRef.current?.contentWindow;
      if (!doc?.body || !win) {
        showToast(t("memo.broken"));
        return;
      }
      const spine = kind === "epub" ? spineFromAnchor(entry.anchor) : null;
      const section = spine !== null ? epubSectionFor(doc, spine) : null;
      const root = section ?? doc.body;
      const match = entry.quote ? findQuoteMatch(buildTextIndex(root), entry.quote, entry.quotePrefix, entry.quoteSuffix) : null;
      if (match) {
        scrollRangeIntoView(match.range);
        flashRange(win, match.range);
        return;
      }
      if (section) {
        // Reflow-safe fallback — jump to the spine section top.
        section.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      showToast(t("memo.broken"));
      return;
    }

    if (kind === "markdown") {
      const previewRoot = markdownMode === "preview" ? mdPreviewRoot() : null;
      if (!previewRoot) {
        showToast(t("memo.previewOnly"));
        return;
      }
      const match = findQuoteMatch(buildTextIndex(previewRoot), entry.quote, entry.quotePrefix, entry.quoteSuffix);
      if (!match) {
        showToast(t("memo.broken"));
        return;
      }
      scrollRangeIntoView(match.range);
      flashRange(window, match.range);
      return;
    }

    if (kind === "text" && textareaRef.current) {
      const textarea = textareaRef.current;
      const value = textarea.value;
      let at = value.indexOf(entry.quote);
      if (at === -1) {
        // Whitespace-flexible fallback matching.
        const pattern = normalizeAnchorText(entry.quote)
          .split(" ")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\s+");
        const match = value.match(new RegExp(pattern));
        at = match?.index ?? -1;
      }
      if (at === -1) {
        showToast(t("memo.broken"));
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(at, at + entry.quote.length);
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
      const lineNumber = value.slice(0, at).split("\n").length - 1;
      textarea.scrollTop = Math.max(0, lineNumber * lineHeight - textarea.clientHeight / 2);
      return;
    }

    showToast(t("memo.broken"));
  }, [kind, markdownMode, mdPreviewRoot, epubSectionFor, flashRange, scrollRangeIntoView, showToast, t]);

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

  const interactive = kind === "markdown" || kind === "pdf";

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
        onContextMenu={memoConfigured ? handleTextareaContextMenu : undefined}
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
        {memoPanelOpen && !memoPanelVisible && (
          <div className="flex shrink-0 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
            <button
              type="button"
              onClick={() => updateConfig({ memoPanelCollapsed: false })}
              title={t("memo.expand")}
              className="p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        )}
        {memoPanelVisible && (
          <MemoTimelinePanel
            entries={memoEntries}
            loading={memoLoading}
            error={memoError}
            draft={draft}
            onClearDraft={() => setDraft(null)}
            onPost={postMemo}
            onEdit={editMemo}
            onDelete={deleteMemo}
            onTogglePin={togglePinMemo}
            unresolvedIds={unresolvedIds}
            flashEntryId={flashEntryId}
            onJumpToAnchor={jumpToAnchor}
            onCollapse={() => updateConfig({ memoPanelCollapsed: true })}
            onClose={() => updateConfig({ memoPanelOpen: false })}
          />
        )}
        <div
          ref={contentWrapRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          onContextMenu={interactive && memoConfigured
            ? (event) => {
                if (handleSelectionContextMenu(event.clientX, event.clientY, window, false)) event.preventDefault();
              }
            : undefined}
          onMouseMove={interactive ? (event) => handlePointerHover(event.clientX, event.clientY, false) : undefined}
          onMouseDown={() => setMenu(null)}
          onClick={interactive ? (event) => handleHighlightClick(event.clientX, event.clientY, false, window) : undefined}
          onMouseLeave={() => setHover(null)}
        >
          {renderContent()}

          {hover && (
            <div
              className="pointer-events-none absolute z-20 max-w-64 rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              style={{ left: Math.max(4, Math.min(hover.x, (contentWrapRef.current?.clientWidth ?? 300) - 260)), top: hover.y }}
            >
              {hover.count > 1 && (
                <span className="mb-1 block text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  {hover.count} {t("memo.countUnit")}
                </span>
              )}
              <p className="line-clamp-4">{hover.preview}</p>
            </div>
          )}

          {toast && (
            <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-gray-700">
              {toast}
            </div>
          )}
        </div>
      </div>

      {menu && memoConfigured && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t("memo.copy"), icon: <Copy size={13} />, onClick: () => void copySelection() },
            { label: t("memo.addToMemo"), icon: <SquarePen size={13} />, onClick: adoptDraft },
          ]}
        />
      )}
    </div>
  );
}
