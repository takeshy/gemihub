import { useState, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { EditHistoryEntry } from "~/services/edit-history.server";
import { useI18n } from "~/i18n/context";
import { DiffView } from "~/components/shared/DiffView";

interface EditHistoryModalProps {
  filePath: string;
  onClose: () => void;
}

export function EditHistoryModal({ filePath, onClose }: EditHistoryModalProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<EditHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/edit-history?filePath=${encodeURIComponent(filePath)}`
      );
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleClearAll = useCallback(async () => {
    if (!confirm(t("editHistory.confirmClearAll"))) return;
    try {
      await fetch("/api/settings/edit-history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      setEntries([]);
      setExpandedId(null);
    } catch {
      // ignore
    }
  }, [filePath, t]);

  const toggleExpand = useCallback(
    (id: string) => {
      setExpandedId(expandedId === id ? null : id);
    },
    [expandedId]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("editHistory.title")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-md">
              {filePath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={ICON.XL} className="animate-spin text-gray-400" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              {t("editHistory.noHistory")}
            </div>
          ) : (
            <div className="space-y-1">
              {[...entries].reverse().map((entry) => {
                const isExpanded = expandedId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className="rounded border border-gray-200 dark:border-gray-700"
                  >
                    {/* Entry header */}
                    <button
                      onClick={() => toggleExpand(entry.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown size={ICON.MD} className="text-gray-400" />
                      ) : (
                        <ChevronRight size={ICON.MD} className="text-gray-400" />
                      )}
                      <span className="text-xs text-gray-700 dark:text-gray-300">
                        {formatDate(entry.timestamp)}
                      </span>
                      <SourceBadge source={entry.source} />
                      <span className="text-xs text-gray-400">
                        <span className="text-green-600 dark:text-green-400">
                          +{entry.stats.additions}
                        </span>
                        {" / "}
                        <span className="text-red-600 dark:text-red-400">
                          -{entry.stats.deletions}
                        </span>
                      </span>
                      {entry.workflowName && (
                        <span className="text-xs text-gray-400 truncate">
                          {entry.workflowName}
                        </span>
                      )}
                    </button>

                    {/* Expanded diff */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 dark:border-gray-700 overflow-x-auto">
                        <DiffView diff={entry.diff} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {entries.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
            >
              <Trash2 size={ICON.SM} />
              {t("editHistory.clearAll")}
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("editHistory.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colorMap: Record<string, string> = {
    workflow:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    propose_edit:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    manual:
      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    auto: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  };

  return (
    <span
      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        colorMap[source] || colorMap.manual
      }`}
    >
      {source}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
