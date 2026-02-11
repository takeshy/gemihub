import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { data, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/_index";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { getLocalPlugins } from "~/services/local-plugins.server";
import type { UserSettings } from "~/types/settings";
import { FolderOpen, FileText, MessageSquare, GitBranch, Puzzle, FilePlus } from "lucide-react";
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
import { SearchPanel } from "~/components/ide/SearchPanel";
import { QuickOpenDialog } from "~/components/ide/QuickOpenDialog";
import { PanelErrorBoundary } from "~/components/shared/PanelErrorBoundary";
import { useSync } from "~/hooks/useSync";
import { useIsMobile } from "~/hooks/useIsMobile";
import { ICON } from "~/utils/icon-sizes";

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
        settings,
        hasGeminiApiKey: !!validTokens.geminiApiKey,
        hasEncryptedApiKey: !!settings.encryptedApiKey,
        rootFolderId: validTokens.rootFolderId,
      },
      { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined }
    );
  } catch (e) {
    if (e instanceof Response) throw e;
    throw redirect("/lp");
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

  return (
    <IDELayout
      settings={data.settings}
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
  const [activeFileId, setActiveFileId] = useState<string | null>(() => {
    const fromUrl = searchParams.get("file");
    if (fromUrl) return fromUrl;
    if (typeof window !== "undefined") {
      return localStorage.getItem("gemihub:lastFileId");
    }
    return null;
  });
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [activeFileMimeType, setActiveFileMimeType] = useState<string | null>(
    null
  );

  // Right panel state — supports "chat", "workflow", or "plugin:{viewId}" for plugin sidebar views
  const [rightPanel, setRightPanel] = useState<RightPanelId>("chat");

  // Resolve file name when opened via URL (fileId present, fileName unknown)
  useEffect(() => {
    if (activeFileId?.startsWith("new:")) return; // Not yet on Drive
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

  // When a new: file is migrated to a real Drive ID, update active file state + URL
  useEffect(() => {
    const handler = (e: Event) => {
      const { oldId, newId, fileName, mimeType } = (e as CustomEvent).detail;
      setActiveFileId((prev) => (prev === oldId ? newId : prev));
      // Use base name (last segment) — fileName from Drive API may be a full path
      const baseName = fileName ? (fileName as string).split("/").pop()! : null;
      setActiveFileName((prev) => (prev === null && baseName ? baseName : prev));
      setActiveFileMimeType((prev) => (prev === null && mimeType ? mimeType : prev));
      // Update URL to use real Drive ID
      const url = new URL(window.location.href);
      if (url.searchParams.get("file") === oldId) {
        url.searchParams.set("file", newId);
        window.history.replaceState({}, "", url.toString());
      }
    };
    window.addEventListener("file-id-migrated", handler);
    return () => window.removeEventListener("file-id-migrated", handler);
  }, []);

  // When a file is permanently decrypted, update active file name (.encrypted removed)
  useEffect(() => {
    const handler = (e: Event) => {
      const { fileId: decryptedId, newName } = (e as CustomEvent).detail;
      if (decryptedId === activeFileId && newName) {
        const baseName = (newName as string).split("/").pop()!;
        setActiveFileName(baseName);
      }
    };
    window.addEventListener("file-decrypted", handler);
    return () => window.removeEventListener("file-decrypted", handler);
  }, [activeFileId]);

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

  // Auto-open conflict dialog when conflicts are detected
  useEffect(() => {
    if (syncStatus === "conflict" && conflicts.length > 0) {
      setShowConflictDialog(true);
    }
  }, [syncStatus, conflicts.length]);

  // AI Workflow dialog state
  const [aiDialog, setAiDialog] = useState<AIDialogState | null>(null);

  // ---- File selection ----
  const handleSelectFile = useCallback(
    (fileId: string, fileName: string, mimeType: string) => {
      setActiveFileId(fileId);
      setActiveFileName(fileName);
      setActiveFileMimeType(mimeType);
      // Remember last opened file for next visit
      localStorage.setItem("gemihub:lastFileId", fileId);
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
          console.log("[AI Accept] Updating existing file:", dialogState.currentFileId);
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
            console.log("[AI Accept] Drive update OK, md5:", resData.md5Checksum);
            // Update IndexedDB cache so the viewer picks up the new content
            await setCachedFile({
              fileId: dialogState.currentFileId,
              content: yamlContent,
              md5Checksum: resData.md5Checksum ?? "",
              modifiedTime: resData.file?.modifiedTime ?? "",
              cachedAt: Date.now(),
              fileName: resData.file?.name,
            });
            // Notify all useFileWithCache hooks so they pick up the new content
            window.dispatchEvent(
              new CustomEvent("file-restored", {
                detail: { fileId: dialogState.currentFileId, content: yamlContent },
              })
            );
            handleWorkflowChanged();
          } else {
            console.error("[AI Accept] Drive update failed:", res.status, await res.text().catch(() => ""));
          }
        } else {
          console.log("[AI Accept] Creating new file. dialogState:", dialogState?.mode, "fileId:", dialogState?.currentFileId);
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
      } catch (err) {
        console.error("[AI Accept] Error:", err);
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

type MobileView = "files" | "editor" | "chat" | "workflow";
const MOBILE_PANEL_COUNT = 3; // files(0), editor(1), right-panel(2)

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
  const isMobile = useIsMobile();
  const { sidebarViews, mainViews, slashCommands: pluginSlashCommands, getPluginAPI } = usePlugins();
  const { fileList } = useEditorContext();

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
    const { file: driveFile } = await res.json();
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

  // Keyboard shortcut: Ctrl+Shift+F / Cmd+Shift+F to open search, Ctrl+P / Cmd+P to quick open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        setShowSearch(true);
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        setShowQuickOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
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
    const touch = e.touches[0];
    const edgeThreshold = 20;
    const screenWidth = window.innerWidth;
    if (touch.clientX > edgeThreshold && touch.clientX < screenWidth - edgeThreshold) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      swipeDirRef.current = null;
    } else {
      touchStartRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
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
    touchStartRef.current = null;
    swipeDirRef.current = null;

    // Determine if swipe should trigger a panel change
    let shouldSwipe = false;
    if (wasTracking) {
      // touchMove reached us: use threshold + velocity
      const threshold = window.innerWidth * 0.25;
      const velocity = Math.abs(deltaX) / elapsed;
      shouldSwipe = Math.abs(deltaX) > threshold || (velocity > 0.3 && Math.abs(deltaX) > 30);
    } else {
      // touchMove was captured by inner element (e.g. editor):
      // fallback to simple start/end delta detection
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

  // Mobile plugin menu state
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false);
  const pluginMenuRef = useRef<HTMLDivElement>(null);
  const allPluginViews = [...sidebarViews, ...mainViews];

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
  const activePluginMainView = rightPanel.startsWith("main-plugin:")
    ? mainViews.find((v) => `main-plugin:${v.id}` === rightPanel)
    : null;

  // Merge plugin slash commands with settings slash commands for ChatPanel
  const allSlashCommands = settings.slashCommands || [];

  // Shared components
  const fileTreeContent = (
    <DriveFileTreeWithContext
      rootFolderId={rootFolderId}
      onSelectFile={isMobile ? handleSelectFileMobile : handleSelectFile}
      activeFileId={activeFileId}
      encryptionEnabled={settings.encryption.enabled}
      onSearchOpen={() => setShowSearch(true)}
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
          settings={settings}
          refreshKey={workflowVersion}
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
    <div className="fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-gray-50 dark:bg-gray-950">
      <Header
        rightPanel={rightPanel}
        setRightPanel={setRightPanel}
        activeFileId={activeFileId}
        syncStatus={syncStatus}
        lastSyncTime={lastSyncTime}
        syncError={syncError}
        syncConflicts={conflicts}
        localModifiedCount={localModifiedCount}
        onPush={push}
        onPull={pull}
        onShowConflicts={() => setShowConflictDialog(true)}
        onQuickOpen={() => setShowQuickOpen(true)}
        activeFilePath={activeFilePath}
        pluginSidebarViews={sidebarViews}
        pluginMainViews={mainViews}
        isMobile={isMobile}
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

      {isMobile ? (
        /* ---- Mobile layout ---- */
        <>
          <div
            className="flex-1 overflow-clip"
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
                        <Puzzle size={ICON.SM} className="shrink-0" />
                        {view.name}
                      </button>
                    ))}
                    {mainViews.map((view) => (
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
                        <Puzzle size={ICON.SM} className="shrink-0" />
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

      {/* AI Workflow dialog */}
      {aiDialog && (
        <AIWorkflowDialog
          mode={aiDialog.mode}
          currentYaml={aiDialog.currentYaml}
          currentName={aiDialog.currentName}
          workflowId={aiDialog.currentFileId}
          apiPlan={settings.apiPlan}
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

      {/* Image picker for wysimark-lite file select */}
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
      />

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
  onSearchOpen?: () => void;
}) {
  const { setFileList } = useEditorContext();
  return (
    <DriveFileTree
      {...props}
      onFileListChange={setFileList}
    />
  );
}
