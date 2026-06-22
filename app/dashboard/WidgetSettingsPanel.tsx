import { createPortal } from "react-dom";
import { X, Trash2 } from "lucide-react";
import { getWidgetDef } from "./widgets/registry";
import type { Widget } from "./types";
import { useI18n } from "~/i18n/context";

interface WidgetSettingsPanelProps {
  widget: Widget;
  onChange: (config: unknown) => void;
  onClose: () => void;
  onDelete: () => void;
  /** The .dashboard file's ID (passed to ConfigEditor for sidecar caches). */
  dashboardFileId?: string;
}

/**
 * Side panel for editing a widget's configuration.
 * Renders the widget type's ConfigEditor (if any) and provides delete action.
 */
export function WidgetSettingsPanel({
  widget,
  onChange,
  onClose,
  onDelete,
  dashboardFileId,
}: WidgetSettingsPanelProps) {
  const { t } = useI18n();
  const def = getWidgetDef(widget.type);
  const ConfigEditor = def.ConfigEditor;

  const panel = (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-white dark:bg-gray-900 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-gray-600 dark:text-gray-400">{def.icon}</span>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {def.label}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Config editor */}
        <div className="flex-1 overflow-auto p-4">
          {ConfigEditor ? (
            <>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                {t("dashboard.settingsAutoSaved")}
              </p>
              <ConfigEditor
                key={widget.id}
                config={widget.config}
                onChange={onChange}
                widgetId={widget.id}
                dashboardFileId={dashboardFileId}
              />
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              {t("dashboard.noSettings")}
            </p>
          )}
        </div>

        {/* Footer: delete (left) + done (right) */}
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 px-4 py-3">
          <button
            onClick={onDelete}
            className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            <Trash2 size={14} />
            {t("dashboard.deleteWidget")}
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("dashboard.done")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }
  return panel;
}
