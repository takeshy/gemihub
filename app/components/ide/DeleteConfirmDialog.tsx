import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "~/i18n/context";

export interface DeleteConfirmRequest {
  message: string;
  resolve: (result: { confirmed: boolean; permanent: boolean }) => void;
}

export function DeleteConfirmDialog({
  request,
}: {
  request: DeleteConfirmRequest;
}) {
  const { t } = useI18n();
  const [permanent, setPermanent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleConfirm = () => request.resolve({ confirmed: true, permanent });
  const handleCancel = () => request.resolve({ confirmed: false, permanent: false });

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50"
      onClick={handleCancel}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="mx-4 w-full max-w-sm rounded-lg bg-white shadow-xl dark:bg-gray-900 flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {request.message}
          </p>
        </div>
        <div className="px-4 pb-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={permanent}
              onChange={(e) => setPermanent(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t("trash.permanentDeleteOption")}
            </span>
          </label>
          {permanent && (
            <p className="mt-1 ml-6 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle size={12} />
              {t("trash.permanentDeleteWarning")}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t("common.cancel")}
          </button>
          <button
            autoFocus
            onClick={handleConfirm}
            className={`px-3 py-1.5 text-sm text-white rounded ${
              permanent
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(dialog, document.body);
  }
  return dialog;
}
