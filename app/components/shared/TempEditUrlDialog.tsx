import { createPortal } from "react-dom";
import type { TranslationStrings } from "~/i18n/translations";

interface TempEditUrlDialogProps {
  t: (key: keyof TranslationStrings) => string;
  onYes: () => void;
  onNo: () => void;
}

export function TempEditUrlDialog({ t, onYes, onNo }: TempEditUrlDialogProps) {
  const modal = (
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={onNo}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full mx-4 max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t("contextMenu.tempEditUrlConfirm")}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {t("contextMenu.tempEditUrlHint")}
          </p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onNo}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          >
            {t("contextMenu.tempEditUrlNo")}
          </button>
          <button
            onClick={onYes}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {t("contextMenu.tempEditUrlYes")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}
