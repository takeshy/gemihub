import { Link } from "react-router";
import {
  MessageSquare,
  GitBranch,
  Settings,
  LogOut,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { SyncStatusBar } from "./SyncStatusBar";
import type { SyncStatus, SyncDiff, ConflictInfo } from "~/hooks/useSync";
import { useI18n } from "~/i18n/context";

interface HeaderProps {
  rightPanel: "chat" | "workflow";
  setRightPanel: (panel: "chat" | "workflow") => void;
  activeFileName: string | null;
  syncStatus: SyncStatus;
  syncDiff: SyncDiff | null;
  lastSyncTime: string | null;
  syncError: string | null;
  syncConflicts: ConflictInfo[];
  onPush: () => void;
  onPull: () => void;
  onCheckSync: () => void;
  onShowConflicts: () => void;
}

export function Header({
  rightPanel,
  setRightPanel,
  activeFileName,
  syncStatus,
  syncDiff,
  lastSyncTime,
  syncError,
  syncConflicts,
  onPush,
  onPull,
  onCheckSync,
  onShowConflicts,
}: HeaderProps) {
  const { t } = useI18n();
  return (
    <header className="flex h-10 items-center justify-between border-b border-gray-200 bg-white px-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
          Gemini Hub
        </span>
        {activeFileName && (
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
            {activeFileName}
          </span>
        )}
        <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
        <SyncStatusBar
          syncStatus={syncStatus}
          diff={syncDiff}
          lastSyncTime={lastSyncTime}
          error={syncError}
          onPush={onPush}
          onPull={onPull}
          onCheckSync={onCheckSync}
          onShowConflicts={onShowConflicts}
          conflicts={syncConflicts}
        />
      </div>

      <div className="flex items-center gap-1">
        {/* Right panel tab toggles */}
        <button
          onClick={() => setRightPanel("chat")}
          className={`flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
            rightPanel === "chat"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          }`}
        >
          <MessageSquare size={ICON.MD} />
          {t("header.chat")}
        </button>
        <button
          onClick={() => setRightPanel("workflow")}
          className={`flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
            rightPanel === "workflow"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          }`}
        >
          <GitBranch size={ICON.MD} />
          {t("header.workflow")}
        </button>

        <div className="mx-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />

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
  );
}
