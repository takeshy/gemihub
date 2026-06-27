// Editor for `.base` files. Defaults to a rendered view of the base ("display"),
// with a toggle to the raw YAML source ("raw"). Display mode renders the active
// view (table, cards, or list) using the Bases engine.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Code,
  Database,
  GitCompareArrows,
  History,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { compileBase, queryView, createGemiHubHost } from "~/bases/index";
import type { CompiledBase, QueryResult, Diagnostic } from "~/bases/types";
import { BaseViewRenderer } from "~/components/bases/BaseViewRenderer";
import { getRemoteMetaFiles, readFileLocal } from "~/services/drive-local";
import { getCachedFile } from "~/services/indexeddb-cache";
import { parseFrontmatter, isMarkdownFile } from "~/utils/frontmatter";
import { FilePreviewModal } from "~/dashboard/widgets/FilePreviewModal";
import { BaseConfigEditor } from "~/dashboard/widgets/config-editors/BaseConfigEditor";
import { DASHBOARD_BASE_FILE_UPDATED_EVENT } from "~/dashboard/widgets/base-events";

type ViewMode = "display" | "edit" | "raw";

interface VaultFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
}

export function BaseFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
  onDiffClick,
  onHistoryClick,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
  onDiffClick?: () => void;
  onHistoryClick?: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const compiled = useMemo<CompiledBase | null>(() => {
    try {
      return compileBase(content);
    } catch {
      return null;
    }
  }, [content]);
  const [viewMode, setViewMode] = useState<ViewMode>(compiled ? "display" : "raw");
  const [activeViewName, setActiveViewName] = useState<string | null>(
    compiled?.config.views[0]?.name ?? null,
  );
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewFile, setPreviewFile] = useState<{ fileId: string; fileName: string } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);
  const prevFileIdRef = useRef(fileId);

  useEffect(() => {
    const prev = prevFileIdRef.current;
    prevFileIdRef.current = fileId;
    if (prev.startsWith("new:") && !fileId.startsWith("new:")) return;
    contentFromProps.current = true;
    setContent(initialContent);
  }, [initialContent, fileId]);

  useEffect(() => {
    const onBaseUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ fileId?: string; fileName?: string }>).detail;
      if (detail?.fileId !== fileId && detail?.fileName !== fileName) return;
      void getCachedFile(fileId).then((cached) => {
        if (!cached) return;
        contentFromProps.current = true;
        setContent(cached.content);
      });
    };
    window.addEventListener(DASHBOARD_BASE_FILE_UPDATED_EVENT, onBaseUpdated);
    return () => window.removeEventListener(DASHBOARD_BASE_FILE_UPDATED_EVENT, onBaseUpdated);
  }, [fileId, fileName]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache, fileId]);

  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  // Load vault files for the query host (display/edit mode).
  useEffect(() => {
    if (viewMode === "raw") return;
    let cancelled = false;
    (async () => {
      setVaultLoading(true);
      try {
        const metaFiles = await getRemoteMetaFiles();
        const files = await Promise.all(
          Object.entries(metaFiles).map(async ([id, meta]) => {
            const vf: VaultFile = {
              id,
              name: meta.name,
              mimeType: meta.mimeType,
              modifiedTime: meta.modifiedTime,
              createdTime: meta.createdTime,
            };
            if (isMarkdownFile(meta.name)) {
              try {
                const cached = await getCachedFile(id);
                vf.content = cached?.content ?? await readFileLocal(id);
                vf.frontmatter = cached?.frontmatter ?? parseFrontmatter(vf.content);
              } catch {
                // keep metadata row even when body is unreadable
              }
            }
            return vf;
          }),
        );
        if (!cancelled) setVaultFiles(files);
      } finally {
        if (!cancelled) setVaultLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, refreshKey]);

  const updateRawContent = useCallback((next: string) => {
    contentFromProps.current = false;
    setContent(next);
  }, []);

  const compileErrors = useMemo<Diagnostic[]>(
    () => compiled?.diagnostics.filter((d) => d.severity === "error") ?? [],
    [compiled],
  );

  const views = useMemo(() => compiled?.config.views ?? [], [compiled]);
  const viewName = activeViewName ?? views[0]?.name ?? null;
  const activeView = views.find((v) => v.name === viewName) ?? views[0] ?? null;

  useEffect(() => {
    const firstViewName = views[0]?.name ?? null;
    if (!firstViewName) {
      if (activeViewName !== null) setActiveViewName(null);
      return;
    }
    if (activeViewName && views.some((v) => v.name === activeViewName)) return;
    setActiveViewName(firstViewName);
  }, [activeViewName, views]);

  const queryResult = useMemo<QueryResult | null>(() => {
    if (!compiled || !viewName || compileErrors.length > 0) return null;
    try {
      const { host, snapshot } = createGemiHubHost({
        files: vaultFiles,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: "en",
      });
      return queryView(compiled, viewName, host, snapshot);
    } catch {
      return null;
    }
  }, [compiled, viewName, vaultFiles, compileErrors]);

  const fileRefsByPath = useMemo(() => {
    const map = new Map<string, { fileId: string; fileName: string }>();
    for (const file of vaultFiles) {
      map.set(file.name, { fileId: file.id, fileName: file.name });
    }
    return map;
  }, [vaultFiles]);

  const assetByBasename = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of vaultFiles) {
      const base = file.name.includes("/") ? file.name.substring(file.name.lastIndexOf("/") + 1) : file.name;
      const key = base.toLowerCase();
      if (!map.has(key)) map.set(key, file.id);
    }
    return map;
  }, [vaultFiles]);

  const resolveAssetUrl = useCallback(
    (target: string): string | null => {
      if (!target) return null;
      let fileId = fileRefsByPath.get(target)?.fileId;
      if (!fileId) {
        const base = target.includes("/") ? target.substring(target.lastIndexOf("/") + 1) : target;
        fileId = assetByBasename.get(base.toLowerCase());
      }
      return fileId ? `/api/drive/files?action=raw&fileId=${encodeURIComponent(fileId)}` : null;
    },
    [fileRefsByPath, assetByBasename],
  );

  const navigateToFile = useCallback((file: { fileId: string; fileName: string }) => {
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: file.fileId, fileName: file.fileName },
      }),
    );
  }, []);

  const toggle = (
    <div className="flex items-center rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
      <button
        onClick={() => compiled && setViewMode("display")}
        disabled={!compiled}
        title={!compiled ? t("base.unparseable") : undefined}
        className={`flex items-center gap-1 px-2 py-1 text-xs ${
          viewMode === "display"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        } disabled:opacity-40`}
      >
        <Database size={ICON.SM} />
        {t("base.viewDisplay")}
      </button>
      <button
        onClick={() => compiled && setViewMode("edit")}
        disabled={!compiled}
        title={!compiled ? t("base.unparseable") : undefined}
        className={`flex items-center gap-1 px-2 py-1 text-xs ${
          viewMode === "edit"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        } disabled:opacity-40`}
      >
        <Pencil size={ICON.SM} />
        {t("base.viewEdit")}
      </button>
      <button
        onClick={() => setViewMode("raw")}
        className={`flex items-center gap-1 px-2 py-1 text-xs ${
          viewMode === "raw"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        }`}
      >
        <Code size={ICON.SM} />
        {t("base.viewRaw")}
      </button>
    </div>
  );

  const toolbar = (
    <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center gap-2 min-w-0">
        <Database size={14} className="text-gray-400 shrink-0" />
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
          {fileName.replace(/\.base$/i, "")}
        </span>
        {views.length > 1 && viewMode !== "raw" && (
          <select
            value={viewName ?? ""}
            onChange={(e) => setActiveViewName(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-600 bg-transparent text-xs text-gray-600 dark:text-gray-300 px-1 py-0.5"
          >
            {views.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        {viewMode !== "raw" && (
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t("base.refresh")}
          >
            <RefreshCw size={ICON.SM} />
          </button>
        )}
        {onHistoryClick && (
          <button
            onClick={onHistoryClick}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t("editHistory.menuLabel")}
          >
            <History size={ICON.SM} />
            <span className="hidden sm:inline">{t("editHistory.menuLabel")}</span>
          </button>
        )}
        {onDiffClick && (
          <button
            onClick={onDiffClick}
            className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t("mainViewer.diff")}
          >
            <GitCompareArrows size={ICON.SM} />
            {t("mainViewer.diff")}
          </button>
        )}
        {toggle}
      </div>
    </div>
  );

  const editPanel =
    viewMode === "edit" && compiled
      ? (
        <BaseEditSidePanel
          fileId={fileId}
          fileName={fileName}
          viewName={activeViewName ?? undefined}
          onViewChange={setActiveViewName}
          onClose={() => setViewMode("display")}
        />
      )
      : null;

  if (viewMode !== "raw" && compiled) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
        {toolbar}
        {vaultLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            <RefreshCw size={16} className="mr-2 animate-spin" />
            {t("base.loading")}
          </div>
        ) : compileErrors.length > 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-red-500">
            <span className="font-medium">{t("base.compileError")}</span>
            <span className="text-xs text-gray-400">{compileErrors[0].message}</span>
          </div>
        ) : !activeView ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {t("base.noViews")}
          </div>
        ) : !queryResult ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {t("base.queryError")}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-2">
            <BaseViewRenderer
              view={activeView}
              result={queryResult}
              properties={compiled?.config.properties}
              resolveFileRef={(entry) => fileRefsByPath.get(entry.file.path) ?? null}
              onOpenFile={setPreviewFile}
              resolveAssetUrl={resolveAssetUrl}
            />
          </div>
        )}
        {previewFile && (
          <FilePreviewModal
            fileId={previewFile.fileId}
            fileName={previewFile.fileName}
            onNavigate={() => {
              navigateToFile(previewFile);
              setPreviewFile(null);
            }}
            onClose={() => setPreviewFile(null)}
          />
        )}
        {editPanel}
      </div>
    );
  }

  // Raw YAML view
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {toolbar}
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => updateRawContent(e.target.value)}
          className="w-full h-full font-mono leading-relaxed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
          style={{ fontSize: "var(--user-font-size, 16px)" }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function BaseEditSidePanel({
  fileId,
  fileName,
  viewName,
  onViewChange,
  onClose,
}: {
  fileId: string;
  fileName: string;
  viewName?: string;
  onViewChange: (viewName: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const panel = (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full justify-end pointer-events-none">
      <div className="pointer-events-auto flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2">
            <Database size={ICON.MD} className="shrink-0 text-gray-500 dark:text-gray-400" />
            <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
              {fileName.replace(/\.base$/i, "")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title={t("common.close")}
          >
            <X size={ICON.LG} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
            {t("dashboard.settingsAutoSaved")}
          </p>
          <BaseConfigEditor
            config={{ base: fileName, baseFileId: fileId, view: viewName }}
            onChange={(next) => {
              const cfg = (next ?? {}) as { view?: unknown };
              if (typeof cfg.view === "string") onViewChange(cfg.view);
            }}
          />
        </div>

        <div className="flex justify-end border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("dashboard.done")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }
  return panel;
}
