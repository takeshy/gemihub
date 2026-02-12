import { useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { createTwoFilesPatch } from "diff";
import { DiffView } from "~/components/shared/DiffView";
import { useI18n } from "~/i18n/context";

interface TempDiffModalProps {
  fileName: string;
  currentContent: string;
  tempContent: string;
  tempSavedAt: string;
  currentModifiedTime: string;
  isBinary: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export function TempDiffModal({
  fileName,
  currentContent,
  tempContent,
  tempSavedAt,
  currentModifiedTime,
  isBinary,
  onAccept,
  onReject,
}: TempDiffModalProps) {
  const { t } = useI18n();

  const diffStr = useMemo(() => {
    if (isBinary) return null;
    if (currentContent === tempContent) return null;
    return createTwoFilesPatch(
      fileName,
      fileName,
      currentContent,
      tempContent,
      t("tempDiff.currentFile"),
      t("tempDiff.tempFile"),
      { context: 3 }
    );
  }, [currentContent, tempContent, fileName, isBinary, t]);

  const noDiff = !isBinary && currentContent === tempContent;

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("tempDiff.title")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-full">
              {fileName}
            </p>
          </div>
          <button
            onClick={onReject}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {noDiff ? (
            <div className="py-8 text-center text-sm text-gray-500">
              {t("tempDiff.noDiff")}
            </div>
          ) : isBinary ? (
            <div className="py-4 space-y-2">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t("tempDiff.binaryCompare")}
              </p>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p>
                  {t("tempDiff.currentFile")}: {currentModifiedTime ? new Date(currentModifiedTime).toLocaleString() : "—"}
                </p>
                <p>
                  {t("tempDiff.tempFile")}: {tempSavedAt ? new Date(tempSavedAt).toLocaleString() : "—"}
                </p>
              </div>
            </div>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded overflow-x-auto">
              <DiffView diff={diffStr || ""} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onReject}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
          >
            {t("tempDiff.reject")}
          </button>
          <button
            onClick={onAccept}
            disabled={noDiff}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {t("tempDiff.accept")}
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
