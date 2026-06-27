// Config editor for the `kanban` widget (folder source → status board).

import { useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../types";
import type { KanbanColumnConfig, KanbanWidgetConfig } from "./types";
import { FolderPicker } from "../widgets/config-editors/FolderPicker";
import { ColumnsEditor, FilterEditor, useFolderFields } from "./config-parts";

const DEFAULT_COLUMNS: KanbanColumnConfig[] = [
  { value: "todo", label: "To Do" },
  { value: "in-progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

function normalizeColumns(columns: KanbanWidgetConfig["columns"]): KanbanColumnConfig[] {
  const source = Array.isArray(columns) && columns.length > 0 ? columns : DEFAULT_COLUMNS;
  return source
    .map((col) => {
      if (typeof col === "string") return { value: col, label: col };
      return {
        value: typeof col.value === "string" ? col.value : "",
        label: typeof col.label === "string" ? col.label : "",
      };
    })
    .filter((col) => col.value.length > 0 || col.label.length > 0);
}

export function KanbanConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as KanbanWidgetConfig, [config]);
  const folder = cfg.folder ?? "";
  const columns = useMemo(() => normalizeColumns(cfg.columns), [cfg.columns]);
  const { fields, loading } = useFolderFields(folder);
  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const fieldTypeMap = useMemo(
    () => new Map(fields.map((f) => [f.name, f.type] as const)),
    [fields],
  );

  const update = useCallback(
    (patch: Partial<KanbanWidgetConfig>) => onChange({ ...cfg, ...patch }),
    [cfg, onChange],
  );

  const updateColumn = (index: number, patch: Partial<KanbanColumnConfig>) => {
    update({ columns: columns.map((col, i) => (i === index ? { ...col, ...patch } : col)) });
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    update({ columns: next });
  };

  const removeColumn = (index: number) => {
    update({ columns: columns.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.sourceFolder")}
        </label>
        <FolderPicker value={folder} onChange={(f) => update({ folder: f })} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.kanbanBoardTitle")}
        </label>
        <input
          type="text"
          required
          value={cfg.title ?? ""}
          onChange={(e) => update({ title: e.target.value })}
          placeholder={t("dashboard.kanbanBoardTitlePlaceholder")}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("dashboard.kanbanBoardTitleHint")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t("dashboard.kanbanStatusProperty")}
          </label>
          <select
            value={cfg.statusProperty ?? "status"}
            onChange={(e) => update({ statusProperty: e.target.value || "status" })}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="status">status</option>
            {fieldNames.filter((name) => name !== "status").map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t("dashboard.kanbanTitleProperty")}
          </label>
          <select
            value={cfg.titleProperty ?? "title"}
            onChange={(e) => update({ titleProperty: e.target.value || "title" })}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="title">title</option>
            <option value="file.name">file.name</option>
            {fieldNames.filter((name) => name !== "title").map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("dashboard.kanbanColumns")}
        </label>
        <div className="space-y-2">
          {columns.map((col, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] gap-1">
              <input
                type="text"
                value={col.value}
                onChange={(e) => updateColumn(index, { value: e.target.value })}
                placeholder={t("dashboard.kanbanColumnValue")}
                className="min-w-0 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <input
                type="text"
                value={col.label ?? ""}
                onChange={(e) => updateColumn(index, { label: e.target.value })}
                placeholder={t("dashboard.kanbanColumnLabel")}
                className="min-w-0 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={() => moveColumn(index, -1)}
                disabled={index === 0}
                title={t("dashboard.moveUp")}
                className="rounded border border-gray-300 p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveColumn(index, 1)}
                disabled={index === columns.length - 1}
                title={t("dashboard.moveDown")}
                className="rounded border border-gray-300 p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => removeColumn(index)}
                title={t("dashboard.deleteWidget")}
                className="rounded border border-red-200 p-1 text-red-500 hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/40"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => update({ columns: [...columns, { value: "", label: "" }] })}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Plus size={13} />
            {t("dashboard.kanbanAddColumn")}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={cfg.showUnspecified !== false}
          onChange={(e) => update({ showUnspecified: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {t("dashboard.kanbanShowUnspecified")}
      </label>

      <ColumnsEditor
        columns={cfg.displayFields ?? []}
        fieldNames={fieldNames}
        onChange={(displayFields) => update({ displayFields })}
      />

      <FilterEditor
        filters={cfg.filter ?? []}
        fieldNames={fieldNames}
        fieldTypeMap={fieldTypeMap}
        onChange={(filter) => update({ filter })}
      />

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("dashboard.limit")}
        </label>
        <input
          type="number"
          min={1}
          max={500}
          value={cfg.limit ?? ""}
          placeholder="100"
          onChange={(e) => {
            const value = e.target.value;
            update({ limit: value === "" ? undefined : Number(value) || 100 });
          }}
          onBlur={() => {
            if (cfg.limit == null) update({ limit: 100 });
          }}
          className="w-28 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {loading && (
        <p className="text-xs text-gray-400">{t("dashboard.loadingFields")}</p>
      )}
    </div>
  );
}
