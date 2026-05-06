import { FileText, Loader2 } from "lucide-react";
import type { UserSettings } from "~/types/settings";
import { useI18n } from "~/i18n/context";
import { usePlugins } from "~/contexts/PluginContext";
import { PanelErrorBoundary } from "~/components/shared/PanelErrorBoundary";
import { getMediaType } from "~/utils/media-utils";
import { MediaViewer } from "./editors/MediaViewer";
import { TextBasedViewer } from "./TextBasedViewer";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME, GoogleDocViewer, GoogleSheetViewer } from "./GoogleWorkspaceViewers";

interface MainViewerProps {
  fileId: string | null;
  fileName: string | null;
  fileMimeType: string | null;
  settings: UserSettings;
  refreshKey?: number;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
}

export function MainViewer({
  fileId,
  fileName,
  fileMimeType,
  settings,
  refreshKey,
  onFileSelect,
  onImageChange,
}: MainViewerProps) {
  const { t } = useI18n();
  const { mainViews, getPluginAPI } = usePlugins();

  // No file selected - welcome screen
  if (!fileId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {t("mainViewer.welcome")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
            {t("mainViewer.welcomeDescription")}
          </p>
        </div>
      </div>
    );
  }

  // Check if any plugin can handle this file
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext) {
      const pluginView = mainViews.find((v) => v.extensions?.includes(`.${ext}`));
      const api = pluginView ? getPluginAPI(pluginView.pluginId) : null;
      if (pluginView && api) {
        return (
          <PanelErrorBoundary fallbackLabel="Error loading plugin view">
            <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
              <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  {fileName} ({pluginView.name})
                </span>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <pluginView.component api={api} fileId={fileId} fileName={fileName} />
              </div>
            </div>
          </PanelErrorBoundary>
        );
      }
    }
  }

  // When opened from a URL, metadata is resolved asynchronously. Do not fall
  // through to TextBasedViewer before we know whether this is a Workspace file.
  if (!fileName && !fileMimeType) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (fileMimeType === GOOGLE_DOC_MIME) {
    return <GoogleDocViewer fileId={fileId} fileName={fileName || "Google Doc"} />;
  }

  if (fileMimeType === GOOGLE_SHEET_MIME) {
    return <GoogleSheetViewer fileId={fileId} fileName={fileName || "Google Sheet"} />;
  }

  // Binary files (PDF, video, audio, image) - don't load via useFileWithCache
  const mediaType = getMediaType(fileName, fileMimeType);
  if (mediaType) {
    return (
      <MediaViewer fileId={fileId} fileName={fileName || "file"} mediaType={mediaType} fileMimeType={fileMimeType} />
    );
  }

  return (
    <TextBasedViewer
      fileId={fileId}
      fileName={fileName}
      settings={settings}
      refreshKey={refreshKey}
      onFileSelect={onFileSelect}
      onImageChange={onImageChange}
    />
  );
}
