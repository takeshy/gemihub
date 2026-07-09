// Editor for `.kanban` files. Mirrors BaseFileEditor's structure: a rendered
// board ("display", the kanban widget itself with the file's definition), an
// edit side panel over the shared definition form, and the raw YAML source.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Code, GitCompareArrows, History, LayoutGrid, Pencil, X } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import KanbanWidget from "~/dashboard/data-widget/KanbanWidget";
import { KanbanDefinitionFields } from "~/dashboard/data-widget/KanbanConfigEditor";
import {
  collectKanbanFileOptions,
  parseKanbanFile,
  serializeKanbanFile,
  type KanbanBoardDefinition,
  type KanbanFileOption,
} from "~/dashboard/data-widget/kanban-file";
import { DASHBOARD_KANBAN_FILE_UPDATED_EVENT } from "~/dashboard/data-widget/kanban-events";
import { getCachedFile, getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { Popover } from "~/dashboard/data-widget/ViewControls";

type ViewMode = "display" | "edit" | "raw";

export function KanbanFileEditor({
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
  const definition = useMemo(() => parseKanbanFile(content), [content]);
  const [viewMode, setViewMode] = useState<ViewMode>(definition ? "display" : "raw");
  const [kanbanFiles, setKanbanFiles] = useState<KanbanFileOption[]>([]);
  const [showKanbanMenu, setShowKanbanMenu] = useState(false);
  const kanbanButtonRef = useRef<HTMLButtonElement>(null);

  const refreshKanbanFiles = useCallback(async () => {
    const meta = await getCachedRemoteMeta();
    setKanbanFiles(meta ? collectKanbanFileOptions(meta.files) : []);
  }, []);

  const navigateToKanbanFile = useCallback((file: KanbanFileOption) => {
    setShowKanbanMenu(false);
    const baseName = file.name.split("/").pop() ?? file.name;
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: file.id, fileName: baseName },
      }),
    );
  }, []);

  useEffect(() => {
    void refreshKanbanFiles();
  }, [refreshKanbanFiles]);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);
  const prevFileIdRef = useRef(fileId);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    const prev = prevFileIdRef.current;
    prevFileIdRef.current = fileId;
    if (prev.startsWith("new:") && !fileId.startsWith("new:")) return;
    contentFromProps.current = true;
    setContent(initialContent);
  }, [initialContent, fileId]);

  // Pick up external writes (e.g. the widget config editor's "Save as .kanban
  // file"). Skips our own saves — the content is already in state.
  useEffect(() => {
    const onKanbanUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ fileId?: string; fileName?: string }>).detail;
      if (detail?.fileId !== fileId && detail?.fileName !== fileName) return;
      void getCachedFile(fileId).then((cached) => {
        if (!cached || cached.content === contentRef.current) return;
        contentFromProps.current = true;
        setContent(cached.content);
      });
    };
    window.addEventListener(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, onKanbanUpdated);
    return () => window.removeEventListener(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, onKanbanUpdated);
  }, [fileId, fileName]);

  // Debounced local-first save; also signals dashboard kanban widgets
  // referencing this file so they re-read the definition.
  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      void saveToCache(content).then(() => {
        window.dispatchEvent(
          new CustomEvent(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, { detail: { fileId, fileName } }),
        );
      });
      pendingContentRef.current = null;
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache, fileId, fileName]);

  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        void saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  const updateRawContent = useCallback((next: string) => {
    contentFromProps.current = false;
    setContent(next);
  }, []);

  const updateDefinition = useCallback(
    (next: KanbanBoardDefinition) => {
      updateRawContent(serializeKanbanFile(next));
    },
    [updateRawContent],
  );

  const toggle = (
    <div className="flex items-center rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
      <button
        onClick={() => definition && setViewMode("display")}
        disabled={!definition}
        title={!definition ? t("dashboard.kanbanFileMissing") : undefined}
        className={`flex items-center gap-1 px-2 py-1 text-xs ${
          viewMode === "display"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        } disabled:opacity-40`}
      >
        <LayoutGrid size={ICON.SM} />
        {t("base.viewDisplay")}
      </button>
      <button
        onClick={() => definition && setViewMode("edit")}
        disabled={!definition}
        title={!definition ? t("dashboard.kanbanFileMissing") : undefined}
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
        <button
          ref={kanbanButtonRef}
          type="button"
          onClick={() => {
            if (!showKanbanMenu) void refreshKanbanFiles();
            setShowKanbanMenu((v) => !v);
          }}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          title={fileName}
        >
          <LayoutGrid size={14} className="shrink-0 text-gray-400" />
          <span className="truncate">{fileName.replace(/\.kanban$/i, "")}</span>
          <ChevronDown size={12} className="shrink-0 text-gray-400" />
        </button>
        {showKanbanMenu && (
          <KanbanFilePopover
            anchorRef={kanbanButtonRef}
            files={kanbanFiles}
            current={fileName}
            onSelect={navigateToKanbanFile}
            onClose={() => setShowKanbanMenu(false)}
          />
        )}
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
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

  if (viewMode !== "raw" && definition) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
        {toolbar}
        <div className="flex-1 min-h-0 overflow-hidden">
          {/* The widget owns data loading, drag & drop writeback, New Card and
              the card modal. Manual card order is session-only here (no
              onConfigChange host). */}
          <KanbanWidget config={definition} />
        </div>
        {viewMode === "edit" && (
          <KanbanEditSidePanel
            fileName={fileName}
            definition={definition}
            onChange={updateDefinition}
            onClose={() => setViewMode("display")}
          />
        )}
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

function KanbanEditSidePanel({
  fileName,
  definition,
  onChange,
  onClose,
}: {
  fileName: string;
  definition: KanbanBoardDefinition;
  onChange: (next: KanbanBoardDefinition) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const panel = (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full justify-end pointer-events-none">
      <div className="pointer-events-auto flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2">
            <LayoutGrid size={ICON.MD} className="shrink-0 text-gray-500 dark:text-gray-400" />
            <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
              {fileName.replace(/\.kanban$/i, "")}
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
          <KanbanDefinitionFields value={definition} onChange={onChange} />
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

function kanbanDisplayName(fileName: string): string {
  return fileName.replace(/\.kanban$/i, "");
}

function KanbanFilePopover({
  anchorRef,
  files,
  current,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  files: KanbanFileOption[];
  current: string;
  onSelect: (file: KanbanFileOption) => void;
  onClose: () => void;
}) {
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} widthClass="w-80">
      <div className="max-h-64 overflow-auto py-0.5">
        {files.map((file) => (
          <button
            key={file.id}
            type="button"
            onClick={() => onSelect(file)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
              file.name === current
                ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
          >
            <LayoutGrid size={12} className="shrink-0 text-gray-400" />
            <span className="truncate">{kanbanDisplayName(file.name)}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
