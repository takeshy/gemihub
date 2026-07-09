// Kanban widget: groups folder-backed Markdown files by a frontmatter status
// property and writes status changes back to the file frontmatter on drop.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDown, LayoutGrid, Plus, X } from "lucide-react";
import yaml from "js-yaml";
import { getCachedFile, getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { findFileByNameLocal, readFileLocal, writeFileLocal } from "~/services/drive-local";
import { updateFrontmatterKey } from "../frontmatter-writeback";
import { collectKanbanFileOptions, parseKanbanFile, type KanbanBoardDefinition, type KanbanFileOption } from "./kanban-file";
import { DASHBOARD_KANBAN_FILE_UPDATED_EVENT } from "./kanban-events";
import type { WidgetContext } from "../types";
import type { DataRow, FilterCondition, KanbanColumnConfig, KanbanWidgetConfig } from "./types";
import { loadFolderRows } from "./folder-source";
import { applyPostSource, formatCell, getCellValue } from "./filter";
import { useI18n } from "~/i18n/context";
import { FilePreviewModal } from "../widgets/FilePreviewModal";
import { Popover } from "./ViewControls";

const UNSPECIFIED = "__unspecified__";
const DEFAULT_COLUMNS: KanbanColumnConfig[] = [
  { value: "todo", label: "To Do" },
  { value: "in-progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

type DropPosition = "before" | "after";
type DropTarget = { column: string; rowId: string; position: DropPosition } | null;

function scalar(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function normalizeColumns(columns: KanbanWidgetConfig["columns"]): KanbanColumnConfig[] {
  const source = Array.isArray(columns) && columns.length > 0 ? columns : DEFAULT_COLUMNS;
  const seen = new Set<string>();
  const out: KanbanColumnConfig[] = [];
  for (const col of source) {
    const normalized =
      typeof col === "string"
        ? { value: col.trim(), label: col.trim() }
        : {
            value: typeof col.value === "string" ? col.value.trim() : "",
            label: typeof col.label === "string" ? col.label.trim() : "",
          };
    if (!normalized.value || seen.has(normalized.value)) continue;
    seen.add(normalized.value);
    out.push(normalized);
  }
  return out;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
}

function joinPath(folder: string, fileName: string): string {
  const dir = folder.trim().replace(/[/\\]+$/, "");
  return dir ? `${dir}/${fileName}` : fileName;
}

function buildNewCardContent(options: {
  title: string;
  titleProperty: string;
  statusProperty: string;
  status: string;
}): string {
  const frontmatter: Record<string, unknown> = {};
  if (options.status) frontmatter[options.statusProperty] = options.status;
  if (options.title && options.titleProperty && options.titleProperty !== "file.name") {
    frontmatter[options.titleProperty] = options.title;
  }
  const fm = Object.keys(frontmatter).length > 0
    ? `---\n${yaml.dump(frontmatter, { lineWidth: -1, noRefs: true })}---\n\n`
    : "";
  return `${fm}# ${options.title}\n`;
}

function fieldDisplayType(field: string): "date" | undefined {
  return field === "file.mtime" || field === "mtime" || field === "file.ctime" || field === "ctime"
    ? "date"
    : undefined;
}

export default function KanbanWidget({
  config,
  ctx,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t, language } = useI18n();
  const cfg = (config ?? {}) as KanbanWidgetConfig;
  const kanbanPath = (cfg.kanban ?? "").trim();

  // File-backed board definition (.kanban). When cfg.kanban is set the file is
  // the single source of truth; inline keys (except cardOrder) are ignored.
  const [fileDef, setFileDef] = useState<KanbanBoardDefinition | null>(null);
  const [fileDefError, setFileDefError] = useState(false);
  const [defRefreshKey, setDefRefreshKey] = useState(0);
  const [kanbanFiles, setKanbanFiles] = useState<KanbanFileOption[]>([]);
  const [showKanbanMenu, setShowKanbanMenu] = useState(false);
  const kanbanButtonRef = useRef<HTMLButtonElement>(null);

  const refreshKanbanFiles = useCallback(async () => {
    const meta = await getCachedRemoteMeta();
    setKanbanFiles(meta ? collectKanbanFileOptions(meta.files) : []);
  }, []);

  useEffect(() => {
    void refreshKanbanFiles();
  }, [refreshKanbanFiles]);

  useEffect(() => {
    if (!kanbanPath) {
      setFileDef(null);
      setFileDefError(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const found = await findFileByNameLocal(kanbanPath);
        if (!found) throw new Error("board file not found");
        const parsed = parseKanbanFile(await readFileLocal(found.id));
        if (cancelled) return;
        setFileDef(parsed);
        setFileDefError(parsed === null);
      } catch {
        if (!cancelled) {
          setFileDef(null);
          setFileDefError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kanbanPath, defRefreshKey]);

  useEffect(() => {
    if (!kanbanPath) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ fileName?: string }>).detail;
      if (detail?.fileName !== kanbanPath) return;
      setDefRefreshKey((k) => k + 1);
    };
    window.addEventListener(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, handler);
  }, [kanbanPath]);

  const def: KanbanBoardDefinition = kanbanPath ? (fileDef ?? {}) : cfg;
  const folder = def.folder ?? "";
  const boardTitle = (def.title ?? "").trim();
  const statusProperty = def.statusProperty || "status";
  const titleProperty = def.titleProperty || "title";
  const displayFields = def.displayFields ?? [];
  const configuredColumns = useMemo(() => normalizeColumns(def.columns), [def.columns]);
  const showUnspecified = def.showUnspecified !== false;

  const [rows, setRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [landedRowId, setLandedRowId] = useState<string | null>(null);
  const [cardOrder, setCardOrder] = useState<string[]>(
    Array.isArray(cfg.cardOrder) ? cfg.cardOrder.filter((id): id is string => typeof id === "string") : [],
  );
  const [showNewCard, setShowNewCard] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState(configuredColumns[0]?.value ?? "");
  const [previewRow, setPreviewRow] = useState<DataRow | null>(null);

  const selectKanbanFile = useCallback(
    (fileName: string) => {
      ctx?.onConfigChange?.({ kanban: fileName, cardOrder: cfg.cardOrder });
      setShowKanbanMenu(false);
    },
    [ctx, cfg.cardOrder],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    const folderRows = await loadFolderRows(folder);
    setRows(folderRows);
    setLoading(false);
  }, [folder]);

  useEffect(() => {
    setCardOrder(Array.isArray(cfg.cardOrder) ? cfg.cardOrder.filter((id): id is string => typeof id === "string") : []);
  }, [cfg.cardOrder]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 300);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    const handler = () => void loadData();
    window.addEventListener("dashboard-data-changed", handler);
    return () => window.removeEventListener("dashboard-data-changed", handler);
  }, [loadData]);

  useEffect(() => {
    if (configuredColumns.length > 0 && !configuredColumns.some((col) => col.value === newStatus)) {
      setNewStatus(configuredColumns[0].value);
    }
  }, [configuredColumns, newStatus]);

  const processedRows = useMemo(
    () => {
      const filtered = applyPostSource(rows, {
        filter: def.filter as FilterCondition[] | undefined,
        sort: def.sort as string | undefined,
        limit: def.limit,
      });
      const orderMap = new Map(cardOrder.map((id, index) => [id, index]));
      return [...filtered].sort((a, b) => {
        const ai = orderMap.get(a.id);
        const bi = orderMap.get(b.id);
        if (ai == null && bi == null) return 0;
        if (ai == null) return 1;
        if (bi == null) return -1;
        return ai - bi;
      });
    },
    [rows, def.filter, def.sort, def.limit, cardOrder],
  );

  const columns = useMemo(() => {
    if (!showUnspecified) return configuredColumns;
    const known = new Set(configuredColumns.map((col) => col.value));
    const hasUnspecified = processedRows.some((row) => {
      const status = scalar(row.cells[statusProperty]);
      return !status || !known.has(status);
    });
    return hasUnspecified || configuredColumns.length === 0
      ? [...configuredColumns, { value: UNSPECIFIED, label: t("dashboard.kanbanUnspecified") }]
      : configuredColumns;
  }, [configuredColumns, processedRows, showUnspecified, statusProperty, t]);

  const rowsByColumn = useMemo(() => {
    const map = new Map<string, DataRow[]>();
    const known = new Set(configuredColumns.map((col) => col.value));
    for (const col of columns) map.set(col.value, []);
    for (const row of processedRows) {
      const status = scalar(row.cells[statusProperty]);
      if (known.has(status)) {
        map.get(status)!.push(row);
      } else if (showUnspecified && map.has(UNSPECIFIED)) {
        map.get(UNSPECIFIED)!.push(row);
      }
    }
    return map;
  }, [columns, configuredColumns, processedRows, showUnspecified, statusProperty]);

  const navigateToFile = (row: DataRow) => {
    if (!row.fileId) return;
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: row.fileId, fileName: row.fileName },
      }),
    );
  };

  const flashLanded = (rowId: string) => {
    setLandedRowId(rowId);
    window.setTimeout(() => setLandedRowId((current) => (current === rowId ? null : current)), 700);
  };

  const persistCardOrder = (nextOrder: string[]) => {
    setCardOrder(nextOrder);
    ctx?.onConfigChange?.({ ...cfg, cardOrder: nextOrder });
  };

  const reorderCard = (rowId: string, target: DropTarget, fallbackColumn: string): string[] => {
    const visibleIds = new Set(processedRows.map((row) => row.id));
    const base = [
      ...cardOrder.filter((id) => visibleIds.has(id)),
      ...processedRows.map((row) => row.id).filter((id) => !cardOrder.includes(id)),
    ].filter((id) => id !== rowId);
    if (target?.rowId && target.rowId !== rowId) {
      const index = base.indexOf(target.rowId);
      if (index >= 0) {
        base.splice(target.position === "before" ? index : index + 1, 0, rowId);
        return base;
      }
    }
    const columnRows = rowsByColumn.get(fallbackColumn) ?? [];
    const lastInColumn = [...columnRows].reverse().find((r) => r.id !== rowId);
    if (!lastInColumn) return [rowId, ...base];
    const index = base.indexOf(lastInColumn.id);
    base.splice(index >= 0 ? index + 1 : base.length, 0, rowId);
    return base;
  };

  const moveCard = async (row: DataRow, nextStatus: string, target: DropTarget) => {
    if (!row.fileId || pendingFileId) return;
    const oldStatus = row.cells[statusProperty];
    const nextValue = nextStatus === UNSPECIFIED ? null : nextStatus;
    const oldColumn = scalar(oldStatus);
    const sameColumn =
      (nextStatus === UNSPECIFIED && (!oldColumn || !configuredColumns.some((col) => col.value === oldColumn))) ||
      oldColumn === nextStatus;
    const nextOrder = reorderCard(row.id, target, nextStatus);

    if (sameColumn) {
      persistCardOrder(nextOrder);
      flashLanded(row.id);
      setDraggingRowId(null);
      setDropColumn(null);
      setDropTarget(null);
      return;
    }

    setPendingFileId(row.fileId);
    setError(null);
    persistCardOrder(nextOrder);
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              cells: {
                ...r.cells,
                ...(nextValue === null ? { [statusProperty]: undefined } : { [statusProperty]: nextValue }),
              },
            }
          : r,
      ),
    );

    try {
      const cached = await getCachedFile(row.fileId);
      if (!cached) throw new Error(t("dashboard.fileNotFound"));
      const result = updateFrontmatterKey(cached.content, statusProperty, nextValue);
      if (result === null) throw new Error(t("dashboard.unparseableFrontmatter"));
      await writeFileLocal(cached.fileName ?? row.fileName!, result.content, {
        existingFileId: row.fileId,
      });
      flashLanded(row.id);
      window.dispatchEvent(
        new CustomEvent("dashboard-data-changed", {
          detail: { folder },
        }),
      );
    } catch (err) {
      persistCardOrder(cardOrder);
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, cells: { ...r.cells, [statusProperty]: oldStatus } } : r,
        ),
      );
      setError(err instanceof Error ? err.message : t("dashboard.writeFailed"));
    } finally {
      setPendingFileId(null);
      setDraggingRowId(null);
      setDropColumn(null);
      setDropTarget(null);
    }
  };

  const createCard = async () => {
    const title = newTitle.trim() || t("dashboard.kanbanNewCardName");
    const base = sanitizeFileName(title) || t("dashboard.kanbanNewCardName");
    let candidate = `${base}.md`;
    let index = 2;
    while (await findFileByNameLocal(joinPath(folder, candidate))) {
      candidate = `${base} ${index++}.md`;
    }

    setError(null);
    try {
      const path = joinPath(folder, candidate);
      const result = await writeFileLocal(
        path,
        buildNewCardContent({
          title,
          titleProperty,
          statusProperty,
          status: newStatus,
        }),
      );
      setShowNewCard(false);
      setNewTitle("");
      await loadData();
      window.dispatchEvent(
        new CustomEvent("dashboard-data-changed", {
          detail: { folder },
        }),
      );
      // Open the new card in the same modal as clicking an existing card;
      // full-page open stays one click away via the modal's navigate icon.
      setPreviewRow({ id: result.fileId, fileId: result.fileId, fileName: path, cells: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.kanbanNewCardError"));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.loading")}
      </div>
    );
  }

  if (kanbanPath && fileDefError) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-center text-sm text-gray-400">
        {t("dashboard.kanbanFileMissing")}
      </div>
    );
  }

  if (kanbanPath && !fileDef) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.loading")}
      </div>
    );
  }

  if (!folder) {
    // A widget with no board file and no definition at all → point at settings
    // (pick/create a .kanban); a definition without a folder → folder prompt.
    const hasDefinition =
      Boolean(kanbanPath) || Boolean((def.title ?? "").trim()) || def.columns !== undefined;
    return (
      <div className="flex h-full items-center justify-center px-3 text-center text-sm text-gray-400">
        {hasDefinition ? t("dashboard.kanbanSelectFolder") : t("dashboard.kanbanPickFile")}
      </div>
    );
  }

  const allColumns = columns.map((column) => ({
    ...column,
    label: column.value === UNSPECIFIED ? t("dashboard.kanbanUnspecified") : column.label || column.value,
    rows: rowsByColumn.get(column.value) ?? [],
  }));

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white dark:bg-gray-950">
      <div className="flex flex-shrink-0 items-center gap-2 px-3 py-2">
        {ctx?.onConfigChange && kanbanPath ? (
          <button
            ref={kanbanButtonRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!showKanbanMenu) void refreshKanbanFiles();
              setShowKanbanMenu((v) => !v);
            }}
            className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
            title={kanbanPath}
          >
            <LayoutGrid size={13} className="shrink-0 text-gray-400" />
            <span className="truncate">{boardTitle || kanbanPath}</span>
            <ChevronDown size={12} className="shrink-0 text-gray-400" />
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
            {boardTitle}
          </span>
        )}
        {showKanbanMenu && (
          <KanbanFilePopover
            anchorRef={kanbanButtonRef}
            files={kanbanFiles}
            current={kanbanPath}
            onSelect={selectKanbanFile}
            onClose={() => setShowKanbanMenu(false)}
          />
        )}
        {error && <span className="min-w-0 truncate text-[11px] text-red-500">{error}</span>}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowNewCard(true);
          }}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          title={t("dashboard.kanbanNewCard")}
        >
          <Plus size={13} />
          {t("dashboard.kanbanNewCard")}
        </button>
      </div>

      {allColumns.length === 0 ? (
        <div className="flex h-full items-center justify-center px-3 text-center text-sm text-gray-400">
          {t("dashboard.kanbanEmpty")}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-2 pb-2">
          {allColumns.map((column, index) => (
            <section
              key={column.value}
              onDragOver={(e) => {
                e.preventDefault();
                setDropColumn(column.value);
              }}
              onDragLeave={() => {
                setDropColumn((current) => (current === column.value ? null : current));
                setDropTarget((current) => (current?.column === column.value ? null : current));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const rowId = e.dataTransfer.getData("text/plain") || draggingRowId;
                const row = rows.find((r) => r.id === rowId);
                if (row) void moveCard(row, column.value, dropTarget?.column === column.value ? dropTarget : null);
              }}
              className={`flex min-w-[240px] flex-[0_0_240px] flex-col overflow-hidden rounded-lg border-t-[3px] bg-gray-50 p-1.5 outline outline-2 -outline-offset-2 transition dark:bg-gray-900 ${
                dropColumn === column.value ? "outline-current" : "outline-transparent"
              } ${KANBAN_ACCENTS[index % KANBAN_ACCENTS.length]}`}
            >
              <div className="mb-1.5 flex items-center justify-between border-b-2 border-current px-1.5 pb-1.5 text-current">
                <span className="truncate text-xs font-semibold">{column.label}</span>
                <span className="min-w-[20px] rounded-full bg-current px-1.5 py-0.5 text-center text-[10px] font-semibold">
                  <span className="text-white dark:text-gray-950">{column.rows.length}</span>
                </span>
              </div>
              <div className="flex min-h-6 flex-1 flex-col gap-1.5 overflow-y-auto">
                {column.rows.map((row) => {
                  const title = scalar(getCellValue(row, titleProperty)) || row.fileName || t("dashboard.kanbanUntitled");
                  return (
                    <article
                      key={row.id}
                      draggable={row.fmParseable}
                      onDragStart={(e) => {
                        setDraggingRowId(row.id);
                        e.dataTransfer.setData("text/plain", row.id);
                      }}
                      onDragOver={(e) => {
                        if (!draggingRowId || draggingRowId === row.id) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const position: DropPosition = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                        setDropColumn(column.value);
                        setDropTarget({ column: column.value, rowId: row.id, position });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const rowId = e.dataTransfer.getData("text/plain") || draggingRowId;
                        const dragged = rows.find((r) => r.id === rowId);
                        if (dragged) void moveCard(dragged, column.value, dropTarget?.column === column.value ? dropTarget : null);
                      }}
                      onDragEnd={() => {
                        setDraggingRowId(null);
                        setDropColumn(null);
                        setDropTarget(null);
                      }}
                      onClick={() => setPreviewRow(row)}
                      title={t("dashboard.kanbanDragToMove")}
                      className={`cursor-pointer select-none rounded-md border border-gray-200 border-l-[3px] border-l-current bg-white px-2.5 py-2 text-xs shadow-sm transition hover:border-current hover:shadow-md dark:border-gray-700 dark:bg-gray-950 ${
                        pendingFileId === row.fileId || draggingRowId === row.id ? "opacity-50" : ""
                      } ${landedRowId === row.id ? "animate-pulse" : ""} ${
                        dropTarget?.rowId === row.id && dropTarget.position === "before"
                          ? "ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900"
                          : dropTarget?.rowId === row.id && dropTarget.position === "after"
                            ? "ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900"
                            : ""
                      }`}
                    >
                      <div className="break-words font-medium leading-snug text-gray-900 dark:text-gray-100">
                        {title}
                      </div>
                      {displayFields.length > 0 && (
                        <dl className="mt-1.5 space-y-1">
                          {displayFields.map((field) => {
                            const value = getCellValue(row, field);
                            const formatted = formatCell(value, fieldDisplayType(field), language);
                            if (!formatted) return null;
                            return (
                              <div key={field} className="flex gap-1.5 text-[10px] leading-snug">
                                <dt className="shrink-0 text-gray-400">{field}</dt>
                                <dd className="min-w-0 break-words text-gray-600 dark:text-gray-300">{formatted}</dd>
                              </div>
                            );
                          })}
                        </dl>
                      )}
                      {row.fileName && row.fileName !== title && (
                        <div className="mt-1.5 break-all text-[10px] text-gray-400">{row.fileName}</div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {showNewCard && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 p-3 backdrop-blur-[1px]"
          onClick={() => setShowNewCard(false)}
        >
          <form
            className="w-full max-w-xs rounded-lg border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void createCard();
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("dashboard.kanbanNewCardTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowNewCard(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                title={t("common.close")}
              >
                <X size={14} />
              </button>
            </div>
            <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("dashboard.kanbanNewCardNameLabel")}
              <input
                autoFocus
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t("dashboard.kanbanNewCardName")}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
            <label className="mb-3 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("dashboard.kanbanNewCardColumn")}
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {configuredColumns.map((column) => (
                  <option key={column.value} value={column.value}>
                    {column.label || column.value}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewCard(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                {t("dashboard.kanbanNewCardCreate")}
              </button>
            </div>
          </form>
        </div>
      )}

      {previewRow?.fileId && previewRow.fileName && (
        <FilePreviewModal
          fileId={previewRow.fileId}
          fileName={previewRow.fileName}
          onNavigate={() => {
            navigateToFile(previewRow);
            setPreviewRow(null);
          }}
          onClose={() => setPreviewRow(null)}
        />
      )}
    </div>
  );
}

const KANBAN_ACCENTS = [
  "text-blue-600 dark:text-blue-400",
  "text-amber-600 dark:text-amber-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-violet-600 dark:text-violet-400",
  "text-cyan-600 dark:text-cyan-400",
  "text-pink-600 dark:text-pink-400",
  "text-yellow-600 dark:text-yellow-400",
  "text-red-600 dark:text-red-400",
];
