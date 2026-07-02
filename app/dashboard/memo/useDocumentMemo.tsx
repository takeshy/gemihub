// Per-document memo orchestration (ported from mdwys), shared by the
// dashboard File widget and the IDE viewers. Owns the memo file IO, quote
// anchoring/highlights (CSS Custom Highlight API), selection → draft context
// menu, hover previews, timeline↔document jumps, and the timeline panel —
// the host component supplies the document refs and renders the returned
// pieces around its content.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import { ChevronsRight, Copy, SquarePen } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { ContextMenu } from "~/components/ide/ContextMenu";
import type { MdEditMode } from "~/components/ide/editors/MarkdownFileEditor";
import type { PdfViewerHandle } from "~/components/shared/PdfViewer";
import type { DocKind } from "~/dashboard/widgets/file-widget/docKind";
import {
  deleteEntry,
  parseMemoFile,
  replaceEntryBody,
  setEntryPinned,
  type MemoEntry,
} from "./memoTimeline";
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
} from "./textAnchor";
import {
  memoPathForDocument,
  postMemoEntry,
  readMemoFileLocal,
  rewriteMemoEntry,
} from "./memoStore";
import { MemoTimelinePanel, memoHoverPreview, type MemoDraft } from "./MemoTimelinePanel";

const FLASH_MS = 1000;
const TOAST_MS = 2500;

function usesTouchSelectionUi(): boolean {
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
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

export interface UseDocumentMemoOptions {
  /** Document Drive path; empty string disables memos entirely. */
  drivePath: string;
  kind: DocKind;
  /** Markdown edit mode — anchoring/highlights work in "preview" only. */
  markdownMode?: MdEditMode;
  /** Highlight-registry contributor id (must be stable and unique per host). */
  contributorId: string;
  /** Wrapper element around the rendered document (spread wrapperHandlers on it). */
  contentWrapRef: RefObject<HTMLDivElement | null>;
  /** Iframe hosting EPUB/HTML content. */
  frameRef?: RefObject<HTMLIFrameElement | null>;
  /** pdf.js viewer handle for PDF documents. */
  pdfRef?: RefObject<PdfViewerHandle | null>;
  /** Access to the plain-text editor's textarea (kind === "text"). */
  getTextarea?: () => HTMLTextAreaElement | null;
  panelOpen: boolean;
  panelCollapsed: boolean;
  /** When false the open panel renders as the collapsed rail (narrow hosts). */
  wideEnough?: boolean;
  onPanelChange: (patch: { open?: boolean; collapsed?: boolean }) => void;
  /** Extra values whose change should re-resolve highlights (content, bytes, scales, ticks). */
  refreshSignals?: readonly unknown[];
  /** Bumped by the host on iframe load so listeners/highlights re-attach. */
  frameLoadTick?: number;
}

export interface DocumentMemoApi {
  memoConfigured: boolean;
  memoPanelVisible: boolean;
  /** Collapsed rail (render before the content wrapper when non-null). */
  rail: ReactNode;
  /** Timeline panel (render before the content wrapper when non-null). */
  panel: ReactNode;
  /** Hover preview + toast (render inside the relative content wrapper). */
  overlays: ReactNode;
  /** Selection context menu portal (render anywhere). */
  contextMenu: ReactNode;
  /** Spread on the content wrapper element. */
  wrapperHandlers: {
    onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
    onMouseMove?: (event: ReactMouseEvent<HTMLDivElement>) => void;
    onMouseDown: () => void;
    onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
    onTouchEnd?: (event: ReactTouchEvent<HTMLDivElement>) => void;
    onMouseLeave: () => void;
  };
  /** Attach to the plain-text editor's textarea (kind === "text"). */
  onTextareaContextMenu: (event: ReactMouseEvent<HTMLTextAreaElement>) => void;
  /**
   * Native-event variant for hosts that can't pass a React handler to the
   * textarea. Returns true when the memo menu was opened (caller should
   * preventDefault).
   */
  openTextareaMenu: (textarea: HTMLTextAreaElement, clientX: number, clientY: number) => boolean;
}

export function useDocumentMemo({
  drivePath,
  kind,
  markdownMode,
  contributorId,
  contentWrapRef,
  frameRef,
  pdfRef,
  getTextarea,
  panelOpen,
  panelCollapsed,
  wideEnough = true,
  onPanelChange,
  refreshSignals = [],
  frameLoadTick = 0,
}: UseDocumentMemoOptions): DocumentMemoApi {
  const { t } = useI18n();
  const memoConfigured = Boolean(drivePath);
  const memoPanelVisible = panelOpen && !panelCollapsed && wideEnough;
  const memoPath = useMemo(() => (drivePath ? memoPathForDocument(drivePath) : ""), [drivePath]);

  const [memoEntries, setMemoEntries] = useState<MemoEntry[]>([]);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState("");
  const [draft, setDraft] = useState<MemoDraft | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hover, setHover] = useState<HoverPopover | null>(null);
  const [toast, setToast] = useState("");
  const [flashEntryId, setFlashEntryId] = useState<string | null>(null);
  const [unresolvedIds, setUnresolvedIds] = useState<ReadonlySet<string>>(new Set());
  const [mdPreviewTick, setMdPreviewTick] = useState(0);

  const resolvedGroupsRef = useRef<ResolvedGroup[]>([]);
  const toastTimerRef = useRef(0);
  const flashTimerRef = useRef(0);
  const memoEntriesRef = useRef<MemoEntry[]>([]);
  memoEntriesRef.current = memoEntries;
  const memoFileIdRef = useRef<string | null>(null);

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

  // Another host on the same document (or a Pull) may change the memo file.
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
    if (!drivePath) throw new Error("no document is open");
    await postMemoEntry(drivePath, body, postDraft);
    await reloadMemo();
  }, [drivePath, reloadMemo]);

  const editMemo = useCallback(
    (id: string, body: string) => rewriteMemoEntry(drivePath, (c) => replaceEntryBody(c, id, body)).then(reloadMemo),
    [drivePath, reloadMemo],
  );
  const deleteMemo = useCallback(
    (id: string) => rewriteMemoEntry(drivePath, (c) => deleteEntry(c, id)).then(reloadMemo),
    [drivePath, reloadMemo],
  );
  const togglePinMemo = useCallback(
    (id: string, pinned: boolean) => rewriteMemoEntry(drivePath, (c) => setEntryPinned(c, id, pinned)).then(reloadMemo),
    [drivePath, reloadMemo],
  );

  // ---- anchor resolution & highlights ----------------------------------------

  const mdPreviewRoot = useCallback(
    () => contentWrapRef.current?.querySelector<HTMLElement>("[data-md-preview-root]") ?? null,
    [contentWrapRef],
  );

  const epubSectionFor = useCallback((doc: Document, spine: number): Element | null => {
    return doc.getElementById(`epub-chapter-${spine + 1}`);
  }, []);

  const applyHighlights = useCallback(() => {
    if (!panelOpen) {
      resolvedGroupsRef.current = [];
      setMemoHighlights(contributorId, window, []);
      const hiddenFrameWin = frameRef?.current?.contentWindow;
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
    } else if ((kind === "html" || kind === "epub") && frameRef?.current?.contentDocument?.body) {
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
    } else if (kind === "pdf" && pdfRef?.current) {
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
    } else if (kind === "text") {
      const textarea = getTextarea?.();
      if (textarea) {
        const haystack = normalizeAnchorText(textarea.value);
        for (const entry of anchored) {
          if (!haystack.includes(normalizeAnchorText(entry.quote))) unresolved.add(entry.id);
        }
      }
    }

    const groupList = [...groups.values()];
    resolvedGroupsRef.current = groupList;

    setMemoHighlights(contributorId, window, groupList.filter((group) => !group.inFrame).map((group) => group.range));
    const frameWin = frameRef?.current?.contentWindow;
    if (frameWin) {
      setMemoHighlights(`${contributorId}:frame`, frameWin, groupList.filter((group) => group.inFrame).map((group) => group.range));
    } else {
      // The host may have switched away from an iframe document.
      clearMemoHighlights(`${contributorId}:frame`);
    }

    setUnresolvedIds((previous) => {
      if (previous.size === unresolved.size && [...unresolved].every((id) => previous.has(id))) return previous;
      return unresolved;
    });
  }, [kind, markdownMode, mdPreviewRoot, epubSectionFor, contributorId, panelOpen, frameRef, pdfRef, getTextarea]);

  useEffect(() => () => {
    clearMemoHighlights(contributorId);
    clearMemoHighlights(`${contributorId}:frame`);
  }, [contributorId]);

  useEffect(() => {
    const timer = window.setTimeout(applyHighlights, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyHighlights, memoEntries, frameLoadTick, mdPreviewTick, ...refreshSignals]);

  // The markdown preview loads lazily and re-renders on edits, so watch its
  // subtree to re-resolve anchors (CSS custom highlights don't mutate the DOM,
  // so this cannot loop).
  useEffect(() => {
    if (!panelOpen || kind !== "markdown" || markdownMode !== "preview") return;
    const wrap = contentWrapRef.current;
    if (!wrap) return;
    const observer = new MutationObserver(() => setMdPreviewTick((value) => value + 1));
    observer.observe(wrap, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [panelOpen, kind, markdownMode, contentWrapRef]);

  // ---- pointer interactions (hover popover, highlight click) -----------------

  const hostPointFor = useCallback((clientX: number, clientY: number, inFrame: boolean) => {
    const wrapRect = contentWrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return { x: 0, y: 0 };
    if (!inFrame) return { x: clientX - wrapRect.left, y: clientY - wrapRect.top };
    const frameRect = frameRef?.current?.getBoundingClientRect();
    return {
      x: clientX + (frameRect?.left ?? 0) - wrapRect.left,
      y: clientY + (frameRect?.top ?? 0) - wrapRect.top,
    };
  }, [contentWrapRef, frameRef]);

  /** Viewport coordinates for the portal ContextMenu. */
  const viewportPointFor = useCallback((clientX: number, clientY: number, inFrame: boolean) => {
    if (!inFrame) return { x: clientX, y: clientY };
    const frameRect = frameRef?.current?.getBoundingClientRect();
    return { x: clientX + (frameRect?.left ?? 0), y: clientY + (frameRect?.top ?? 0) };
  }, [frameRef]);

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
    if (!memoPanelVisible) onPanelChange({ open: true, collapsed: false });
  }, [memoPanelVisible, onPanelChange]);

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
      const doc = frameRef?.current?.contentDocument;
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
      const layer = pdfRef?.current?.getTextLayer(page);
      return layer ? { root: layer, anchor: `page=${page}` } : null;
    }
    return null;
  }, [kind, markdownMode, mdPreviewRoot, frameRef, pdfRef]);

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

  const buildTextareaDraft = useCallback((textarea: HTMLTextAreaElement): MemoDraft | null => {
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart === selectionEnd) return null;
    const quote = value.slice(selectionStart, selectionEnd);
    if (!normalizeAnchorText(quote)) return null;
    return {
      anchor: "text",
      quote,
      quotePrefix: normalizeAnchorText(value.slice(Math.max(0, selectionStart - 40), selectionStart)).slice(-30),
      quoteSuffix: normalizeAnchorText(value.slice(selectionEnd, selectionEnd + 40)).slice(0, 30),
    };
  }, []);

  const openTextareaMenu = useCallback((textarea: HTMLTextAreaElement, clientX: number, clientY: number): boolean => {
    if (!memoConfigured) return false;
    const textareaDraft = buildTextareaDraft(textarea);
    if (!textareaDraft) return false;
    setMenu({
      x: clientX,
      y: clientY + 2,
      draft: textareaDraft,
    });
    return true;
  }, [buildTextareaDraft, memoConfigured]);

  const onTextareaContextMenu = useCallback((event: ReactMouseEvent<HTMLTextAreaElement>) => {
    if (openTextareaMenu(event.currentTarget, event.clientX, event.clientY)) event.preventDefault();
  }, [openTextareaMenu]);

  const selectionMenuPoint = useCallback((win: Window, inFrame: boolean): { x: number; y: number } | null => {
    const selection = win.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects());
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    const viewportPoint = viewportPointFor(rect.left + rect.width / 2, rect.top, inFrame);
    const y = viewportPoint.y > 48 ? viewportPoint.y - 42 : viewportPoint.y + rect.height + 8;
    return { x: Math.max(8, Math.min(viewportPoint.x - 70, window.innerWidth - 148)), y: Math.max(8, y) };
  }, [viewportPointFor]);

  const textareaMenuPoint = useCallback((textarea: HTMLTextAreaElement): { x: number; y: number } => {
    const rect = textarea.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(rect.left + rect.width / 2 - 70, window.innerWidth - 148)),
      y: Math.max(8, rect.top + 8),
    };
  }, []);

  const showMobileSelectionMenu = useCallback((win: Window, inFrame: boolean) => {
    if (!memoConfigured || !usesTouchSelectionUi()) return;
    window.setTimeout(() => {
      const selectionDraft = buildSelectionDraft(win);
      if (!selectionDraft) return;
      const point = selectionMenuPoint(win, inFrame);
      if (!point) return;
      setMenu({ ...point, draft: selectionDraft });
    }, 180);
  }, [buildSelectionDraft, memoConfigured, selectionMenuPoint]);

  const showMobileTextareaMenu = useCallback((textarea: HTMLTextAreaElement, clientX?: number, clientY?: number) => {
    if (!memoConfigured || !usesTouchSelectionUi()) return;
    window.setTimeout(() => {
      const textareaDraft = buildTextareaDraft(textarea);
      if (!textareaDraft) return;
      const point = clientX !== undefined && clientY !== undefined
        ? { x: Math.max(8, Math.min(clientX - 70, window.innerWidth - 148)), y: Math.max(8, clientY + 8) }
        : textareaMenuPoint(textarea);
      setMenu({ ...point, draft: textareaDraft });
    }, 180);
  }, [buildTextareaDraft, memoConfigured, textareaMenuPoint]);

  const adoptDraft = useCallback(() => {
    if (!menu) return;
    setDraft(menu.draft);
    setMenu(null);
    openPanel();
    window.getSelection()?.removeAllRanges();
    frameRef?.current?.contentWindow?.getSelection()?.removeAllRanges();
  }, [menu, openPanel, frameRef]);

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
    const doc = frameRef?.current?.contentDocument;
    const win = frameRef?.current?.contentWindow;
    if (!doc || !win) return;

    const onContextMenu = (event: globalThis.MouseEvent) => {
      if (!memoConfigured) return;
      if (handleSelectionContextMenu(event.clientX, event.clientY, win, true)) event.preventDefault();
    };
    const onSelectionChange = () => showMobileSelectionMenu(win, true);
    const onTouchEnd = () => showMobileSelectionMenu(win, true);
    const onMouseMove = (event: globalThis.MouseEvent) => handlePointerHover(event.clientX, event.clientY, true);
    const onClick = (event: globalThis.MouseEvent) => {
      handleHighlightClick(event.clientX, event.clientY, true, win);
    };
    const onMouseDown = () => setMenu(null);
    doc.addEventListener("contextmenu", onContextMenu);
    doc.addEventListener("selectionchange", onSelectionChange);
    doc.addEventListener("touchend", onTouchEnd);
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("click", onClick);
    doc.addEventListener("mousedown", onMouseDown);
    return () => {
      doc.removeEventListener("contextmenu", onContextMenu);
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("touchend", onTouchEnd);
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("mousedown", onMouseDown);
    };
  }, [kind, frameLoadTick, memoConfigured, handleSelectionContextMenu, handlePointerHover, handleHighlightClick, showMobileSelectionMenu, frameRef]);

  // Mobile browsers usually do not dispatch a useful contextmenu for text
  // selections. Detect completed selections and show the same app menu.
  useEffect(() => {
    if (!memoConfigured) return;
    const onSelectionChange = () => {
      if (!usesTouchSelectionUi()) return;
      if (kind === "text") {
        const active = document.activeElement;
        if (active instanceof HTMLTextAreaElement && contentWrapRef.current?.contains(active)) {
          showMobileTextareaMenu(active);
        }
        return;
      }
      if (kind === "markdown" || kind === "pdf") showMobileSelectionMenu(window, false);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [kind, memoConfigured, contentWrapRef, showMobileSelectionMenu, showMobileTextareaMenu]);

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
      const pdf = pdfRef?.current;
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
      const doc = frameRef?.current?.contentDocument;
      const win = frameRef?.current?.contentWindow;
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

    if (kind === "text") {
      const textarea = getTextarea?.();
      if (textarea) {
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
    }

    showToast(t("memo.broken"));
  }, [kind, markdownMode, mdPreviewRoot, epubSectionFor, flashRange, scrollRangeIntoView, showToast, t, frameRef, pdfRef, getTextarea]);

  // ---- rendered pieces ---------------------------------------------------------

  const interactive = kind === "markdown" || kind === "pdf";

  const rail = panelOpen && !memoPanelVisible ? (
    <div className="flex shrink-0 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
      <button
        type="button"
        onClick={() => onPanelChange({ collapsed: false })}
        title={t("memo.expand")}
        className="p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <ChevronsRight size={14} />
      </button>
    </div>
  ) : null;

  const panel = memoPanelVisible ? (
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
      onCollapse={() => onPanelChange({ collapsed: true })}
      onClose={() => onPanelChange({ open: false })}
    />
  ) : null;

  const overlays = (
    <>
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
    </>
  );

  const contextMenu = menu && memoConfigured ? (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={() => setMenu(null)}
      items={[
        { label: t("memo.copy"), icon: <Copy size={13} />, onClick: () => void copySelection() },
        { label: t("memo.addToMemo"), icon: <SquarePen size={13} />, onClick: adoptDraft },
      ]}
    />
  ) : null;

  const wrapperHandlers: DocumentMemoApi["wrapperHandlers"] = {
    onContextMenu: interactive && memoConfigured
      ? (event) => {
          if (handleSelectionContextMenu(event.clientX, event.clientY, window, false)) event.preventDefault();
        }
      : undefined,
    onMouseMove: interactive ? (event) => handlePointerHover(event.clientX, event.clientY, false) : undefined,
    onMouseDown: () => setMenu(null),
    onClick: interactive ? (event) => handleHighlightClick(event.clientX, event.clientY, false, window) : undefined,
    onTouchEnd: memoConfigured
      ? (event) => {
          const touch = event.changedTouches[0];
          if (kind === "text") {
            const target = event.target as HTMLElement;
            const textarea = target instanceof HTMLTextAreaElement ? target : target.closest("textarea");
            if (textarea) showMobileTextareaMenu(textarea, touch?.clientX, touch?.clientY);
            return;
          }
          if (interactive) showMobileSelectionMenu(window, false);
        }
      : undefined,
    onMouseLeave: () => setHover(null),
  };

  return {
    memoConfigured,
    memoPanelVisible,
    rail,
    panel,
    overlays,
    contextMenu,
    wrapperHandlers,
    onTextareaContextMenu,
    openTextareaMenu,
  };
}
