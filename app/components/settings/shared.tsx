import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import { Check, AlertCircle, X, Loader2, Save } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { invalidateIndexCache } from "~/routes/_index";

export function StatusBanner({ fetcher }: { fetcher: ReturnType<typeof useFetcher> }) {
  const data = fetcher.data as { success?: boolean; message?: string } | undefined;

  useEffect(() => {
    if (data?.success) {
      invalidateIndexCache();
    }
  }, [data]);

  if (!data) return null;
  return (
    <div
      className={`mb-6 p-3 rounded-md border text-sm ${
        data.success
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
          : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
      }`}
    >
      <div className="flex items-center gap-2">
        {data.success ? <Check size={16} /> : <AlertCircle size={16} />}
        {data.message}
      </div>
    </div>
  );
}

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      {children}
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
    >
      {children}
    </label>
  );
}

export function SaveButton({ loading }: { loading?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
      Save
    </button>
  );
}

export function NotifyDialog({
  message,
  variant = "info",
  onClose,
}: {
  message: string;
  variant?: "info" | "error";
  onClose: () => void;
}) {
  const { t } = useI18n();
  const isError = variant === "error";
  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className={`text-sm font-semibold flex items-center gap-2 ${isError ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}`}>
            {isError ? <AlertCircle size={16} /> : <Check size={16} />}
            {isError ? t("settings.general.errorTitle") : t("common.ok")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">{message}</p>
        </div>
        <div className="flex justify-end border-t border-gray-200 dark:border-gray-700 px-4 py-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-sm"
          >
            {t("common.close")}
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

export const inputClass =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
export const checkboxClass =
  "h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500";
