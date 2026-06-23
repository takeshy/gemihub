import { useMemo } from "react";
import { FileText, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import { MarkdownFilePicker } from "./MarkdownFilePicker";

interface MarkdownConfig {
  fileId?: string;
  fileName?: string;
}

/**
 * Markdown config editor — references an existing Drive markdown file. The
 * widget renders it with the normal markdown editor (preview/wysiwyg/code) and
 * the file can also be switched from the widget header in view mode.
 */
export function MarkdownConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as MarkdownConfig, [config]);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t("dashboard.markdownSelectFile")}
      </label>
      <MarkdownFilePicker
        currentFileId={cfg.fileId}
        currentLabel={cfg.fileName}
        onSelect={(id, path) => onChange({ fileId: id, fileName: path })}
        buttonClassName="flex w-full items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      />
      {cfg.fileId && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <FileText size={12} className="shrink-0" />
          <span className="truncate">{cfg.fileName ?? cfg.fileId}</span>
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
