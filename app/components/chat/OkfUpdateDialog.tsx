import { createPortal } from "react-dom";
import { BookOpen, Loader2, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { GemihubOkfUpdateInfo } from "~/services/gemihub-okf-update";

interface OkfUpdateDialogProps {
  update: GemihubOkfUpdateInfo;
  updating: boolean;
  error: string;
  onUpdate: () => void;
  onClose: () => void;
}

export function OkfUpdateDialog({
  update,
  updating,
  error,
  onUpdate,
  onClose,
}: OkfUpdateDialogProps) {
  const { t } = useI18n();
  const description = update.currentVersion
    ? t("okf.update.available")
      .replace("{current}", update.currentVersion)
      .replace("{latest}", update.manifest.version)
    : t("okf.update.unmanaged").replace("{latest}", update.manifest.version);

  const dialog = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="okf-update-title"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="rounded-full bg-teal-100 p-2 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            <BookOpen size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="okf-update-title" className="font-semibold text-gray-900 dark:text-gray-100">
              {t("okf.update.title")}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={updating}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={t("common.close")}
          >
            <X size={17} />
          </button>
        </div>

        <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {t("okf.update.note")}
        </p>
        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={updating}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t("okf.update.later")}
          </button>
          <button
            type="button"
            onClick={onUpdate}
            disabled={updating}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {updating && <Loader2 size={14} className="animate-spin" />}
            {updating ? t("okf.update.updating") : t("okf.update.install")}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(dialog, document.body);
}
