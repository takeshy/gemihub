import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DriveFileTree } from "~/components/ide/DriveFileTree";
import { MainViewer } from "~/components/ide/MainViewer";
import { SearchPanel } from "~/components/ide/SearchPanel";
import { WorkflowPropsPanel } from "~/components/ide/WorkflowPropsPanel";
import { SyncDiffDialog, type FileListItem } from "~/components/ide/SyncDiffDialog";
import { ConflictDialog } from "~/components/ide/ConflictDialog";
import { DiffEditor } from "~/components/ide/editors/DiffEditor";
import { EditorContextProvider } from "~/contexts/EditorContext";
import { EnterpriseProvider } from "~/contexts/EnterpriseContext";
import { StaticPluginProvider } from "~/contexts/plugin-context";
import { SkillProvider } from "~/contexts/SkillContext";
import DashboardHost from "~/dashboard/DashboardHost";
import { createDefaultDashboard, serializeDashboard } from "~/dashboard/dashboardFile";
import { I18nProvider } from "~/i18n/context";
// Story fixtures always seed the personal Drive cache before an optional
// organization selection is mounted. This keeps captures deterministic even
// when another Story previously persisted a project selection.
import { setCachedFile, setCachedFileTree, setCachedRemoteMeta } from "~/services/indexeddb-cache-drive";
import type { Language } from "~/types/settings";
import { IdeCaptureTemplate } from "./IdeCaptureTemplate";
import { settingsFixture } from "./settings.fixtures";
import { WorkflowTemplate } from "./WorkflowTemplate";
import { workflowFixture } from "./workflow-dashboard.fixtures";

type Mode = "dashboard" | "workflow" | "chat" | "search" | "pull" | "push" | "conflict" | "diff" | "execution";
const ChatPanel = lazy(() => import("~/components/ide/ChatPanel").then((module) => ({ default: module.ChatPanel })));

function ExpandedSyncDiffDialog({ files, type }: { files: FileListItem[]; type: "push" | "pull" }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const syncModal = document.querySelector<HTMLElement>(".fixed.inset-0.z-50");
      const button = [...(syncModal?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((candidate) => candidate.textContent?.trim() === "差分" || candidate.textContent?.trim() === "Diff");
      button?.click();
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);
  return <SyncDiffDialog files={files} type={type} onClose={() => undefined} onSync={() => undefined} onSelectFile={() => undefined} />;
}

function ExpandedConflictDialog() {
  const conflicts = [
    { fileId: "conflicted", fileName: "Reports/quarterly-report.md", localChecksum: "local-report", remoteChecksum: "remote-report", localModifiedTime: "2026-08-21T03:18:00.000Z", remoteModifiedTime: "2026-08-21T03:22:00.000Z" },
    { fileId: "settings", fileName: "Config/team-settings.yaml", localChecksum: "local-settings", remoteChecksum: "remote-settings", localModifiedTime: "2026-08-21T02:48:00.000Z", remoteModifiedTime: "2026-08-21T03:05:00.000Z" },
    { fileId: "remote-delete", fileName: "Notes/retrospective.md", localChecksum: "local-retro", remoteChecksum: "deleted", localModifiedTime: "2026-08-21T03:12:00.000Z", remoteModifiedTime: "2026-08-21T03:15:00.000Z", isEditDelete: true },
  ];
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const modal = document.querySelector<HTMLElement>(".fixed.inset-0.z-50");
      [...(modal?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((button) => button.textContent?.trim() === "差分" || button.textContent?.trim() === "Diff")?.click();
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);
  return <ConflictDialog conflicts={conflicts} onResolve={async () => undefined} onClose={() => undefined} />;
}

function IdeScene({ mode, language = "ja", organization = false }: { mode: Mode; language?: Language; organization?: boolean }) {
  const selection = organization ? { orgId: "acme", projectId: "website", projectName: "Website renewal", role: "admin" as const, allowedModels: [], gcsPrefix: "projects/website", region: "asia-northeast1" } : null;
  const settings = { ...settingsFixture, language };
  const files = [
    { id: "dashboard", name: "team-overview.dashboard", path: "Dashboards/team-overview.dashboard" },
    { id: "weekly", name: "weekly-content-report.yaml", path: "Workflows/weekly-content-report.yaml" },
    { id: "notes", name: "project-notes.md", path: "Notes/project-notes.md" },
  ];
  const workflowMode = mode === "workflow" || mode === "execution";
  const workflowSurface = workflowMode || mode === "pull" || mode === "push" || mode === "conflict";
  const notes = language === "en"
    ? "# Project notes\n\nThis document collects the quarterly plan, product quality goals, and customer feedback.\n\n## Next actions\n\n- Publish the design system\n- Review the roadmap"
    : "# プロジェクトノート\n\n四半期計画、品質目標、お客様からのフィードバックをまとめます。\n\n## 次のアクション\n\n- デザインシステムを公開\n- ロードマップをレビュー";
  const center = mode === "dashboard"
    ? <DashboardHost settings={{ ...settings, homeDashboard: "Dashboards/team-overview.dashboard" }} />
    : workflowSurface
      ? <WorkflowTemplate embedded fileName="weekly-content-report" content={workflowFixture} settings={settings} />
      : mode === "diff"
        ? <DiffEditor fileId="notes" fileName="project-notes.md" currentContent={notes} targetFileId="notes-previous" targetFileName="project-notes-previous.md" saveToCache={async () => undefined} onClose={() => undefined} />
      : <MainViewer fileId="notes" fileName="project-notes.md" fileMimeType="text/markdown" settings={settings} />;
  const leftPanel = mode === "search"
    ? <SearchPanel apiPlan={settings.apiPlan} ragStoreIds={["sample-store"]} ragTopK={8} fileList={files} onSelectFile={() => undefined} onClose={() => undefined} initialQuery={language === "en" ? "quarterly plan" : "四半期計画"} autoSearch />
    : <DriveFileTree rootFolderId="storybook-root" activeFileId={mode === "dashboard" ? "dashboard" : mode === "workflow" ? "weekly" : "notes"} encryptionEnabled={false} onSelectFile={() => undefined} onSearchOpen={() => undefined} cacheFilesByIds={async () => undefined} cachingProgress={null} />;
  const executionLogs = [
    { nodeId: "load-notes", nodeType: "drive-read", message: language === "en" ? "Loaded project notes" : "プロジェクトノートを読み込みました", status: "success" as const, timestamp: "2026-08-21T03:00:01.000Z", output: { file: "project-notes.md", characters: 248 } },
    { nodeId: "summarize", nodeType: "generate-text", message: language === "en" ? "Summary generated" : "要約を生成しました", status: "success" as const, timestamp: "2026-08-21T03:00:04.000Z", output: language === "en" ? "Three priorities and two follow-up actions." : "3つの優先事項と2つのフォローアップ。" },
    { nodeId: "save-report", nodeType: "drive-write", message: language === "en" ? "Saved weekly report" : "週次レポートを保存しました", status: "success" as const, timestamp: "2026-08-21T03:00:05.000Z", output: { file: "Reports/weekly-report.md" } },
  ];
  const rightPanel = workflowMode
    ? <WorkflowPropsPanel activeFileId="weekly" activeFileName="weekly-content-report.yaml" onNewWorkflow={() => undefined} onSelectFile={() => undefined} settings={settings} externalExecStatus={mode === "execution" ? { fileId: "weekly", state: "done" } : null} externalLogs={mode === "execution" ? executionLogs : undefined} />
    : <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading chat…</div>}><ChatPanel settings={settings} rootFolderId="storybook-root" hasApiKey slashCommands={settings.slashCommands} /></Suspense>;

  const syncFiles: FileListItem[] = mode === "pull" ? [
    { id: "weekly", name: "Workflows/weekly-content-report.yaml", type: "modified" },
    { id: "roadmap", name: "Planning/product-roadmap.md", type: "modified" },
    { id: "settings", name: "Config/team-settings.yaml", type: "modified" },
    { id: "archived", name: "Archive/launch-checklist.md", type: "deleted" },
    { id: "remote-delete", name: "Notes/retrospective.md", type: "editDeleted" },
    { id: "conflicted", name: "Reports/quarterly-report.md", type: "conflict" },
  ] : [
    { id: "weekly", name: "Workflows/weekly-content-report.yaml", type: "modified" },
    { id: "notes", name: "Notes/project-notes.md", type: "modified" },
    { id: "roadmap", name: "Planning/product-roadmap.md", type: "modified" },
    { id: "settings", name: "Config/team-settings.yaml", type: "modified" },
    { id: "new-report", name: "Reports/weekly-report.md", type: "new" },
    { id: "removed-draft", name: "Drafts/old-announcement.md", type: "deleted" },
  ];
  const syncDialog = mode === "pull" || mode === "push"
    ? <ExpandedSyncDiffDialog files={syncFiles} type={mode} />
    : mode === "conflict" ? <ExpandedConflictDialog /> : null;

  return <EnterpriseProvider selection={selection} currentOrgId={organization ? "acme" : null} currentProjectId={organization ? "website" : null} currentUserId="user-1" currentUserEmail="owner@example.com" hasOrganizations>
    <I18nProvider language={language}><StaticPluginProvider><EditorContextProvider><SkillProvider rootFolderId="storybook-root" agentPlugins={settings.agentPlugins} dashboardEnabled><IdeCaptureTemplate mode={mode} language={language} leftPanel={leftPanel} rightPanel={rightPanel}>{center}{syncDialog}</IdeCaptureTemplate></SkillProvider></EditorContextProvider></StaticPluginProvider></I18nProvider>
  </EnterpriseProvider>;
}

function RoutedScene(props: Parameters<typeof IdeScene>[0]) {
  const { mode, language, organization } = props;
  const router = useMemo(() => createMemoryRouter([{ path: "*", element: <SeedGate language={language}><IdeScene mode={mode} language={language} organization={organization} /></SeedGate> }]), [mode, language, organization]);
  return <RouterProvider router={router} />;
}

function SeedGate({ children, language = "ja" }: { children: React.ReactNode; language?: Language }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    localStorage.removeItem("gemihub-active-tenant-project");
    const now = new Date().toISOString();
    const tree = [
      { id: "dashboards-folder", name: "Dashboards", mimeType: "application/vnd.google-apps.folder", isFolder: true, children: [{ id: "dashboard", name: "team-overview.dashboard", mimeType: "text/yaml", isFolder: false }] },
      { id: "workflows-folder", name: "Workflows", mimeType: "application/vnd.google-apps.folder", isFolder: true, children: [{ id: "weekly", name: "weekly-content-report.yaml", mimeType: "text/yaml", isFolder: false }] },
      { id: "notes-folder", name: "Notes", mimeType: "application/vnd.google-apps.folder", isFolder: true, children: [{ id: "notes", name: "project-notes.md", mimeType: "text/markdown", isFolder: false }] },
    ];
    const notes = language === "en" ? "# Project notes\n\nThis document collects the quarterly plan, product quality goals, and customer feedback.\n\n## Next actions\n\n- Publish the design system\n- Review the roadmap" : "# プロジェクトノート\n\n四半期計画、品質目標、お客様からのフィードバックをまとめます。\n\n## 次のアクション\n\n- デザインシステムを公開\n- ロードマップをレビュー";
    const previousNotes = language === "en" ? "# Project notes\n\nThis document collects the quarterly plan.\n\n## Next actions\n\n- Review the roadmap" : "# プロジェクトノート\n\n四半期計画をまとめます。\n\n## 次のアクション\n\n- ロードマップをレビュー";
    void (async () => {
      await setCachedFile({ fileId: "dashboard", fileName: "Dashboards/team-overview.dashboard", content: serializeDashboard(createDefaultDashboard()), md5Checksum: "dashboard", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFile({ fileId: "weekly", fileName: "Workflows/weekly-content-report.yaml", content: workflowFixture, md5Checksum: "weekly", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFile({ fileId: "notes", fileName: "project-notes.md", content: notes, md5Checksum: "notes", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFile({ fileId: "notes-previous", fileName: "project-notes-previous.md", content: previousNotes, md5Checksum: "notes-previous", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFile({ fileId: "roadmap", fileName: "Planning/product-roadmap.md", content: "# Product roadmap\n\n## Q3 priorities\n\n- Search improvements: complete\n- Workflow templates: in progress\n- Organization projects: in review\n- Mobile layout: planned\n", md5Checksum: "roadmap-local", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFile({ fileId: "settings", fileName: "Config/team-settings.yaml", content: "language: ja\ntheme: dark\nautoSync: true\nragTopK: 8\nworkflowTimeout: 300\n", md5Checksum: "settings-local", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFile({ fileId: "archived", fileName: "Archive/launch-checklist.md", content: "# Archived launch checklist\n\n- [x] Design review\n- [x] Security review\n- [x] Release notes\n- [x] Production rollout\n", md5Checksum: "archived-local", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFile({ fileId: "conflicted", fileName: "Reports/quarterly-report.md", content: "# Quarterly report\n\n## Highlights\n\n- Search latency improved by 38%\n- Workflow adoption reached 72%\n\n## Risks\n\n- Documentation backlog remains\n", md5Checksum: "conflicted-local", modifiedTime: now, cachedAt: Date.now() });
      await setCachedFileTree({ id: "current", rootFolderId: "storybook-root", items: tree, cachedAt: Date.now() });
      await setCachedRemoteMeta({ id: "current", rootFolderId: "storybook-root", lastUpdatedAt: now, cachedAt: Date.now(), files: {
        dashboard: { name: "Dashboards/team-overview.dashboard", mimeType: "text/yaml", md5Checksum: "dashboard", modifiedTime: now },
        weekly: { name: "Workflows/weekly-content-report.yaml", mimeType: "text/yaml", md5Checksum: "weekly", modifiedTime: now },
        notes: { name: "project-notes.md", mimeType: "text/markdown", md5Checksum: "notes", modifiedTime: now },
      } });
    })();
    // The real IDE handles cache hydration after mount. Do the same here so a
    // blocked IndexedDB upgrade cannot leave a capture on "Loading fixture".
    setReady(true);
  }, [language]);
  return ready ? children : <div className="p-8 text-sm text-gray-500">Loading fixture…</div>;
}

const meta = { title: "Templates/IDE Scenes", component: RoutedScene, parameters: { layout: "fullscreen" }, args: { mode: "dashboard" } } satisfies Meta<typeof RoutedScene>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Dashboard: Story = {};
export const Workflow: Story = { args: { mode: "workflow" } };
export const Chat: Story = { args: { mode: "chat" } };
export const Search: Story = { args: { mode: "search" } };
export const PullChanges: Story = { args: { mode: "pull" } };
export const PushChanges: Story = { args: { mode: "push" } };
export const Diff: Story = { args: { mode: "diff" } };
export const Conflict: Story = { args: { mode: "conflict" } };
export const ExecutionResult: Story = { args: { mode: "execution" } };
export const OrganizationDashboard: Story = { args: { organization: true } };
export const OrganizationWorkflow: Story = { args: { mode: "workflow", organization: true } };
export const DashboardEnglish: Story = { args: { language: "en" } };
export const WorkflowEnglish: Story = { args: { mode: "workflow", language: "en" } };
export const ChatEnglish: Story = { args: { mode: "chat", language: "en" } };
export const SearchEnglish: Story = { args: { mode: "search", language: "en" } };
export const PullChangesEnglish: Story = { args: { mode: "pull", language: "en" } };
export const PushChangesEnglish: Story = { args: { mode: "push", language: "en" } };
export const DiffEnglish: Story = { args: { mode: "diff", language: "en" } };
export const ConflictEnglish: Story = { args: { mode: "conflict", language: "en" } };
export const ExecutionResultEnglish: Story = { args: { mode: "execution", language: "en" } };
export const OrganizationDashboardEnglish: Story = { args: { language: "en", organization: true } };
export const OrganizationWorkflowEnglish: Story = { args: { mode: "workflow", language: "en", organization: true } };
