// Base widget — renders an Obsidian Bases .base file view in the dashboard.
// Config: { base: "path/to/file.base", view: "ViewName" }

import { useState, useEffect, useMemo, useCallback } from "react";
import { Table as TableIcon, RefreshCw } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";
import { compileBase, queryView, createGemiHubHost } from "~/bases/index";
import type { CompiledBase, QueryResult, Diagnostic } from "~/bases/types";
import { BaseViewRenderer } from "~/components/bases/BaseViewRenderer";
import { getRemoteMetaFiles, readFileLocal } from "~/services/drive-local";
import { getCachedFile, getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { parseFrontmatter, isMarkdownFile } from "~/utils/frontmatter";
import { findBaseFileOption } from "./base-file-options";
import { FilePreviewModal } from "./FilePreviewModal";

interface BaseWidgetConfig {
  base?: string;
  view?: string;
}

interface VaultFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
}

export default function BaseWidget({
  config,
  ctx,
}: {
  config: unknown;
  ctx: WidgetContext;
}) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as BaseWidgetConfig, [config]);

  const [baseContent, setBaseContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewFile, setPreviewFile] = useState<{ fileId: string; fileName: string } | null>(null);

  // Load vault files
  const loadVaultFiles = useCallback(async () => {
    const metaFiles = await getRemoteMetaFiles();
    return Promise.all(Object.entries(metaFiles).map(async ([id, meta]) => {
      const vf: VaultFile = {
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        modifiedTime: meta.modifiedTime,
        createdTime: meta.createdTime,
      };
      // Load content for markdown files to get frontmatter
      if (isMarkdownFile(meta.name)) {
        try {
          const cached = await getCachedFile(id);
          vf.content = cached?.content ?? await readFileLocal(id);
          vf.frontmatter = cached?.frontmatter ?? parseFrontmatter(vf.content);
        } catch {
          // Keep the metadata row even when the body is not locally readable.
        }
      }
      return vf;
    }));
  }, []);

  // Load .base file content
  const loadBaseContent = useCallback(async (fileId: string) => {
    const cached = await getCachedFile(fileId);
    if (cached) return cached.content;
    return await readFileLocal(fileId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const files = await loadVaultFiles();
        if (cancelled) return;
        setVaultFiles(files);

        if (cfg.base) {
          const meta = await getCachedRemoteMeta();
          const found = meta ? findBaseFileOption(meta.files, cfg.base) : null;
          if (found) {
            const content = await loadBaseContent(found.id);
            if (cancelled) return;
            setBaseContent(content);
          } else {
            setBaseContent(null);
          }
        } else {
          setBaseContent(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cfg.base, loadVaultFiles, loadBaseContent, refreshKey]);

  // Compile the base
  const compiled = useMemo<CompiledBase | null>(() => {
    if (!baseContent) return null;
    try {
      return compileBase(baseContent);
    } catch {
      return null;
    }
  }, [baseContent]);

  // Check for compile errors
  const compileErrors = useMemo<Diagnostic[]>(() => {
    if (!compiled) return [];
    return compiled.diagnostics.filter((d) => d.severity === "error");
  }, [compiled]);

  // Determine the active view
  const viewName = cfg.view ?? compiled?.config.views[0]?.name;
  const views = compiled?.config.views ?? [];

  // Run the query
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

  // Render
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        <RefreshCw size={16} className="mr-2 animate-spin" />
        {t("dashboard.loading")}
      </div>
    );
  }

  if (!cfg.base) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-400">
        <TableIcon size={24} className="text-gray-300 dark:text-gray-600" />
        <span>{t("dashboard.baseSelectPlaceholder")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-red-500">
        <span className="font-medium">{t("dashboard.baseQueryError")}</span>
        <span className="text-xs text-gray-400">{error}</span>
      </div>
    );
  }

  if (compileErrors.length > 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-red-500">
        <span className="font-medium">{t("dashboard.baseCompileError")}</span>
        <span className="text-xs text-gray-400">{compileErrors[0].message}</span>
      </div>
    );
  }

  if (!queryResult || !viewName) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.baseNoViews")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with view selector + refresh */}
      <div className="flex items-center justify-between border-b border-gray-200 px-2 py-1 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <span className="truncate font-medium">{cfg.base}</span>
          {views.length > 1 && (
            <ViewSelector
              views={views.map((v) => v.name)}
              current={viewName}
              onSelect={(v) => ctx.onConfigChange?.({ ...cfg, view: v })}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* View body */}
      <div className="flex-1 overflow-auto">
        <div className="p-2">
          <BaseViewRenderer
            view={views.find((v) => v.name === viewName) ?? views[0]}
            result={queryResult}
            resolveFileRef={(entry) => fileRefsByPath.get(entry.file.path) ?? null}
            onOpenFile={setPreviewFile}
            resolveAssetUrl={resolveAssetUrl}
          />
        </div>
      </div>

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
    </div>
  );
}

// ---------------------------------------------------------------------------
// View selector dropdown
// ---------------------------------------------------------------------------

function ViewSelector({
  views,
  current,
  onSelect,
}: {
  views: string[];
  current: string;
  onSelect: (view: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={current}
        onChange={(e) => onSelect(e.target.value)}
        className="cursor-pointer rounded border-0 bg-transparent text-xs text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
      >
        {views.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}
