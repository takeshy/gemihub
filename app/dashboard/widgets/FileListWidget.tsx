import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FileText, Folder, Filter, ArrowUpDown, X } from "lucide-react";
import { listFilesLocal } from "~/services/drive-local";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";
import type { WidgetContext } from "../types";
import { Popover } from "../data-widget/ViewControls";
import { FilePreviewModal } from "./FilePreviewModal";

interface FileListConfig {
  folder?: string;
  sort?: string;
  limit?: number;
}

interface FileEntry {
  id: string;
  name: string;
  modifiedTime?: string;
}

const SORT_OPTIONS: { value: string; labelKey: keyof TranslationStrings }[] = [
  { value: "-mtime", labelKey: "dashboard.sortModifiedNew" },
  { value: "mtime", labelKey: "dashboard.sortModifiedOld" },
  { value: "-ctime", labelKey: "dashboard.sortCreatedNew" },
  { value: "ctime", labelKey: "dashboard.sortCreatedOld" },
  { value: "name", labelKey: "dashboard.sortNameAz" },
  { value: "-name", labelKey: "dashboard.sortNameZa" },
];

export default function FileListWidget({
  config,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as FileListConfig;
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // View-time (ephemeral) filename filter / sort override from the header icons.
  const [viewFilter, setViewFilter] = useState("");
  const [viewSort, setViewSort] = useState<string | undefined>(undefined);
  const [openControl, setOpenControl] = useState<"filter" | "sort" | null>(null);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);

  const effectiveSort = viewSort ?? cfg.sort ?? "-mtime";

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const sortBy = effectiveSort.startsWith("-") ? effectiveSort.slice(1) : effectiveSort;
    const sortOrder = effectiveSort.startsWith("-") ? "desc" : "asc";
    const result = await listFilesLocal(cfg.folder || undefined, {
      limit: cfg.limit ?? 20,
      sortBy: sortBy === "mtime" ? "modified" : sortBy === "ctime" ? "created" : sortBy,
      sortOrder,
    });
    setFiles(result.files);
    setLoading(false);
  }, [cfg.folder, cfg.limit, effectiveSort]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Refresh when another widget in the same folder edits data (e.g. cell write).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { folder?: string } | undefined;
      if (!detail || !detail.folder || detail.folder === (cfg.folder ?? "")) {
        loadFiles();
      }
    };
    window.addEventListener("dashboard-data-changed", handler);
    return () => window.removeEventListener("dashboard-data-changed", handler);
  }, [loadFiles, cfg.folder]);

  const displayName = useCallback(
    (name: string) =>
      cfg.folder && name.startsWith(cfg.folder + "/") ? name.slice(cfg.folder.length + 1) : name,
    [cfg.folder],
  );

  const displayed = useMemo(() => {
    const q = viewFilter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => displayName(f.name).toLowerCase().includes(q));
  }, [files, viewFilter, displayName]);

  // Clicking a file opens a preview modal first; the modal's navigate icon
  // performs the actual open (instead of jumping straight to the editor).
  const openFile = (file: FileEntry) => {
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: file.id, fileName: file.name },
      }),
    );
  };

  const hasFilter = viewFilter.trim().length > 0;
  const hasSort = viewSort != null && viewSort !== "";
  const iconClass = (active: boolean) =>
    `relative flex items-center rounded px-1 py-0.5 ${
      active
        ? "text-blue-600 dark:text-blue-400"
        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
    }`;

  return (
    <div className="flex h-full flex-col">
      {/* Header: folder path + filter/sort controls */}
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-2 py-1 flex-shrink-0">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
          <Folder size={11} className="shrink-0" />
          <span className="truncate">{cfg.folder || "/"}</span>
        </span>
        <button
          ref={filterBtnRef}
          type="button"
          onClick={() => setOpenControl((o) => (o === "filter" ? null : "filter"))}
          title={t("dashboard.filter")}
          className={iconClass(hasFilter)}
        >
          <Filter size={12} />
          {hasFilter && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </button>
        <button
          ref={sortBtnRef}
          type="button"
          onClick={() => setOpenControl((o) => (o === "sort" ? null : "sort"))}
          title={t("dashboard.sort")}
          className={iconClass(hasSort)}
        >
          <ArrowUpDown size={12} />
          {hasSort && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </button>

        {openControl === "filter" && (
          <Popover anchorRef={filterBtnRef} onClose={() => setOpenControl(null)}>
            <input
              type="text"
              autoFocus
              value={viewFilter}
              onChange={(e) => setViewFilter(e.target.value)}
              placeholder={t("dashboard.filter")}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </Popover>
        )}
        {openControl === "sort" && (
          <Popover anchorRef={sortBtnRef} onClose={() => setOpenControl(null)}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("dashboard.sort")}</span>
              {hasSort && (
                <button
                  type="button"
                  onClick={() => setViewSort(undefined)}
                  className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-red-500"
                >
                  <X size={11} />
                  {t("dashboard.viewSortReset")}
                </button>
              )}
            </div>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setViewSort(opt.value)}
                className={`block w-full rounded px-2 py-1 text-left text-xs ${
                  effectiveSort === opt.value
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </Popover>
        )}
      </div>

      {/* List body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            {t("dashboard.loading")}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            {t("dashboard.noFiles")}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {displayed.map((file) => {
              const name = displayName(file.name);
              return (
                <li key={file.id}>
                  <button
                    onClick={() => setPreviewFile(file)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    {name.includes("/") ? (
                      <Folder size={14} className="shrink-0 text-blue-500" />
                    ) : (
                      <FileText size={14} className="shrink-0 text-gray-400" />
                    )}
                    <span className="truncate text-gray-700 dark:text-gray-300">{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {previewFile && (
        <FilePreviewModal
          fileId={previewFile.id}
          fileName={previewFile.name}
          onNavigate={() => {
            openFile(previewFile);
            setPreviewFile(null);
          }}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
