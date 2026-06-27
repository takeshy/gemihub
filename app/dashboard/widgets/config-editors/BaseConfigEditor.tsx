// Config editor for the Base widget. Existing base widgets edit the referenced
// .base file directly; changing widget type or swapping the base file is handled
// by deleting/recreating the widget.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import yaml from "js-yaml";
import { FileText, Plus, Sparkles, Trash2, Wand2, Wrench, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import { readFileLocal, writeFileLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { compileBase } from "~/bases/index";
import type { ViewConfig } from "~/bases/types";
import { collectBaseFileOptions, type BaseFileOption } from "../base-file-options";
import { DASHBOARD_BASE_FILE_UPDATED_EVENT } from "../base-events";

interface BaseWidgetConfig {
  base?: string;
  view?: string;
}

type EditableBaseConfig = Record<string, unknown> & {
  views: EditableBaseView[];
};

type EditableBaseView = Record<string, unknown> & {
  type: string;
  name: string;
  filters?: unknown;
  order?: string[];
  sort?: Array<{ property: string; direction: "ASC" | "DESC" }>;
  limit?: number;
};

type EditMode = "manual" | "ai";

export function BaseConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as BaseWidgetConfig, [config]);
  const [baseFiles, setBaseFiles] = useState<BaseFileOption[]>([]);
  const [views, setViews] = useState<string[]>([]);
  const [baseContent, setBaseContent] = useState("");
  const [baseConfig, setBaseConfig] = useState<EditableBaseConfig | null>(null);
  const [baseFileId, setBaseFileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("manual");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiWorking, setAiWorking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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
      const found = baseFiles.find((f) => f.name === cfg.base);
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
        setViews(compiled.config.views.map((v) => v.name));
        setBaseContent(content);
        setBaseConfig(parseEditableBase(content));
        setBaseFileId(found.id);
        setLoadError(null);
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
  }, [cfg.base, baseFiles]);

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

  const addView = () => {
    const current = baseConfig ?? { views: [] };
    const name = uniqueViewName(current.views, "Table");
    const nextView: EditableBaseView = { type: "table", name };
    void saveBaseConfig({ ...current, views: [...current.views, nextView] }, name);
  };

  const deleteActiveView = () => {
    if (!baseConfig || !activeView || baseConfig.views.length <= 1) return;
    const index = activeViewIndex >= 0 ? activeViewIndex : 0;
    const nextViews = baseConfig.views.filter((_, i) => i !== index);
    void saveBaseConfig({ ...baseConfig, views: nextViews }, nextViews[0]?.name ?? "");
  };

  const generateWithAI = async () => {
    if (!cfg.base || !baseContent || !aiPrompt.trim()) return;
    setAiWorking(true);
    setAiError(null);
    try {
      const res = await fetch("/api/base/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: aiPrompt,
          currentYaml: baseContent,
          fileName: cfg.base,
        }),
      });
      const data = await res.json() as { yaml?: string; error?: string };
      if (!res.ok || !data.yaml) {
        throw new Error(data.error || "Failed to generate base YAML.");
      }
      const nextConfig = parseEditableBase(data.yaml);
      await saveBaseConfig(nextConfig, nextConfig.views[0]?.name ?? "");
      setAiPrompt("");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiWorking(false);
    }
  };

  if (!cfg.base) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        {t("dashboard.baseSelectPlaceholder")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {views.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("dashboard.baseView")}
          </label>
          <select
            value={cfg.view ?? ""}
            onChange={(e) => onChange({ ...cfg, view: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value="">Auto (first view)</option>
            {views.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      )}

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
            <div className="text-xs text-gray-400">{saving ? "Saving..." : "Saved"}</div>
          </div>

          <div className="grid grid-cols-2 overflow-hidden rounded border border-gray-300 dark:border-gray-700">
            <ModeButton active={editMode === "manual"} onClick={() => setEditMode("manual")}>
              <Wrench size={13} />
              Manual
            </ModeButton>
            <ModeButton active={editMode === "ai"} onClick={() => setEditMode("ai")}>
              <Sparkles size={13} />
              AI
            </ModeButton>
          </div>

          {editMode === "ai" ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                AI request
              </label>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder='例: Projectsフォルダの未完了タスクを更新日順で表示するlistにして'
                rows={6}
                className="w-full resize-y rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              />
              <button
                type="button"
                onClick={generateWithAI}
                disabled={aiWorking || !aiPrompt.trim()}
                className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Wand2 size={14} />
                {aiWorking ? "Generating..." : "Apply with AI"}
              </button>
              {aiError && (
                <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {aiError}
                </div>
              )}
            </div>
          ) : (
            <ManualBaseEditor
              t={t}
              activeView={activeView}
              baseConfig={baseConfig}
              baseContent={baseContent}
              addView={addView}
              deleteActiveView={deleteActiveView}
              updateActiveView={updateActiveView}
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
          )}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1 px-2 py-1.5 text-xs ${
        active
          ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
          : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
      }`}
    >
      {children}
    </button>
  );
}

function ManualBaseEditor({
  t,
  activeView,
  baseConfig,
  baseContent,
  addView,
  deleteActiveView,
  updateActiveView,
  onRawChange,
}: {
  t: ReturnType<typeof useI18n>["t"];
  activeView: EditableBaseView;
  baseConfig: EditableBaseConfig;
  baseContent: string;
  addView: () => void;
  deleteActiveView: () => void;
  updateActiveView: (patch: Partial<EditableBaseView>, nextViewName?: string) => void;
  onRawChange: (nextContent: string) => void;
}) {
  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={addView}
          className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Plus size={12} />
          View
        </button>
        <button
          type="button"
          onClick={deleteActiveView}
          disabled={baseConfig.views.length <= 1}
          className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>

      <LabeledInput
        label="View name"
        value={activeView.name}
        onChange={(value) => updateActiveView({ name: value || activeView.name }, value || activeView.name)}
      />

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          View type
        </label>
        <select
          value={activeView.type}
          onChange={(e) => updateActiveView({ type: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          <option value="table">Table</option>
          <option value="cards">Cards</option>
          <option value="list">List</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Fields
        </label>
        <textarea
          value={(activeView.order ?? []).join("\n")}
          onChange={(e) => updateActiveView({ order: linesToList(e.target.value) })}
          placeholder={"file.name\nfile.mtime\nstatus"}
          rows={4}
          className="w-full resize-y rounded border border-gray-300 px-2 py-1 font-mono text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.filter")}
        </label>
        <textarea
          value={filterToText(activeView.filters)}
          onChange={(e) => updateActiveView({ filters: e.target.value.trim() || undefined })}
          placeholder='file.inFolder("Projects")'
          rows={3}
          className="w-full resize-y rounded border border-gray-300 px-2 py-1 font-mono text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("dashboard.sort")}
          </label>
          <button
            type="button"
            onClick={() => updateActiveView({ sort: [...(activeView.sort ?? []), { property: "file.mtime", direction: "DESC" }] })}
            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Add
          </button>
        </div>
        {(activeView.sort ?? []).length === 0 ? (
          <div className="text-xs text-gray-400">{t("dashboard.sortNone")}</div>
        ) : (
          (activeView.sort ?? []).map((sort, index) => (
            <div key={index} className="flex gap-1">
              <input
                value={sort.property}
                onChange={(e) => {
                  const next = [...(activeView.sort ?? [])];
                  next[index] = { ...sort, property: e.target.value };
                  updateActiveView({ sort: next });
                }}
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              />
              <select
                value={sort.direction}
                onChange={(e) => {
                  const next = [...(activeView.sort ?? [])];
                  next[index] = { ...sort, direction: e.target.value as "ASC" | "DESC" };
                  updateActiveView({ sort: next });
                }}
                className="rounded border border-gray-300 px-1 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                <option value="ASC">ASC</option>
                <option value="DESC">DESC</option>
              </select>
              <button
                type="button"
                onClick={() => updateActiveView({ sort: (activeView.sort ?? []).filter((_, i) => i !== index) })}
                className="rounded px-1 text-gray-400 hover:text-red-500"
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.limit")}
        </label>
        <input
          type="number"
          min={1}
          value={activeView.limit ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            updateActiveView({ limit: e.target.value === "" || !Number.isFinite(n) ? undefined : n });
          }}
          className="w-28 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        />
      </div>

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

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      />
    </div>
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

function linesToList(value: string): string[] | undefined {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function filterToText(filter: unknown): string {
  if (typeof filter === "string") return filter;
  if (filter == null) return "";
  return yaml.dump(filter, { schema: yaml.JSON_SCHEMA, lineWidth: -1 }).trim();
}

function uniqueViewName(views: Pick<ViewConfig, "name">[], base: string): string {
  const names = new Set(views.map((v) => v.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}
