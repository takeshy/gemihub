import { useState, useCallback, useEffect } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/_index";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { listChatHistories } from "~/services/chat-history.server";
import type { UserSettings } from "~/types/settings";
import type { ChatHistoryItem } from "~/types/chat";
import { LogIn } from "lucide-react";
import { I18nProvider } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { EditorContextProvider, useEditorContext } from "~/contexts/EditorContext";

import { Header } from "~/components/ide/Header";
import { LeftSidebar } from "~/components/ide/LeftSidebar";
import { RightSidebar } from "~/components/ide/RightSidebar";
import { DriveFileTree } from "~/components/ide/DriveFileTree";
import { MainViewer } from "~/components/ide/MainViewer";
import { ChatPanel } from "~/components/ide/ChatPanel";
import { WorkflowPropsPanel } from "~/components/ide/WorkflowPropsPanel";
import { ConflictDialog } from "~/components/ide/ConflictDialog";
import { AIWorkflowDialog } from "~/components/ide/AIWorkflowDialog";
import { useSync } from "~/hooks/useSync";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens) {
    return {
      authenticated: false as const,
      settings: null,
      chatHistories: [],
      hasGeminiApiKey: false,
      rootFolderId: "",
    };
  }

  try {
    const { tokens: validTokens } = await getValidTokens(request, tokens);
    const [settings, chatHistories] = await Promise.all([
      getSettings(validTokens.accessToken, validTokens.rootFolderId),
      listChatHistories(validTokens.accessToken, validTokens.rootFolderId),
    ]);

    return {
      authenticated: true as const,
      settings,
      chatHistories,
      hasGeminiApiKey: !!validTokens.geminiApiKey,
      rootFolderId: validTokens.rootFolderId,
    };
  } catch {
    return {
      authenticated: false as const,
      settings: null,
      chatHistories: [],
      hasGeminiApiKey: false,
      rootFolderId: "",
    };
  }
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
      chatHistories={data.chatHistories as ChatHistoryItem[]}
      hasGeminiApiKey={data.hasGeminiApiKey}
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
  chatHistories,
  hasGeminiApiKey,
  rootFolderId,
}: {
  settings: UserSettings;
  chatHistories: ChatHistoryItem[];
  hasGeminiApiKey: boolean;
  rootFolderId: string;
}) {
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

  // Right panel state
  const [rightPanel, setRightPanel] = useState<"chat" | "workflow">("chat");

  // Resolve file name when opened via URL (fileId present, fileName unknown)
  useEffect(() => {
    if (activeFileId && !activeFileName) {
      fetch(`/api/drive/files?action=metadata&fileId=${activeFileId}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.name) {
            setActiveFileName(data.name);
            setActiveFileMimeType(data.mimeType || null);
            if (data.name.endsWith(".yaml") || data.name.endsWith(".yml")) {
              setRightPanel("workflow");
            }
          }
        })
        .catch(() => {});
    }
  }, [activeFileId, activeFileName]);

  // Workflow version for refreshing MainViewer after sidebar edits
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const handleWorkflowChanged = useCallback(() => {
    setWorkflowVersion((v) => v + 1);
  }, []);

  // Sync state
  const {
    syncStatus,
    lastSyncTime,
    diff: syncDiff,
    conflicts,
    error: syncError,
    push,
    pull,
    checkSync,
    resolveConflict,
  } = useSync();

  const [showConflictDialog, setShowConflictDialog] = useState(false);

  // AI Workflow dialog state
  const [aiDialog, setAiDialog] = useState<AIDialogState | null>(null);

  // ---- File selection ----
  const handleSelectFile = useCallback(
    (fileId: string, fileName: string, mimeType: string) => {
      setActiveFileId(fileId);
      setActiveFileName(fileName);
      setActiveFileMimeType(mimeType);
      // Auto-switch to workflow tab for YAML files
      if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
        setRightPanel("workflow");
      }
      // Update URL without triggering React Router navigation/loader
      const url = new URL(window.location.href);
      url.searchParams.set("file", fileId);
      window.history.replaceState({}, "", url.toString());
    },
    []
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
    async (yamlContent: string, workflowName: string) => {
      const dialogState = aiDialog;
      setAiDialog(null);

      try {
        if (dialogState?.mode === "modify" && dialogState.currentFileId) {
          // Update existing workflow
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
            handleWorkflowChanged();
          }
        } else {
          // Create new workflow file
          const fileName = workflowName.endsWith(".yaml")
            ? workflowName
            : `${workflowName}.yaml`;
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
            handleSelectFile(data.file.id, data.file.name, "text/yaml");
          }
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
      <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-950">
        <Header
          rightPanel={rightPanel}
          setRightPanel={setRightPanel}
          activeFileName={activeFileName}
          syncStatus={syncStatus}
          syncDiff={syncDiff}
          lastSyncTime={lastSyncTime}
          syncError={syncError}
          syncConflicts={conflicts}
          onPush={push}
          onPull={pull}
          onCheckSync={checkSync}
          onShowConflicts={() => setShowConflictDialog(true)}
        />

        {!hasGeminiApiKey && (
          <div className="flex items-center justify-between border-b border-yellow-200 bg-yellow-50 px-4 py-1.5 text-xs dark:border-yellow-800 dark:bg-yellow-900/20">
            <span className="text-yellow-800 dark:text-yellow-200">
              Gemini API key is not set. AI features will not work.
            </span>
            <a
              href="/settings"
              className="font-medium text-yellow-800 underline hover:no-underline dark:text-yellow-200"
            >
              Settings
            </a>
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
            <MainViewer
              fileId={activeFileId}
              fileName={activeFileName}
              fileMimeType={activeFileMimeType}
              settings={settings}
              refreshKey={workflowVersion}
            />
          </div>

          {/* Right sidebar - Chat / Workflow props */}
          <RightSidebar>
            {rightPanel === "chat" ? (
              <ChatPanel
                settings={settings}
                hasApiKey={hasGeminiApiKey}
                chatHistories={chatHistories}
                slashCommands={settings.slashCommands || []}
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
      </div>
      </EditorContextProvider>
    </I18nProvider>
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
