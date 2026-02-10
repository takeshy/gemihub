import { useState, useMemo } from "react";
import { X, Search } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import type { RagFileInfo } from "~/types/settings";

type StatusFilter = "all" | "registered" | "pending";

interface RagFilesDialogProps {
  settingName: string;
  files: Record<string, RagFileInfo>;
  onClose: () => void;
}

export function RagFilesDialog({ settingName, files, onClose }: RagFilesDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const entries = useMemo(() => {
    const all = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
    return all.filter(([name, info]) => {
      if (query && !name.toLowerCase().includes(query.toLowerCase())) return false;
      if (statusFilter !== "all" && info.status !== statusFilter) return false;
      return true;
    });
  }, [files, query, statusFilter]);

  const filterButtons: { key: StatusFilter; labelKey: "settings.rag.filterAll" | "settings.rag.filterRegistered" | "settings.rag.filterPending" }[] = [
    { key: "all", labelKey: "settings.rag.filterAll" },
    { key: "registered", labelKey: "settings.rag.filterRegistered" },
    { key: "pending", labelKey: "settings.rag.filterPending" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("settings.rag.filesDialogTitle").replace("{name}", settingName)}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          <div className="relative flex-1">
            <Search size={ICON.SM} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.rag.filterPlaceholder")}
              className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
            {filterButtons.map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === key
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {entries.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              {t("settings.rag.noFiles")}
            </div>
          ) : (
            <div className="space-y-1">
              {entries.map(([name, info]) => (
                <div
                  key={name}
                  className="flex items-center gap-3 rounded border border-gray-200 dark:border-gray-700 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{name}</p>
                    {info.uploadedAt > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(info.uploadedAt)}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                      info.status === "registered"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                        : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {info.status === "registered"
                      ? t("settings.rag.filterRegistered")
                      : t("settings.rag.filterPending")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("editHistory.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}
