// Wraps an IDE viewer with the per-document memo timeline (same feature as
// the dashboard File widget). The panel toggle is a floating button at the
// bottom-right of the content area; its state is remembered globally in
// localStorage — turn memos on once and every document you open shows them.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { NotebookPen } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useDocumentMemo } from "~/dashboard/memo/useDocumentMemo";
import { getStoredMemoPanelState, setStoredMemoPanelState } from "~/dashboard/memo/panelState";
import type { DocKind } from "~/dashboard/widgets/file-widget/docKind";
import type { MdEditMode } from "./MarkdownFileEditor";
import type { PdfViewerHandle } from "~/components/shared/PdfViewer";

export function IdeDocumentMemo({
  drivePath,
  kind,
  markdownMode,
  frameRef,
  pdfRef,
  frameLoadTick,
  refreshSignals,
  children,
}: {
  /** Document Drive path (memo file identity — same as the File widget). */
  drivePath: string;
  kind: DocKind;
  markdownMode?: MdEditMode;
  frameRef?: RefObject<HTMLIFrameElement | null>;
  pdfRef?: RefObject<PdfViewerHandle | null>;
  frameLoadTick?: number;
  refreshSignals?: readonly unknown[];
  children: ReactNode;
}) {
  const { t } = useI18n();
  const contentWrapRef = useRef<HTMLDivElement | null>(null);
  const contributorId = `ide-memo-${useId()}`;

  const [panelState, setPanelState] = useState(getStoredMemoPanelState);
  const onPanelChange = useCallback((patch: { open?: boolean; collapsed?: boolean }) => {
    setPanelState((current) => {
      const next = {
        open: patch.open ?? current.open,
        collapsed: patch.collapsed ?? current.collapsed,
      };
      setStoredMemoPanelState(next);
      return next;
    });
  }, []);

  const getTextarea = useCallback(
    () => contentWrapRef.current?.querySelector("textarea") ?? null,
    [],
  );

  const memo = useDocumentMemo({
    drivePath,
    kind,
    markdownMode,
    contributorId,
    contentWrapRef,
    frameRef,
    pdfRef,
    getTextarea,
    panelOpen: panelState.open,
    panelCollapsed: panelState.collapsed,
    onPanelChange,
    refreshSignals,
    frameLoadTick,
  });

  // Plain-text editors render their own textarea; hook the selection context
  // menu up via a native listener instead of a React prop.
  const { openTextareaMenu } = memo;
  useEffect(() => {
    if (kind !== "text") return;
    const wrap = contentWrapRef.current;
    if (!wrap) return;
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName !== "TEXTAREA") return;
      if (openTextareaMenu(target as HTMLTextAreaElement, event.clientX, event.clientY)) {
        event.preventDefault();
      }
    };
    wrap.addEventListener("contextmenu", onContextMenu);
    return () => wrap.removeEventListener("contextmenu", onContextMenu);
  }, [kind, openTextareaMenu]);

  return (
    <div className="flex min-h-0 flex-1">
      {memo.rail}
      {memo.panel}
      <div
        ref={contentWrapRef}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        {...memo.wrapperHandlers}
      >
        {children}
        {memo.overlays}
        <button
          type="button"
          title={t("memo.panelToggle")}
          onClick={() =>
            onPanelChange(
              panelState.open ? { open: false } : { open: true, collapsed: false },
            )
          }
          className={`absolute bottom-3 right-3 z-20 rounded-full border p-2 shadow-md transition-opacity ${
            panelState.open
              ? "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/70 dark:text-amber-300"
              : "border-gray-200 bg-white/90 text-gray-400 opacity-60 hover:text-gray-600 hover:opacity-100 dark:border-gray-700 dark:bg-gray-800/90 dark:hover:text-gray-300"
          }`}
        >
          <NotebookPen size={14} />
        </button>
      </div>
      {memo.contextMenu}
    </div>
  );
}
