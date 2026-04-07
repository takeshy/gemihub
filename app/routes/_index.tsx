import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { data, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/_index";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { ensureRootFolder } from "~/services/google-drive.server";
import { getSettings } from "~/services/user-settings.server";
import { getLocalPlugins } from "~/services/local-plugins.server";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { resolveLanguage } from "~/i18n/resolve-language";
import { FolderOpen, FileText, MessageSquare, GitBranch, Puzzle, FilePlus, WifiOff, AlertTriangle, Loader2, Check, AlertCircle } from "lucide-react";
import { I18nProvider, useI18n } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { EditorContextProvider, useEditorContext } from "~/contexts/EditorContext";
import { setCachedFile, getCachedLoaderData, setCachedLoaderData, getLocalSyncMeta, setLocalSyncMeta, getAllCachedFiles, clearAllCache } from "~/services/indexeddb-cache";
import { PluginProvider, usePlugins } from "~/contexts/PluginContext";
import { SkillProvider } from "~/contexts/SkillContext";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflowLocally } from "~/engine/local-executor";
import { processDriveEvent } from "~/utils/drive-file-local";
import { readFileLocal } from "~/services/drive-local";
import { getCachedApiKey } from "~/services/api-key-cache";

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
import { SearchPanel } from "~/components/ide/SearchPanel";
import { QuickOpenDialog } from "~/components/ide/QuickOpenDialog";
import { PanelErrorBoundary } from "~/components/shared/PanelErrorBoundary";
import { useIsMobile } from "~/hooks/useIsMobile";
import { usePendingFileMigration } from "~/hooks/usePendingFileMigration";
import { useActiveFile } from "~/hooks/useActiveFile";
import { useSyncUI } from "~/hooks/useSyncUI";
import { useAIWorkflowDialog, type AIDialogState } from "~/hooks/useAIWorkflowDialog";
import { ICON } from "~/utils/icon-sizes";
import { PluginIcon } from "~/components/shared/PluginIcon";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens) {
    throw redirect("/lp");
  }

  try {
    const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);

    // Detect root folder mismatch (folder trashed/renamed → new folder created on another device)
    let rootFolderMismatch: { canonicalRootFolderId: string } | null = null;

    if (validTokens.rootFolderId) {
      const canonicalId = await ensureRootFolder(validTokens.accessToken);
      if (canonicalId !== validTokens.rootFolderId) {
        rootFolderMismatch = { canonicalRootFolderId: canonicalId };
      }
    }

    let driveSettings;
    if (rootFolderMismatch) {
      try {
        driveSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      } catch {
        driveSettings = await getSettings(validTokens.accessToken, rootFolderMismatch.canonicalRootFolderId);
      }
    } else {
      driveSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
    }

    // Merge local plugins (dev only) — local plugins take priority over Drive plugins
    const localPlugins = getLocalPlugins();
    const localIds = new Set(localPlugins.map((p) => p.id));
    const mergedPlugins = [
      ...localPlugins,
      ...(driveSettings.plugins || []).filter((p) => !localIds.has(p.id)),
    ];
    const settings = { ...driveSettings, plugins: mergedPlugins };
    const acceptLanguage = request.headers.get("Accept-Language");
    const effectiveLanguage = resolveLanguage(settings.language, acceptLanguage);

    return data(
      {
        settings: { ...settings, language: effectiveLanguage } as UserSettings,
        hasGeminiApiKey: !!validTokens.geminiApiKey,
        hasEncryptedApiKey: !!settings.encryptedApiKey,
        rootFolderId: validTokens.rootFolderId,
        isOffline: false,
        rootFolderMismatch,
      },
      { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined }
    );
  } catch (e) {
    if (e instanceof Response) throw e;
    // Network error (Google API unreachable) — return offline-compatible data
    // so the client can fall back to IndexedDB-cached settings.
    const acceptLanguage = request.headers.get("Accept-Language");
    return data({
      settings: { ...DEFAULT_USER_SETTINGS, language: resolveLanguage(null, acceptLanguage) } as UserSettings,
      hasGeminiApiKey: !!tokens.geminiApiKey,
      hasEncryptedApiKey: false,
      rootFolderId: tokens.rootFolderId,
      isOffline: true,
      rootFolderMismatch: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Client-side loader cache (with offline fallback via IndexedDB)
// ---------------------------------------------------------------------------

function getLocalStorageLanguage(): import("~/types/settings").Language | null {
  try {
    const v = localStorage.getItem("gemihub-language");
    if (v === "ja" || v === "en") return v;
  } catch { /* localStorage unavailable */ }
  return null;
}

type LoaderData = Awaited<ReturnType<Route.ClientLoaderArgs["serverLoader"]>>;
let cachedLoaderData: LoaderData | null = null;

/** In-memory access to loader data (avoids IndexedDB round-trip). */
export function getCachedLoaderDataInMemory(): LoaderData | null {
  return cachedLoaderData;
}

function applyLocalStorageLanguage(d: LoaderData): LoaderData {
  const lsLang = getLocalStorageLanguage();
  if (lsLang && d.settings.language !== lsLang) {
    return { ...d, settings: { ...d.settings, language: lsLang } };
  }
  return d;
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  if (cachedLoaderData) return applyLocalStorageLanguage(cachedLoaderData);

  try {
    const loaderData = await serverLoader();

    // Server indicated offline (Google API unreachable) — restore cached settings
    if (loaderData.isOffline) {
      const cached = await getCachedLoaderData();
      if (cached) {
        cachedLoaderData = applyLocalStorageLanguage({
          ...loaderData,
          settings: cached.settings as typeof loaderData.settings,
          hasGeminiApiKey: cached.hasGeminiApiKey,
          hasEncryptedApiKey: cached.hasEncryptedApiKey,

          rootFolderId: cached.rootFolderId,
          isOffline: true,
          rootFolderMismatch: null,
        });
        return cachedLoaderData;
      }
      // No IndexedDB cache — use default settings from server response
      cachedLoaderData = applyLocalStorageLanguage(loaderData);
      return cachedLoaderData;
    }

    // Online — cache for future offline use (geminiApiKey kept in-memory only)
    cachedLoaderData = applyLocalStorageLanguage(loaderData);
    setCachedLoaderData({
      id: "current",
      settings: loaderData.settings,
      hasGeminiApiKey: loaderData.hasGeminiApiKey,
      hasEncryptedApiKey: loaderData.hasEncryptedApiKey,
      rootFolderId: loaderData.rootFolderId,
      cachedAt: Date.now(),
    }).catch(() => {});
    return cachedLoaderData;
  } catch {
    // Server completely unreachable (SW served cached HTML) — try IndexedDB
    const cached = await getCachedLoaderData();
    if (cached) {
      cachedLoaderData = applyLocalStorageLanguage({
        settings: cached.settings as LoaderData["settings"],
        hasGeminiApiKey: cached.hasGeminiApiKey,
        hasEncryptedApiKey: cached.hasEncryptedApiKey,
        rootFolderId: cached.rootFolderId,
        isOffline: true,
        rootFolderMismatch: null,
      });
      return cachedLoaderData;
    }
    // Never loaded online before — return minimal offline data instead of
    // redirecting to /lp (which also fails offline and shows a blank page)
    if (!navigator.onLine) {
      cachedLoaderData = applyLocalStorageLanguage({
        settings: { ...DEFAULT_USER_SETTINGS, language: resolveLanguage(null, navigator.language) } as LoaderData["settings"],
        hasGeminiApiKey: false,
        hasEncryptedApiKey: false,
        rootFolderId: "",
        isOffline: true,
        rootFolderMismatch: null,
      });
      return cachedLoaderData;
    }
    throw redirect("/lp");
  }
}
clientLoader.hydrate = true;

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-gray-50 dark:bg-gray-950">
      <img src="/icons/icon-192x192.png" alt="" width={48} height={48} className="animate-pulse rounded" />
    </div>
  );
}

export function invalidateIndexCache() {
  cachedLoaderData = null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Index() {
  const data = useLoaderData<typeof loader>();

  return (
    <IDELayout
      settings={data.settings}
      hasGeminiApiKey={data.hasGeminiApiKey}
      hasEncryptedApiKey={data.hasEncryptedApiKey}
      rootFolderId={data.rootFolderId}
      initialOffline={data.isOffline}
      rootFolderMismatch={data.rootFolderMismatch}
    />
  );
}

// ---------------------------------------------------------------------------
// IDE Layout (authenticated)
// ---------------------------------------------------------------------------

function IDELayout({
  settings,
  hasGeminiApiKey: initialHasGeminiApiKey,
  hasEncryptedApiKey,
  rootFolderId,
  initialOffline,
  rootFolderMismatch,
}: {
  settings: UserSettings;
  hasGeminiApiKey: boolean;
  hasEncryptedApiKey: boolean;
  rootFolderId: string;
  initialOffline: boolean;
  rootFolderMismatch: { canonicalRootFolderId: string } | null;
}) {
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(initialHasGeminiApiKey);
  useApplySettings(settings.language ?? "en", settings.fontSize, settings.theme);

  // Right panel state — supports "chat", "workflow", or "plugin:{viewId}" for plugin sidebar views
  const [rightPanel, setRightPanel] = useState<RightPanelId>("chat");

  // Active file state (synced with URL, migration events, decryption events)
  const { activeFileId, activeFileName, activeFileMimeType, handleSelectFile, clearActiveFile } =
    useActiveFile({ rightPanel, setRightPanel });

  // Workflow version for refreshing MainViewer after sidebar edits
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const handleWorkflowChanged = useCallback(() => {
    setWorkflowVersion((v) => v + 1);
  }, []);

  // Sync state + dialog management
  const {
    syncStatus,
    lastSyncTime,
    conflicts,
    syncError,
    localModifiedCount,
    remoteModifiedCount,
    push,
    pull,
    resolveConflict,
    clearError,
    checkRemoteChanges,
    showConflictDialog,
    setShowConflictDialog,
    showPasswordPrompt,
    setShowPasswordPrompt,
    showPushRejected,
    setShowPushRejected,
    pullDialogTrigger,
    setPullDialogTrigger,
  } = useSyncUI();

  // AI Workflow dialog state + callbacks
  const {
    aiDialog,
    setAiDialog,
    handleNewWorkflow,
    handleModifyWithAI,
    handleAIAccept,
  } = useAIWorkflowDialog({ activeFileId, handleSelectFile, handleWorkflowChanged });

  return (
    <I18nProvider language={settings.language ?? "en"}>
      <EditorContextProvider>
      <PluginProvider pluginConfigs={settings.plugins || []} language={settings.language ?? "en"} hasPremium={settings.hubwork?.plan === "pro" || settings.hubwork?.plan === "granted"}>
      <SkillProvider rootFolderId={rootFolderId}>
      <IDEContent
        settings={settings}
        hasGeminiApiKey={hasGeminiApiKey}
        hasEncryptedApiKey={hasEncryptedApiKey}
        rootFolderId={rootFolderId}
        initialOffline={initialOffline}
        rootFolderMismatch={rootFolderMismatch}
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
        remoteModifiedCount={remoteModifiedCount}
        push={push}
        pull={pull}
        checkRemoteChanges={checkRemoteChanges}
        resolveConflict={resolveConflict}
        showConflictDialog={showConflictDialog}
        setShowConflictDialog={setShowConflictDialog}
        showPasswordPrompt={showPasswordPrompt}
        setShowPasswordPrompt={setShowPasswordPrompt}
        setHasGeminiApiKey={setHasGeminiApiKey}
        aiDialog={aiDialog}
        setAiDialog={setAiDialog}
        handleSelectFile={handleSelectFile}
        clearActiveFile={clearActiveFile}
        handleNewWorkflow={handleNewWorkflow}
        handleWorkflowChanged={handleWorkflowChanged}
        handleModifyWithAI={handleModifyWithAI}
        handleAIAccept={handleAIAccept}
        showPushRejected={showPushRejected}
        setShowPushRejected={setShowPushRejected}
        clearSyncError={clearError}
        pullDialogTrigger={pullDialogTrigger}
        setPullDialogTrigger={setPullDialogTrigger}
      />
      </SkillProvider>
      </PluginProvider>
      </EditorContextProvider>
    </I18nProvider>
  );
}

// ---------------------------------------------------------------------------
// IDE Content — separated to access PluginContext
// ---------------------------------------------------------------------------

type MobileView = "files" | "editor" | "chat" | "workflow";
const MOBILE_PANEL_COUNT = 3; // files(0), editor(1), right-panel(2)

function IDEContent({
  settings,
  hasGeminiApiKey,
  hasEncryptedApiKey,
  rootFolderId,
  initialOffline,
  rootFolderMismatch,
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
  remoteModifiedCount,
  push,
  pull,
  checkRemoteChanges,
  resolveConflict,
  showConflictDialog,
  setShowConflictDialog,
  showPasswordPrompt,
  setShowPasswordPrompt,
  setHasGeminiApiKey,
  aiDialog,
  setAiDialog,
  handleSelectFile,
  clearActiveFile,
  handleNewWorkflow,
  handleWorkflowChanged,
  handleModifyWithAI,
  handleAIAccept,
  showPushRejected,
  setShowPushRejected,
  clearSyncError,
  pullDialogTrigger,
  setPullDialogTrigger,
}: {
  settings: UserSettings;
  hasGeminiApiKey: boolean;
  hasEncryptedApiKey: boolean;
  rootFolderId: string;
  initialOffline: boolean;
  rootFolderMismatch: { canonicalRootFolderId: string } | null;
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
  remoteModifiedCount: number;
  push: () => void;
  pull: () => void;
  checkRemoteChanges: () => Promise<void>;
  resolveConflict: (fileId: string, resolution: "local" | "remote") => Promise<void>;
  showConflictDialog: boolean;
  setShowConflictDialog: (v: boolean) => void;
  showPasswordPrompt: boolean;
  setShowPasswordPrompt: (v: boolean) => void;
  setHasGeminiApiKey: (v: boolean) => void;
  aiDialog: AIDialogState | null;
  setAiDialog: (v: AIDialogState | null) => void;
  handleSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  clearActiveFile: () => void;
  handleNewWorkflow: () => void;
  handleWorkflowChanged: () => void;
  handleModifyWithAI: (yaml: string, name: string) => void;
  handleAIAccept: (yaml: string, name: string, meta: AIWorkflowMeta) => void;
  showPushRejected: boolean;
  setShowPushRejected: (v: boolean) => void;
  clearSyncError: () => void;
  pullDialogTrigger: number;
  setPullDialogTrigger: (v: number | ((prev: number) => number)) => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { sidebarViews, mainViews, getPluginAPI } = usePlugins();
  const { fileList } = useEditorContext();

  // On iOS Safari the layout viewport (and 100dvh) does NOT shrink when the
  // virtual keyboard appears.  Override the root container height with the
  // actual visible height so the entire flex layout (header + editor + nav)
  // fits within the visible area without body scroll.
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      const isKeyboardOpen = vv.height < window.innerHeight * 0.75;
      setVvHeight(isKeyboardOpen ? vv.height : null);
      if (isKeyboardOpen) {
        window.scrollTo(0, 0);
      }
    };
    vv.addEventListener("resize", handler);
    vv.addEventListener("scroll", handler);
    return () => {
      vv.removeEventListener("resize", handler);
      vv.removeEventListener("scroll", handler);
    };
  }, [isMobile]);

  // Online/offline state — starts from loader detection, updates with browser events
  const [isOffline, setIsOffline] = useState(initialOffline);
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Migrate offline-created new: files to Drive when back online
  usePendingFileMigration(isOffline);

  // Root folder mismatch dialog state (once confirmed, page reloads — no toggle needed)
  const showMismatchDialog = !!rootFolderMismatch;
  const [mismatchMigrating, setMismatchMigrating] = useState(false);

  const handleMismatchConfirm = useCallback(async () => {
    if (!rootFolderMismatch) return;
    setMismatchMigrating(true);
    try {
      const cachedFiles = await getAllCachedFiles();
      // Only migrate text files (skip binary/base64 files)
      const textFiles = cachedFiles
        .filter((f) => !f.encoding && !f.fileId.startsWith("new:"))
        .map((f) => ({ fileName: f.fileName || f.fileId, content: f.content }));
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "migrateRootFolder",
          newRootFolderId: rootFolderMismatch.canonicalRootFolderId,
          files: textFiles,
        }),
      });
      if (!res.ok) {
        setMismatchMigrating(false);
        return;
      }
      await clearAllCache();
      invalidateIndexCache();
      window.location.reload();
    } catch {
      setMismatchMigrating(false);
    }
  }, [rootFolderMismatch]);

  // Search panel state
  const [showSearch, setShowSearch] = useState(false);

  // Quick open state
  const [showQuickOpen, setShowQuickOpen] = useState(false);

  // Image picker state (for wysimark-lite file select)
  const [showImagePicker, setShowImagePicker] = useState(false);
  const imagePickerResolverRef = useRef<((url: string | null) => void) | null>(null);

  const imageFileList = useMemo(() => {
    const exts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];
    return fileList.filter((f) => exts.some((ext) => f.name.toLowerCase().endsWith(ext)));
  }, [fileList]);

  const handleImageFileSelect = useCallback((): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      imagePickerResolverRef.current = resolve;
      setShowImagePicker(true);
    });
  }, []);

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const res = await fetch("/api/drive/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create-image",
        name: file.name,
        data: base64,
        mimeType: file.type || "image/png",
      }),
    });
    if (!res.ok) throw new Error("Upload failed");
    const { file: driveFile, meta } = await res.json();

    // Cache binary in IndexedDB so it's marked as synced
    await setCachedFile({
      fileId: driveFile.id,
      content: base64,
      md5Checksum: driveFile.md5Checksum,
      modifiedTime: driveFile.modifiedTime,
      cachedAt: Date.now(),
      fileName: driveFile.name,
      encoding: "base64",
    });

    // Update localSyncMeta so the file doesn't appear as a pull candidate
    const localMeta = await getLocalSyncMeta();
    if (localMeta) {
      localMeta.files[driveFile.id] = {
        md5Checksum: driveFile.md5Checksum,
        modifiedTime: driveFile.modifiedTime,
      };
      localMeta.lastUpdatedAt = meta?.lastUpdatedAt || new Date().toISOString();
      await setLocalSyncMeta(localMeta);
    }

    // Update tree + remote meta cache without a network call
    if (meta) {
      window.dispatchEvent(new CustomEvent("tree-meta-updated", { detail: { meta } }));
    }
    window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: driveFile.id } }));

    return `/api/drive/files?action=raw&fileId=${driveFile.id}`;
  }, []);

  const activeFilePath = useMemo(() => {
    if (!activeFileId) return null;
    return fileList.find((f) => f.id === activeFileId)?.path ?? null;
  }, [activeFileId, fileList]);

  const ragStoreIds = useMemo(() => {
    if (!settings.ragEnabled) return [];
    const rs = settings.ragSettings?.["gemihub"];
    if (!rs?.storeId) return [];
    return [rs.storeId];
  }, [settings.ragEnabled, settings.ragSettings]);

  // Silent workflow execution status (for shortcut-triggered background execution)
  const [silentExecStatus, setSilentExecStatus] = useState<{ id: string; name: string; state: "running" | "done" | "error" } | null>(null);
  const [silentExecLogs, setSilentExecLogs] = useState<Array<{ nodeId: string; nodeType: string; message: string; status: "info" | "success" | "error"; timestamp: string; input?: Record<string, unknown>; output?: unknown }>>([]);
  const silentExecTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentExecAbortRef = useRef<AbortController | null>(null);
  const executeSilentWorkflow = useCallback((workflowId: string, workflowName: string) => {
    // Abort any previous silent execution
    silentExecAbortRef.current?.abort();
    setSilentExecStatus({ id: workflowId, name: workflowName, state: "running" });
    setSilentExecLogs([]);
    if (silentExecTimerRef.current) clearTimeout(silentExecTimerRef.current);
    const abortController = new AbortController();
    silentExecAbortRef.current = abortController;
    (async () => {
      try {
        const content = await readFileLocal(workflowId);
        const workflow = parseWorkflowYaml(content);
        const silentSettings = getCachedLoaderDataInMemory()?.settings as import("~/types/settings").UserSettings | undefined;
        const result = await executeWorkflowLocally(
          workflow,
          {
            onLog: (log) => { setSilentExecLogs((prev) => [...prev, { nodeId: log.nodeId, nodeType: log.nodeType, message: log.message, status: log.status, timestamp: log.timestamp.toISOString(), input: log.input, output: log.output }]); },
            onDriveEvent: (event) => { processDriveEvent(event).catch(() => {}); },
            promptCallbacks: {
              promptForValue: async () => null,
              promptForDialog: async () => null,
              promptForDriveFile: async () => {
                // Auto-respond with the currently open file
                if (activeFileIdRef.current) {
                  return {
                    id: activeFileIdRef.current,
                    name: activeFileNameRef.current ?? "",
                    mimeType: activeFileMimeTypeRef.current ?? "text/plain",
                  };
                }
                return null;
              },
              promptForDiff: async () => true, // Auto-approve in silent mode
              promptForPassword: async () => null,
            },
          },
          {
            workflowId,
            workflowName,
            abortSignal: abortController.signal,
            geminiApiKey: getCachedApiKey() || undefined,
            settings: silentSettings,
          },
        );
        if (abortController.signal.aborted) return;
        if (result.historyRecord.status === "completed") {
          setSilentExecStatus({ id: workflowId, name: workflowName, state: "done" });
          silentExecTimerRef.current = setTimeout(() => setSilentExecStatus(null), 3000);
          window.dispatchEvent(new Event("workflow-completed"));
        } else {
          setSilentExecStatus({ id: workflowId, name: workflowName, state: "error" });
          silentExecTimerRef.current = setTimeout(() => setSilentExecStatus(null), 5000);
        }
      } catch {
        if (abortController.signal.aborted) return;
        setSilentExecStatus({ id: workflowId, name: workflowName, state: "error" });
        silentExecTimerRef.current = setTimeout(() => setSilentExecStatus(null), 5000);
      }
    })();
  }, []);
  // Cleanup silent execution on unmount
  useEffect(() => {
    return () => {
      silentExecAbortRef.current?.abort();
      if (silentExecTimerRef.current) clearTimeout(silentExecTimerRef.current);
    };
  }, []);

  // Keyboard shortcut: Ctrl+Shift+F / Cmd+Shift+F to open search, Ctrl+P / Cmd+P to quick open
  // Also handles user-configured shortcut keys from settings
  const shortcutKeys = useMemo(() => settings.shortcutKeys ?? [], [settings.shortcutKeys]);
  const activeFileIdRef = useRef(activeFileId);
  activeFileIdRef.current = activeFileId;
  const activeFileNameRef = useRef(activeFileName);
  activeFileNameRef.current = activeFileName;
  const activeFileMimeTypeRef = useRef(activeFileMimeType);
  activeFileMimeTypeRef.current = activeFileMimeType;
  useEffect(() => {
    if (isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        setShowQuickOpen(true);
        return;
      }

      // User-configured shortcut keys
      for (const binding of shortcutKeys) {
        if (!binding.key) continue;
        const keyMatch = e.key.toLowerCase() === binding.key.toLowerCase();
        const ctrlMatch = binding.ctrlOrMeta ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
        const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = binding.alt ? e.altKey : !e.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          if (binding.action === "executeWorkflow") {
            const targetId = binding.targetFileId;
            const targetName = binding.targetFileName;
            if (binding.silent && targetId) {
              // Silent execution: run in background without opening the workflow
              executeSilentWorkflow(targetId, targetName || targetId);
            } else {
              // Normal execution: open the workflow file and dispatch event
              if (targetId && targetName && activeFileIdRef.current !== targetId) {
                handleSelectFile(targetId, targetName, "text/yaml");
              }
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent("shortcut-execute-workflow", {
                    detail: { fileId: targetId },
                  })
                );
              }, 0);
            }
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutKeys, handleSelectFile, executeSilentWorkflow, isMobile]);

  // Mobile view state: which panel is shown full-screen
  const [mobileView, setMobileView] = useState<MobileView>("editor");

  // Map mobileView to panel index: files=0, editor=1, chat/workflow/plugin=2
  const mobileViewToIndex = useCallback((view: MobileView): number => {
    if (view === "files") return 0;
    if (view === "editor") return 1;
    return 2; // chat, workflow
  }, []);
  const mobileIndex = mobileViewToIndex(mobileView);

  // Swipe animation state
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number; fromEdge: boolean } | null>(null);
  const swipeDirRef = useRef<"horizontal" | "vertical" | null>(null);
  const isAnimatingRef = useRef(false);

  // Apply transform without transition (for drag tracking)
  const applyTransform = useCallback((index: number, delta = 0) => {
    if (!containerRef.current) return;
    const offset = -(index * 100) / MOBILE_PANEL_COUNT;
    const deltaPct = (delta / window.innerWidth) * (100 / MOBILE_PANEL_COUNT);
    containerRef.current.style.transition = "none";
    containerRef.current.style.transform = `translateX(calc(${offset}% + ${deltaPct}%))`;
  }, []);

  // Animate to a panel index
  const animateTo = useCallback((index: number) => {
    if (!containerRef.current) return;
    isAnimatingRef.current = true;
    const offset = -(index * 100) / MOBILE_PANEL_COUNT;
    containerRef.current.style.transition = "transform 300ms ease-out";
    containerRef.current.style.transform = `translateX(${offset}%)`;
    const cleanup = () => { isAnimatingRef.current = false; };
    containerRef.current.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 350);
  }, []);

  // Sync container position with mobileIndex.
  // On first run (prevIndexRef is null), set position instantly (no animation).
  // On subsequent changes (bottom nav tap, etc.), animate to the target.
  const prevIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    if (prevIndexRef.current === null) {
      // Initial positioning — no transition to avoid flash
      const offset = -(mobileIndex * 100) / MOBILE_PANEL_COUNT;
      containerRef.current.style.transform = `translateX(${offset}%)`;
    } else if (prevIndexRef.current !== mobileIndex) {
      animateTo(mobileIndex);
    }
    prevIndexRef.current = mobileIndex;
  }, [mobileIndex, animateTo, isMobile]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isAnimatingRef.current) return;
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) { touchStartRef.current = null; return; }
    const touch = e.touches[0];
    const screenWidth = window.innerWidth;
    const edgeZone = screenWidth * 0.2; // 20% from each edge
    const fromEdge = touch.clientX < edgeZone || touch.clientX > screenWidth - edgeZone;
    // Only allow swipe from screen edges to avoid interfering with content interaction
    if (!fromEdge) {
      touchStartRef.current = null;
      return;
    }
    const edgeThreshold = 20;
    if (touch.clientX > edgeThreshold && touch.clientX < screenWidth - edgeThreshold) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now(), fromEdge };
      swipeDirRef.current = null;
    } else {
      touchStartRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      touchStartRef.current = null;
      swipeDirRef.current = null;
      return;
    }
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    // Lock direction once
    if (!swipeDirRef.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      swipeDirRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
    }

    if (swipeDirRef.current === "vertical") return;

    // Clamp at boundaries with resistance
    const idx = mobileIndex;
    let clamped = deltaX;
    if (idx === 0 && deltaX > 0) clamped = deltaX * 0.3; // resist left edge
    if (idx === MOBILE_PANEL_COUNT - 1 && deltaX < 0) clamped = deltaX * 0.3; // resist right edge

    applyTransform(idx, clamped);
  }, [mobileIndex, applyTransform]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    const wasTracking = swipeDirRef.current === "horizontal";
    const startedFromEdge = touchStartRef.current.fromEdge;
    touchStartRef.current = null;
    swipeDirRef.current = null;

    // Determine if swipe should trigger a panel change
    let shouldSwipe = false;
    if (wasTracking) {
      // touchMove reached us: use threshold + velocity
      const threshold = window.innerWidth * 0.25;
      const velocity = Math.abs(deltaX) / elapsed;
      shouldSwipe = Math.abs(deltaX) > threshold || (velocity > 0.3 && Math.abs(deltaX) > 30);
    } else if (startedFromEdge) {
      // touchMove was captured by inner element (e.g. editor):
      // fallback to simple start/end delta detection (only from edge swipes)
      shouldSwipe = Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) && elapsed < 300;
    }

    let nextIndex = mobileIndex;
    if (shouldSwipe) {
      if (deltaX > 0 && mobileIndex > 0) nextIndex = mobileIndex - 1;
      if (deltaX < 0 && mobileIndex < MOBILE_PANEL_COUNT - 1) nextIndex = mobileIndex + 1;
    }

    // Animate: snap back if tracking, or slide to next panel
    if (wasTracking || nextIndex !== mobileIndex) {
      animateTo(nextIndex);
    }

    if (nextIndex !== mobileIndex) {
      if (nextIndex === 0) setMobileView("files");
      else if (nextIndex === 1) setMobileView("editor");
      else {
        // Keep current rightPanel selection (chat/workflow/plugin)
        if (rightPanel === "chat") setMobileView("chat");
        else if (rightPanel === "workflow") setMobileView("workflow");
        else setMobileView("chat");
      }
      prevIndexRef.current = nextIndex;
    }
  }, [mobileIndex, animateTo, rightPanel]);

  // Listen for swipe events from iframes (e.g. HTML preview) via postMessage
  useEffect(() => {
    if (!isMobile) return;
    const handler = (e: Event) => {
      const dir = (e as CustomEvent).detail?.direction;
      let nextIndex = mobileIndex;
      if (dir === "right" && mobileIndex > 0) nextIndex = mobileIndex - 1;
      if (dir === "left" && mobileIndex < MOBILE_PANEL_COUNT - 1) nextIndex = mobileIndex + 1;
      if (nextIndex === mobileIndex) return;
      animateTo(nextIndex);
      if (nextIndex === 0) setMobileView("files");
      else if (nextIndex === 1) setMobileView("editor");
      else {
        if (rightPanel === "chat") setMobileView("chat");
        else if (rightPanel === "workflow") setMobileView("workflow");
        else setMobileView("chat");
      }
      prevIndexRef.current = nextIndex;
    };
    window.addEventListener("iframe-swipe", handler);
    return () => window.removeEventListener("iframe-swipe", handler);
  }, [isMobile, mobileIndex, animateTo, rightPanel]);

  // Mobile plugin menu state
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false);
  const pluginMenuRef = useRef<HTMLDivElement>(null);
  // Hide main views whose plugin already has a sidebar view (they auto-activate)
  const standaloneMainViews = mainViews.filter(
    (mv) => !sidebarViews.some((sv) => sv.pluginId === mv.pluginId),
  );
  const allPluginViews = [...sidebarViews, ...standaloneMainViews];

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

  // Close file panel after selecting a file on mobile
  const handleSelectFileMobile = useCallback(
    (fileId: string, fileName: string, mimeType: string) => {
      handleSelectFile(fileId, fileName, mimeType);
      if (isMobile) setMobileView("editor");
    },
    [handleSelectFile, isMobile]
  );

  // Determine if current right panel is a plugin view
  const activePluginSidebarView = rightPanel.startsWith("plugin:")
    ? sidebarViews.find((v) => `plugin:${v.id}` === rightPanel)
    : null;

  // Determine if current main view is a plugin view
  // Explicit selection via main-plugin: prefix, or auto-activate when sidebar plugin has a companion main view
  const activePluginMainView = (() => {
    if (rightPanel.startsWith("main-plugin:")) {
      return mainViews.find((v) => `main-plugin:${v.id}` === rightPanel) ?? null;
    }
    if (activePluginSidebarView) {
      const companion = mainViews.find((v) => v.pluginId === activePluginSidebarView.pluginId);
      if (!companion) return null;
      // If the companion defines supported extensions, only activate when file matches (or no file)
      if (companion.extensions?.length && activeFileName) {
        const ext = "." + (activeFileName.split(".").pop()?.toLowerCase() ?? "");
        if (!companion.extensions.includes(ext)) return null;
      }
      return companion;
    }
    return null;
  })();

  // Slash commands for ChatPanel (skills are added inside ChatPanel itself)
  const allSlashCommands = settings.slashCommands || [];

  // Shared components
  const fileTreeContent = (
    <DriveFileTreeWithContext
      rootFolderId={rootFolderId}
      onSelectFile={isMobile ? handleSelectFileMobile : handleSelectFile}
      activeFileId={activeFileId}
      encryptionEnabled={settings.encryption.enabled}
      onSearchOpen={() => setShowSearch(true)}
      showManagementFolders={settings.showManagementFolders}
    />
  );

  const searchPanelContent = (
    <SearchPanel
      apiPlan={settings.apiPlan}
      ragStoreIds={ragStoreIds}
      ragTopK={settings.ragTopK}
      fileList={fileList}
      onSelectFile={isMobile ? handleSelectFileMobile : handleSelectFile}
      onClose={() => setShowSearch(false)}
    />
  );

  const leftSidebarContent = showSearch ? searchPanelContent : fileTreeContent;

  const mainViewerContent = (
    <PanelErrorBoundary fallbackLabel="Error loading main viewer">
      {activePluginMainView ? (
        <div className="flex-1 overflow-auto p-4">
          {getPluginAPI(activePluginMainView.pluginId) ? (
            <activePluginMainView.component api={getPluginAPI(activePluginMainView.pluginId)!} language={settings.language ?? "en"} fileId={activeFileId ?? undefined} fileName={activeFileName ?? undefined} />
          ) : null}
        </div>
      ) : (
        <MainViewer
          fileId={activeFileId}
          fileName={activeFileName}
          fileMimeType={activeFileMimeType}
          settings={settings}
          refreshKey={workflowVersion}
          onFileSelect={handleImageFileSelect}
          onImageChange={handleImageUpload}
        />
      )}
    </PanelErrorBoundary>
  );

  const rightPanelContent = (
    <PanelErrorBoundary fallbackLabel="Error loading panel">
      {activePluginSidebarView ? (
        <div className="h-full overflow-auto p-2">
          {getPluginAPI(activePluginSidebarView.pluginId) ? (
            <activePluginSidebarView.component api={getPluginAPI(activePluginSidebarView.pluginId)!} language={settings.language ?? "en"} fileId={activeFileId ?? undefined} fileName={activeFileName ?? undefined} />
          ) : null}
        </div>
      ) : rightPanel === "chat" ? (
        <ChatPanel
          settings={settings}
          hasApiKey={hasGeminiApiKey}
          hasEncryptedApiKey={hasEncryptedApiKey}
          onNeedUnlock={() => setShowPasswordPrompt(true)}
          slashCommands={allSlashCommands}
          onSkillWorkflowStart={(workflowId, workflowName) => {
            if (silentExecTimerRef.current) clearTimeout(silentExecTimerRef.current);
            setSilentExecStatus({ id: workflowId, name: workflowName, state: "running" });
            setSilentExecLogs([]);
          }}
          onSkillWorkflowEnd={(workflowId, status) => {
            const state = status === "completed" ? "done" as const : "error" as const;
            setSilentExecStatus((prev) => ({ id: workflowId, name: prev?.name || workflowId, state }));
            silentExecTimerRef.current = setTimeout(() => setSilentExecStatus(null), state === "done" ? 3000 : 5000);
            if (state === "done") {
              window.dispatchEvent(new Event("workflow-completed"));
            }
          }}
          onSkillWorkflowLog={(log) => {
            setSilentExecLogs((prev) => [...prev, { nodeId: log.nodeId, nodeType: log.nodeType, message: log.message, status: log.status, timestamp: log.timestamp.toISOString(), input: log.input, output: log.output }]);
          }}
        />
      ) : (
        <WorkflowPropsPanel
          activeFileId={activeFileId}
          activeFileName={activeFileName}
          onNewWorkflow={handleNewWorkflow}
          onSelectFile={handleSelectFile}
          onWorkflowChanged={handleWorkflowChanged}
          onModifyWithAI={handleModifyWithAI}
          settings={settings}
          refreshKey={workflowVersion}
          externalExecStatus={
            silentExecStatus
              ? { fileId: silentExecStatus.id, state: silentExecStatus.state === "done" ? "done" : silentExecStatus.state === "error" ? "error" : "running" }
              : null
          }
          externalLogs={silentExecLogs}
        />
      )}
    </PanelErrorBoundary>
  );

  // Mobile bottom nav button helper
  const mobileTabClass = (isActive: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
      isActive
        ? "text-blue-600 dark:text-blue-400"
        : "text-gray-500 dark:text-gray-400"
    }`;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden overscroll-none bg-gray-50 dark:bg-gray-950"
      style={vvHeight !== null ? { height: `${vvHeight}px` } : undefined}
    >
      <Header
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
        activeFileId={activeFileId}
        syncStatus={syncStatus}
        lastSyncTime={lastSyncTime}
        syncError={syncError}
        syncConflicts={conflicts}
        localModifiedCount={localModifiedCount}
        remoteModifiedCount={remoteModifiedCount}
        onPush={push}
        onPull={pull}
        onShowConflicts={() => setShowConflictDialog(true)}
        onSelectFile={isMobile ? handleSelectFileMobile : handleSelectFile}
        onQuickOpen={() => setShowQuickOpen(true)}
        activeFilePath={activeFilePath}
        pluginSidebarViews={sidebarViews}
        pluginMainViews={mainViews}
        isMobile={isMobile}
        isOffline={isOffline}
        pullDialogTrigger={pullDialogTrigger}
        onLogoClick={isMobile ? () => setMobileView("files") : clearActiveFile}
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

      {isOffline && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs dark:border-amber-800 dark:bg-amber-900/20">
          <WifiOff size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-800 dark:text-amber-200">{t("offline.banner")}</span>
        </div>
      )}

      {silentExecStatus && (
        <div className={`flex items-center gap-2 border-b px-4 py-1.5 text-xs ${
          silentExecStatus.state === "running"
            ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
            : silentExecStatus.state === "done"
            ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
            : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
        }`}>
          {silentExecStatus.state === "running" && <Loader2 size={14} className="animate-spin text-blue-600 dark:text-blue-400" />}
          {silentExecStatus.state === "done" && <Check size={14} className="text-green-600 dark:text-green-400" />}
          {silentExecStatus.state === "error" && <AlertCircle size={14} className="text-red-600 dark:text-red-400" />}
          {(() => {
            const key = silentExecStatus.state === "running" ? "settings.shortcuts.executing"
              : silentExecStatus.state === "done" ? "settings.shortcuts.executionDone"
              : "settings.shortcuts.executionError";
            const textClass = silentExecStatus.state === "running" ? "text-blue-800 dark:text-blue-200"
              : silentExecStatus.state === "done" ? "text-green-800 dark:text-green-200"
              : "text-red-800 dark:text-red-200";
            const parts = t(key).split("{name}");
            return (
              <span className={textClass}>
                {parts[0]}
                <button
                  className="underline hover:no-underline font-medium"
                  onClick={() => {
                    handleSelectFile(silentExecStatus.id, silentExecStatus.name, "text/yaml");
                  }}
                >
                  {silentExecStatus.name}
                </button>
                {parts[1]}
              </span>
            );
          })()}
        </div>
      )}

      {isMobile ? (
        /* ---- Mobile layout ---- */
        <>
          <div
            className="flex-1 min-h-0 overflow-clip"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div
              ref={containerRef}
              className="flex h-full"
              style={{ width: `${MOBILE_PANEL_COUNT * 100}%` }}
            >
              {/* Panel 0: Files */}
              <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900" style={{ width: `${100 / MOBILE_PANEL_COUNT}%` }}>
                {leftSidebarContent}
              </div>
              {/* Panel 1: Editor */}
              <div className="relative flex h-full flex-col overflow-hidden" style={{ width: `${100 / MOBILE_PANEL_COUNT}%` }}>
                {mainViewerContent}
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("create-file-requested"))}
                  className="absolute bottom-4 right-4 z-10 rounded-full bg-blue-600 p-3 text-white shadow-lg hover:bg-blue-700 active:bg-blue-800"
                  title={t("fileTree.newFile")}
                >
                  <FilePlus size={ICON.LG} />
                </button>
              </div>
              {/* Panel 2: Right panel (chat / workflow / plugin) */}
              <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900" style={{ width: `${100 / MOBILE_PANEL_COUNT}%` }}>
                {rightPanelContent}
              </div>
            </div>
          </div>

          {/* Bottom navigation bar */}
          <nav className="flex shrink-0 border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 safe-area-bottom">
            <button
              onClick={() => setMobileView("files")}
              className={mobileTabClass(mobileView === "files")}
            >
              <FolderOpen size={ICON.LG} />
              {t("header.files")}
            </button>
            <button
              onClick={() => setMobileView("editor")}
              className={mobileTabClass(mobileView === "editor")}
            >
              <FileText size={ICON.LG} />
              {t("header.editor")}
            </button>
            <button
              onClick={() => { setRightPanel("chat"); setMobileView("chat"); }}
              className={mobileTabClass(mobileView === "chat")}
            >
              <MessageSquare size={ICON.LG} />
              {t("header.chat")}
            </button>
            <button
              onClick={() => { setRightPanel("workflow"); setMobileView("workflow"); }}
              className={mobileTabClass(mobileView === "workflow")}
            >
              <GitBranch size={ICON.LG} />
              {t("header.workflow")}
            </button>
            {allPluginViews.length > 0 && (
              <div className="relative flex flex-1" ref={pluginMenuRef}>
                <button
                  onClick={() => setPluginMenuOpen((v) => !v)}
                  className={mobileTabClass(
                    rightPanel.startsWith("plugin:") || rightPanel.startsWith("main-plugin:")
                  )}
                >
                  <Puzzle size={ICON.LG} />
                  {t("header.plugins")}
                </button>
                {pluginMenuOpen && (
                  <div className="absolute bottom-full left-1/2 z-50 mb-2 min-w-[160px] -translate-x-1/2 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {sidebarViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => {
                          setRightPanel(`plugin:${view.id}`);
                          setMobileView("chat");
                          setPluginMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          rightPanel === `plugin:${view.id}`
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                      >
                        <PluginIcon icon={view.icon} size={ICON.SM} className="shrink-0" />
                        {view.name}
                      </button>
                    ))}
                    {standaloneMainViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => {
                          setRightPanel(`main-plugin:${view.id}`);
                          setMobileView("editor");
                          setPluginMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
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
          </nav>
        </>
      ) : (
        /* ---- Desktop layout ---- */
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar - File tree / Search */}
          <LeftSidebar>
            {leftSidebarContent}
          </LeftSidebar>

          {/* Main viewer */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {mainViewerContent}
          </div>

          {/* Right sidebar - Chat / Workflow props / Plugin views */}
          <RightSidebar>
            {rightPanelContent}
          </RightSidebar>
        </div>
      )}

      {/* Conflict dialog */}
      {showConflictDialog && conflicts.length > 0 && (
        <ConflictDialog
          conflicts={conflicts}
          onResolve={resolveConflict}
          onClose={() => setShowConflictDialog(false)}
        />
      )}

      {/* Push rejected dialog */}
      {showPushRejected && (
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <div className="mb-4 flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle size={20} />
              <h3 className="text-base font-semibold">{t("settings.sync.pushRejected")}</h3>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowPushRejected(false); clearSyncError(); }}
                className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => { setShowPushRejected(false); clearSyncError(); setPullDialogTrigger(prev => prev + 1); }}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Pull
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Workflow dialog */}
      {aiDialog && (
        <AIWorkflowDialog
          mode={aiDialog.mode}
          currentYaml={aiDialog.currentYaml}
          currentName={aiDialog.currentName}
          workflowId={aiDialog.currentFileId}
          apiPlan={settings.apiPlan}
          encryptedPrivateKey={settings.encryption?.encryptedPrivateKey}
          salt={settings.encryption?.salt}
          onAccept={handleAIAccept}
          onClose={() => setAiDialog(null)}
        />
      )}

      {/* Quick open file picker */}
      <QuickOpenDialog
        open={showQuickOpen}
        onClose={() => setShowQuickOpen(false)}
        fileList={fileList}
        onSelectFile={isMobile ? handleSelectFileMobile : handleSelectFile}
      />

      {/* Image picker for wysimark-lite file select (z-[1001] to sit above wysimark dialog z-index:1000) */}
      <QuickOpenDialog
        open={showImagePicker}
        onClose={() => {
          setShowImagePicker(false);
          imagePickerResolverRef.current?.(null);
          imagePickerResolverRef.current = null;
        }}
        fileList={imageFileList}
        onSelectFile={(id) => {
          setShowImagePicker(false);
          const url = `/api/drive/files?action=raw&fileId=${id}`;
          imagePickerResolverRef.current?.(url);
          imagePickerResolverRef.current = null;
        }}
        zClass="z-[1001]"
      />

      {/* Root folder mismatch dialog */}
      {showMismatchDialog && rootFolderMismatch && (
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <div className="mb-3 flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle size={20} />
              <h3 className="text-base font-semibold">{t("rootMismatch.title")}</h3>
            </div>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
              {t("rootMismatch.description")}
            </p>
            <div className="flex justify-end">
              <button
                onClick={handleMismatchConfirm}
                disabled={mismatchMigrating}
                className="flex items-center gap-2 rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {mismatchMigrating && <Loader2 size={14} className="animate-spin" />}
                {mismatchMigrating ? t("rootMismatch.migrating") : t("rootMismatch.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password prompt for API key unlock */}
      {showPasswordPrompt && (
        <PasswordPromptDialog
          onSuccess={() => {
            setShowPasswordPrompt(false);
            setHasGeminiApiKey(true);
            // Refresh sync counts so the pull badge shows remote changes
            // (actual pull is left to the user via the pull dialog)
            checkRemoteChanges();
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
  onSearchOpen?: () => void;
  showManagementFolders?: boolean;
}) {
  const { setFileList } = useEditorContext();
  return (
    <DriveFileTree
      {...props}
      onFileListChange={setFileList}
    />
  );
}
