import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import { FolderPicker } from "./FolderPicker";

interface FileListConfig {
  folder?: string;
  sort?: string;
  limit?: number;
}

export function FileListConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as FileListConfig;

  const SORT_OPTIONS = [
    { value: "-mtime", label: t("dashboard.sortModifiedNew") },
    { value: "mtime", label: t("dashboard.sortModifiedOld") },
    { value: "-ctime", label: t("dashboard.sortCreatedNew") },
    { value: "ctime", label: t("dashboard.sortCreatedOld") },
    { value: "name", label: t("dashboard.sortNameAz") },
    { value: "-name", label: t("dashboard.sortNameZa") },
  ];

  const update = (patch: Partial<FileListConfig>) => {
    onChange({ ...cfg, ...patch });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.folder")}
        </label>
        <FolderPicker
          value={cfg.folder ?? ""}
          onChange={(folder) => update({ folder })}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.sort")}
        </label>
        <select
          value={cfg.sort ?? "-mtime"}
          onChange={(e) => update({ sort: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.limit")}
        </label>
        <input
          type="number"
          min={1}
          max={500}
          value={cfg.limit ?? 20}
          onChange={(e) => update({ limit: Number(e.target.value) || 20 })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>
    </div>
  );
}
