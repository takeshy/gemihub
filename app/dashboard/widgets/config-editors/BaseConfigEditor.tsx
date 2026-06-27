// Config editor for the Base widget. Existing base widgets edit the referenced
// .base file directly; changing widget type or swapping the base file is handled
// by deleting/recreating the widget.

import { useEffect, useMemo, useRef, useState } from "react";
import yaml from "js-yaml";
import { FileText, GripVertical, Plus, Sparkles, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";
import type { ConfigEditorProps } from "../../types";
import { listFoldersLocal, readFileLocal, writeFileLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { compileBase } from "~/bases/index";
import type { FilterNode, PropertyConfig } from "~/bases/types";
import { collectBaseFileOptions, type BaseFileOption } from "../base-file-options";
import { DASHBOARD_BASE_FILE_UPDATED_EVENT } from "../base-events";
import { AIBaseDialog } from "./AIBaseDialog";
import {
  SortLimitFields,
  buildSortOptions,
  useFolderFields,
} from "../../data-widget/config-parts";
import { OPERATORS_BY_TYPE } from "../../data-widget/filter";
import type { FieldInfo, FilterCondition, FilterOp, PropertyType } from "../../data-widget/types";

interface BaseWidgetConfig {
  base?: string;
  baseFileId?: string;
  view?: string;
}

type EditableBaseConfig = Record<string, unknown> & {
  views: EditableBaseView[];
  formulas?: Record<string, string>;
  /** Base-level property config (display-name aliases, shared across views). */
  properties?: Record<string, PropertyConfig>;
};

/** Starter content for a newly created .base file (a simple table of recent files). */
const DEFAULT_BASE_YAML = `views:
  - type: table
    name: Table
    order:
      - file.name
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC
    limit: 50
`;

/** Pick a unique "<name>.base" file name not already present in the vault. */
function uniqueBaseFileName(existing: BaseFileOption[], desired: string): string {
  const names = new Set(existing.map((f) => f.name));
  const base = desired.trim() || "New Base";
  let name = `${base}.base`;
  let i = 2;
  while (names.has(name)) {
    name = `${base} ${i}.base`;
    i += 1;
  }
  return name;
}

type EditableBaseView = Record<string, unknown> & {
  type: string;
  name: string;
  filters?: unknown;
  order?: string[];
  sort?: Array<{ property: string; direction: "ASC" | "DESC" }>;
  limit?: number;
};

export function BaseConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as BaseWidgetConfig, [config]);
  const onChangeRef = useRef(onChange);
  const [baseFiles, setBaseFiles] = useState<BaseFileOption[]>([]);
  const [views, setViews] = useState<string[]>([]);
  const [baseContent, setBaseContent] = useState("");
  const [baseConfig, setBaseConfig] = useState<EditableBaseConfig | null>(null);
  const [baseFileId, setBaseFileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    (async () => {
      const meta = await getCachedRemoteMeta();
      setBaseFiles(meta ? collectBaseFileOptions(meta.files) : []);
    })();
  }, []);

  useEffect(() => {
    if (!cfg.base) {
      setViews([]);
      setBaseContent("");
      setBaseConfig(null);
      setBaseFileId(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const found = baseFiles.find((f) => f.name === cfg.base || f.id === cfg.baseFileId);
      if (!found) {
        setViews([]);
        setBaseContent("");
        setBaseConfig(null);
        setBaseFileId(null);
        return;
      }

      try {
        const { getCachedFile } = await import("~/services/indexeddb-cache");
        const cached = await getCachedFile(found.id);
        const content = cached?.content ?? await readFileLocal(found.id);
        if (cancelled) return;
        const compiled = compileBase(content);
        const nextViews = compiled.config.views.map((v) => v.name);
        setViews(nextViews);
        setBaseContent(content);
        setBaseConfig(parseEditableBase(content));
        setBaseFileId(found.id);
        setLoadError(null);
        if (nextViews.length > 0 && (!cfg.view || !nextViews.includes(cfg.view))) {
          onChangeRef.current({ ...cfg, view: nextViews[0] });
        }
      } catch (err) {
        if (cancelled) return;
        setViews([]);
        setBaseContent("");
        setBaseConfig(null);
        setBaseFileId(found.id);
        setLoadError(err instanceof Error ? err.message : "Failed to load base file.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg, baseFiles]);

  const activeViewName = cfg.view || views[0] || baseConfig?.views[0]?.name || "";
  const activeViewIndex = baseConfig?.views.findIndex((v) => v.name === activeViewName) ?? -1;
  const activeView =
    baseConfig && activeViewIndex >= 0
      ? baseConfig.views[activeViewIndex]
      : baseConfig?.views[0] ?? null;

  const saveBaseConfig = async (next: EditableBaseConfig, nextViewName?: string) => {
    if (!cfg.base || !baseFileId) return;
    setBaseConfig(next);
    const nextContent = dumpEditableBase(next);
    setBaseContent(nextContent);
    setViews(next.views.map((v) => v.name));
    if (nextViewName !== undefined) {
      onChange({ ...cfg, view: nextViewName });
    }

    setSaving(true);
    try {
      await writeFileLocal(cfg.base, nextContent, { existingFileId: baseFileId });
      window.dispatchEvent(
        new CustomEvent(DASHBOARD_BASE_FILE_UPDATED_EVENT, {
          detail: { fileId: baseFileId, fileName: cfg.base },
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const updateActiveView = (patch: Partial<EditableBaseView>, nextViewName?: string) => {
    if (!baseConfig || !activeView) return;
    const nextViews = [...baseConfig.views];
    const index = activeViewIndex >= 0 ? activeViewIndex : 0;
    nextViews[index] = cleanView({ ...activeView, ...patch });
    void saveBaseConfig({ ...baseConfig, views: nextViews }, nextViewName);
  };

  const updateProperties = (next: Record<string, PropertyConfig>) => {
    if (!baseConfig) return;
    const nextConfig: EditableBaseConfig = { ...baseConfig };
    if (Object.keys(next).length > 0) nextConfig.properties = next;
    else delete nextConfig.properties;
    void saveBaseConfig(nextConfig);
  };

  const applyAIYaml = async (yaml: string) => {
    const nextConfig = parseEditableBase(yaml);
    await saveBaseConfig(nextConfig, nextConfig.views[0]?.name ?? "");
  };

  const createNewBase = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const fileName = uniqueBaseFileName(baseFiles, newName);
      await writeFileLocal(fileName, DEFAULT_BASE_YAML);
      // Refresh options so the load effect (keyed on cfg.base + baseFiles) finds it.
      const meta = await getCachedRemoteMeta();
      setBaseFiles(meta ? collectBaseFileOptions(meta.files) : []);
      onChange({ ...cfg, base: fileName, view: "" });
    } finally {
      setCreating(false);
    }
  };

  if (!cfg.base) {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.baseCreateNew")}
        </label>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createNewBase();
              }
            }}
            placeholder="New Base"
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          />
          <button
            type="button"
            onClick={createNewBase}
            disabled={creating}
            className="flex shrink-0 items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} />
            {t("dashboard.baseCreate")}
          </button>
        </div>

        {baseFiles.length > 0 && (
          <div className="pt-1">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("dashboard.baseImportExisting")}
            </label>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onChange({ ...cfg, base: e.target.value, view: "" });
              }}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              <option value="">{t("dashboard.baseSelectFile")}</option>
              {baseFiles.map((f) => (
                <option key={f.id} value={f.name}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {views.length === 0 && !loadError && (
        <div className="text-xs text-gray-400">{t("dashboard.baseNoViews")}</div>
      )}

      {loadError && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {loadError}
        </div>
      )}

      {baseConfig && activeView && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              <FileText size={14} className="shrink-0 text-gray-400" />
              <span className="truncate">{cfg.base}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-gray-400">{saving ? "Saving..." : "Saved"}</span>
              <button
                type="button"
                onClick={() => setShowAI(true)}
                className="flex items-center gap-1 rounded border border-purple-300 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900/30"
              >
                <Sparkles size={13} />
                {t("dashboard.baseEditWithAi")}
              </button>
            </div>
          </div>

          <ManualBaseEditor
            t={t}
            activeView={activeView}
            baseConfig={baseConfig}
            baseContent={baseContent}
            updateActiveView={updateActiveView}
            updateProperties={updateProperties}
            onRawChange={(nextContent) => {
              setBaseContent(nextContent);
              try {
                const nextConfig = parseEditableBase(nextContent);
                setBaseConfig(nextConfig);
                void saveBaseConfig(nextConfig);
                setLoadError(null);
              } catch (err) {
                setLoadError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </div>
      )}

      {showAI && cfg.base && (
        <AIBaseDialog
          currentYaml={baseContent}
          fileName={cfg.base}
          onApply={applyAIYaml}
          onClose={() => setShowAI(false)}
        />
      )}
    </div>
  );
}

function ManualBaseEditor({
  t,
  activeView,
  baseConfig,
  baseContent,
  updateActiveView,
  updateProperties,
  onRawChange,
}: {
  t: ReturnType<typeof useI18n>["t"];
  activeView: EditableBaseView;
  baseConfig: EditableBaseConfig;
  baseContent: string;
  updateActiveView: (patch: Partial<EditableBaseView>, nextViewName?: string) => void;
  updateProperties: (next: Record<string, PropertyConfig>) => void;
  onRawChange: (nextContent: string) => void;
}) {
  const folder = useMemo(
    () => extractSourceFolder(activeView, baseConfig) ?? "",
    [activeView, baseConfig],
  );
  const { fields } = useFolderFields(folder);
  const formulaFields = useMemo<FieldInfo[]>(
    () => Object.keys(baseConfig.formulas ?? {}).map((name) => ({ name: `formula.${name}`, type: "string" })),
    [baseConfig.formulas],
  );
  const fieldsWithFormulas = useMemo(() => {
    const seen = new Set<string>();
    return [...fields, ...formulaFields].filter((field) => {
      if (seen.has(field.name)) return false;
      seen.add(field.name);
      return true;
    });
  }, [fields, formulaFields]);
  const fieldNames = useMemo(() => fieldsWithFormulas.map((f) => f.name), [fieldsWithFormulas]);
  const fieldTypeMap = useMemo(() => {
    const map = new Map<string, PropertyType>();
    for (const f of fieldsWithFormulas) map.set(f.name, f.type);
    return map;
  }, [fieldsWithFormulas]);

  const sortOptions = useMemo(() => buildSortOptions(fieldsWithFormulas, false), [fieldsWithFormulas]);
  const order = activeView.order ?? [];
  const setOrder = (next: string[]) => updateActiveView({ order: next.length > 0 ? next : undefined });

  const properties = (baseConfig.properties ?? {}) as Record<string, PropertyConfig>;
  const setAlias = (id: string, alias: string) => {
    const next: Record<string, PropertyConfig> = { ...properties };
    const trimmed = alias.trim();
    if (trimmed) {
      next[id] = { ...next[id], displayName: trimmed };
    } else if (next[id]) {
      const { displayName: _drop, ...rest } = next[id];
      if (Object.keys(rest).length > 0) next[id] = rest;
      else delete next[id];
    }
    updateProperties(next);
  };

  const viewType = activeView.type === "cards" || activeView.type === "list" ? activeView.type : "table";

  return (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          View type
        </label>
        <select
          value={viewType}
          onChange={(e) => updateActiveView({ type: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          <option value="table">Table</option>
          <option value="cards">Cards</option>
          <option value="list">List</option>
        </select>
      </div>

      <BaseFieldsEditor
        t={t}
        label={viewType === "table" ? t("dashboard.columns") : t("dashboard.baseProperties")}
        order={order}
        fieldNames={fieldNames}
        allowAlias={viewType === "table"}
        aliasFor={(id) => properties[id]?.displayName ?? ""}
        onOrderChange={setOrder}
        onAliasChange={setAlias}
      />

      {viewType === "cards" && (
        <BaseCardOptions t={t} view={activeView} fieldNames={fieldNames} updateActiveView={updateActiveView} />
      )}

      {viewType === "list" && (
        <BaseListOptions t={t} view={activeView} updateActiveView={updateActiveView} />
      )}

      <BaseFilterEditor
        t={t}
        filters={activeView.filters}
        fieldNames={fieldNames}
        fieldTypeMap={fieldTypeMap}
        onChange={(next) => updateActiveView({ filters: next })}
      />

      <SortLimitFields
        sort={baseSortToSortString(activeView.sort)}
        limit={activeView.limit}
        sortOptions={sortOptions}
        defaultSort=""
        onChange={(patch) => {
          const next: Partial<EditableBaseView> = {};
          if ("sort" in patch) next.sort = sortStringToBaseSort(patch.sort);
          if ("limit" in patch) next.limit = patch.limit;
          updateActiveView(next);
        }}
      />

      <details>
        <summary className="cursor-pointer text-xs text-gray-400">Raw base YAML</summary>
        <textarea
          value={baseContent}
          onChange={(e) => onRawChange(e.target.value)}
          rows={8}
          className="mt-1 w-full resize-y rounded border border-gray-300 px-2 py-1 font-mono text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        />
      </details>
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-type fields editor (table columns + alias / list & cards properties)
// ---------------------------------------------------------------------------

/** Strip the note./file./formula. prefix for a property's default label. */
function defaultPropLabel(propId: string): string {
  const dot = propId.indexOf(".");
  if (dot < 0) return propId;
  const prefix = propId.slice(0, dot);
  return prefix === "note" || prefix === "file" || prefix === "formula" ? propId.slice(dot + 1) : propId;
}

function BaseFieldsEditor({
  t,
  label,
  order,
  fieldNames,
  allowAlias,
  aliasFor,
  onOrderChange,
  onAliasChange,
}: {
  t: ReturnType<typeof useI18n>["t"];
  label: string;
  order: string[];
  fieldNames: string[];
  allowAlias: boolean;
  aliasFor: (id: string) => string;
  onOrderChange: (next: string[]) => void;
  onAliasChange: (id: string, alias: string) => void;
}) {
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const available = fieldNames.filter((f) => !order.includes(f));

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onOrderChange(next);
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {order.length === 0 && (
        <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{t("dashboard.baseFieldsAuto")}</p>
      )}
      <div className="space-y-1">
        {order.map((field, index) => (
          <div
            key={field}
            draggable
            onDragStart={() => { dragIndexRef.current = index; }}
            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={() => {
              if (dragIndexRef.current !== null) move(dragIndexRef.current, index);
              dragIndexRef.current = null;
              setDragOverIndex(null);
            }}
            className={`flex items-center gap-1.5 rounded border px-1.5 py-1 ${
              dragOverIndex === index
                ? "border-blue-400 bg-blue-50 dark:bg-blue-900/30"
                : "border-gray-200 dark:border-gray-700"
            }`}
          >
            <GripVertical size={12} className="shrink-0 cursor-move text-gray-400" />
            <span className={`truncate text-xs text-gray-700 dark:text-gray-300 ${allowAlias ? "w-28 shrink-0" : "flex-1"}`}>
              {field}
            </span>
            {allowAlias && (
              <input
                type="text"
                value={aliasFor(field)}
                placeholder={defaultPropLabel(field)}
                onChange={(e) => onAliasChange(field, e.target.value)}
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              />
            )}
            <RemoveTermButton onClick={() => onOrderChange(order.filter((_, i) => i !== index))} />
          </div>
        ))}
      </div>
      <select
        value=""
        onChange={(e) => { if (e.target.value) onOrderChange([...order, e.target.value]); }}
        disabled={available.length === 0}
        className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
      >
        <option value="">{t("dashboard.baseAddField")}</option>
        {available.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </div>
  );
}

function BaseCardOptions({
  t,
  view,
  fieldNames,
  updateActiveView,
}: {
  t: ReturnType<typeof useI18n>["t"];
  view: EditableBaseView;
  fieldNames: string[];
  updateActiveView: (patch: Partial<EditableBaseView>) => void;
}) {
  const imageProp = typeof view.image === "string" ? view.image : "";
  const imageFit = typeof view.imageFit === "string" ? view.imageFit : "cover";
  const imageAspectRatio = typeof view.imageAspectRatio === "string" ? view.imageAspectRatio : "16 / 9";
  const cardSize = typeof view.cardSize === "string" ? view.cardSize : "medium";
  const selectClass =
    "w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300";

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("dashboard.baseCardImage")}
        </label>
        <select
          value={imageProp}
          onChange={(e) => updateActiveView({ image: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">{t("dashboard.baseImageNone")}</option>
          {fieldNames.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("dashboard.baseCardImageFit")}
        </label>
        <select
          value={imageFit}
          onChange={(e) => updateActiveView({ imageFit: e.target.value })}
          className={selectClass}
        >
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
      </div>
      <div className="col-span-2">
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Image ratio
        </label>
        <select
          value={imageAspectRatio}
          onChange={(e) => updateActiveView({ imageAspectRatio: e.target.value })}
          className={selectClass}
        >
          <option value="16 / 9">16:9</option>
          <option value="4 / 3">4:3</option>
          <option value="1 / 1">1:1</option>
          <option value="3 / 2">3:2</option>
        </select>
      </div>
      <div className="col-span-2">
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("dashboard.baseCardSize")}
        </label>
        <select
          value={cardSize}
          onChange={(e) => updateActiveView({ cardSize: e.target.value })}
          className={selectClass}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </div>
    </div>
  );
}

function BaseListOptions({
  t,
  view,
  updateActiveView,
}: {
  t: ReturnType<typeof useI18n>["t"];
  view: EditableBaseView;
  updateActiveView: (patch: Partial<EditableBaseView>) => void;
}) {
  const indent = view.indentProperties === true;
  return (
    <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
      <input
        type="checkbox"
        checked={indent}
        onChange={(e) => updateActiveView({ indentProperties: e.target.checked ? true : undefined })}
        className="rounded border-gray-300 dark:border-gray-600"
      />
      {t("dashboard.baseListIndent")}
    </label>
  );
}

function parseEditableBase(content: string): EditableBaseConfig {
  const loaded = yaml.load(content, { schema: yaml.JSON_SCHEMA });
  const obj = loaded && typeof loaded === "object" && !Array.isArray(loaded)
    ? loaded as Record<string, unknown>
    : {};
  const views = Array.isArray(obj.views)
    ? obj.views
        .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v))
        .map(normalizeView)
    : [];
  return {
    ...obj,
    views: views.length > 0 ? views : [{ type: "table", name: "Table" }],
  };
}

function normalizeView(view: Record<string, unknown>): EditableBaseView {
  const type = typeof view.type === "string" && view.type ? view.type : "table";
  const name = typeof view.name === "string" && view.name ? view.name : "Table";
  const order = Array.isArray(view.order)
    ? view.order.filter((p): p is string => typeof p === "string" && p.length > 0)
    : undefined;
  const sort = Array.isArray(view.sort)
    ? view.sort
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
        .map((s) => ({
          property: typeof s.property === "string" ? s.property : "",
          direction: s.direction === "ASC" ? "ASC" as const : "DESC" as const,
        }))
        .filter((s) => s.property.length > 0)
    : undefined;
  const limit = typeof view.limit === "number" && Number.isFinite(view.limit) ? view.limit : undefined;
  return cleanView({ ...view, type, name, order, sort, limit });
}

function cleanView(view: EditableBaseView): EditableBaseView {
  const next: EditableBaseView = { ...view };
  if (!next.order || next.order.length === 0) delete next.order;
  if (!next.sort || next.sort.length === 0) delete next.sort;
  if (!next.filters || (typeof next.filters === "string" && next.filters.trim() === "")) delete next.filters;
  if (!next.limit || next.limit < 1) delete next.limit;
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  return next;
}

function dumpEditableBase(config: EditableBaseConfig): string {
  return yaml.dump(config, {
    schema: yaml.JSON_SCHEMA,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

// ---------------------------------------------------------------------------
// Source folder detection (for field suggestions)
// ---------------------------------------------------------------------------

/** Find the first `file.inFolder("...")` target in the view or global filters. */
function extractSourceFolder(view: EditableBaseView, baseConfig: EditableBaseConfig): string | null {
  return extractFolderFromNode(view.filters) ?? extractFolderFromNode(baseConfig.filters);
}

function extractFolderFromNode(node: unknown): string | null {
  if (typeof node === "string") {
    const m = node.match(/file\.inFolder\((["'])(.*?)\1\)/);
    return m?.[2] ?? null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as { and?: unknown[]; or?: unknown[]; not?: unknown[] };
  for (const child of [...(obj.and ?? []), ...(obj.or ?? []), ...(obj.not ?? [])]) {
    const found = extractFolderFromNode(child);
    if (found != null) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sort <-> base sort conversion (single primary key, like the table widget)
// ---------------------------------------------------------------------------

const BUILTIN_SORT_PROP: Record<string, string> = {
  mtime: "file.mtime",
  ctime: "file.ctime",
  name: "file.name",
};
const BUILTIN_SORT_KEY: Record<string, string> = {
  "file.mtime": "mtime",
  mtime: "mtime",
  "file.ctime": "ctime",
  ctime: "ctime",
  "file.name": "name",
  name: "name",
};

/** Base `sort` array -> single sort-string (e.g. `-mtime`). Uses the first key. */
function baseSortToSortString(sort: EditableBaseView["sort"]): string {
  const first = sort?.[0];
  if (!first) return "";
  const key = BUILTIN_SORT_KEY[first.property] ?? first.property;
  return `${first.direction === "DESC" ? "-" : ""}${key}`;
}

/** Single sort-string (e.g. `-mtime`) -> base `sort` array. */
function sortStringToBaseSort(value: string | undefined): EditableBaseView["sort"] {
  if (!value) return undefined;
  const desc = value.startsWith("-");
  const key = desc ? value.slice(1) : value;
  const property = BUILTIN_SORT_PROP[key] ?? key;
  return [{ property, direction: desc ? "DESC" : "ASC" }];
}

// ---------------------------------------------------------------------------
// Structured base filter editor
// ---------------------------------------------------------------------------
//
// A base `filters` value is a FilterNode: a string expression, or an
// `{ and | or | not: FilterNode[] }` combinator. The editor models a single
// top-level AND/OR group of "terms" — each term is a property comparison, a
// `file.inFolder(...)` / `file.hasTag(...)` predicate, or a raw node it can't
// parse (preserved verbatim, editable only via Raw base YAML). A top-level
// `not` group is not representable and falls back to a raw-YAML notice.

type Combinator = "and" | "or";

type BaseTerm =
  | { kind: "cmp"; cond: FilterCondition }
  | { kind: "inFolder"; value: string }
  | { kind: "hasTag"; value: string }
  | { kind: "raw"; node: FilterNode };

interface ParsedBaseFilter {
  combinator: Combinator;
  terms: BaseTerm[];
  /** False for a top-level `not` group — only Raw base YAML editing is offered. */
  representable: boolean;
}

const VALUELESS_OPS = new Set<FilterOp>(["empty", "notEmpty", "isTrue", "isFalse"]);
const INFOLDER_KEY = "@inFolder";
const HASTAG_KEY = "@hasTag";

const FILE_PREDICATE_LABELS: Record<string, keyof TranslationStrings> = {
  [INFOLDER_KEY]: "dashboard.baseFilterInFolder",
  [HASTAG_KEY]: "dashboard.baseFilterHasTag",
};

function parseBaseFilter(filters: unknown): ParsedBaseFilter {
  if (filters == null || filters === "") {
    return { combinator: "and", terms: [], representable: true };
  }
  if (typeof filters === "string") {
    return { combinator: "and", terms: [parseTermNode(filters)], representable: true };
  }
  if (filters && typeof filters === "object" && !Array.isArray(filters)) {
    const obj = filters as { and?: unknown[]; or?: unknown[]; not?: unknown[] };
    const combinator: Combinator | null = Array.isArray(obj.and)
      ? "and"
      : Array.isArray(obj.or)
        ? "or"
        : null;
    if (combinator) {
      const items = (combinator === "and" ? obj.and : obj.or) ?? [];
      return { combinator, terms: items.map(parseTermNode), representable: true };
    }
  }
  // Top-level `not`, arrays, or anything unexpected — preserve, edit via YAML.
  return { combinator: "and", terms: [{ kind: "raw", node: filters as FilterNode }], representable: false };
}

function parseTermNode(node: unknown): BaseTerm {
  if (typeof node !== "string") return { kind: "raw", node: node as FilterNode };
  const s = node.trim();
  const inF = s.match(/^file\.inFolder\((["'])(.*?)\1\)$/);
  if (inF) return { kind: "inFolder", value: inF[2] };
  const tag = s.match(/^file\.hasTag\((["'])(.*?)\1\)$/);
  if (tag) return { kind: "hasTag", value: tag[2] };
  const cond = parseConditionExpr(s);
  if (cond) return { kind: "cmp", cond };
  return { kind: "raw", node };
}

function termToNode(term: BaseTerm): FilterNode {
  switch (term.kind) {
    case "cmp": return conditionToExpr(term.cond);
    case "inFolder": return `file.inFolder(${lit(term.value)})`;
    case "hasTag": return `file.hasTag(${lit(term.value)})`;
    case "raw": return term.node;
  }
}

function serializeBaseFilter(combinator: Combinator, terms: BaseTerm[]): FilterNode | undefined {
  const nodes = terms.map(termToNode);
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  return { [combinator]: nodes } as FilterNode;
}

function rawNodeToText(node: FilterNode): string {
  return typeof node === "string" ? node : JSON.stringify(node);
}

/** All folder paths (recursively) from the cached vault meta, for the inFolder picker. */
function useAllFolders(): string[] {
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: string[] = [];
      const walk = async (parent: string) => {
        const children = await listFoldersLocal(parent || undefined);
        for (const child of children) {
          const path = parent ? `${parent}/${child}` : child;
          all.push(path);
          await walk(path);
        }
      };
      await walk("");
      if (!cancelled) setFolders(all.sort());
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return folders;
}

function BaseFilterEditor({
  t,
  filters,
  fieldNames,
  fieldTypeMap,
  onChange,
}: {
  t: ReturnType<typeof useI18n>["t"];
  filters: unknown;
  fieldNames: string[];
  fieldTypeMap: Map<string, PropertyType>;
  onChange: (next: FilterNode | undefined) => void;
}) {
  const parsed = useMemo(() => parseBaseFilter(filters), [filters]);
  const { combinator, terms, representable } = parsed;
  const folderOptions = useAllFolders();

  const commit = (nextCombinator: Combinator, nextTerms: BaseTerm[]) =>
    onChange(serializeBaseFilter(nextCombinator, nextTerms));
  const setTerm = (index: number, term: BaseTerm) =>
    commit(combinator, terms.map((c, i) => (i === index ? term : c)));
  const removeTerm = (index: number) =>
    commit(combinator, terms.filter((_, i) => i !== index));
  const addTerm = () => {
    const firstProp = fieldNames[0] ?? "";
    const propType = fieldTypeMap.get(firstProp) ?? "string";
    const op = OPERATORS_BY_TYPE[propType][0] ?? "eq";
    commit(combinator, [...terms, { kind: "cmp", cond: { property: firstProp, op } }]);
  };

  const onFieldChange = (index: number, value: string) => {
    if (value === INFOLDER_KEY) return setTerm(index, { kind: "inFolder", value: "" });
    if (value === HASTAG_KEY) return setTerm(index, { kind: "hasTag", value: "" });
    const newType = fieldTypeMap.get(value) ?? "string";
    const op = OPERATORS_BY_TYPE[newType][0] ?? "eq";
    setTerm(index, { kind: "cmp", cond: { property: value, op, value: undefined } });
  };

  const fieldSelect = (index: number, term: BaseTerm, selectedValue: string) => (
    <select
      value={selectedValue}
      onChange={(e) => onFieldChange(index, e.target.value)}
      className="min-w-0 px-2 py-1 pr-7 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
    >
      {term.kind === "cmp" && !fieldNames.includes(term.cond.property) && (
        <option value={term.cond.property}>{term.cond.property}</option>
      )}
      <optgroup label={t("dashboard.columns")}>
        {fieldNames.length === 0 && <option value="">{t("dashboard.noFields")}</option>}
        {fieldNames.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </optgroup>
      <optgroup label="file">
        <option value={INFOLDER_KEY}>{t("dashboard.baseFilterInFolder")}</option>
        <option value={HASTAG_KEY}>{t("dashboard.baseFilterHasTag")}</option>
      </optgroup>
    </select>
  );

  if (!representable) {
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.filter")}
        </label>
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {t("dashboard.baseAdvancedFilters")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.filter")}
        </label>
        {terms.length >= 2 && (
          <select
            value={combinator}
            onChange={(e) => commit(e.target.value as Combinator, terms)}
            className="px-1.5 py-0.5 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs"
          >
            <option value="and">{t("dashboard.baseFilterAnd")}</option>
            <option value="or">{t("dashboard.baseFilterOr")}</option>
          </select>
        )}
      </div>
      {terms.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("dashboard.noFilters")}</p>
      )}
      <div className="space-y-1.5">
        {terms.map((term, index) => {
          if (term.kind === "raw") {
            return (
              <div key={index} className="flex items-center gap-1.5">
                <span
                  title={rawNodeToText(term.node)}
                  className="flex-1 min-w-0 truncate rounded border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1 font-mono text-xs text-gray-500 dark:text-gray-400"
                >
                  {rawNodeToText(term.node)}
                </span>
                <span className="text-[10px] text-gray-400">YAML</span>
                <RemoveTermButton onClick={() => removeTerm(index)} />
              </div>
            );
          }
          if (term.kind === "inFolder") {
            const missing = term.value !== "" && !folderOptions.includes(term.value);
            return (
              <div key={index} className="grid grid-cols-[minmax(6.5rem,0.9fr)_minmax(8rem,1.6fr)_auto] items-center gap-1.5">
                {fieldSelect(index, term, INFOLDER_KEY)}
                <select
                  value={term.value}
                  onChange={(e) => setTerm(index, { ...term, value: e.target.value })}
                  className="min-w-0 px-2 py-1 pr-7 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
                >
                  <option value="">{t("dashboard.baseFilterSelectFolder")}</option>
                  {missing && <option value={term.value}>{term.value}</option>}
                  {folderOptions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <RemoveTermButton onClick={() => removeTerm(index)} />
              </div>
            );
          }
          if (term.kind === "hasTag") {
            return (
              <div key={index} className="grid grid-cols-[minmax(6.5rem,0.9fr)_minmax(8rem,1.6fr)_auto] items-center gap-1.5">
                {fieldSelect(index, term, HASTAG_KEY)}
                <input
                  type="text"
                  value={term.value}
                  placeholder={t(FILE_PREDICATE_LABELS[HASTAG_KEY])}
                  onChange={(e) => setTerm(index, { ...term, value: e.target.value })}
                  className="min-w-0 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
                />
                <RemoveTermButton onClick={() => removeTerm(index)} />
              </div>
            );
          }
          const cond = term.cond;
          const propType = fieldTypeMap.get(cond.property) ?? "string";
          const availableOps = OPERATORS_BY_TYPE[propType] ?? ["eq"];
          const needsValue = !VALUELESS_OPS.has(cond.op);
          return (
            <div key={index} className="grid grid-cols-[minmax(6.5rem,0.9fr)_minmax(5.5rem,0.7fr)_minmax(8rem,1.6fr)_auto] items-center gap-1.5">
              {fieldSelect(index, term, cond.property)}
              <select
                value={cond.op}
                onChange={(e) => setTerm(index, { kind: "cmp", cond: { ...cond, op: e.target.value as FilterOp } })}
                className="min-w-0 px-2 py-1 pr-7 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
              >
                {availableOps.map((op) => (
                  <option key={op} value={op}>{t(OP_LABEL_KEYS[op])}</option>
                ))}
              </select>
              {needsValue ? (
                <input
                  type={propType === "number" ? "number" : propType === "date" ? "date" : "text"}
                  value={cond.value == null ? "" : String(cond.value)}
                  onChange={(e) => {
                    let val: unknown = e.target.value;
                    if (propType === "number") val = Number(val);
                    setTerm(index, { kind: "cmp", cond: { ...cond, value: val } });
                  }}
                  className="min-w-0 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
                />
              ) : (
                <div />
              )}
              <RemoveTermButton onClick={() => removeTerm(index)} />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addTerm}
        className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        <Plus size={12} />
        {t("dashboard.addFilter")}
      </button>
    </div>
  );
}

function RemoveTermButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-gray-400 hover:text-red-500 p-1">
      <X size={12} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter expression <-> condition conversion
// ---------------------------------------------------------------------------

const OP_LABEL_KEYS: Record<FilterOp, keyof TranslationStrings> = {
  eq: "dashboard.opEq",
  neq: "dashboard.opNeq",
  contains: "dashboard.opContains",
  notContains: "dashboard.opNotContains",
  empty: "dashboard.opEmpty",
  notEmpty: "dashboard.opNotEmpty",
  gt: "dashboard.opGt",
  lt: "dashboard.opLt",
  gte: "dashboard.opGte",
  lte: "dashboard.opLte",
  isTrue: "dashboard.opIsTrue",
  isFalse: "dashboard.opIsFalse",
  before: "dashboard.opBefore",
  after: "dashboard.opAfter",
};

const PROP = String.raw`([A-Za-z_][\w.]*)`;

function parseConditionExpr(raw: string): FilterCondition | null {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^!\\s*${PROP}\\.isEmpty\\(\\)$`)))) return { property: m[1], op: "notEmpty" };
  if ((m = s.match(new RegExp(`^${PROP}\\.isEmpty\\(\\)$`)))) return { property: m[1], op: "empty" };
  if ((m = s.match(new RegExp(`^!\\s*${PROP}\\.contains\\((.+)\\)$`)))) return { property: m[1], op: "notContains", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\.contains\\((.+)\\)$`)))) return { property: m[1], op: "contains", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\s*>=\\s*(.+)$`)))) return { property: m[1], op: "gte", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\s*<=\\s*(.+)$`)))) return { property: m[1], op: "lte", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\s*!=\\s*(.+)$`)))) return { property: m[1], op: "neq", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\s*==\\s*(.+)$`)))) {
    const v = parseLiteral(m[2]);
    if (v === true) return { property: m[1], op: "isTrue" };
    if (v === false) return { property: m[1], op: "isFalse" };
    return { property: m[1], op: "eq", value: v };
  }
  if ((m = s.match(new RegExp(`^${PROP}\\s*<\\s*date\\((.+)\\)$`)))) return { property: m[1], op: "before", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\s*>\\s*date\\((.+)\\)$`)))) return { property: m[1], op: "after", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\s*<\\s*(.+)$`)))) return { property: m[1], op: "lt", value: parseLiteral(m[2]) };
  if ((m = s.match(new RegExp(`^${PROP}\\s*>\\s*(.+)$`)))) return { property: m[1], op: "gt", value: parseLiteral(m[2]) };
  return null;
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\(["'\\])/g, "$1");
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function conditionToExpr(c: FilterCondition): string {
  const p = c.property;
  switch (c.op) {
    case "empty": return `${p}.isEmpty()`;
    case "notEmpty": return `!${p}.isEmpty()`;
    case "contains": return `${p}.contains(${lit(c.value)})`;
    case "notContains": return `!${p}.contains(${lit(c.value)})`;
    case "eq": return `${p} == ${lit(c.value)}`;
    case "neq": return `${p} != ${lit(c.value)}`;
    case "gt": return `${p} > ${lit(c.value)}`;
    case "lt": return `${p} < ${lit(c.value)}`;
    case "gte": return `${p} >= ${lit(c.value)}`;
    case "lte": return `${p} <= ${lit(c.value)}`;
    case "isTrue": return `${p} == true`;
    case "isFalse": return `${p} == false`;
    case "before": return `${p} < date(${lit(c.value)})`;
    case "after": return `${p} > date(${lit(c.value)})`;
    default: return p;
  }
}

function lit(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value == null ? "" : String(value));
}
