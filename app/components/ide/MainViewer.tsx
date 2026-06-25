import { Loader2 } from "lucide-react";
import type { UserSettings } from "~/types/settings";
import { usePlugins } from "~/contexts/PluginContext";
import { PanelErrorBoundary } from "~/components/shared/PanelErrorBoundary";
import { isBinaryFileName, isBinaryMimeType } from "~/services/sync-client-utils";
import { getMediaType } from "~/utils/media-utils";
import { BinaryFileInfoViewer } from "./BinaryFileInfoViewer";
import { MediaViewer } from "./editors/MediaViewer";
import { TextBasedViewer } from "./TextBasedViewer";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME, GoogleDocViewer, GoogleSheetViewer } from "./GoogleWorkspaceViewers";
import DashboardHost from "~/dashboard/DashboardHost";

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
  const { mainViews, getPluginAPI } = usePlugins();

  // No file selected - show dashboard home screen
  if (!fileId) {
    return (
      <PanelErrorBoundary fallbackLabel="Error loading dashboard">
        <DashboardHost settings={settings} />
      </PanelErrorBoundary>
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

  if (fileName?.toLowerCase().endsWith(".canvas")) {
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

  if (fileName?.toLowerCase().endsWith(".encrypted")) {
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

  // Binary files (PDF, video, audio, image) - don't load via useFileWithCache
  const mediaType = getMediaType(fileName, fileMimeType);
  if (mediaType) {
    return (
      <MediaViewer fileId={fileId} fileName={fileName || "file"} mediaType={mediaType} fileMimeType={fileMimeType} />
    );
  }

  if (settings.encryption.enabled && (isBinaryMimeType(fileMimeType) || isBinaryFileName(fileName))) {
    return (
      <TextBasedViewer
        fileId={fileId}
        fileName={fileName}
        fileMimeType={fileMimeType}
        settings={settings}
        refreshKey={refreshKey}
        onFileSelect={onFileSelect}
        onImageChange={onImageChange}
        binaryFallback
      />
    );
  }

  if (isBinaryMimeType(fileMimeType) || isBinaryFileName(fileName)) {
    return (
      <BinaryFileInfoViewer fileId={fileId} fileName={fileName} fileMimeType={fileMimeType} />
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
