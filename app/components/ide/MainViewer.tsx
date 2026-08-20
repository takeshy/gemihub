import { CloudDownload, CloudUpload, FileText, FolderOpen, History, Lightbulb, ListChecks, Loader2, MessageSquare, PenLine, Rocket, Settings } from "lucide-react";
import { Link } from "react-router";
import type { UserSettings } from "~/types/settings";
import { usePlugins } from "~/contexts/plugin-context";
import { PanelErrorBoundary } from "~/components/shared/PanelErrorBoundary";
import { isBinaryFileName, isBinaryMimeType } from "~/services/sync-client-utils";
import { getMediaType } from "~/utils/media-utils";
import { BinaryFileInfoViewer } from "./BinaryFileInfoViewer";
import { MediaViewer } from "./editors/MediaViewer";
import { EpubFileViewer } from "./editors/EpubFileViewer";
import { TextBasedViewer } from "./TextBasedViewer";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME, GoogleDocViewer, GoogleSheetViewer } from "./GoogleWorkspaceViewers";
import DashboardHost from "~/dashboard/DashboardHost";
import { useI18n } from "~/i18n/context";

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
  const { t } = useI18n();
  const dashboardEnabled = settings.dashboardEnabled ?? false;

  // No file selected — the dashboard is an advanced, opt-in feature, so the
  // default home screen is the getting-started guide.
  if (!fileId) {
    if (!dashboardEnabled) {
      return <GettingStartedPage />;
    }
    return (
      <PanelErrorBoundary fallbackLabel="Error loading dashboard">
        <DashboardHost settings={settings} />
      </PanelErrorBoundary>
    );
  }

  if (fileName?.toLowerCase().endsWith(".dashboard") && !dashboardEnabled) {
    return (
      <FeatureDisabledNotice
        title={t("mainViewer.dashboardDisabled")}
        description={t("mainViewer.dashboardDisabledDescription")}
        actionLabel={t("mainViewer.openFeatureSettings")}
      />
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

  // .canvas / .dashboard / .base / .kanban are text but may be served with a
  // binary MIME type (application/octet-stream). Route them to TextBasedViewer
  // before the binary checks below so they open in their dedicated editors.
  if (
    fileName?.toLowerCase().endsWith(".canvas") ||
    fileName?.toLowerCase().endsWith(".dashboard") ||
    fileName?.toLowerCase().endsWith(".base") ||
    fileName?.toLowerCase().endsWith(".kanban")
  ) {
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

  // EPUB gets its own reader (client-side unpack + memo timeline).
  if (fileName?.toLowerCase().endsWith(".epub")) {
    return <EpubFileViewer fileId={fileId} fileName={fileName} />;
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

function FeatureDisabledNotice({
  title,
  description,
  actionLabel,
}: {
  title: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-50 p-6 dark:bg-gray-950">
      <div className="max-w-lg rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{description}</p>
        <Link to="/settings?tab=general" className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Settings size={16} />
          {actionLabel}
        </Link>
      </div>
    </div>
  );
}

function GettingStartedPage() {
  const { t } = useI18n();
  const capabilities = [
    { icon: PenLine, title: t("gettingStarted.capability1Title"), description: t("gettingStarted.capability1Description") },
    { icon: FolderOpen, title: t("gettingStarted.capability2Title"), description: t("gettingStarted.capability2Description") },
    { icon: Lightbulb, title: t("gettingStarted.capability3Title"), description: t("gettingStarted.capability3Description") },
    { icon: ListChecks, title: t("gettingStarted.capability4Title"), description: t("gettingStarted.capability4Description") },
  ];
  const steps = [
    { icon: FolderOpen, title: t("gettingStarted.step1Title"), description: t("gettingStarted.step1Description") },
    { icon: FileText, title: t("gettingStarted.step2Title"), description: t("gettingStarted.step2Description") },
    { icon: MessageSquare, title: t("gettingStarted.step3Title"), description: t("gettingStarted.step3Description") },
  ];
  return (
    <div className="flex flex-1 overflow-auto bg-gray-50 px-5 py-8 dark:bg-gray-950 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{t("gettingStarted.eyebrow")}</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-gray-900 dark:text-gray-100 sm:text-3xl">{t("gettingStarted.title")}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-gray-600 dark:text-gray-400 sm:text-base">{t("gettingStarted.description")}</p>

          <section className="mt-8" aria-labelledby="capabilities-heading">
            <h2 id="capabilities-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("gettingStarted.capabilitiesTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{t("gettingStarted.capabilitiesDescription")}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {capabilities.map(({ icon: Icon, title, description }) => (
                <div key={title} className="flex gap-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-950/40">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-400 sm:text-sm">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-9" aria-labelledby="first-steps-heading">
            <h2 id="first-steps-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("gettingStarted.stepsTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{t("gettingStarted.stepsDescription")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {steps.map(({ icon: Icon, title, description }, index) => (
                <div key={title} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{index + 1}</span>
                    <Icon size={18} className="text-gray-500 dark:text-gray-400" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-400">{description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-9 rounded-xl border border-blue-200 bg-blue-50/60 p-5 dark:border-blue-900 dark:bg-blue-950/20" aria-labelledby="saving-heading">
            <h2 id="saving-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("gettingStarted.savingTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{t("gettingStarted.savingDescription")}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white p-4 dark:bg-gray-900">
                <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"><CloudUpload size={19} className="text-blue-600" />{t("gettingStarted.driveTitle")}</div>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{t("gettingStarted.driveDescription")}</p>
              </div>
              <div className="rounded-lg bg-white p-4 dark:bg-gray-900">
                <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"><CloudDownload size={19} className="text-emerald-600" />{t("gettingStarted.localTitle")}</div>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{t("gettingStarted.localDescription")}</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-gray-600 dark:text-gray-400">{t("gettingStarted.savingNote")}</p>
          </section>

          <section className="mt-9" aria-labelledby="launcher-heading">
            <div className="flex items-center gap-2"><Rocket size={20} className="text-violet-600" /><h2 id="launcher-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("gettingStarted.launcherTitle")}</h2></div>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{t("gettingStarted.launcherDescription")}</p>
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
              <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"><History size={20} className="text-emerald-600" />{t("gettingStarted.timelineTitle")}</div>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{t("gettingStarted.timelineDescription")}</p>
              <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("gettingStarted.timelineExample")}</p>
            </div>
          </section>

          <div className="mt-7 flex flex-wrap gap-3 border-t border-gray-200 pt-5 dark:border-gray-800">
            <a href="/manual" target="_blank" rel="noopener noreferrer" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">{t("gettingStarted.openManual")}</a>
            <Link to="/settings?tab=general" className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <Settings size={16} />{t("gettingStarted.optionalFeatures")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
