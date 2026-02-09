import { Link } from "react-router";
import {
  MessageSquare,
  GitBranch,
  Settings,
  LogOut,
  Puzzle,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { SyncStatusBar } from "./SyncStatusBar";
import type { SyncStatus, ConflictInfo } from "~/hooks/useSync";
import type { PluginView } from "~/types/plugin";
import { useI18n } from "~/i18n/context";

export type RightPanelId = "chat" | "workflow" | `plugin:${string}` | `main-plugin:${string}`;

interface HeaderProps {
  rightPanel: RightPanelId;
  setRightPanel: (panel: RightPanelId) => void;
  activeFileName: string | null;
  activeFileId: string | null;
  syncStatus: SyncStatus;
  lastSyncTime: string | null;
  syncError: string | null;
  syncConflicts: ConflictInfo[];
  localModifiedCount: number;
  onPush: () => void;
  onPull: () => void;
  onShowConflicts: () => void;
  onSelectFile?: (fileId: string, fileName: string, mimeType: string) => void;
  pluginSidebarViews?: PluginView[];
  pluginMainViews?: PluginView[];
  isMobile?: boolean;
}

export function Header({
  rightPanel,
  setRightPanel,
  activeFileName,
  activeFileId: _activeFileId,
  syncStatus,
  lastSyncTime,
  syncError,
  syncConflicts,
  localModifiedCount,
  onPush,
  onPull,
  onShowConflicts,
  onSelectFile,
  pluginSidebarViews = [],
  pluginMainViews = [],
  isMobile = false,
}: HeaderProps) {
  const { t } = useI18n();

  const tabButtonClass = (isActive: boolean) =>
    `flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
      isActive
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;

  return (
    <>
    <header className="flex h-10 items-center justify-between border-b border-gray-200 bg-white px-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <img src="/icons/icon-192x192.png" alt="" width={20} height={20} className="shrink-0 rounded" />
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100 shrink-0">
          GemiHub
        </span>
        {activeFileName && (
          <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
            {activeFileName}
          </span>
        )}
        <div className="hidden sm:block mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
        <SyncStatusBar
          syncStatus={syncStatus}
          lastSyncTime={lastSyncTime}
          error={syncError}
          localModifiedCount={localModifiedCount}
          onPush={onPush}
          onPull={onPull}
          onShowConflicts={onShowConflicts}
          onSelectFile={onSelectFile}
          conflicts={syncConflicts}
          compact={isMobile}
        />
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Right panel tab toggles - hidden on mobile (bottom nav handles this) */}
        {!isMobile && (
          <>
            <button
              onClick={() => setRightPanel("chat")}
              className={tabButtonClass(rightPanel === "chat")}
            >
              <MessageSquare size={ICON.MD} />
              {t("header.chat")}
            </button>
            <button
              onClick={() => setRightPanel("workflow")}
              className={tabButtonClass(rightPanel === "workflow")}
            >
              <GitBranch size={ICON.MD} />
              {t("header.workflow")}
            </button>

            {/* Plugin sidebar view tabs */}
            {pluginSidebarViews.map((view) => (
              <button
                key={view.id}
                onClick={() => setRightPanel(`plugin:${view.id}`)}
                className={tabButtonClass(rightPanel === `plugin:${view.id}`)}
                title={view.name}
              >
                <Puzzle size={ICON.MD} />
                {view.name}
              </button>
            ))}

            {/* Plugin main view buttons */}
            {pluginMainViews.map((view) => (
              <button
                key={view.id}
                onClick={() => setRightPanel(`main-plugin:${view.id}`)}
                className={tabButtonClass(rightPanel === `main-plugin:${view.id}`)}
                title={view.name}
              >
                <Puzzle size={ICON.MD} />
                {view.name}
              </button>
            ))}

            <div className="mx-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />
          </>
        )}

        {/* Settings */}
        <Link
          to="/settings"
          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          title={t("common.settings")}
        >
          <Settings size={ICON.MD} />
        </Link>

        {/* Logout */}
        <a
          href="/auth/logout"
          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          title={t("common.logout")}
        >
          <LogOut size={ICON.MD} />
        </a>
      </div>
    </header>

    </>
  );
}
