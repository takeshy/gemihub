import { useRef, useState, useEffect, useCallback } from "react";
import { ExternalLink, GripVertical, Maximize2, Minimize2, Settings, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import type { Widget, LayoutPos, GridLayout, WidgetContext } from "./types";
import type { EncryptionSettings } from "~/types/settings";
import WidgetRenderer from "./WidgetRenderer";
import { getWidgetDef } from "./widgets/registry";

type InteractionMode = "drag" | "resize" | null;

interface GridCellProps {
  widget: Widget;
  pos: LayoutPos;
  grid: GridLayout;
  cellW: number;
  cellH: number;
  onDragEnd: (pos: LayoutPos) => void;
  onResizeEnd: (pos: LayoutPos) => void;
  computeDragPos: (widgetId: string, dxPx: number, dyPx: number) => LayoutPos;
  computeResizePos: (widgetId: string, dxPx: number, dyPx: number) => LayoutPos;
  onSettings?: () => void;
  onDelete?: () => void;
  /** Whether this cell fills the whole grid area (widget maximize). */
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  /** Hidden (but kept mounted, preserving widget state) while a sibling is maximized. */
  hidden?: boolean;
  /** Persist a config change emitted by the widget itself (works in view mode). */
  onConfigChange?: (config: unknown) => void;
  /** The .dashboard file's ID (passed to WidgetContext as a sidecar cache fallback). */
  dashboardFileId?: string;
  /** The .dashboard file path (stable sidecar cache scope). */
  dashboardFileName?: string;
  encryptionSettings?: EncryptionSettings;
}

export default function GridCell({
  widget,
  pos,
  grid,
  cellW,
  cellH,
  onDragEnd,
  onResizeEnd,
  computeDragPos,
  computeResizePos,
  onSettings,
  onDelete,
  isMaximized,
  onToggleMaximize,
  hidden,
  onConfigChange,
  dashboardFileId,
  dashboardFileName,
  encryptionSettings,
}: GridCellProps) {
  const { t } = useI18n();
  const { fileList } = useEditorContext();
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(null);
  const [transform, setTransform] = useState<{ dx: number; dy: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ width: number; height: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRef = useRef<{ id: number; target: HTMLElement } | null>(null);
  const [snapPreview, setSnapPreview] = useState<LayoutPos | null>(null);

  const isActive = interactionMode !== null;
  // Maximized cells aren't movable/resizable. (obsidian-gemini-helper also
  // disables the handles while a file widget's memo panel is open, but its
  // full-width drag tab conflicted with memo text selection — GemiHub's drag
  // is confined to the pill grip, so no such guard is needed.)
  const layoutHandlesEnabled = !isMaximized;

  // --- Chrome pill repositioning ---
  // The hover pill floats over widget content, so it can cover a control the
  // user actually wants. Its left nub lets the user drag the pill anywhere
  // inside the cell (session-only; resets when the cell is resized/maximized,
  // since the clamped offset no longer fits the new bounds).
  const cellRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const pillDragRef = useRef<{ startX: number; startY: number; baseDx: number; baseDy: number } | null>(null);
  const [pillOffset, setPillOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [pillDragging, setPillDragging] = useState(false);

  useEffect(() => {
    setPillOffset(null);
  }, [pos.w, pos.h, isMaximized]);

  const handlePillPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pillDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseDx: pillOffset?.dx ?? 0,
        baseDy: pillOffset?.dy ?? 0,
      };
      setPillDragging(true);
    },
    [pillOffset],
  );

  const handlePillPointerMove = useCallback((e: React.PointerEvent) => {
    const start = pillDragRef.current;
    if (!start) return;
    let dx = start.baseDx + e.clientX - start.startX;
    let dy = start.baseDy + e.clientY - start.startY;
    const cell = cellRef.current?.getBoundingClientRect();
    const pill = pillRef.current?.getBoundingClientRect();
    if (cell && pill) {
      // Default (offset-less) pill position: horizontally centered, 4px from
      // the top (wrapper is `inset-x-0 top-1` + `justify-center`).
      const maxDx = Math.max(0, (cell.width - pill.width) / 2);
      dx = Math.min(maxDx, Math.max(-maxDx, dx));
      dy = Math.min(Math.max(0, cell.height - pill.height - 4), Math.max(-4, dy));
    }
    setPillOffset({ dx, dy });
  }, []);

  const handlePillPointerUp = useCallback((e: React.PointerEvent) => {
    if (!pillDragRef.current) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    pillDragRef.current = null;
    setPillDragging(false);
  }, []);

  // --- Unified drag/resize pointer handling ---
  // A single effect keyed on `interactionMode` (boolean-like) so listeners
  // are added once per interaction, not re-bound on every pointermove frame.
  useEffect(() => {
    if (interactionMode === null) return;

    const compute = interactionMode === "drag" ? computeDragPos : computeResizePos;

    const clearInteraction = () => {
      const pointer = pointerRef.current;
      if (pointer?.target.hasPointerCapture?.(pointer.id)) {
        pointer.target.releasePointerCapture(pointer.id);
      }
      pointerRef.current = null;
      setInteractionMode(null);
      setTransform(null);
      setResizePreview(null);
      setSnapPreview(null);
      startRef.current = null;
    };

    const onMove = (e: PointerEvent) => {
      if (!startRef.current) return;
      if (pointerRef.current && e.pointerId !== pointerRef.current.id) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      // Drag follows the pointer via translate; resize grows the cell box
      // itself (width/height) so it visibly resizes instead of moving.
      if (interactionMode === "drag") {
        setTransform({ dx, dy });
      } else if (cellW > 0 && cellH > 0) {
        const nextPos = compute(widget.id, dx, dy);
        setResizePreview({
          width: nextPos.w * cellW + (nextPos.w - 1) * grid.gap,
          height: nextPos.h * cellH + (nextPos.h - 1) * grid.gap,
        });
      }
      if (cellW > 0 && cellH > 0) {
        setSnapPreview(compute(widget.id, dx, dy));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!startRef.current) return;
      if (pointerRef.current && e.pointerId !== pointerRef.current.id) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      const finalPos = compute(widget.id, dx, dy);
      if (interactionMode === "drag") {
        onDragEnd(finalPos);
      } else {
        onResizeEnd(finalPos);
      }
      clearInteraction();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", clearInteraction);
    window.addEventListener("blur", clearInteraction);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", clearInteraction);
      window.removeEventListener("blur", clearInteraction);
    };
  }, [interactionMode, cellW, cellH, computeDragPos, computeResizePos, onDragEnd, onResizeEnd, widget.id, pos, grid]);

  const handleDragPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      pointerRef.current = { id: e.pointerId, target };
      startRef.current = { x: e.clientX, y: e.clientY };
      setInteractionMode("drag");
      setTransform({ dx: 0, dy: 0 });
    },
    [],
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      pointerRef.current = { id: e.pointerId, target };
      startRef.current = { x: e.clientX, y: e.clientY };
      setInteractionMode("resize");
      setTransform(null);
      if (cellW > 0 && cellH > 0) {
        setResizePreview({
          width: pos.w * cellW + (pos.w - 1) * grid.gap,
          height: pos.h * cellH + (pos.h - 1) * grid.gap,
        });
      }
    },
    [cellW, cellH, pos, grid.gap],
  );

  // Backing targets get an Open button in the chrome pill: Drive files navigate
  // to their main viewer page, external URLs open in a new browser tab.
  const widgetDef = getWidgetDef(widget.type);
  const backingFilePath = widgetDef.filePathOf?.(widget.config);
  const backingFile = backingFilePath
    ? fileList.find((f) => (f.path || f.name) === backingFilePath)
    : undefined;
  const externalUrl = widgetDef.externalUrlOf?.(widget.config);
  const hasOpenTarget = Boolean(backingFile || externalUrl);
  const handleOpenTarget = useCallback(() => {
    if (externalUrl) {
      window.open(externalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!backingFile) return;
    // No mimeType: like FileListWidget, let MainViewer detect the type from
    // the file name (media-utils' guessMimeType only knows media extensions
    // and would mark .md as binary application/octet-stream).
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: backingFile.id, fileName: backingFile.path || backingFile.name },
      }),
    );
  }, [backingFile, externalUrl]);

  const ctx: WidgetContext = {
    host: "dashboard",
    size: { w: pos.w, h: pos.h },
    widgetId: widget.id,
    dashboardFileId,
    dashboardFileName,
    encryptionSettings,
    onConfigChange,
  };

  const transformStyle = transform
    ? `translate(${transform.dx}px, ${transform.dy}px)`
    : undefined;

  return (
    <>
      {/* Snap preview outline (shown during drag/resize) */}
      {snapPreview && cellW > 0 && cellH > 0 && (
        <div
          className="pointer-events-none absolute border-2 border-blue-400 bg-blue-400/10 rounded-lg z-20"
          style={{
            left: snapPreview.x * (cellW + grid.gap),
            top: snapPreview.y * (cellH + grid.gap),
            width: snapPreview.w * cellW + (snapPreview.w - 1) * grid.gap,
            height: snapPreview.h * cellH + (snapPreview.h - 1) * grid.gap,
          }}
        />
      )}

      <div
        ref={cellRef}
        className={`group rounded-lg border border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-800 overflow-hidden transition-shadow ${
          isActive ? "shadow-lg z-30 opacity-80" : ""
        } ${isMaximized ? "absolute inset-0 z-40 shadow-md" : "relative"}`}
        style={
          isMaximized
            ? undefined
            : {
                display: hidden ? "none" : undefined,
                gridColumn: `${pos.x + 1} / span ${pos.w}`,
                gridRow: `${pos.y + 1} / span ${pos.h}`,
                transform: transformStyle,
                width: resizePreview ? `${resizePreview.width}px` : undefined,
                height: resizePreview ? `${resizePreview.height}px` : undefined,
                touchAction: interactionMode ? "none" : undefined,
              }
        }
      >
        {/* Widget content */}
        <div className="h-full w-full overflow-hidden">
          <WidgetRenderer widget={widget} ctx={ctx} />
        </div>

        {/* Hover-revealed chrome pill (settings / drag grip / delete), centered
            at the top. Widget headers keep their own controls at the left/right
            edges, so the center is the one spot the pill can float without
            covering them. The wrapper ignores pointer events (and the pill only
            accepts them while the cell is hovered) so widget content stays
            clickable everywhere else. Touch devices have no reliable hover, so
            `pointer-coarse:` keeps the pill always visible and interactive there. */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-1 z-10 flex justify-center transition-opacity ${
            isActive || pillDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
          }`}
        >
          <div
            ref={pillRef}
            className={`flex items-center rounded-md border border-gray-200 bg-gray-50/90 shadow-sm dark:border-gray-700 dark:bg-gray-800/90 ${
              isActive || pillDragging
                ? "pointer-events-auto"
                : "pointer-events-none group-hover:pointer-events-auto pointer-coarse:pointer-events-auto"
            }`}
            style={pillOffset ? { transform: `translate(${pillOffset.dx}px, ${pillOffset.dy}px)` } : undefined}
          >
            {/* Pill mover — drags the pill itself out of the way when it
                covers a widget control (the center grip moves the widget) */}
            <div
              onPointerDown={handlePillPointerDown}
              onPointerMove={handlePillPointerMove}
              onPointerUp={handlePillPointerUp}
              onPointerCancel={handlePillPointerUp}
              className="flex h-7 w-3.5 shrink-0 cursor-move items-center justify-center text-gray-300 dark:text-gray-600"
              style={{ touchAction: "none" }}
              title={t("dashboard.moveToolbar")}
            >
              <GripVertical size={10} />
            </div>
            {onToggleMaximize && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMaximize();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
                title={isMaximized ? t("dashboard.restoreWidget") : t("dashboard.maximizeWidget")}
              >
                {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}
            {hasOpenTarget && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenTarget();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
                title={externalUrl ? t("workspace.openExternal") : t("dashboard.openFile")}
              >
                <ExternalLink size={14} />
              </button>
            )}
            {onSettings && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSettings();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
                title={t("common.settings")}
              >
                <Settings size={14} />
              </button>
            )}
            {layoutHandlesEnabled && (
              <div
                onPointerDown={handleDragPointerDown}
                className="flex h-7 w-9 cursor-grab items-center justify-center text-gray-400 active:cursor-grabbing"
                style={{ touchAction: "none" }}
                title={t("dashboard.dragToMove")}
              >
                <GripVertical size={14} />
              </div>
            )}
            {onDelete && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:text-red-500 dark:text-gray-300"
                title={t("dashboard.deleteWidget")}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Resize handle — hover-revealed on desktop, always on for touch
            (`pointer-coarse:`), same reveal model as the chrome pill */}
        {layoutHandlesEnabled && (
          <div
            onPointerDown={handleResizePointerDown}
            className={`absolute bottom-0 right-0 w-5 h-5 cursor-se-resize transition-opacity ${
              isActive
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 hover:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
            }`}
            style={{ touchAction: "none" }}
            title={t("dashboard.dragToResize")}
          >
            <Maximize2 size={12} className="absolute bottom-1 right-1 text-gray-400" />
          </div>
        )}
      </div>
    </>
  );
}
