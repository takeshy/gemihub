import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Save } from "lucide-react";
import { useI18n } from "~/i18n/context";

interface GoogleDocViewerProps {
  fileId: string;
  fileName: string;
}

interface GoogleSheetViewerProps {
  fileId: string;
  fileName: string;
}

interface SheetMeta {
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

interface SheetReadResponse {
  title?: string;
  sheets?: SheetMeta[];
  selectedSheet?: string;
  range?: string;
  values?: Array<Array<string | number | boolean | null>>;
  error?: string;
}

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const MAX_ROWS = 100;
const MAX_COLUMNS = 26;
const DEFAULT_COLUMN_WIDTH = 128;
const MIN_COLUMN_WIDTH = 64;
const MAX_COLUMN_WIDTH = 520;
const DEFAULT_ROW_HEIGHT = 32;

export { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME };

function googleDocUrl(fileId: string) {
  return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
}

function googleSheetUrl(fileId: string) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit`;
}

function columnName(index: number): string {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const mod = (current - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    current = Math.floor((current - mod) / 26);
  }
  return name;
}

function quoteSheetName(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function buildRange(sheetTitle: string, rows: number, columns: number): string {
  return `${quoteSheetName(sheetTitle)}!A1:${columnName(columns - 1)}${rows}`;
}

function normalizeValues(values: SheetReadResponse["values"], rows: number, columns: number): string[][] {
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, colIndex) => {
      const value = values?.[rowIndex]?.[colIndex];
      return value == null ? "" : String(value);
    })
  );
}

function WorkspaceHeader({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{title}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

const SheetCell = memo(function SheetCell({
  value,
  rowIndex,
  colIndex,
  columnLabel,
  width,
  onChange,
  onPaste,
  onMoveFocus,
}: {
  value: string;
  rowIndex: number;
  colIndex: number;
  columnLabel: string;
  width: number;
  onChange: (rowIndex: number, colIndex: number, value: string) => void;
  onPaste: (rowIndex: number, colIndex: number, text: string) => boolean;
  onMoveFocus: (rowIndex: number, colIndex: number, rowDelta: number, colDelta: number) => void;
}) {
  return (
    <td
      className="border border-gray-200 p-0 dark:border-gray-800"
      style={{ width, minWidth: width }}
    >
      <textarea
        value={value}
        onChange={(event) => onChange(rowIndex, colIndex, event.target.value)}
        onPaste={(event) => {
          if (onPaste(rowIndex, colIndex, event.clipboardData.getData("text/plain"))) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart ?? value.length;
            const end = target.selectionEnd ?? value.length;
            const nextValue = `${value.slice(0, start)}\n${value.slice(end)}`;
            onChange(rowIndex, colIndex, nextValue);
            requestAnimationFrame(() => {
              target.selectionStart = start + 1;
              target.selectionEnd = start + 1;
            });
            return;
          }
          const move = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
          }[event.key] as [number, number] | undefined;
          if (!move) return;
          event.preventDefault();
          onMoveFocus(rowIndex, colIndex, move[0], move[1]);
        }}
        rows={1}
        className="block h-8 resize-none overflow-hidden bg-white px-2 py-1.5 text-sm leading-5 text-gray-900 outline-none focus:bg-blue-50 focus:ring-1 focus:ring-inset focus:ring-blue-500 dark:bg-gray-950 dark:text-gray-100 dark:focus:bg-blue-950"
        style={{ width }}
        data-sheet-cell={`${rowIndex}:${colIndex}`}
        aria-label={`${columnLabel}${rowIndex + 1}`}
      />
    </td>
  );
});

const SheetRow = memo(function SheetRow({
  row,
  rowIndex,
  columns,
  columnWidths,
  onCellChange,
  onCellPaste,
  onMoveFocus,
}: {
  row: string[];
  rowIndex: number;
  columns: string[];
  columnWidths: number[];
  onCellChange: (rowIndex: number, colIndex: number, value: string) => void;
  onCellPaste: (rowIndex: number, colIndex: number, text: string) => boolean;
  onMoveFocus: (rowIndex: number, colIndex: number, rowDelta: number, colDelta: number) => void;
}) {
  return (
    <tr>
      <th
        className="sticky left-0 z-10 w-12 min-w-12 border border-gray-200 bg-gray-100 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
        style={{ height: DEFAULT_ROW_HEIGHT }}
      >
        {rowIndex + 1}
      </th>
      {row.map((cell, colIndex) => (
        <SheetCell
          key={colIndex}
          value={cell}
          rowIndex={rowIndex}
          colIndex={colIndex}
          columnLabel={columns[colIndex]}
          width={columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH}
          onChange={onCellChange}
          onPaste={onCellPaste}
          onMoveFocus={onMoveFocus}
        />
      ))}
    </tr>
  );
});

export function GoogleDocViewer({ fileId, fileName }: GoogleDocViewerProps) {
  const { t } = useI18n();
  const previewUrl = `/api/drive/files?action=export&fileId=${encodeURIComponent(fileId)}&mimeType=${encodeURIComponent("application/pdf")}`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <WorkspaceHeader title={fileName}>
        <a
          href={googleDocUrl(fileId)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t("workspace.openExternal")}
        >
          <ExternalLink size={14} />
          {t("workspace.openExternal")}
        </a>
      </WorkspaceHeader>
      <iframe src={previewUrl} className="flex-1 w-full border-0" title={fileName} />
    </div>
  );
}

export function GoogleSheetViewer({ fileId, fileName }: GoogleSheetViewerProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(fileName);
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [range, setRange] = useState<string>("");
  const [grid, setGrid] = useState<string[][]>([]);
  const [columnWidthsBySheet, setColumnWidthsBySheet] = useState<Record<string, number[]>>({});
  const resizingRef = useRef<{
    colIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const stopResizeRef = useRef<(() => void) | null>(null);

  const selectedMeta = useMemo(
    () => sheets.find((sheet) => sheet.title === selectedSheet) ?? sheets[0],
    [sheets, selectedSheet]
  );
  const columnCount = selectedMeta ? Math.min(Math.max(selectedMeta.columnCount || 10, 10), MAX_COLUMNS) : 10;
  const columns = useMemo(() => Array.from({ length: columnCount }, (_, index) => columnName(index)), [columnCount]);
  const selectedColumnWidths = useMemo(
    () => selectedSheet ? columnWidthsBySheet[selectedSheet] ?? [] : [],
    [columnWidthsBySheet, selectedSheet]
  );
  const effectiveColumnWidths = useMemo(
    () => Array.from({ length: columnCount }, (_, index) => selectedColumnWidths[index] ?? DEFAULT_COLUMN_WIDTH),
    [columnCount, selectedColumnWidths]
  );
  const getColumnWidth = useCallback((index: number) => selectedColumnWidths[index] ?? DEFAULT_COLUMN_WIDTH, [selectedColumnWidths]);

  const loadSheet = useCallback(async (sheetName?: string) => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const params = new URLSearchParams({ action: "read", spreadsheetId: fileId });
      if (sheetName) {
        params.set("sheetName", sheetName);
      }
      const res = await fetch(`/api/sheets?${params.toString()}`);
      const data = (await res.json()) as SheetReadResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error || t("mainViewer.loadError"));
      }
      const loadedSheets = data.sheets ?? [];
      const loadedSelected = data.selectedSheet ?? sheetName ?? loadedSheets[0]?.title ?? "";
      const loadedMeta = loadedSheets.find((sheet) => sheet.title === loadedSelected) ?? loadedSheets[0];
      const rows = loadedMeta ? Math.min(Math.max(loadedMeta.rowCount || 50, 50), MAX_ROWS) : 50;
      const cols = loadedMeta ? Math.min(Math.max(loadedMeta.columnCount || 10, 10), MAX_COLUMNS) : 10;

      setTitle(data.title || fileName);
      setSheets(loadedSheets);
      setSelectedSheet(loadedSelected);
      setRange(data.range || (loadedSelected ? buildRange(loadedSelected, rows, cols) : ""));
      setGrid(normalizeValues(data.values, rows, cols));
      if (loadedSelected) {
        setColumnWidthsBySheet((current) => ({
          ...current,
          [loadedSelected]: Array.from(
            { length: cols },
            (_, index) => current[loadedSelected]?.[index] ?? DEFAULT_COLUMN_WIDTH
          ),
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("mainViewer.loadError"));
    } finally {
      setLoading(false);
    }
  }, [fileId, fileName, t]);

  useEffect(() => {
    void loadSheet();
  }, [loadSheet]);

  const updateCell = useCallback((rowIndex: number, colIndex: number, value: string) => {
    setSaved(false);
    setGrid((current) =>
      current.map((row, r) =>
        r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row
      )
    );
  }, []);

  const pasteCells = useCallback((startRow: number, startCol: number, text: string): boolean => {
    if (!text.includes("\t") && !text.includes("\n") && !text.includes("\r")) {
      return false;
    }
    const rows = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((row) => row.split("\t"));
    if (rows.length === 0 || rows.every((row) => row.length === 0)) {
      return false;
    }

    setSaved(false);
    setGrid((current) => {
      const next = current.map((row) => [...row]);
      for (let rowOffset = 0; rowOffset < rows.length; rowOffset++) {
        const targetRow = startRow + rowOffset;
        if (targetRow >= next.length) break;
        for (let colOffset = 0; colOffset < rows[rowOffset].length; colOffset++) {
          const targetCol = startCol + colOffset;
          if (targetCol >= next[targetRow].length) break;
          next[targetRow][targetCol] = rows[rowOffset][colOffset];
        }
      }
      return next;
    });
    return true;
  }, []);

  const moveCellFocus = useCallback((rowIndex: number, colIndex: number, rowDelta: number, colDelta: number) => {
    const nextRow = Math.max(0, Math.min(grid.length - 1, rowIndex + rowDelta));
    const nextCol = Math.max(0, Math.min(columnCount - 1, colIndex + colDelta));
    const target = document.querySelector<HTMLTextAreaElement>(
      `[data-sheet-cell="${nextRow}:${nextCol}"]`
    );
    target?.focus();
    target?.select();
  }, [columnCount, grid.length]);

  const startColumnResize = useCallback((event: React.PointerEvent<HTMLDivElement>, colIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    stopResizeRef.current?.();
    resizingRef.current = {
      colIndex,
      startX: event.clientX,
      startWidth: getColumnWidth(colIndex),
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const resizing = resizingRef.current;
      if (!resizing) return;
      moveEvent.preventDefault();
      const nextWidth = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, resizing.startWidth + moveEvent.clientX - resizing.startX)
      );
      setColumnWidthsBySheet((current) => {
        const sheetKey = selectedSheet || "";
        if (!sheetKey) return current;
        const nextSheetWidths = Array.from(
          { length: columnCount },
          (_, index) => current[sheetKey]?.[index] ?? DEFAULT_COLUMN_WIDTH
        );
        nextSheetWidths[resizing.colIndex] = nextWidth;
        return { ...current, [sheetKey]: nextSheetWidths };
      });
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      resizingRef.current = null;
      stopResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    stopResizeRef.current = stopResize;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [columnCount, getColumnWidth, selectedSheet]);

  useEffect(() => {
    return () => {
      stopResizeRef.current?.();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const save = useCallback(async () => {
    if (!range) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateValues",
          spreadsheetId: fileId,
          range,
          values: grid,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || t("mainViewer.loadError"));
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("mainViewer.loadError"));
    } finally {
      setSaving(false);
    }
  }, [fileId, grid, range, t]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <WorkspaceHeader title={title || fileName}>
        {saved && <span className="text-xs text-green-600 dark:text-green-400">{t("mainViewer.saved")}</span>}
        <button
          onClick={() => void loadSheet(selectedSheet)}
          disabled={loading || saving}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          title={t("workspace.reload")}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {t("workspace.reload")}
        </button>
        <button
          onClick={() => void save()}
          disabled={loading || saving || !range}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          title={t("common.save")}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? t("mainViewer.saving") : t("common.save")}
        </button>
        <a
          href={googleSheetUrl(fileId)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t("workspace.openExternal")}
        >
          <ExternalLink size={14} />
          {t("workspace.openExternal")}
        </a>
      </WorkspaceHeader>

      {sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-2 py-1">
          {sheets.map((sheet) => (
            <button
              key={sheet.title}
              onClick={() => void loadSheet(sheet.title)}
              className={`px-3 py-1 text-xs rounded border ${
                selectedSheet === sheet.title
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                  : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {sheet.title}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="border-collapse text-sm bg-white dark:bg-gray-950">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 h-8 w-12 min-w-12 border border-gray-200 bg-gray-100 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400" />
                {columns.map((column, colIndex) => (
                  <th
                    key={column}
                    className="sticky top-0 z-10 h-8 border border-gray-200 bg-gray-100 p-0 text-xs font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                    style={{ width: getColumnWidth(colIndex), minWidth: getColumnWidth(colIndex) }}
                  >
                    <div className="relative flex h-8 items-center justify-center px-2">
                      {column}
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none hover:bg-blue-400/40"
                        onPointerDown={(event) => startColumnResize(event, colIndex)}
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, rowIndex) => (
                <SheetRow
                  key={rowIndex}
                  row={row}
                  rowIndex={rowIndex}
                  columns={columns}
                  columnWidths={effectiveColumnWidths}
                  onCellChange={updateCell}
                  onCellPaste={pasteCells}
                  onMoveFocus={moveCellFocus}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
