import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, Folder, Check } from "lucide-react";
import { listFoldersLocal } from "~/services/drive-local";
import { useI18n } from "~/i18n/context";

interface FolderPickerProps {
  value: string;
  onChange: (folder: string) => void;
}

/**
 * Folder picker using virtual folders from CachedRemoteMeta.
 * Shows a breadcrumb-style selector with drill-down navigation.
 */
export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const { t } = useI18n();
  const [currentParent, setCurrentParent] = useState<string>("");
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadFolders = useCallback(async (parent: string) => {
    setLoading(true);
    const result = await listFoldersLocal(parent || undefined);
    setFolders(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (showPicker) {
      loadFolders(currentParent);
    }
  }, [showPicker, currentParent, loadFolders]);

  // Close on outside click
  useEffect(() => {
    if (!showPicker) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showPicker]);

  const breadcrumbs = currentParent ? currentParent.split("/") : [];

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("dashboard.rootFolderPlaceholder")}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <button
          type="button"
          onClick={() => setShowPicker((v) => !v)}
          className="px-2 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
          title={t("dashboard.browseFolders")}
        >
          <Folder size={16} />
        </button>
      </div>

      {showPicker && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-60 overflow-auto">
          {/* Breadcrumb navigation */}
          {breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-700 text-xs">
                <button
                  type="button"
                  onClick={() => setCurrentParent("")}
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t("dashboard.root")}
                </button>
              {breadcrumbs.map((crumb, i) => {
                const path = breadcrumbs.slice(0, i + 1).join("/");
                return (
                  <span key={path} className="flex items-center gap-1">
                    <ChevronRight size={12} className="text-gray-400" />
                    <button
                      type="button"
                      onClick={() => setCurrentParent(path)}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {crumb}
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {loading ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">{t("dashboard.loading")}</div>
          ) : folders.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">{t("dashboard.noSubfolders")}</div>
          ) : (
            <ul className="py-1">
              {currentParent && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      const parts = currentParent.split("/");
                      parts.pop();
                      setCurrentParent(parts.join("/"));
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <ChevronRight size={14} className="rotate-180" />
                    ..
                  </button>
                </li>
              )}
              {folders.map((folder) => {
                const fullPath = currentParent ? `${currentParent}/${folder}` : folder;
                return (
                  <li key={folder}>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => {
                          onChange(fullPath);
                          setShowPicker(false);
                        }}
                        className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <Folder size={14} className="text-blue-500" />
                        {folder}
                        {value === fullPath && (
                          <Check size={14} className="ml-auto text-green-500" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentParent(fullPath)}
                        className="px-2 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
