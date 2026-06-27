import { useState, useEffect, useRef, useCallback } from "react";
import { Code, LayoutDashboard, GitCompareArrows, History } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { DashboardCanvas } from "~/dashboard/DashboardCanvas";
import { parseDashboard, serializeDashboard } from "~/dashboard/dashboardFile";
import { dashboardDisplayName } from "~/dashboard/dashboardFile";
import type { DashboardData } from "~/dashboard/types";

type ViewMode = "display" | "raw";

/**
 * Editor for `.dashboard` files. Defaults to the rendered grid ("display"),
 * with a toggle to the raw YAML source ("raw"). Both views write back to the
 * same cached file via saveToCache (local-first, debounced).
 */
export function DashboardFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
  onDiffClick,
  onHistoryClick,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
  onDiffClick?: () => void;
  onHistoryClick?: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  // `data` is the source of truth for the display view. Keeping a stable object
  // (rather than re-parsing `content` each render) preserves object identity
  // across canvas commits, which the canvas relies on for its undo/redo history.
  const [data, setData] = useState<DashboardData | null>(() => parseDashboard(initialContent));
  const [editMode, setEditMode] = useState(false);
  // Fall back to raw if the file can't be parsed (avoids a blank display view).
  const [viewMode, setViewMode] = useState<ViewMode>(data ? "display" : "raw");

  // Debounced auto-save, mirroring the other file editors.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);
  const prevFileIdRef = useRef(fileId);

  // Reset on file switch / external content change.
  useEffect(() => {
    const prev = prevFileIdRef.current;
    prevFileIdRef.current = fileId;
    if (prev.startsWith("new:") && !fileId.startsWith("new:")) return;
    contentFromProps.current = true;
    setContent(initialContent);
    setData(parseDashboard(initialContent));
  }, [initialContent, fileId]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache, fileId]);

  // Flush pending content on unmount / fileId change.
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  // Raw-view edits: update the string and re-derive data.
  const updateRawContent = useCallback((next: string) => {
    contentFromProps.current = false;
    setContent(next);
    setData(parseDashboard(next));
  }, []);

  // Display-view edits: keep the stable data object and serialize for persistence.
  const handleCanvasChange = useCallback((next: DashboardData) => {
    contentFromProps.current = false;
    setData(next);
    setContent(serializeDashboard(next));
  }, []);

  const toggle = (
    <div className="flex items-center rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
      <button
        onClick={() => data && setViewMode("display")}
        disabled={!data}
        title={!data ? t("dashboard.unparseableDashboard") : undefined}
        className={`flex items-center gap-1 px-2 py-1 text-xs ${
          viewMode === "display"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        } disabled:opacity-40`}
      >
        <LayoutDashboard size={ICON.SM} />
        {t("dashboard.viewDisplay")}
      </button>
      <button
        onClick={() => setViewMode("raw")}
        className={`flex items-center gap-1 px-2 py-1 text-xs ${
          viewMode === "raw"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        }`}
      >
        <Code size={ICON.SM} />
        {t("dashboard.viewRaw")}
      </button>
    </div>
  );

  if (viewMode === "display" && data) {
    return (
      <DashboardCanvas
        data={data}
        onChange={handleCanvasChange}
        editMode={editMode}
        onEditModeChange={setEditMode}
        dashboardFileId={fileId}
        dashboardFileName={fileName}
        toolbarLeft={
          <>
            <LayoutDashboard size={14} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
              {dashboardDisplayName(fileName)}
            </span>
          </>
        }
        toolbarRight={toggle}
      />
    );
  }

  // Raw YAML view
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
          {dashboardDisplayName(fileName)}
        </span>
        <div className="flex items-center gap-1 sm:gap-2">
          {onHistoryClick && (
            <button
              onClick={onHistoryClick}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              title={t("editHistory.menuLabel")}
            >
              <History size={ICON.SM} />
              <span className="hidden sm:inline">{t("editHistory.menuLabel")}</span>
            </button>
          )}
          {onDiffClick && (
            <button
              onClick={onDiffClick}
              className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              title={t("mainViewer.diff")}
            >
              <GitCompareArrows size={ICON.SM} />
              {t("mainViewer.diff")}
            </button>
          )}
          {toggle}
        </div>
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => updateRawContent(e.target.value)}
          className="w-full h-full font-mono leading-relaxed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
          style={{ fontSize: "var(--user-font-size, 16px)" }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
