import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { Plus, Pencil, Check, Undo2, Redo2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useBreakpoint } from "./useBreakpoint";
import { useGridLayout } from "./useGridLayout";
import GridCell from "./GridCell";
import { WidgetPalette } from "./WidgetPalette";
import { WidgetSettingsPanel } from "./WidgetSettingsPanel";
import type { DashboardData, Widget, WidgetDef } from "./types";

interface DashboardCanvasProps {
  data: DashboardData;
  /** Called with the next data on every mutation (add/update/delete/move/resize). */
  onChange: (next: DashboardData) => void;
  editMode: boolean;
  onEditModeChange: (v: boolean) => void;
  /** Left side of the toolbar (e.g. dashboard switcher or file name). */
  toolbarLeft?: ReactNode;
  /** Extra right-side buttons shown only in edit mode (e.g. rename/delete/home). */
  toolbarEditActions?: ReactNode;
  /** Right-side buttons always shown, placed before the edit toggle (e.g. raw toggle). */
  toolbarRight?: ReactNode;
  /** The .dashboard file's ID (passed to widgets as a sidecar cache fallback). */
  dashboardFileId?: string;
  /** The .dashboard file path (stable sidecar cache scope). */
  dashboardFileName?: string;
}

/**
 * Whether a widget has its primary selection set. Used to discard a just-added
 * widget that the user closed without choosing anything. Unknown/custom widget
 * types have no single required field, so they are kept.
 */
function isWidgetConfigured(widget: Widget): boolean {
  const c = widget.config ?? {};
  const str = (key: string): string => {
    const value = c[key];
    return typeof value === "string" ? value.trim() : "";
  };

  switch (widget.type) {
    case "markdown":
      return str("path").length > 0;
    case "web":
      return str("url").length > 0;
    case "workflow":
      return str("workflow").length > 0;
    case "file-list":
    case "card":
    case "table":
      return true;
    case "kanban":
      return str("folder").length > 0 && str("title").length > 0;
    default:
      return true;
  }
}

/**
 * Controlled, reusable dashboard grid editor: toolbar (add widget + edit toggle),
 * the widget grid with drag/resize, the widget palette, and the settings panel.
 *
 * The parent owns the `data` state and persistence; this component only emits
 * `onChange` with the next data. Used by both DashboardHost (home view with a
 * dashboard switcher) and DashboardFileEditor (a single `.dashboard` file).
 */
export function DashboardCanvas({
  data,
  onChange,
  editMode,
  onEditModeChange,
  toolbarLeft,
  toolbarEditActions,
  toolbarRight,
  dashboardFileId,
  dashboardFileName,
}: DashboardCanvasProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  // Id of a widget that was just added from the palette and hasn't been
  // configured yet. If its settings panel is closed without a selection, the
  // widget is discarded rather than left empty on the grid.
  const [pendingNewWidgetId, setPendingNewWidgetId] = useState<string | null>(null);

  // --- Undo/redo history ---
  // The canvas is controlled, so it tracks its own stack of data snapshots.
  // `lastEmittedRef` lets us tell our own commits (data identity unchanged on
  // the round-trip through the parent) from external changes (load/switch/raw
  // edit), which reset the history.
  const stackRef = useRef<DashboardData[]>([data]);
  const indexRef = useRef(0);
  const lastEmittedRef = useRef<DashboardData>(data);
  const coalesceKeyRef = useRef<string | null>(null);
  const [, setTick] = useState(0);
  const rerender = () => setTick((v) => v + 1);

  useEffect(() => {
    if (data !== lastEmittedRef.current) {
      // External change — reset history to this snapshot.
      stackRef.current = [data];
      indexRef.current = 0;
      lastEmittedRef.current = data;
      coalesceKeyRef.current = null;
      rerender();
    }
  }, [data]);

  // Plugins register dashboard widgets asynchronously (after this canvas may
  // already be mounted). The widget registry has no change notification, so a
  // widget whose type loads late would stay stuck on UnknownWidget. Re-render on
  // the registry's change signal so the real widget swaps in without a reload.
  useEffect(() => {
    const onWidgetsChanged = () => rerender();
    window.addEventListener("dashboard-widgets-changed", onWidgetsChanged);
    return () => window.removeEventListener("dashboard-widgets-changed", onWidgetsChanged);
  }, []);

  // Push a new snapshot and emit it. When `coalesceKey` matches the previous
  // commit (e.g. consecutive keystrokes in a config form), replace the top
  // entry instead of stacking a new one so undo stays coarse-grained.
  const commit = useCallback(
    (next: DashboardData, coalesceKey?: string) => {
      const stack = stackRef.current;
      const atTop = indexRef.current === stack.length - 1;
      if (coalesceKey && coalesceKey === coalesceKeyRef.current && atTop) {
        stack[indexRef.current] = next;
      } else {
        const truncated = stack.slice(0, indexRef.current + 1);
        truncated.push(next);
        if (truncated.length > 100) truncated.shift();
        stackRef.current = truncated;
        indexRef.current = truncated.length - 1;
      }
      coalesceKeyRef.current = coalesceKey ?? null;
      lastEmittedRef.current = next;
      rerender();
      onChange(next);
    },
    [onChange],
  );

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    const target = stackRef.current[indexRef.current];
    coalesceKeyRef.current = null;
    lastEmittedRef.current = target;
    rerender();
    onChange(target);
  }, [onChange]);

  const redo = useCallback(() => {
    if (indexRef.current >= stackRef.current.length - 1) return;
    indexRef.current += 1;
    const target = stackRef.current[indexRef.current];
    coalesceKeyRef.current = null;
    lastEmittedRef.current = target;
    rerender();
    onChange(target);
  }, [onChange]);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < stackRef.current.length - 1;

  const { breakpoint, width } = useBreakpoint(containerRef);

  const gridLayout = useGridLayout({
    data,
    breakpoint,
    containerWidth: width,
    onCommit: commit,
  });

  const handleAddWidget = useCallback(
    (def: WidgetDef) => {
      const maxY = data.widgets.reduce(
        (max, w) => Math.max(max, (w.layout.lg?.y ?? 0) + (w.layout.lg?.h ?? 0)),
        0,
      );
      const defaultSize = def.defaultSize ?? { w: 4, h: 3 };
      const newWidget: Widget = {
        id: crypto.randomUUID(),
        type: def.type,
        layout: { lg: { x: 0, y: maxY, w: defaultSize.w, h: defaultSize.h } },
        config: { ...(def.defaultConfig as Record<string, unknown>) },
      };
      commit({ ...data, widgets: [...data.widgets, newWidget] });
      setShowPalette(false);
      // Stay in edit mode so the "Add widget" button remains visible for more.
      onEditModeChange(true);
      // Open settings panel for the newly added widget.
      setEditingWidgetId(newWidget.id);
      setPendingNewWidgetId(newWidget.id);
    },
    [data, commit, onEditModeChange],
  );

  const handleCloseSettings = useCallback(async (nextConfig?: unknown) => {
    const id = editingWidgetId;
    setEditingWidgetId(null);

    const nextData = id && nextConfig !== undefined
      ? {
          ...data,
          widgets: data.widgets.map((w) =>
            w.id === id ? { ...w, config: nextConfig as Record<string, unknown> } : w,
          ),
        }
      : data;

    if (id && id === pendingNewWidgetId) {
      const widget = nextData.widgets.find((w) => w.id === id);
      if (widget && !isWidgetConfigured(widget)) {
        commit({ ...nextData, widgets: nextData.widgets.filter((w) => w.id !== id) });
      } else if (nextConfig !== undefined) {
        commit(nextData, `config:${id}`);
      }
    } else if (nextConfig !== undefined) {
      commit(nextData, id ? `config:${id}` : undefined);
    }

    setPendingNewWidgetId(null);
  }, [editingWidgetId, pendingNewWidgetId, data, commit]);

  const handleUpdateWidgetConfig = useCallback(
    (widgetId: string, config: unknown) => {
      // Coalesce consecutive edits to the same widget's config into one undo step.
      commit(
        {
          ...data,
          widgets: data.widgets.map((w) =>
            w.id === widgetId ? { ...w, config: config as Record<string, unknown> } : w,
          ),
        },
        `config:${widgetId}`,
      );
    },
    [data, commit],
  );

  const handleUpdateWidgetType = useCallback(
    (widgetId: string, nextType: string, nextConfig: Record<string, unknown>) => {
      commit(
        {
          ...data,
          widgets: data.widgets.map((w) =>
            w.id === widgetId ? { ...w, type: nextType, config: nextConfig } : w,
          ),
        },
        `config:${widgetId}`,
      );
    },
    [data, commit],
  );

  const handleDeleteWidget = useCallback(
    (widgetId: string) => {
      if (!confirm(t("dashboard.deleteWidgetConfirm"))) return;
      commit({ ...data, widgets: data.widgets.filter((w) => w.id !== widgetId) });
      setEditingWidgetId(null);
      setPendingNewWidgetId(null);
    },
    [data, commit, t],
  );

  const editingWidget = useMemo(
    () => data.widgets.find((w) => w.id === editingWidgetId) ?? null,
    [data, editingWidgetId],
  );

  const grid = data.grid;
  const gridStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
      gridAutoRows: `${grid.rowHeight}px`,
      gap: `${grid.gap}px`,
    }),
    [grid.cols, grid.rowHeight, grid.gap],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
        <div className="flex items-center gap-2">{toolbarLeft}</div>
        <div className="flex items-center gap-1">
          {editMode && (
            <>
              <button
                onClick={undo}
                disabled={!canUndo}
                title={t("dashboard.undo")}
                className="flex items-center rounded px-1.5 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title={t("dashboard.redo")}
                className="flex items-center rounded px-1.5 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <Redo2 size={14} />
              </button>
              <button
                onClick={() => setShowPalette(true)}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              >
                <Plus size={14} />
                {t("dashboard.addWidget")}
              </button>
              {toolbarEditActions}
            </>
          )}
          {toolbarRight}
          <button
            onClick={() => onEditModeChange(!editMode)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
              editMode
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            }`}
          >
            {editMode ? <Check size={14} /> : <Pencil size={14} />}
            {editMode ? t("dashboard.done") : t("dashboard.edit")}
          </button>
        </div>
      </div>

      {/* Grid container — the ref'd element must always be mounted so
          useBreakpoint can measure it. If it only mounts once widgets exist,
          the breakpoint stays null and newly added widgets never render. */}
      <div className="flex-1 overflow-auto p-3">
        <div
          ref={containerRef}
          className="relative min-h-full"
          style={data.widgets.length > 0 ? gridStyle : undefined}
        >
          {data.widgets.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-4">
              <Plus size={48} className="text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("dashboard.emptyDashboard")}
              </p>
              <button
                onClick={() => setShowPalette(true)}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus size={16} />
                {t("dashboard.addFirstWidget")}
              </button>
            </div>
          ) : (
            gridLayout.layout.map(({ widget, pos }) => (
              <GridCell
                key={widget.id}
                widget={widget}
                pos={pos}
                grid={grid}
                cellW={gridLayout.cellW}
                cellH={gridLayout.cellH}
                editMode={editMode}
                onDragEnd={(newPos) => gridLayout.commitPos(widget.id, newPos)}
                onResizeEnd={(newPos) => gridLayout.commitPos(widget.id, newPos)}
                computeDragPos={gridLayout.computeDragPos}
                computeResizePos={gridLayout.computeResizePos}
                onSettings={editMode ? () => setEditingWidgetId(widget.id) : undefined}
                onDelete={editMode ? () => handleDeleteWidget(widget.id) : undefined}
                onConfigChange={(config) => handleUpdateWidgetConfig(widget.id, config)}
                dashboardFileId={dashboardFileId}
                dashboardFileName={dashboardFileName}
              />
            ))
          )}
        </div>
      </div>

      {showPalette && (
        <WidgetPalette onSelect={handleAddWidget} onClose={() => setShowPalette(false)} />
      )}

      {editingWidget && (
        <WidgetSettingsPanel
          widget={editingWidget}
          onChange={(config) => handleUpdateWidgetConfig(editingWidget.id, config)}
          onTypeChange={(type, config) => handleUpdateWidgetType(editingWidget.id, type, config)}
          onClose={handleCloseSettings}
          onDelete={() => handleDeleteWidget(editingWidget.id)}
          dashboardFileId={dashboardFileId}
          dashboardFileName={dashboardFileName}
        />
      )}
    </div>
  );
}
