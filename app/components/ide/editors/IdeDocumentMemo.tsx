// Wraps an IDE viewer with the per-document memo timeline (same feature as
// the dashboard File widget). The panel toggle is rendered by the hosted
// viewer, usually in its toolbar; its state is remembered globally in
// localStorage — turn memos on once and every document you open shows them.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { NotebookPen } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useDocumentMemo } from "~/dashboard/memo/useDocumentMemo";
import { getStoredMemoPanelState, setStoredMemoPanelState } from "~/dashboard/memo/panelState";
import type { DocKind } from "~/dashboard/widgets/file-widget/docKind";
import type { MdEditMode } from "./MarkdownFileEditor";
import type { PdfViewerHandle } from "~/components/shared/PdfViewer";

interface IdeDocumentMemoRenderProps {
  memoToggle: ReactNode;
}

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
  children: ReactNode | ((props: IdeDocumentMemoRenderProps) => ReactNode);
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

  const memoToggle = (
    <button
      type="button"
      title={t("memo.panelToggle")}
      onClick={() =>
        onPanelChange(
          panelState.open ? { open: false } : { open: true, collapsed: false },
        )
      }
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
        panelState.open
          ? "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/70 dark:text-amber-300"
          : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      }`}
    >
      <NotebookPen size={14} />
      <span className="hidden sm:inline">{t("memo.panelToggle")}</span>
    </button>
  );
  const renderedChildren = typeof children === "function" ? children({ memoToggle }) : children;

  return (
    <div className="flex min-h-0 flex-1">
      {memo.rail}
      {memo.panel}
      <div
        ref={contentWrapRef}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        {...memo.wrapperHandlers}
      >
        {renderedChildren}
        {memo.overlays}
      </div>
      {memo.contextMenu}
    </div>
  );
}
