import { useState, useCallback, useEffect } from "react";
import { data, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/_index";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { getLocalPlugins } from "~/services/local-plugins.server";
import type { UserSettings } from "~/types/settings";
import { LogIn } from "lucide-react";
import { I18nProvider, useI18n } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { EditorContextProvider, useEditorContext } from "~/contexts/EditorContext";
import { setCachedFile } from "~/services/indexeddb-cache";
import { PluginProvider, usePlugins } from "~/contexts/PluginContext";

import { Header, type RightPanelId } from "~/components/ide/Header";
import { LeftSidebar } from "~/components/ide/LeftSidebar";
import { RightSidebar } from "~/components/ide/RightSidebar";
import { DriveFileTree } from "~/components/ide/DriveFileTree";
import { MainViewer } from "~/components/ide/MainViewer";
import { ChatPanel } from "~/components/ide/ChatPanel";
import { PasswordPromptDialog } from "~/components/ide/PasswordPromptDialog";
import { WorkflowPropsPanel } from "~/components/ide/WorkflowPropsPanel";
import { ConflictDialog } from "~/components/ide/ConflictDialog";
import { AIWorkflowDialog, type AIWorkflowMeta } from "~/components/ide/AIWorkflowDialog";
import { PanelErrorBoundary } from "~/components/shared/PanelErrorBoundary";
import { useSync } from "~/hooks/useSync";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens) {
    return data({
      authenticated: false as const,
      settings: null,
      hasGeminiApiKey: false,
      hasEncryptedApiKey: false,
      rootFolderId: "",
    });
  }

  try {
    const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
    const driveSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

    // Merge local plugins (dev only) — local plugins take priority over Drive plugins
    const localPlugins = getLocalPlugins();
    const localIds = new Set(localPlugins.map((p) => p.id));
    const mergedPlugins = [
      ...localPlugins,
      ...(driveSettings.plugins || []).filter((p) => !localIds.has(p.id)),
    ];
    const settings = { ...driveSettings, plugins: mergedPlugins };

    return data(
      {
        authenticated: true as const,
        settings,
        hasGeminiApiKey: !!validTokens.geminiApiKey,
        hasEncryptedApiKey: !!settings.encryptedApiKey,
        rootFolderId: validTokens.rootFolderId,
      },
      { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined }
    );
  } catch {
    return data({
      authenticated: false as const,
      settings: null,
      hasGeminiApiKey: false,
      hasEncryptedApiKey: false,
      rootFolderId: "",
    });
  }
}

// ---------------------------------------------------------------------------
// Client-side loader cache
// ---------------------------------------------------------------------------

let cachedLoaderData: Awaited<ReturnType<Route.ClientLoaderArgs["serverLoader"]>> | null = null;

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  if (cachedLoaderData) return cachedLoaderData;
  const loaderData = await serverLoader();
  cachedLoaderData = loaderData;
  return loaderData;
}

export function invalidateIndexCache() {
  cachedLoaderData = null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Index() {
  const data = useLoaderData<typeof loader>();

  if (!data.authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900 dark:text-gray-100">
            Gemini Hub
          </h1>
          <p className="mb-8 text-gray-600 dark:text-gray-400">
            Build and execute AI-powered workflows visually
          </p>
          <a
            href="/auth/google"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700 transition-colors"
          >
            <LogIn size={20} />
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  return (
    <IDELayout
      settings={data.settings!}
      hasGeminiApiKey={data.hasGeminiApiKey}
      hasEncryptedApiKey={data.hasEncryptedApiKey}
      rootFolderId={data.rootFolderId}
    />
  );
}

// ---------------------------------------------------------------------------
// IDE Layout (authenticated)
// ---------------------------------------------------------------------------

interface AIDialogState {
  mode: "create" | "modify";
  currentYaml?: string;
  currentName?: string;
  currentFileId?: string;
}

function IDELayout({
  settings,
  hasGeminiApiKey: initialHasGeminiApiKey,
  hasEncryptedApiKey,
  rootFolderId,
}: {
  settings: UserSettings;
  hasGeminiApiKey: boolean;
  hasEncryptedApiKey: boolean;
  rootFolderId: string;
}) {
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(initialHasGeminiApiKey);
  useApplySettings(settings.language, settings.fontSize, settings.theme);
  const [searchParams] = useSearchParams();

  // Active file state — use local state to avoid React Router navigation on file switch
  const [activeFileId, setActiveFileId] = useState<string | null>(
    searchParams.get("file")
  );
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [activeFileMimeType, setActiveFileMimeType] = useState<string | null>(
    null
  );

  // Right panel state — supports "chat", "workflow", or "plugin:{viewId}" for plugin sidebar views
  const [rightPanel, setRightPanel] = useState<RightPanelId>("chat");

  // Resolve file name when opened via URL (fileId present, fileName unknown)
  useEffect(() => {
    if (activeFileId && !activeFileName) {
      fetch(`/api/drive/files?action=metadata&fileId=${activeFileId}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.name) {
            setActiveFileName(data.name);
            setActiveFileMimeType(data.mimeType || null);
            // Don't switch away from plugin views
            if (!rightPanel.startsWith("plugin:") && !rightPanel.startsWith("main-plugin:")) {
              if (data.name.endsWith(".yaml") || data.name.endsWith(".yml")) {
                setRightPanel("workflow");
              } else {
                setRightPanel("chat");
              }
            }
          }
        })
        .catch(() => {});
    }
  }, [activeFileId, activeFileName, rightPanel]);

  // Workflow version for refreshing MainViewer after sidebar edits
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const handleWorkflowChanged = useCallback(() => {
    setWorkflowVersion((v) => v + 1);
  }, []);

  // Sync state
  const {
    syncStatus,
    lastSyncTime,
    conflicts,
    error: syncError,
    localModifiedCount,
    push,
    pull,
    resolveConflict,
  } = useSync();

  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);

  // AI Workflow dialog state
  const [aiDialog, setAiDialog] = useState<AIDialogState | null>(null);

  // ---- File selection ----
  const handleSelectFile = useCallback(
    (fileId: string, fileName: string, mimeType: string) => {
      setActiveFileId(fileId);
      setActiveFileName(fileName);
      setActiveFileMimeType(mimeType);
      // Auto-switch right panel based on file type, but keep plugin views open
      if (!rightPanel.startsWith("plugin:") && !rightPanel.startsWith("main-plugin:")) {
        if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
          setRightPanel("workflow");
        } else {
          setRightPanel("chat");
        }
      }
      // Update URL without triggering React Router navigation/loader
      const url = new URL(window.location.href);
      url.searchParams.set("file", fileId);
      window.history.replaceState({}, "", url.toString());
    },
    [rightPanel]
  );

  // ---- New workflow creation (opens AI dialog) ----
  const handleNewWorkflow = useCallback(() => {
    setAiDialog({ mode: "create" });
  }, []);

  // ---- Modify workflow with AI ----
  const handleModifyWithAI = useCallback(
    (currentYaml: string, workflowName: string) => {
      setAiDialog({
        mode: "modify",
        currentYaml,
        currentName: workflowName,
        currentFileId: activeFileId || undefined,
      });
    },
    [activeFileId]
  );

  // ---- AI workflow accept handler ----
  const handleAIAccept = useCallback(
    async (yamlContent: string, workflowName: string, meta: AIWorkflowMeta) => {
      const dialogState = aiDialog;
      setAiDialog(null);

      let workflowId = "";
      let finalName = workflowName;

      try {
        if (dialogState?.mode === "modify" && dialogState.currentFileId) {
          // Update existing workflow
          workflowId = dialogState.currentFileId;
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update",
              fileId: dialogState.currentFileId,
              content: yamlContent,
            }),
          });
          if (res.ok) {
            const resData = await res.json();
            // Update IndexedDB cache so the viewer picks up the new content
            await setCachedFile({
              fileId: dialogState.currentFileId,
              content: yamlContent,
              md5Checksum: resData.md5Checksum ?? "",
              modifiedTime: resData.file?.modifiedTime ?? "",
              cachedAt: Date.now(),
              fileName: resData.file?.name,
            });
            handleWorkflowChanged();
          }
        } else {
          // Create new workflow file under workflows/ folder
          const baseName = workflowName.endsWith(".yaml")
            ? workflowName
            : `${workflowName}.yaml`;
          const fileName = `workflows/${baseName}`;
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create",
              name: fileName,
              content: yamlContent,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            workflowId = data.file.id;
            finalName = data.file.name;
            // Refresh file tree so the new file appears
            window.dispatchEvent(new Event("sync-complete"));
            handleSelectFile(data.file.id, data.file.name, "text/yaml");
          }
        }

        // Save request record (fire-and-forget)
        if (workflowId) {
          const recordId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          fetch("/api/workflow/request-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "save",
              record: {
                id: recordId,
                workflowId,
                workflowName: finalName,
                createdAt: new Date().toISOString(),
                description: meta.description,
                thinking: meta.thinking,
                model: meta.model,
                mode: meta.mode,
                history: meta.history.length > 0 ? meta.history : undefined,
              },
            }),
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    },
    [aiDialog, handleSelectFile, handleWorkflowChanged]
  );

  return (
    <I18nProvider language={settings.language}>
      <EditorContextProvider>
      <PluginProvider pluginConfigs={settings.plugins || []} language={settings.language}>
      <IDEContent
        settings={settings}
        hasGeminiApiKey={hasGeminiApiKey}
        hasEncryptedApiKey={hasEncryptedApiKey}
        rootFolderId={rootFolderId}
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
        activeFileId={activeFileId}
        activeFileName={activeFileName}
        activeFileMimeType={activeFileMimeType}
        workflowVersion={workflowVersion}
        syncStatus={syncStatus}
        lastSyncTime={lastSyncTime}
        syncError={syncError}
        conflicts={conflicts}
        localModifiedCount={localModifiedCount}
        push={push}
        pull={pull}
        resolveConflict={resolveConflict}
        showConflictDialog={showConflictDialog}
        setShowConflictDialog={setShowConflictDialog}
        showPasswordPrompt={showPasswordPrompt}
        setShowPasswordPrompt={setShowPasswordPrompt}
        setHasGeminiApiKey={setHasGeminiApiKey}
        aiDialog={aiDialog}
        setAiDialog={setAiDialog}
        handleSelectFile={handleSelectFile}
        handleNewWorkflow={handleNewWorkflow}
        handleWorkflowChanged={handleWorkflowChanged}
        handleModifyWithAI={handleModifyWithAI}
        handleAIAccept={handleAIAccept}
      />
      </PluginProvider>
      </EditorContextProvider>
    </I18nProvider>
  );
}

// ---------------------------------------------------------------------------
// IDE Content — separated to access PluginContext
// ---------------------------------------------------------------------------

function IDEContent({
  settings,
  hasGeminiApiKey,
  hasEncryptedApiKey,
  rootFolderId,
  rightPanel,
  setRightPanel,
  activeFileId,
  activeFileName,
  activeFileMimeType,
  workflowVersion,
  syncStatus,
  lastSyncTime,
  syncError,
  conflicts,
  localModifiedCount,
  push,
  pull,
  resolveConflict,
  showConflictDialog,
  setShowConflictDialog,
  showPasswordPrompt,
  setShowPasswordPrompt,
  setHasGeminiApiKey,
  aiDialog,
  setAiDialog,
  handleSelectFile,
  handleNewWorkflow,
  handleWorkflowChanged,
  handleModifyWithAI,
  handleAIAccept,
}: {
  settings: UserSettings;
  hasGeminiApiKey: boolean;
  hasEncryptedApiKey: boolean;
  rootFolderId: string;
  rightPanel: RightPanelId;
  setRightPanel: (panel: RightPanelId) => void;
  activeFileId: string | null;
  activeFileName: string | null;
  activeFileMimeType: string | null;
  workflowVersion: number;
  syncStatus: import("~/hooks/useSync").SyncStatus;
  lastSyncTime: string | null;
  syncError: string | null;
  conflicts: import("~/hooks/useSync").ConflictInfo[];
  localModifiedCount: number;
  push: () => void;
  pull: () => void;
  resolveConflict: (fileId: string, resolution: "local" | "remote") => Promise<void>;
  showConflictDialog: boolean;
  setShowConflictDialog: (v: boolean) => void;
  showPasswordPrompt: boolean;
  setShowPasswordPrompt: (v: boolean) => void;
  setHasGeminiApiKey: (v: boolean) => void;
  aiDialog: AIDialogState | null;
  setAiDialog: (v: AIDialogState | null) => void;
  handleSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  handleNewWorkflow: () => void;
  handleWorkflowChanged: () => void;
  handleModifyWithAI: (yaml: string, name: string) => void;
  handleAIAccept: (yaml: string, name: string, meta: AIWorkflowMeta) => void;
}) {
  const { t } = useI18n();
  const { sidebarViews, mainViews, slashCommands: pluginSlashCommands, getPluginAPI } = usePlugins();

  // Determine if current right panel is a plugin view
  const activePluginSidebarView = rightPanel.startsWith("plugin:")
    ? sidebarViews.find((v) => `plugin:${v.id}` === rightPanel)
    : null;

  // Determine if current main view is a plugin view
  const activePluginMainView = rightPanel.startsWith("main-plugin:")
    ? mainViews.find((v) => `main-plugin:${v.id}` === rightPanel)
    : null;

  // Merge plugin slash commands with settings slash commands for ChatPanel
  const allSlashCommands = settings.slashCommands || [];

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-950">
      <Header
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
        activeFileName={activeFileName}
        activeFileId={activeFileId}
        syncStatus={syncStatus}
        lastSyncTime={lastSyncTime}
        syncError={syncError}
        syncConflicts={conflicts}
        localModifiedCount={localModifiedCount}
        onPush={push}
        onPull={pull}
        onShowConflicts={() => setShowConflictDialog(true)}
        pluginSidebarViews={sidebarViews}
        pluginMainViews={mainViews}
      />

      {!hasGeminiApiKey && (
        <div className="flex items-center justify-between border-b border-yellow-200 bg-yellow-50 px-4 py-1.5 text-xs dark:border-yellow-800 dark:bg-yellow-900/20">
          <span className="text-yellow-800 dark:text-yellow-200">
            {hasEncryptedApiKey ? t("index.apiKeyLocked") : t("index.apiKeyWarning")}
          </span>
          <div className="flex items-center gap-3">
            {hasEncryptedApiKey && (
              <button
                onClick={() => setShowPasswordPrompt(true)}
                className="font-medium text-yellow-800 underline hover:no-underline dark:text-yellow-200"
              >
                {t("unlock.submit")}
              </button>
            )}
            <a
              href="/settings"
              className="font-medium text-yellow-800 underline hover:no-underline dark:text-yellow-200"
            >
              {t("common.settings")}
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - File tree */}
        <LeftSidebar>
          <DriveFileTreeWithContext
            rootFolderId={rootFolderId}
            onSelectFile={handleSelectFile}
            activeFileId={activeFileId}
            encryptionEnabled={settings.encryption.enabled}
          />
        </LeftSidebar>

        {/* Main viewer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <PanelErrorBoundary fallbackLabel="Error loading main viewer">
            {activePluginMainView ? (
              <div className="flex-1 overflow-auto p-4">
                {getPluginAPI(activePluginMainView.pluginId) ? (
                  <activePluginMainView.component api={getPluginAPI(activePluginMainView.pluginId)!} />
                ) : null}
              </div>
            ) : (
              <MainViewer
                fileId={activeFileId}
                fileName={activeFileName}
                fileMimeType={activeFileMimeType}
                settings={settings}
                refreshKey={workflowVersion}
              />
            )}
          </PanelErrorBoundary>
        </div>

        {/* Right sidebar - Chat / Workflow props / Plugin views */}
        <RightSidebar>
          <PanelErrorBoundary fallbackLabel="Error loading panel">
          {activePluginSidebarView ? (
            <div className="h-full overflow-auto p-2">
              {getPluginAPI(activePluginSidebarView.pluginId) ? (
                <activePluginSidebarView.component api={getPluginAPI(activePluginSidebarView.pluginId)!} />
              ) : null}
            </div>
          ) : rightPanel === "chat" ? (
            <ChatPanel
              settings={settings}
              hasApiKey={hasGeminiApiKey}
              hasEncryptedApiKey={hasEncryptedApiKey}
              onNeedUnlock={() => setShowPasswordPrompt(true)}
              slashCommands={allSlashCommands}
              pluginSlashCommands={pluginSlashCommands}
            />
          ) : (
            <WorkflowPropsPanel
              activeFileId={activeFileId}
              activeFileName={activeFileName}
              onNewWorkflow={handleNewWorkflow}
              onSelectFile={handleSelectFile}
              onWorkflowChanged={handleWorkflowChanged}
              onModifyWithAI={handleModifyWithAI}
            />
          )}
          </PanelErrorBoundary>
        </RightSidebar>
      </div>

      {/* Conflict dialog */}
      {showConflictDialog && conflicts.length > 0 && (
        <ConflictDialog
          conflicts={conflicts}
          onResolve={resolveConflict}
          onClose={() => setShowConflictDialog(false)}
        />
      )}

      {/* AI Workflow dialog */}
      {aiDialog && (
        <AIWorkflowDialog
          mode={aiDialog.mode}
          currentYaml={aiDialog.currentYaml}
          currentName={aiDialog.currentName}
          apiPlan={settings.apiPlan}
          onAccept={handleAIAccept}
          onClose={() => setAiDialog(null)}
        />
      )}

      {/* Password prompt for API key unlock */}
      {showPasswordPrompt && (
        <PasswordPromptDialog
          onSuccess={() => {
            setShowPasswordPrompt(false);
            setHasGeminiApiKey(true);
            // Trigger a pull so Drive files are cached in IndexedDB
            // and the file tree shows green cache indicators
            pull();
          }}
          onClose={() => setShowPasswordPrompt(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DriveFileTree wrapper that bridges to EditorContext
// ---------------------------------------------------------------------------

function DriveFileTreeWithContext(props: {
  rootFolderId: string;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  activeFileId: string | null;
  encryptionEnabled: boolean;
}) {
  const { setFileList } = useEditorContext();
  return (
    <DriveFileTree
      {...props}
      onFileListChange={setFileList}
    />
  );
}
