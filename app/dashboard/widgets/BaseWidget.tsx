// Base widget — renders an Obsidian Bases .base file view in the dashboard.
// Config: { base: "path/to/file.base", view: "ViewName" }
// Empty/omitted view means the first view in the .base file.

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ArrowUpDown, FileText, Filter, Folder, RefreshCw, Search, Table as TableIcon, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";
import { compileBase, queryView, createGemiHubHost } from "~/bases/index";
import type { CompiledBase, QueryResult, Diagnostic, BaseEntry, Value, ViewConfig } from "~/bases/types";
import { BaseViewRenderer, entryPropertyText } from "~/components/bases/BaseViewRenderer";
import { getRemoteMetaFiles, readFileLocal } from "~/services/drive-local";
import { getCachedFile, getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { parseFrontmatter, isMarkdownFile } from "~/utils/frontmatter";
import { findBaseFileOption } from "./base-file-options";
import { FilePreviewModal } from "./FilePreviewModal";
import { DASHBOARD_BASE_FILE_UPDATED_EVENT } from "./base-events";
import { Popover, ViewControls, deriveFieldsFromRows } from "../data-widget/ViewControls";
import { FilterEditor } from "../data-widget/config-parts";
import { applyPostSource, detectFields } from "../data-widget/filter";
import type { DataRow, FieldInfo, FilterCondition, PropertyType } from "../data-widget/types";
import type { TranslationStrings } from "~/i18n/translations";

/** Which list-header popover is open: filename search, structured filter, or sort. */
type ListControl = "search" | "filter" | "sort" | null;

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

const FILE_LIST_SORT_OPTIONS: { value: string; labelKey: keyof TranslationStrings }[] = [
  { value: "-mtime", labelKey: "dashboard.sortModifiedNew" },
  { value: "mtime", labelKey: "dashboard.sortModifiedOld" },
  { value: "-ctime", labelKey: "dashboard.sortCreatedNew" },
  { value: "ctime", labelKey: "dashboard.sortCreatedOld" },
  { value: "name", labelKey: "dashboard.sortNameAz" },
  { value: "-name", labelKey: "dashboard.sortNameZa" },
];

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
  const [viewFilter, setViewFilter] = useState<FilterCondition[]>([]);
  const [viewSort, setViewSort] = useState<string | undefined>(undefined);
  const [viewLimit, setViewLimit] = useState<number | undefined>(undefined);
  const [listFilter, setListFilter] = useState("");
  const [listSort, setListSort] = useState<string | undefined>(undefined);
  const [listControl, setListControl] = useState<ListControl>(null);

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
  const requestedView = cfg.view?.trim();
  const viewName = requestedView || compiled?.config.views[0]?.name;
  const views = compiled?.config.views ?? [];
  const activeView = views.find((v) => v.name === viewName) ?? views[0];
  const isListView = activeView?.type === "list";

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

  useEffect(() => {
    setViewFilter([]);
    setViewSort(undefined);
    setViewLimit(undefined);
    setListFilter("");
    setListSort(undefined);
  }, [cfg.base, viewName]);

  useEffect(() => {
    const handleBaseUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ fileName?: string }>).detail;
      if (detail?.fileName?.toLowerCase() !== cfg.base?.toLowerCase()) return;
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener(DASHBOARD_BASE_FILE_UPDATED_EVENT, handleBaseUpdated);
    return () => {
      window.removeEventListener(DASHBOARD_BASE_FILE_UPDATED_EVENT, handleBaseUpdated);
    };
  }, [cfg.base]);

  const rowsById = useMemo(() => {
    if (!queryResult) return new Map<string, BaseEntry>();
    return new Map(queryResult.data.map((entry) => [entry.file.path, entry]));
  }, [queryResult]);

  const baseRows = useMemo<DataRow[]>(() => {
    if (!queryResult) return [];
    return queryResult.data.map((entry) => baseEntryToRow(entry));
  }, [queryResult]);

  const fields = useMemo(
    () => deriveFieldsFromRows(baseRows.map((row) => row.cells), true, detectFields),
    [baseRows],
  );

  const displayedResult = useMemo<QueryResult | null>(() => {
    if (!queryResult) return null;
    const rows = applyPostSource(baseRows, {
      filter: viewFilter,
      sort: viewSort,
      limit: viewLimit,
    });
    const data = rows
      .map((row) => rowsById.get(row.id))
      .filter((entry): entry is BaseEntry => !!entry);
    return {
      ...queryResult,
      data,
      groupedData: [],
    };
  }, [queryResult, baseRows, viewFilter, viewSort, viewLimit, rowsById]);

  const listEntries = useMemo(() => {
    if (!queryResult || !activeView) return [];
    const effectiveSort = listSort ?? "-mtime";
    const q = listFilter.trim().toLowerCase();
    const folder = extractFolderFilter(activeView);
    const displayName = (entry: BaseEntry) => fileListDisplayName(entry.file.path, folder);
    // Structured view-time filter (same FilterEditor as the other view types),
    // applied over the row cells; the text box stays a filename quick-search.
    const allowedIds = viewFilter.length > 0
      ? new Set(applyPostSource(baseRows, { filter: viewFilter }).map((r) => r.id))
      : null;
    const filtered = queryResult.data.filter((entry) => {
      if (allowedIds && !allowedIds.has(entry.file.path)) return false;
      if (q && !displayName(entry).toLowerCase().includes(q)) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => compareFileEntries(a, b, effectiveSort));
    return viewLimit && viewLimit > 0 ? sorted.slice(0, viewLimit) : sorted;
  }, [queryResult, activeView, listFilter, listSort, viewLimit, viewFilter, baseRows]);

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

  if (!queryResult || !displayedResult || !viewName || !activeView) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.baseNoViews")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with view selector + refresh */}
      {isListView ? (
        <BaseFileListHeader
          view={activeView}
          views={views}
          viewName={viewName}
          onSelectView={(v) => ctx.onConfigChange?.({ ...cfg, view: v })}
          filter={listFilter}
          onFilterChange={setListFilter}
          fields={fields}
          viewFilter={viewFilter}
          onViewFilterChange={setViewFilter}
          sort={listSort}
          onSortChange={setListSort}
          limit={viewLimit}
          onLimitChange={setViewLimit}
          openControl={listControl}
          onOpenControlChange={setListControl}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      ) : (
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
          <div className="flex items-center gap-1">
            <ViewControls
              fields={fields}
              isWorkflow={false}
              viewFilter={viewFilter}
              onViewFilterChange={setViewFilter}
              viewSort={viewSort}
              onViewSortChange={setViewSort}
            />
            <LimitInput limit={viewLimit} onLimitChange={setViewLimit} />
            <RefreshButton onClick={() => setRefreshKey((k) => k + 1)} />
          </div>
        </div>
      )}

      {/* View body */}
      <div className="flex-1 overflow-auto">
        {isListView ? (
          <BaseFileListBody
            entries={listEntries}
            folder={extractFolderFilter(activeView)}
            properties={Array.isArray(activeView.order) ? activeView.order : []}
            indent={activeView.indentProperties === true}
            onPreview={(entry) => setPreviewFile(fileRefsByPath.get(entry.file.path) ?? null)}
          />
        ) : (
        <div className="p-2">
          <BaseViewRenderer
            view={activeView}
            result={displayedResult}
            properties={compiled?.config.properties}
            resolveFileRef={(entry) => fileRefsByPath.get(entry.file.path) ?? null}
            onOpenFile={setPreviewFile}
            resolveAssetUrl={resolveAssetUrl}
          />
        </div>
        )}
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

function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
      title="Refresh"
    >
      <RefreshCw size={12} />
    </button>
  );
}

function LimitInput({
  limit,
  onLimitChange,
}: {
  limit: number | undefined;
  onLimitChange: (limit: number | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <input
      type="number"
      min={1}
      max={500}
      value={limit ?? ""}
      placeholder="Limit"
      onChange={(e) => {
        const value = e.target.value;
        onLimitChange(value === "" ? undefined : Number(value) || undefined);
      }}
      className="h-6 w-16 rounded border border-gray-200 bg-white px-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
      title={t("dashboard.limit")}
    />
  );
}

function BaseFileListHeader({
  view,
  views,
  viewName,
  onSelectView,
  filter,
  onFilterChange,
  fields,
  viewFilter,
  onViewFilterChange,
  sort,
  onSortChange,
  limit,
  onLimitChange,
  openControl,
  onOpenControlChange,
  onRefresh,
}: {
  view: ViewConfig;
  views: ViewConfig[];
  viewName: string;
  onSelectView: (view: string) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
  fields: FieldInfo[];
  viewFilter: FilterCondition[];
  onViewFilterChange: (next: FilterCondition[]) => void;
  sort: string | undefined;
  onSortChange: (sort: string | undefined) => void;
  limit: number | undefined;
  onLimitChange: (limit: number | undefined) => void;
  openControl: ListControl;
  onOpenControlChange: (next: ListControl) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const folder = extractFolderFilter(view);
  const effectiveSort = sort ?? "-mtime";
  const hasSearch = filter.trim().length > 0;
  const hasFilter = viewFilter.length > 0;
  const hasSort = !!sort;
  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const fieldTypeMap = useMemo(
    () => new Map(fields.map((f) => [f.name, f.type] as const)) as Map<string, PropertyType>,
    [fields],
  );
  const iconClass = (active: boolean) =>
    `relative flex items-center rounded px-1 py-0.5 ${
      active
        ? "text-blue-600 dark:text-blue-400"
        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
    }`;

  return (
    <div className="flex items-center gap-2 border-b border-gray-100 px-2 py-1 dark:border-gray-800">
      <span className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
        <Folder size={11} className="shrink-0" />
        <span className="truncate">{folder || "/"}</span>
        {views.length > 1 && (
          <ViewSelector
            views={views.map((v) => v.name)}
            current={viewName}
            onSelect={onSelectView}
          />
        )}
      </span>
      <button
        ref={searchBtnRef}
        type="button"
        onClick={() => onOpenControlChange(openControl === "search" ? null : "search")}
        title={t("search.title")}
        className={iconClass(hasSearch)}
      >
        <Search size={12} />
        {hasSearch && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />}
      </button>
      <button
        ref={filterBtnRef}
        type="button"
        onClick={() => onOpenControlChange(openControl === "filter" ? null : "filter")}
        title={t("dashboard.filter")}
        className={iconClass(hasFilter)}
      >
        <Filter size={12} />
        {hasFilter && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />}
      </button>
      <button
        ref={sortBtnRef}
        type="button"
        onClick={() => onOpenControlChange(openControl === "sort" ? null : "sort")}
        title={t("dashboard.sort")}
        className={iconClass(hasSort)}
      >
        <ArrowUpDown size={12} />
        {hasSort && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />}
      </button>
      <LimitInput limit={limit} onLimitChange={onLimitChange} />
      <RefreshButton onClick={onRefresh} />

      {openControl === "search" && (
        <Popover anchorRef={searchBtnRef} onClose={() => onOpenControlChange(null)}>
          <input
            type="text"
            autoFocus
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={t("search.title")}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </Popover>
      )}
      {openControl === "filter" && (
        <Popover anchorRef={filterBtnRef} onClose={() => onOpenControlChange(null)} widthClass="w-[28rem]">
          <FilterEditor
            filters={viewFilter}
            fieldNames={fieldNames}
            fieldTypeMap={fieldTypeMap}
            onChange={onViewFilterChange}
          />
        </Popover>
      )}
      {openControl === "sort" && (
        <Popover anchorRef={sortBtnRef} onClose={() => onOpenControlChange(null)}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("dashboard.sort")}</span>
            {hasSort && (
              <button
                type="button"
                onClick={() => onSortChange(undefined)}
                className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-red-500"
              >
                <X size={11} />
                {t("dashboard.viewSortReset")}
              </button>
            )}
          </div>
          {FILE_LIST_SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSortChange(opt.value)}
              className={`block w-full rounded px-2 py-1 text-left text-xs ${
                effectiveSort === opt.value
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

function BaseFileListBody({
  entries,
  folder,
  properties,
  indent,
  onPreview,
}: {
  entries: BaseEntry[];
  folder: string;
  properties: string[];
  indent: boolean;
  onPreview: (entry: BaseEntry) => void;
}) {
  const { t } = useI18n();
  // The first selected property is the parent (title row); the rest are children
  // (indented sub-lines when indent is on, else inline). Values only — no labels.
  const props = properties.length > 0 ? properties : ["file.name"];
  const parentProp = props[0];
  const childProps = props.slice(1);
  const isFileParent = parentProp === "file.name" || parentProp === "name";
  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.noFiles")}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {entries.map((entry) => {
        const name = fileListDisplayName(entry.file.path, folder);
        const parentText = isFileParent ? name : listCellValue(entry, parentProp);
        const children = childProps
          .map((prop) => listCellValue(entry, prop))
          .filter(Boolean);
        return (
          <li key={entry.file.path}>
            <button
              onClick={() => onPreview(entry)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div className="flex items-center gap-2">
                {isFileParent &&
                  (name.includes("/") ? (
                    <Folder size={14} className="shrink-0 text-blue-500" />
                  ) : (
                    <FileText size={14} className="shrink-0 text-gray-400" />
                  ))}
                <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{parentText}</span>
                {!indent && children.length > 0 && (
                  <span className="ml-auto max-w-[50%] shrink-0 truncate text-[11px] text-gray-400 dark:text-gray-500">
                    {children.join(" · ")}
                  </span>
                )}
              </div>
              {indent && children.length > 0 && (
                <div className="ml-6 mt-0.5 space-y-0.5">
                  {children.map((value, i) => (
                    <div key={i} className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {value}
                    </div>
                  ))}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Display value for a list-item property. mtime/ctime get the compact date
 * format; everything else (note frontmatter, file.*, and formulas) is resolved
 * through the shared base property resolver so e.g. formula.* values appear.
 */
function listCellValue(entry: BaseEntry, prop: string): string {
  if (prop === "file.mtime" || prop === "mtime") return formatModifiedTime(entry.file.mtimeMs);
  if (prop === "file.ctime" || prop === "ctime") return formatModifiedTime(entry.file.ctimeMs);
  return entryPropertyText(entry, prop);
}

function formatModifiedTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function baseEntryToRow(entry: BaseEntry): DataRow {
  const cells: Record<string, unknown> = {};
  for (const [key, value] of entry.rowScope.note.map.entries()) {
    const raw = baseValueToRaw(value);
    cells[key] = raw;
    cells[`note.${key}`] = raw;
  }
  return {
    id: entry.file.path,
    fileName: entry.file.name,
    mtime: entry.file.mtimeMs,
    ctime: entry.file.ctimeMs,
    cells,
  };
}

function extractFolderFilter(view: ViewConfig): string {
  const fromNode = (node: unknown): string | null => {
    if (typeof node === "string") {
      const match = node.match(/file\.inFolder\((["'])(.*?)\1\)/);
      return match?.[2] ?? null;
    }
    if (!node || typeof node !== "object") return null;
    const obj = node as { and?: unknown[]; or?: unknown[]; not?: unknown[] };
    for (const child of [...(obj.and ?? []), ...(obj.or ?? []), ...(obj.not ?? [])]) {
      const found = fromNode(child);
      if (found != null) return found;
    }
    return null;
  };
  return fromNode(view.filters) ?? "";
}

function fileListDisplayName(path: string, folder: string): string {
  return folder && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

function compareFileEntries(a: BaseEntry, b: BaseEntry, sort: string): number {
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  const av = key === "name" ? a.file.name.toLowerCase() : key === "ctime" ? a.file.ctimeMs : a.file.mtimeMs;
  const bv = key === "name" ? b.file.name.toLowerCase() : key === "ctime" ? b.file.ctimeMs : b.file.mtimeMs;
  let result = 0;
  if (av < bv) result = -1;
  else if (av > bv) result = 1;
  return desc ? -result : result;
}

function baseValueToRaw(value: Value): unknown {
  switch (value.type) {
    case "null":
      return null;
    case "boolean":
      return value.value;
    case "number":
      return value.value;
    case "string":
      return value.value;
    case "date":
      return value.epochMs;
    case "list":
      return value.items.map(baseValueToRaw);
    case "file":
      return value.path;
    case "link":
      return value.display ? baseValueToRaw(value.display) : value.target;
    case "url":
      return value.display ? baseValueToRaw(value.display) : value.url;
    case "image":
      return value.source;
    case "html":
      return value.source;
    case "icon":
      return value.name;
    default:
      return "";
  }
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
