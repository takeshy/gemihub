import { useState } from "react";
import { Upload, Download, GitCompareArrows, History, MoreVertical } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";

interface EditorToolbarActionsProps {
  onDiffClick?: () => void;
  onHistoryClick?: () => void;
  onTempUpload: () => void;
  onTempDownload: () => void;
  uploading: boolean;
  uploaded: boolean;
}

export function EditorToolbarActions({
  onDiffClick,
  onHistoryClick,
  onTempUpload,
  onTempDownload,
  uploading,
  uploaded,
}: EditorToolbarActionsProps) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {onHistoryClick && (
        <button
          onClick={onHistoryClick}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t("editHistory.menuLabel")}
        >
          <History size={ICON.SM} />
          <span className="hidden sm:inline">{t("editHistory.menuLabel")}</span>
        </button>
      )}
      {/* Desktop only: diff */}
      {onDiffClick && (
        <button
          onClick={onDiffClick}
          className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t("mainViewer.diff")}
        >
          <GitCompareArrows size={ICON.SM} />
          {t("mainViewer.diff")}
        </button>
      )}
      {/* Desktop only: temp upload and temp download side by side */}
      {uploaded && (
        <span className="hidden sm:inline text-xs text-green-600 dark:text-green-400">
          {t("contextMenu.tempUploaded")}
        </span>
      )}
      <button
        onClick={onTempUpload}
        disabled={uploading}
        className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        title={t("contextMenu.tempUpload")}
      >
        <Upload size={ICON.SM} />
        {t("contextMenu.tempUpload")}
      </button>
      <button
        onClick={onTempDownload}
        className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        title={t("contextMenu.tempDownload")}
      >
        <Download size={ICON.SM} />
        {t("contextMenu.tempDownload")}
      </button>
      {/* Mobile: temp upload button always visible */}
      {uploaded && (
        <span className="sm:hidden text-xs text-green-600 dark:text-green-400">
          {t("contextMenu.tempUploaded")}
        </span>
      )}
      <button
        onClick={onTempUpload}
        disabled={uploading}
        className="sm:hidden flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        title={t("contextMenu.tempUpload")}
      >
        <Upload size={ICON.SM} />
      </button>
      {/* Mobile more menu */}
      <div className="relative sm:hidden">
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex items-center px-1.5 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <MoreVertical size={ICON.SM} />
        </button>
        {moreOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1 min-w-[120px]">
              {onDiffClick && (
                <button
                  onClick={() => { onDiffClick(); setMoreOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <GitCompareArrows size={ICON.SM} />
                  {t("mainViewer.diff")}
                </button>
              )}
              <button
                onClick={() => { onTempDownload(); setMoreOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Download size={ICON.SM} />
                {t("contextMenu.tempDownload")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
