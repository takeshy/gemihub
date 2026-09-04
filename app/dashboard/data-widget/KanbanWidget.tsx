// Kanban widget: groups folder-backed Markdown files by a frontmatter status
// property and writes status changes back to the file frontmatter on drop.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CheckSquare, Paperclip, PenLine, Plus, Sparkles, X } from "lucide-react";
import yaml from "js-yaml";
import { getCachedFile } from "~/services/indexeddb-cache";
import {
  findFileByNameLocal,
  findFileByNameLocalLoose,
  mimeTypeFromFileName,
  readFileBinaryLocal,
  readFileLocal,
  renameFileLocal,
  saveBinaryFileLocal,
  writeFileLocal,
} from "~/services/drive-local";
import { updateFrontmatterKey } from "../frontmatter-writeback";
import { parseKanbanFile, type KanbanBoardDefinition } from "./kanban-file";
import { DASHBOARD_KANBAN_FILE_UPDATED_EVENT } from "./kanban-events";
import type { WidgetContext } from "../types";
import type { DataRow, FilterCondition, KanbanColumnConfig, KanbanWidgetConfig } from "./types";
import { loadFolderRows } from "./folder-source";
import { applyPostSource, formatCell, getCellValue } from "./filter";
import { useI18n } from "~/i18n/context";
import { FilePreviewModal } from "../widgets/FilePreviewModal";
import type { MdEditMode } from "~/components/ide/editors/MarkdownFileEditor";
import { appendSystemTimeline } from "~/services/system-timeline";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { bytesToBase64, base64ToBytes } from "~/utils/media-utils";
import { KanbanTaskModal, type KanbanTaskInput } from "./KanbanTaskModal";
import {
  type KanbanAttachment,
  isCompletionColumn,
  parseKanbanTaskBody,
  replaceKanbanTaskBody,
} from "./kanban-task";
import { generateKanbanTasks, parseKanbanAiTasks } from "./kanban-ai";

const UNSPECIFIED = "__unspecified__";
const DEFAULT_COLUMNS: KanbanColumnConfig[] = [
  { value: "todo", label: "To Do" },
  { value: "in-progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

type DropPosition = "before" | "after";
type DropTarget = { column: string; rowId: string; position: DropPosition } | null;
type NormalizedDisplayField = { field: string; label: string | null; maxLength?: number };

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

function normalizeDisplayFields(fields: KanbanWidgetConfig["displayFields"]): NormalizedDisplayField[] {
  if (!Array.isArray(fields)) return [];
  const out: NormalizedDisplayField[] = [];
  const seen = new Set<string>();
  for (const item of fields) {
    const field = typeof item === "string"
      ? item.trim()
      : typeof item?.field === "string"
        ? item.field.trim()
        : "";
    if (!field || seen.has(field)) continue;
    const label = typeof item === "string"
      ? field
      : typeof item.label === "string"
        ? item.label.trim()
        : field;
    const maxLength = typeof item === "string" ? undefined : item.maxLength;
    seen.add(field);
    out.push({
      field,
      label: label || null,
      maxLength: typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0
        ? Math.floor(maxLength)
        : undefined,
    });
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

function localIsoDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function updateFrontmatterKeys(content: string, values: Record<string, unknown>): string | null {
  let next = content;
  for (const [key, value] of Object.entries(values)) {
    const result = updateFrontmatterKey(next, key, value);
    if (!result) return null;
    next = result.content;
  }
  return next;
}

function canPreviewAttachment(path: string): boolean {
  return /\.(?:avif|bmp|epub|gif|html?|jpe?g|markdown|md|pdf|png|svg|txt|webp)$/i.test(path);
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
  return fm;
}

function fieldDisplayType(field: string): "date" | undefined {
  return field === "file.mtime" || field === "mtime" || field === "file.ctime" || field === "ctime"
    ? "date"
    : undefined;
}

function truncateText(value: string, maxLength?: number): string {
  if (!maxLength || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function rowTags(row: DataRow): string[] {
  if (Array.isArray(row.fileTags)) return row.fileTags;
  const tags = row.cells.tags;
  if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
  if (typeof tags === "string") return tags.split(/[\s,]+/).filter(Boolean);
  return [];
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
  const [resolvedKanbanPath, setResolvedKanbanPath] = useState("");

  useEffect(() => {
    if (!kanbanPath) {
      setFileDef(null);
      setFileDefError(false);
      setResolvedKanbanPath("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const found = await findFileByNameLocalLoose(kanbanPath);
        if (!found) throw new Error("board file not found");
        const parsed = parseKanbanFile(await readFileLocal(found.id));
        if (cancelled) return;
        setFileDef(parsed);
        setFileDefError(parsed === null);
        setResolvedKanbanPath(found.name);
      } catch {
        if (!cancelled) {
          setFileDef(null);
          setFileDefError(true);
          setResolvedKanbanPath("");
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
      const current = resolvedKanbanPath || kanbanPath;
      if (detail?.fileName?.toLowerCase() !== current.toLowerCase()) return;
      setDefRefreshKey((k) => k + 1);
    };
    window.addEventListener(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, handler);
  }, [kanbanPath, resolvedKanbanPath]);

  const def: KanbanBoardDefinition = kanbanPath ? (fileDef ?? {}) : cfg;
  const folder = def.folder ?? "";
  const boardTitle = (def.title ?? "").trim();
  const statusProperty = def.statusProperty || "status";
  const titleProperty = def.titleProperty || "title";
  const dueProperty = def.dueProperty || "due";
  const startedProperty = def.startedProperty || "started";
  const completedProperty = def.completedProperty || "completed";
  const displayFields = useMemo(() => normalizeDisplayFields(def.displayFields), [def.displayFields]);
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
  const [editingRow, setEditingRow] = useState<DataRow | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [previewRow, setPreviewRow] = useState<DataRow | null>(null);
  const [previewInitialMode, setPreviewInitialMode] = useState<MdEditMode | undefined>(undefined);
  const [selectedTag, setSelectedTag] = useState("");

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


  const baseFilteredRows = useMemo(
    () =>
      applyPostSource(rows, {
        filter: def.filter as FilterCondition[] | undefined,
        sort: def.sort as string | undefined,
        limit: def.limit,
      }),
    [rows, def.filter, def.sort, def.limit],
  );

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of baseFilteredRows) {
      for (const tag of rowTags(row)) {
        if (tag) set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseFilteredRows]);

  useEffect(() => {
    if (selectedTag && !tagOptions.includes(selectedTag)) setSelectedTag("");
  }, [selectedTag, tagOptions]);

  const processedRows = useMemo(
    () => {
      const filtered = selectedTag
        ? baseFilteredRows.filter((row) => rowTags(row).includes(selectedTag))
        : baseFilteredRows;
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
    [baseFilteredRows, selectedTag, cardOrder],
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
      const nextIndex = configuredColumns.findIndex((column) => column.value === nextValue);
      const values: Record<string, unknown> = { [statusProperty]: nextValue };
      if (nextIndex > 0 && !row.cells[startedProperty]) values[startedProperty] = localIsoDate();
      if (nextIndex >= 0 && isCompletionColumn(String(nextValue), configuredColumns[nextIndex].label || "")) {
        if (!row.cells[startedProperty]) values[startedProperty] = localIsoDate();
        values[completedProperty] = localIsoDate();
      } else {
        values[completedProperty] = null;
      }
      const content = updateFrontmatterKeys(cached.content, values);
      if (content === null) throw new Error(t("dashboard.unparseableFrontmatter"));
      await writeFileLocal(cached.fileName ?? row.fileName!, content, {
        existingFileId: row.fileId,
      });
      const cardTitle = scalar(getCellValue(row, titleProperty)) || row.fileName || t("dashboard.kanbanUntitled");
      void appendSystemTimeline(
        `> [!kanban] Kanban · ${cardTitle}\n> [[${cached.fileName ?? row.fileName}|${cardTitle}]]\n\n${oldColumn || t("dashboard.kanbanUnspecified")} → ${nextValue || t("dashboard.kanbanUnspecified")}`,
      ).catch((timelineError) => console.error("Failed to record Kanban move in Timeline", timelineError));
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

  const storeAttachments = async (notePath: string, files: File[]): Promise<KanbanAttachment[]> => {
    if (files.length === 0) return [];
    const slash = notePath.lastIndexOf("/");
    const noteFolder = slash >= 0 ? notePath.slice(0, slash) : "";
    const noteName = notePath.slice(slash + 1).replace(/\.md(?:own)?$/i, "");
    const attachmentFolder = [noteFolder, "Attachments", sanitizeFileName(noteName)].filter(Boolean).join("/");
    const stored: KanbanAttachment[] = [];
    for (const source of files) {
      const safeName = source.name.replace(/[\\/:*?"<>|#[\]]/g, "-").trim() || "attachment";
      const dot = safeName.lastIndexOf(".");
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
      const extension = dot > 0 ? safeName.slice(dot) : "";
      let path = `${attachmentFolder}/${safeName}`;
      for (let index = 2; await findFileByNameLocal(path); index += 1) {
        path = `${attachmentFolder}/${stem} ${index}${extension}`;
      }
      await saveBinaryFileLocal(
        path,
        bytesToBase64(new Uint8Array(await source.arrayBuffer())),
        source.type || mimeTypeFromFileName(path),
      );
      stored.push({ path, label: source.name });
    }
    return stored;
  };

  const createCard = async (input: KanbanTaskInput) => {
    const title = input.title.trim() || t("dashboard.kanbanNewCardName");
    const base = sanitizeFileName(title) || t("dashboard.kanbanNewCardName");
    let candidate = `${base}.md`;
    let index = 2;
    while (await findFileByNameLocal(joinPath(folder, candidate))) {
      candidate = `${base} ${index++}.md`;
    }

    setError(null);
    try {
      const path = joinPath(folder, candidate);
      const attachments = await storeAttachments(path, input.files);
      let content = buildNewCardContent({
        title,
        titleProperty,
        statusProperty,
        status: input.status,
      });
      content = replaceKanbanTaskBody(content, {
        description: input.description,
        checklist: input.checklist,
        attachments: [...input.attachments, ...attachments],
      });
      const column = configuredColumns.find((item) => item.value === input.status);
      const values: Record<string, unknown> = { [dueProperty]: input.due || null };
      if (column && isCompletionColumn(input.status, column.label || "")) {
        values[startedProperty] = localIsoDate();
        values[completedProperty] = localIsoDate();
      }
      content = updateFrontmatterKeys(content, values) ?? content;
      const result = await writeFileLocal(
        path,
        content,
      );
      void appendSystemTimeline(
        `> [!kanban] Kanban · ${title}\n> [[${path}|${title}]]\n\n${t("dashboard.kanbanNewCardCreate")}: ${input.status}`,
      ).catch((timelineError) => console.error("Failed to record Kanban card in Timeline", timelineError));
      setShowNewCard(false);
      await loadData();
      window.dispatchEvent(
        new CustomEvent("dashboard-data-changed", {
          detail: { folder },
        }),
      );
      // Open the new card in the same modal as clicking an existing card;
      // full-page open stays one click away via the modal's navigate icon.
      setPreviewInitialMode("wysiwyg");
      setPreviewRow({ id: result.fileId, fileId: result.fileId, fileName: path, cells: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.kanbanNewCardError"));
    }
  };

  const editCard = async (input: KanbanTaskInput) => {
    if (!editingRow?.fileId || !editingRow.fileName) return;
    const cached = await getCachedFile(editingRow.fileId);
    if (!cached) throw new Error(t("dashboard.fileNotFound"));
    const attachments = await storeAttachments(editingRow.fileName, input.files);
    const nextIndex = configuredColumns.findIndex((column) => column.value === input.status);
    const values: Record<string, unknown> = {
      [statusProperty]: input.status,
      [dueProperty]: input.due || null,
    };
    if (titleProperty && titleProperty !== "file.name") values[titleProperty] = input.title;
    if (nextIndex > 0 && !editingRow.cells[startedProperty]) values[startedProperty] = localIsoDate();
    if (nextIndex >= 0 && isCompletionColumn(input.status, configuredColumns[nextIndex].label || "")) {
      if (!editingRow.cells[startedProperty]) values[startedProperty] = localIsoDate();
      if (!editingRow.cells[completedProperty]) values[completedProperty] = localIsoDate();
    } else {
      values[completedProperty] = null;
    }
    let content = updateFrontmatterKeys(cached.content, values);
    if (content === null) throw new Error(t("dashboard.unparseableFrontmatter"));
    content = replaceKanbanTaskBody(content, {
      description: input.description,
      checklist: input.checklist,
      attachments: [...input.attachments, ...attachments],
    });
    let nextPath = editingRow.fileName;
    await writeFileLocal(nextPath, content, { existingFileId: editingRow.fileId });
    if (titleProperty === "file.name") {
      const slash = nextPath.lastIndexOf("/");
      const directory = slash >= 0 ? nextPath.slice(0, slash + 1) : "";
      const base = sanitizeFileName(input.title) || t("dashboard.kanbanNewCardName");
      let candidate = `${directory}${base}.md`;
      for (let index = 2; await findFileByNameLocal(candidate); index += 1) {
        if (candidate === nextPath) break;
        candidate = `${directory}${base} ${index}.md`;
      }
      if (candidate !== nextPath) {
        await renameFileLocal(editingRow.fileId, candidate);
        nextPath = candidate;
      }
    }
    setEditingRow(null);
    await loadData();
    window.dispatchEvent(new CustomEvent("dashboard-data-changed", { detail: { folder } }));
  };

  const openAttachment = async (attachment: KanbanAttachment) => {
    const found = await findFileByNameLocalLoose(attachment.path);
    if (!found) throw new Error(t("dashboard.kanbanAttachmentMissing"));
    if (canPreviewAttachment(found.name)) {
      setPreviewInitialMode(undefined);
      setPreviewRow({ id: found.id, fileId: found.id, fileName: found.name, cells: {} });
      return;
    }
    const bytes = base64ToBytes(await readFileBinaryLocal(found.id));
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], {
      type: found.mimeType || mimeTypeFromFileName(found.name),
    }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.label || found.name.split("/").pop() || "attachment";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          {boardTitle}
        </span>
        {error && <span className="min-w-0 truncate text-[11px] text-red-500">{error}</span>}
        {tagOptions.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <select
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="max-w-[150px] rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              title={t("dashboard.kanbanTagFilter")}
            >
              <option value="">{t("dashboard.kanbanAllTags")}</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            {selectedTag && (
              <button
                type="button"
                onClick={() => setSelectedTag("")}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                title={t("dashboard.kanbanClearTagFilter")}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowAI(true);
          }}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
          title={t("dashboard.kanbanAiCreate")}
        >
          <Sparkles size={13} />
          {t("dashboard.kanbanAiCreate")}
        </button>
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
                  const task = parseKanbanTaskBody(row.fileContent ?? "");
                  const due = scalar(row.cells[dueProperty]).slice(0, 10);
                  const completed = scalar(row.cells[completedProperty]).slice(0, 10);
                  const checklistDone = task.checklist.filter((item) => item.completed).length;
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
                      <div className="flex items-start gap-1.5">
                        <div className="min-w-0 flex-1 break-words font-medium leading-snug text-gray-900 dark:text-gray-100 [&_p]:m-0">
                          <GfmMarkdownPreview content={title} />
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingRow(row);
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800"
                          title={t("dashboard.kanbanTaskEdit")}
                        >
                          <PenLine size={13} />
                        </button>
                      </div>
                      {(due || completed || task.checklist.length > 0 || task.attachments.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
                          {due && <span className={`inline-flex items-center gap-0.5 ${!completed && due < localIsoDate() ? "font-semibold text-red-500" : ""}`}><CalendarDays size={11} />{due}</span>}
                          {task.checklist.length > 0 && <span className="inline-flex items-center gap-0.5"><CheckSquare size={11} />{checklistDone}/{task.checklist.length}</span>}
                          {task.attachments.length > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{task.attachments.length}</span>}
                          {completed && <span className="inline-flex items-center gap-0.5 text-emerald-600"><CheckSquare size={11} />{completed}</span>}
                        </div>
                      )}
                      {displayFields.length > 0 && (
                        <dl className="mt-1.5 space-y-1">
                          {displayFields.map(({ field, label, maxLength }) => {
                            const value = getCellValue(row, field);
                            const formatted = truncateText(formatCell(value, fieldDisplayType(field), language), maxLength);
                            if (!formatted) return null;
                            return (
                              <div key={field} className="flex gap-1.5 text-[10px] leading-snug">
                                {label && <dt className="shrink-0 text-gray-400">{label}</dt>}
                                <dd className="min-w-0 break-words text-gray-600 dark:text-gray-300">{formatted}</dd>
                              </div>
                            );
                          })}
                        </dl>
                      )}
                      {task.attachments.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {task.attachments.map((attachment) => (
                            <button
                              type="button"
                              key={attachment.path}
                              onClick={(event) => {
                                event.stopPropagation();
                                void openAttachment(attachment).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
                              }}
                              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9px] text-gray-500 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                              title={canPreviewAttachment(attachment.path) ? t("dashboard.kanbanAttachmentPreview") : t("dashboard.kanbanAttachmentDownload")}
                            >
                              <Paperclip size={10} /><span className="truncate">{attachment.label}</span>
                            </button>
                          ))}
                        </div>
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
        <KanbanTaskModal
          mode="new"
          columns={configuredColumns}
          onSubmit={createCard}
          onClose={() => setShowNewCard(false)}
        />
      )}

      {editingRow && (
        <KanbanTaskModal
          mode="edit"
          columns={configuredColumns}
          initial={{
            title: scalar(getCellValue(editingRow, titleProperty)) || editingRow.fileName?.split("/").pop()?.replace(/\.md(?:own)?$/i, "") || "",
            status: scalar(editingRow.cells[statusProperty]),
            due: scalar(editingRow.cells[dueProperty]).slice(0, 10),
            ...parseKanbanTaskBody(editingRow.fileContent ?? ""),
          }}
          onSubmit={editCard}
          onClose={() => setEditingRow(null)}
        />
      )}

      {showAI && (
        <KanbanAiModal
          onApply={async (tasks) => {
            for (const task of tasks) {
              await createCard({
                ...task,
                status: configuredColumns[0]?.value ?? "",
                attachments: [],
                files: [],
              });
            }
          }}
          onClose={() => setShowAI(false)}
        />
      )}

      {previewRow?.fileId && previewRow.fileName && (
        <FilePreviewModal
          fileId={previewRow.fileId}
          fileName={previewRow.fileName}
          initialMode={previewInitialMode}
          onEdit={rows.some((row) => row.fileId === previewRow.fileId)
            ? () => {
                const row = rows.find((item) => item.fileId === previewRow.fileId);
                setPreviewRow(null);
                setPreviewInitialMode(undefined);
                if (row) setEditingRow(row);
              }
            : undefined}
          onNavigate={() => {
            navigateToFile(previewRow);
            setPreviewRow(null);
            setPreviewInitialMode(undefined);
          }}
          onClose={() => {
            setPreviewRow(null);
            setPreviewInitialMode(undefined);
          }}
        />
      )}
    </div>
  );
}

function KanbanAiModal({ onApply, onClose }: {
  onApply: (tasks: ReturnType<typeof parseKanbanAiTasks>) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <form
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!instruction.trim() || busy) return;
          setBusy(true);
          setError("");
          void generateKanbanTasks(instruction, localIsoDate())
            .then(setResult)
            .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Sparkles size={16} className="text-blue-500" />
          <strong className="flex-1 text-sm">{t("dashboard.kanbanAiCreate")}</strong>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
        </header>
        <div className="grid min-h-0 gap-4 overflow-auto p-4 text-xs">
          <label className="grid gap-1.5">{t("dashboard.kanbanAiDescription")}<textarea autoFocus rows={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} className="resize-y rounded border border-gray-300 bg-white p-2 dark:border-gray-700 dark:bg-gray-800" /></label>
          {result && <label className="grid gap-1.5">{t("dashboard.kanbanAiResult")}<textarea rows={10} value={result} onChange={(event) => setResult(event.target.value)} spellCheck={false} className="resize-y rounded border border-gray-300 bg-white p-2 font-mono dark:border-gray-700 dark:bg-gray-800" /></label>}
          {error && <p className="text-red-500">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-xs">{t("common.cancel")}</button>
          {!result ? (
            <button type="submit" disabled={busy || !instruction.trim()} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{busy ? `${t("dashboard.kanbanAiGenerate")}…` : t("dashboard.kanbanAiGenerate")}</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => {
              setBusy(true);
              setError("");
              void Promise.resolve(onApply(parseKanbanAiTasks(result))).then(onClose).catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : String(caught));
                setBusy(false);
              });
            }} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{busy ? `${t("dashboard.kanbanAiApply")}…` : t("dashboard.kanbanAiApply")}</button>
          )}
        </footer>
      </form>
    </div>,
    document.body,
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
