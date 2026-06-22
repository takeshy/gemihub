import { useState, useEffect, useCallback } from "react";
import { FileText, Folder } from "lucide-react";
import { listFilesLocal } from "~/services/drive-local";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";

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

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const sort = cfg.sort ?? "-mtime";
    const sortBy = sort.startsWith("-") ? sort.slice(1) : sort;
    const sortOrder = sort.startsWith("-") ? "desc" : "asc";
    const result = await listFilesLocal(cfg.folder || undefined, {
      limit: cfg.limit ?? 20,
      sortBy: sortBy === "mtime" ? "modified" : sortBy === "ctime" ? "created" : sortBy,
      sortOrder,
    });
    setFiles(result.files);
    setLoading(false);
  }, [cfg.folder, cfg.sort, cfg.limit]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Refresh when another widget in the same folder edits data (e.g. file-table cell write).
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

  const handleClick = (file: FileEntry) => {
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: file.id, fileName: file.name },
      }),
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.loading")}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.noFiles")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {files.map((file) => {
          const displayName = cfg.folder
            ? file.name.startsWith(cfg.folder + "/")
              ? file.name.slice(cfg.folder.length + 1)
              : file.name
            : file.name;
          return (
            <li key={file.id}>
              <button
                onClick={() => handleClick(file)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                {displayName.includes("/") ? (
                  <Folder size={14} className="shrink-0 text-blue-500" />
                ) : (
                  <FileText size={14} className="shrink-0 text-gray-400" />
                )}
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {displayName}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
