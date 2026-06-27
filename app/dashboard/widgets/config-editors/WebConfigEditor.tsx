import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";

interface WebConfig {
  url?: string;
  showHeader?: boolean;
}

export function WebConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as WebConfig;
  const url = cfg.url ?? "";

  const handleChange = (next: string) => {
    onChange({ ...cfg, url: next });
  };

  const isValidUrl = (value: string) => {
    if (!value) return true;
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.url")}
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="https://example.com"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        {!isValidUrl(url) && (
          <p className="mt-1 text-xs text-red-500">
            {t("dashboard.urlInvalid")}
          </p>
        )}
      </div>
      <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
        <span>{t("dashboard.showWidgetHeader")}</span>
        <input
          type="checkbox"
          checked={cfg.showHeader !== false}
          onChange={(e) => onChange({ ...cfg, showHeader: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      </label>
    </div>
  );
}
