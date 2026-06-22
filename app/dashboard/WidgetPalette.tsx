import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { listWidgetDefs } from "./widgets/registry";
import type { WidgetDef } from "./types";
import { useI18n } from "~/i18n/context";

interface WidgetPaletteProps {
  onSelect: (def: WidgetDef) => void;
  onClose: () => void;
}

/**
 * Modal palette showing all registered widget types.
 * Selecting a type calls onSelect with the WidgetDef.
 */
export function WidgetPalette({ onSelect, onClose }: WidgetPaletteProps) {
  const { t } = useI18n();
  const defs = listWidgetDefs();

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-lg bg-white dark:bg-gray-900 shadow-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("dashboard.addWidget")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            {defs.map((def) => (
              <button
                key={def.type}
                onClick={() => onSelect(def)}
                className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <div className="text-gray-600 dark:text-gray-400">
                  {def.icon}
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {def.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}
