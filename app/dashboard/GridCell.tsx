import { useRef, useState, useEffect, useCallback } from "react";
import { GripVertical, Maximize2, Settings, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { Widget, LayoutPos, GridLayout, WidgetContext } from "./types";
import WidgetRenderer from "./WidgetRenderer";

type InteractionMode = "drag" | "resize" | null;

interface GridCellProps {
  widget: Widget;
  pos: LayoutPos;
  grid: GridLayout;
  cellW: number;
  cellH: number;
  editMode: boolean;
  onDragStart?: () => void;
  onDragEnd: (pos: LayoutPos) => void;
  onResizeEnd: (pos: LayoutPos) => void;
  computeDragPos: (widgetId: string, dxPx: number, dyPx: number) => LayoutPos;
  computeResizePos: (widgetId: string, dxPx: number, dyPx: number) => LayoutPos;
  onSettings?: () => void;
  onDelete?: () => void;
  /** Persist a config change emitted by the widget itself (works in view mode). */
  onConfigChange?: (config: unknown) => void;
  /** The .dashboard file's ID (passed to WidgetContext for sidecar caches). */
  dashboardFileId?: string;
}

export default function GridCell({
  widget,
  pos,
  grid,
  cellW,
  cellH,
  editMode,
  onDragStart,
  onDragEnd,
  onResizeEnd,
  computeDragPos,
  computeResizePos,
  onSettings,
  onDelete,
  onConfigChange,
  dashboardFileId,
}: GridCellProps) {
  const { t } = useI18n();
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(null);
  const [transform, setTransform] = useState<{ dx: number; dy: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ width: number; height: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRef = useRef<{ id: number; target: HTMLElement } | null>(null);
  const [snapPreview, setSnapPreview] = useState<LayoutPos | null>(null);

  const isActive = interactionMode !== null;

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
      if (!editMode) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      pointerRef.current = { id: e.pointerId, target };
      startRef.current = { x: e.clientX, y: e.clientY };
      setInteractionMode("drag");
      setTransform({ dx: 0, dy: 0 });
      onDragStart?.();
    },
    [editMode, onDragStart],
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!editMode) return;
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
    [editMode, cellW, cellH, pos, grid.gap],
  );

  const ctx: WidgetContext = {
    host: "dashboard",
    size: { w: pos.w, h: pos.h },
    editMode,
    widgetId: widget.id,
    dashboardFileId,
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
        className={`group relative rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800 overflow-hidden transition-shadow ${
          editMode ? "border-gray-200" : "border-transparent"
        } ${isActive ? "shadow-lg z-30 opacity-80" : ""}`}
        style={{
          gridColumn: `${pos.x + 1} / span ${pos.w}`,
          gridRow: `${pos.y + 1} / span ${pos.h}`,
          transform: transformStyle,
          width: resizePreview ? `${resizePreview.width}px` : undefined,
          height: resizePreview ? `${resizePreview.height}px` : undefined,
          touchAction: interactionMode ? "none" : undefined,
        }}
      >
        {/* Widget content */}
        <div className="h-full w-full overflow-hidden">
          <WidgetRenderer widget={widget} ctx={ctx} />
        </div>

        {/* Drag handle (edit mode only) */}
        {editMode && (
          <div
            onPointerDown={handleDragPointerDown}
            className="absolute top-0 left-0 right-0 h-7 cursor-grab active:cursor-grabbing bg-gray-50/80 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity group-hover:opacity-100"
            style={{ touchAction: "none" }}
          >
            <GripVertical size={14} className="text-gray-400" />
          </div>
        )}

        {/* Settings & Delete buttons (edit mode only, top-right corner) */}
        {editMode && (
          <div className="absolute top-0.5 right-1 flex items-center gap-0.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
            {onSettings && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSettings();
                }}
                className="rounded p-1 bg-gray-50/80 dark:bg-gray-800/80 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                title={t("common.settings")}
              >
                <Settings size={12} />
              </button>
            )}
            {onDelete && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="rounded p-1 bg-gray-50/80 dark:bg-gray-800/80 text-gray-400 hover:text-red-500"
                title={t("dashboard.deleteWidget")}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}

        {/* Resize handle (edit mode only) */}
        {editMode && (
          <div
            onPointerDown={handleResizePointerDown}
            className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity group-hover:opacity-100"
            style={{ touchAction: "none" }}
          >
            <Maximize2 size={12} className="absolute bottom-1 right-1 text-gray-400" />
          </div>
        )}
      </div>
    </>
  );
}
