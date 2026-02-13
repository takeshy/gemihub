import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import {
  MessageSquare,
  GitBranch,
  Settings,
  LogOut,
  Puzzle,
  Search,
  WifiOff,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { SyncStatusBar } from "./SyncStatusBar";
import type { SyncStatus, ConflictInfo } from "~/hooks/useSync";
import type { PluginView } from "~/types/plugin";
import { useI18n } from "~/i18n/context";
import { PluginIcon } from "~/components/shared/PluginIcon";

export type RightPanelId = "chat" | "workflow" | `plugin:${string}` | `main-plugin:${string}`;

interface HeaderProps {
  rightPanel: RightPanelId;
  setRightPanel: (panel: RightPanelId) => void;
  activeFileId: string | null;
  syncStatus: SyncStatus;
  lastSyncTime: string | null;
  syncError: string | null;
  syncConflicts: ConflictInfo[];
  localModifiedCount: number;
  remoteModifiedCount: number;
  onPush: () => void;
  onPull: () => void;
  onShowConflicts: () => void;
  onSelectFile?: (fileId: string, fileName: string, mimeType: string) => void;
  onQuickOpen?: () => void;
  activeFilePath?: string | null;
  pluginSidebarViews?: PluginView[];
  pluginMainViews?: PluginView[];
  isMobile?: boolean;
  isOffline?: boolean;
}

export function Header({
  rightPanel,
  setRightPanel,
  activeFileId: _activeFileId,
  syncStatus,
  lastSyncTime,
  syncError,
  syncConflicts,
  localModifiedCount,
  remoteModifiedCount,
  onPush,
  onPull,
  onShowConflicts,
  onSelectFile,
  onQuickOpen,
  activeFilePath,
  pluginSidebarViews = [],
  pluginMainViews = [],
  isMobile = false,
  isOffline = false,
}: HeaderProps) {
  const { t } = useI18n();
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false);
  const pluginMenuRef = useRef<HTMLDivElement>(null);

  // Close plugin menu on click outside
  useEffect(() => {
    if (!pluginMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (pluginMenuRef.current && !pluginMenuRef.current.contains(e.target as Node)) {
        setPluginMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pluginMenuOpen]);

  const allPluginViews = [...pluginSidebarViews, ...pluginMainViews];
  const hasActivePlugin = rightPanel.startsWith("plugin:") || rightPanel.startsWith("main-plugin:");

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
        <a href="/lp" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 shrink-0 hover:opacity-80">
          <img src="/icons/icon-192x192.png" alt="" width={20} height={20} className="rounded" />
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
            GemiHub
          </span>
        </a>
        <div className="hidden sm:block mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
        {isOffline ? (
          <div className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800">
            <WifiOff size={ICON.SM} />
            {t("offline.indicator")}
          </div>
        ) : (
          <SyncStatusBar
            syncStatus={syncStatus}
            lastSyncTime={lastSyncTime}
            error={syncError}
            localModifiedCount={localModifiedCount}
            remoteModifiedCount={remoteModifiedCount}
            onPush={onPush}
            onPull={onPull}
            onShowConflicts={onShowConflicts}
            onSelectFile={onSelectFile}
            conflicts={syncConflicts}
            compact={isMobile}
          />
        )}
        {onQuickOpen && (
          <button
            onClick={onQuickOpen}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 min-w-0"
            title={t("quickOpen.selectFile")}
          >
            <Search size={ICON.MD} className="shrink-0" />
            {activeFilePath && (
              <span className="hidden sm:inline text-xs whitespace-nowrap">{activeFilePath}</span>
            )}
          </button>
        )}
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

            {/* Plugin dropdown */}
            {allPluginViews.length > 0 && (
              <div className="relative" ref={pluginMenuRef}>
                <button
                  onClick={() => setPluginMenuOpen((v) => !v)}
                  className={tabButtonClass(hasActivePlugin)}
                  title={t("header.plugins")}
                >
                  <Puzzle size={ICON.MD} />
                  {t("header.plugins")}
                </button>
                {pluginMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {pluginSidebarViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => { setRightPanel(`plugin:${view.id}`); setPluginMenuOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                          rightPanel === `plugin:${view.id}`
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                      >
                        <PluginIcon icon={view.icon} size={ICON.SM} className="shrink-0" />
                        {view.name}
                      </button>
                    ))}
                    {pluginMainViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => { setRightPanel(`main-plugin:${view.id}`); setPluginMenuOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                          rightPanel === `main-plugin:${view.id}`
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                      >
                        <PluginIcon icon={view.icon} size={ICON.SM} className="shrink-0" />
                        {view.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

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
