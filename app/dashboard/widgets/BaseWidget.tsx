// Base widget — renders an Obsidian Bases .base file view in the dashboard.
// Config: { base: "path/to/file.base", view: "ViewName" }

import { useState, useEffect, useMemo, useCallback } from "react";
import { Table as TableIcon, RefreshCw } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";
import { compileBase, queryView, createGemiHubHost } from "~/bases/index";
import type { CompiledBase, QueryResult, BaseEntry, Value, Diagnostic } from "~/bases/types";
import { valueToString } from "~/bases/values";
import { getRemoteMetaFiles, readFileLocal } from "~/services/drive-local";
import { getCachedFile, getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { parseFrontmatter, isMarkdownFile } from "~/utils/frontmatter";
import { findBaseFileOption } from "./base-file-options";

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
    if (!compiled || !viewName || vaultFiles.length === 0 || compileErrors.length > 0) return null;
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

      {/* Table body */}
      <div className="flex-1 overflow-auto">
        {queryResult.groupedData.length > 0 ? (
          <GroupedTable
            groups={queryResult.groupedData}
            properties={queryResult.properties}
          />
        ) : (
          <BaseTable
            entries={queryResult.data}
            properties={queryResult.properties}
          />
        )}
      </div>
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

// ---------------------------------------------------------------------------
// Table rendering for Bases query results
// ---------------------------------------------------------------------------

function BaseTable({
  entries,
  properties,
}: {
  entries: BaseEntry[];
  properties: string[];
}) {
  if (entries.length === 0) {
    return <div className="p-4 text-center text-sm text-gray-400">No results</div>;
  }

  // Get column labels from properties
  const columns = properties.length > 0 ? properties : entries.length > 0
    ? [...entries[0].rowScope.note.map.keys()].map((k) => `note.${k}`)
    : ["file.name"];

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
        <tr>
          {columns.map((col) => (
            <th
              key={col}
              className="truncate px-2 py-1 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {formatPropertyLabel(col)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => (
          <tr
            key={entry.file.path + i}
            className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {columns.map((col) => (
              <td
                key={col}
                className="truncate px-2 py-1 text-gray-700 dark:text-gray-300"
              >
                {renderCellValue(getEntryProperty(entry, col))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GroupedTable({
  groups,
  properties,
}: {
  groups: Array<{ key: Value; entries: BaseEntry[]; summaries: Map<string, Value> }>;
  properties: string[];
}) {
  return (
    <div className="space-y-3 p-2">
      {groups.map((group, gi) => (
        <div key={gi}>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
            <span>{valueToString(group.key)}</span>
            <span className="text-gray-400">({group.entries.length})</span>
          </div>
          <BaseTable entries={group.entries} properties={properties} />
          {group.summaries.size > 0 && (
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
              {[...group.summaries.entries()].map(([prop, val]) => (
                <span key={prop} className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
                  {formatPropertyLabel(prop)}: {valueToString(val)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEntryProperty(entry: BaseEntry, propertyId: string): Value {
  const dotIdx = propertyId.indexOf(".");
  if (dotIdx < 0) {
    return entry.rowScope.note.map.get(propertyId) ?? { type: "null" };
  }
  const prefix = propertyId.substring(0, dotIdx);
  const name = propertyId.substring(dotIdx + 1);

  if (prefix === "note") {
    return entry.rowScope.note.map.get(name) ?? { type: "null" };
  }
  if (prefix === "file") {
    return resolveFileField(name, entry);
  }
  if (prefix === "formula") {
    return entry.rowScope.formula.resolve(name) ?? { type: "null" };
  }
  return { type: "null" };
}

function resolveFileField(field: string, entry: BaseEntry): Value {
  const file = entry.rowScope.file;
  switch (field) {
    case "name": return { type: "string", value: file.name };
    case "basename": return { type: "string", value: file.basename };
    case "path": return { type: "string", value: file.path };
    case "folder": return { type: "string", value: file.folder };
    case "ext": return { type: "string", value: file.ext };
    case "size": return { type: "number", value: file.size };
    case "ctime": return { type: "date", epochMs: file.ctimeMs, dateOnly: false };
    case "mtime": return { type: "date", epochMs: file.mtimeMs, dateOnly: false };
    default: return { type: "null" };
  }
}

function formatPropertyLabel(propId: string): string {
  const dotIdx = propId.indexOf(".");
  if (dotIdx < 0) return propId;
  const prefix = propId.substring(0, dotIdx);
  const name = propId.substring(dotIdx + 1);
  if (prefix === "note" || prefix === "file" || prefix === "formula") {
    return name;
  }
  return propId;
}

function renderCellValue(value: Value): string {
  if (value.type === "null") return "";
  if (value.type === "error") return "";
  if (value.type === "list") return value.items.map(renderCellValue).join(", ");
  if (value.type === "object") return "";
  return valueToString(value);
}
