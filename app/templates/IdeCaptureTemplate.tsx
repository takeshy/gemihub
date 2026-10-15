import { Search } from "lucide-react";
import { Header, type RightPanelId } from "~/components/ide/Header";
import { LeftSidebar } from "~/components/ide/LeftSidebar";
import { RightSidebar } from "~/components/ide/RightSidebar";
import type { Language } from "~/types/settings";

type IdeCaptureMode = "dashboard" | "workflow" | "chat" | "search" | "pull" | "push" | "conflict" | "diff" | "execution";

export function IdeCaptureTemplate({ children, mode, language: _language, leftPanel, rightPanel: rightPanelContent }: { children: React.ReactNode; mode: IdeCaptureMode; language: Language; leftPanel: React.ReactNode; rightPanel: React.ReactNode }) {
  const workflowMode = mode === "workflow" || mode === "execution";
  const workflowFileMode = workflowMode || mode === "pull" || mode === "push" || mode === "conflict";
  const dashboardMode = mode === "dashboard";
  const rightPanel: RightPanelId = workflowMode ? "workflow" : "chat";
  return (
    <div className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-gray-50">
      <Header
        rightPanel={rightPanel}
        setRightPanel={() => undefined}
        workflowEnabled
        activeFileId={workflowFileMode ? "weekly" : dashboardMode ? "dashboard" : "notes"}
        syncStatus="idle"
        lastSyncTime="2026-08-21T03:00:00.000Z"
        syncError={null}
        syncConflicts={[]}
        localModifiedCount={0}
        remoteModifiedCount={0}
        onPush={() => undefined}
        onPull={() => undefined}
        onShowConflicts={() => undefined}
        onLogoClick={() => undefined}
        onOpenLauncher={() => undefined}
        onOpenTimelineComposer={() => undefined}
        onOpenSecretManager={() => undefined}
        onOpenHome={() => undefined}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftSidebar>{leftPanel}</LeftSidebar>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            <Search size={16} className="shrink-0" />
            <span className="truncate">{workflowFileMode ? "Workflows/weekly-content-report.yaml" : dashboardMode ? "Dashboards/team-overview.dashboard" : "Notes/project-notes.md"}</span>
          </div>
          {children}
        </main>
        <RightSidebar>{rightPanelContent}</RightSidebar>
      </div>
    </div>
  );
}
