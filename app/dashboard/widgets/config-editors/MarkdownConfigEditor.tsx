import { useMemo } from "react";
import { FileText, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import { MarkdownFilePicker } from "./MarkdownFilePicker";

interface MarkdownConfig {
  path?: string;
}

/**
 * Markdown config editor — references an existing Drive markdown file. The
 * widget renders it with the normal markdown editor (preview/wysiwyg/code) and
 * the file can also be switched from the widget header in view mode.
 */
export function MarkdownConfigEditor({ config, onChange, widgetType, onTypeChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as MarkdownConfig, [config]);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Type
        </label>
        <select
          value={widgetType === "base" ? "base" : "markdown"}
          onChange={(e) => {
            if (e.target.value === "base") {
              onTypeChange?.("base", { base: "", view: "" });
            }
          }}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="markdown">Markdown</option>
          <option value="base">Base</option>
        </select>
      </div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t("dashboard.markdownSelectFile")}
      </label>
      <MarkdownFilePicker
        currentPath={cfg.path}
        onSelect={(path) => onChange({ path })}
        buttonClassName="flex w-full items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      />
      {cfg.path && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <FileText size={12} className="shrink-0" />
          <span className="truncate">{cfg.path}</span>
          <button
            type="button"
            onClick={() => onChange({})}
            title={t("dashboard.cancel")}
            className="ml-auto shrink-0 text-gray-400 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
