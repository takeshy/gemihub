// Table view — renders rows as a table with optional cell editing.
// Cell editing is enabled ONLY for folder sources (P2 spec §7).
// Workflow sources are always read-only.

import { useState, useRef, useEffect } from "react";
import { getCachedFile } from "~/services/indexeddb-cache";
import { findFileByNameLocal, writeFileLocal } from "~/services/drive-local";
import { updateFrontmatterKey } from "../frontmatter-writeback";
import { useI18n } from "~/i18n/context";
import type { DataRow, PropertyType } from "./types";
import { FILE_ATTR_KEYS } from "./types";
import { getCellValue, formatCell } from "./filter";

interface TableViewProps {
  rows: DataRow[];
  columns: string[];
  /** True for folder sources — enables cell editing. */
  editable: boolean;
  /** Edit mode (dashboard canvas editMode). */
  editMode?: boolean;
  /** Folder path for dispatching data-changed events. */
  folder?: string;
  /** Field type map for locale-aware formatting (e.g. dates). */
  fieldTypes?: Record<string, PropertyType>;
}

function isEditableType(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Inline base64 image (how images are stored in the IndexedDB cache). */
function isDataImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

function isFrontmatterColumn(column: string): boolean {
  return !FILE_ATTR_KEYS.has(column);
}

export function TableView({
  rows,
  columns,
  editable,
  editMode,
  folder,
  fieldTypes,
}: TableViewProps) {
  const { t, language } = useI18n();
  const [editingCell, setEditingCell] = useState<
    { rowId: string; column: string } | null
  >(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState<DataRow[]>(rows);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const committingRef = useRef(false);

  // Sync local rows when prop changes
  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  const canEditCell = (row: DataRow, column: string): boolean => {
    if (!editable || !editMode) return false;
    if (!isFrontmatterColumn(column)) return false;
    if (!row.fmParseable) return false;
    const value = getCellValue(row, column);
    if (isDataImage(value)) return false; // render as image, not an editable blob
    return value === undefined || isEditableType(value);
  };

  const startEdit = (row: DataRow, column: string) => {
    if (!canEditCell(row, column)) return;
    if (pendingFileId === row.fileId) return;
    const value = getCellValue(row, column);
    setEditingCell({ rowId: row.id, column });
    setEditValue(value == null ? "" : String(value));
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
    setEditError(null);
  };

  const toggleBoolean = async (row: DataRow, column: string) => {
    if (pendingFileId === row.fileId) return;
    const oldValue = getCellValue(row, column);
    const newValue = !oldValue;

    setLocalRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, cells: { ...r.cells, [column]: newValue } } : r,
      ),
    );
    setPendingFileId(row.fileId!);

    try {
      const cached = await getCachedFile(row.fileId!);
      if (!cached) throw new Error(t("dashboard.fileNotFound"));
      const result = updateFrontmatterKey(cached.content, column, newValue);
      if (result === null) throw new Error(t("dashboard.unparseableFrontmatter"));
      await writeFileLocal(cached.fileName ?? row.fileName!, result.content, {
        existingFileId: row.fileId,
      });
      window.dispatchEvent(
        new CustomEvent("dashboard-data-changed", {
          detail: { folder: folder ?? "" },
        }),
      );
    } catch (err) {
      setLocalRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, cells: { ...r.cells, [column]: oldValue } } : r,
        ),
      );
      setEditError(err instanceof Error ? err.message : t("dashboard.writeFailed"));
      setTimeout(() => setEditError(null), 3000);
    } finally {
      setPendingFileId(null);
    }
  };

  const commitEdit = async () => {
    if (committingRef.current) return;
    const cell = editingCell;
    if (!cell) return;
    committingRef.current = true;
    const { rowId, column } = cell;
    const row = localRows.find((r) => r.id === rowId);
    if (!row) {
      setEditingCell(null);
      setEditValue("");
      committingRef.current = false;
      return;
    }

    const oldValue = getCellValue(row, column);

    let newValue: unknown;
    if (typeof oldValue === "number") {
      newValue = editValue.trim() === "" ? null : Number(editValue);
      if (newValue !== null && isNaN(newValue as number)) {
        setEditError(t("dashboard.invalidNumber"));
        committingRef.current = false;
        return;
      }
    } else if (typeof oldValue === "boolean") {
      newValue = editValue.toLowerCase() === "true" || editValue === "1";
    } else {
      newValue = editValue;
    }

    if (oldValue === newValue) {
      setEditingCell(null);
      setEditValue("");
      committingRef.current = false;
      return;
    }

    setLocalRows((prev) =>
      prev.map((r) =>
        r.id === rowId ? { ...r, cells: { ...r.cells, [column]: newValue } } : r,
      ),
    );
    setEditingCell(null);
    setEditValue("");
    setPendingFileId(row.fileId!);

    try {
      const cached = await getCachedFile(row.fileId!);
      if (!cached) throw new Error(t("dashboard.fileNotFound"));
      const result = updateFrontmatterKey(cached.content, column, newValue);
      if (result === null) throw new Error(t("dashboard.unparseableFrontmatter"));
      await writeFileLocal(cached.fileName ?? row.fileName!, result.content, {
        existingFileId: row.fileId,
      });
      window.dispatchEvent(
        new CustomEvent("dashboard-data-changed", {
          detail: { folder: folder ?? "" },
        }),
      );
    } catch (err) {
      setLocalRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, cells: { ...r.cells, [column]: oldValue } } : r,
        ),
      );
      setEditError(err instanceof Error ? err.message : t("dashboard.writeFailed"));
      setTimeout(() => setEditError(null), 3000);
    } finally {
      setPendingFileId(null);
      committingRef.current = false;
    }
  };

  // Focus input when editing starts
  const focusInput = (el: HTMLInputElement | null) => {
    editInputRef.current = el;
    if (el) {
      el.focus();
      el.select();
    }
  };

  // Resolve a row's file reference. Folder rows carry runtime fileId/fileName
  // directly; workflow rows may carry path/file.path cells.
  const resolveRowFileRef = (row: DataRow): { fileId?: string; fileName?: string; path?: string } => {
    const fileId =
      row.fileId ??
      (typeof row.cells.fileId === "string" ? row.cells.fileId : undefined) ??
      (typeof row.cells["file.fileId"] === "string" ? row.cells["file.fileId"] : undefined);
    const fileName =
      row.fileName ??
      (typeof row.cells.fileName === "string" ? row.cells.fileName : undefined) ??
      (typeof row.cells["file.name"] === "string" ? row.cells["file.name"] : undefined);
    const path =
      row.fileName ??
      (typeof row.cells.path === "string" ? row.cells.path : undefined) ??
      (typeof row.cells["file.path"] === "string" ? row.cells["file.path"] : undefined) ??
      fileName;
    return { fileId, fileName, path };
  };

  const handleRowClick = async (row: DataRow) => {
    if (editingCell) return;
    const ref = resolveRowFileRef(row);
    let { fileId, fileName } = ref;
    const { path } = ref;
    if (!fileId && path) {
      const found = await findFileByNameLocal(path);
      fileId = found?.id;
      fileName = found?.name ?? fileName ?? path;
    }
    if (fileId) {
      window.dispatchEvent(
        new CustomEvent("plugin-select-file", {
          detail: { fileId, fileName },
        }),
      );
    }
  };

  if (localRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.noFiles")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {editError && (
        <div className="sticky top-0 z-10 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-2 py-1 text-xs text-red-600 dark:text-red-400">
          {editError}
        </div>
      )}
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/80">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-400"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {localRows.map((row) => (
            <tr
              key={row.id}
              onClick={() => handleRowClick(row)}
              className={`${
                (() => {
                  const ref = resolveRowFileRef(row);
                  return ref.fileId || ref.path ? "cursor-pointer" : "";
                })()
              } hover:bg-gray-50 dark:hover:bg-gray-800/50`}
            >
              {columns.map((col) => {
                const isEditing =
                  editingCell?.rowId === row.id && editingCell?.column === col;
                const canEdit = canEditCell(row, col);
                const value = getCellValue(row, col);
                const isReadOnly =
                  isFrontmatterColumn(col) && !isEditableType(value) && value != null;
                const isBooleanCell = canEdit && typeof value === "boolean";

                if (isEditing) {
                  return (
                    <td
                      key={col}
                      className="px-2 py-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={focusInput}
                        type={typeof value === "number" ? "number" : "text"}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitEdit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        onBlur={commitEdit}
                        className="w-full px-1 py-0.5 border border-blue-400 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none text-xs"
                      />
                    </td>
                  );
                }

                if (isBooleanCell) {
                  return (
                    <td
                      key={col}
                      className="px-2 py-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={value === true}
                        onChange={() => toggleBoolean(row, col)}
                        disabled={pendingFileId === row.fileId}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                  );
                }

                return (
                  <td
                    key={col}
                    className={`px-2 py-1.5 text-gray-700 dark:text-gray-300 ${
                      canEdit ? "cursor-text" : ""
                    } ${pendingFileId === row.fileId ? "opacity-50" : ""}`}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEdit(row, col);
                    }}
                    title={
                      canEdit
                        ? t("dashboard.doubleClickToEdit")
                        : isReadOnly
                          ? t("dashboard.readOnlyComplex")
                          : ""
                    }
                  >
                    {isDataImage(value) ? (
                      <img
                        src={value}
                        alt=""
                        className="h-12 max-w-[120px] object-contain"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      formatCell(value, fieldTypes?.[col], language)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
