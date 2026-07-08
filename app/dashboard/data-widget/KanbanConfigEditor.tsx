// Config editor for the `kanban` widget. Boards are always defined by a
// .kanban file (widget config: { kanban, cardOrder }); this editor edits the
// referenced file directly, mirroring BaseConfigEditor. Legacy inline configs
// are force-converted to a generated .kanban when the editor opens. The
// definition form (KanbanDefinitionFields) is shared with the standalone
// .kanban file editor (~/components/ide/editors/KanbanFileEditor).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../types";
import type { KanbanColumnConfig, KanbanWidgetConfig } from "./types";
import { FolderPicker } from "../widgets/config-editors/FolderPicker";
import { ColumnsEditor, FilterEditor, useFolderFields } from "./config-parts";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { findFileByNameLocal, readFileLocal, writeFileLocal } from "~/services/drive-local";
import {
  KANBAN_FILE_EXT,
  KANBAN_FOLDER,
  boardDefinitionFromConfig,
  collectKanbanFileOptions,
  kanbanFileBaseName,
  parseKanbanFile,
  serializeKanbanFile,
  type KanbanBoardDefinition,
  type KanbanFileOption,
} from "./kanban-file";
import { DASHBOARD_KANBAN_FILE_UPDATED_EVENT } from "./kanban-events";

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

/** Write a definition to a fresh uniquely-named .kanban under Dashboards/Kanbans/. */
async function writeDefinitionFile(def: KanbanBoardDefinition, widgetId: string): Promise<string> {
  const base = kanbanFileBaseName(def, widgetId);
  let candidate = `${KANBAN_FOLDER}/${base}${KANBAN_FILE_EXT}`;
  let index = 2;
  while (await findFileByNameLocal(candidate)) {
    candidate = `${KANBAN_FOLDER}/${base} ${index++}${KANBAN_FILE_EXT}`;
  }
  await writeFileLocal(candidate, serializeKanbanFile(def));
  window.dispatchEvent(
    new CustomEvent(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, { detail: { fileName: candidate } }),
  );
  return candidate;
}

export function KanbanConfigEditor({ config, onChange, widgetId }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as KanbanWidgetConfig, [config]);
  const kanbanPath = (cfg.kanban ?? "").trim();

  const [kanbanFiles, setKanbanFiles] = useState<KanbanFileOption[]>([]);
  const [definition, setDefinition] = useState<KanbanBoardDefinition | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    (async () => {
      const meta = await getCachedRemoteMeta();
      setKanbanFiles(meta ? collectKanbanFileOptions(meta.files) : []);
    })();
  }, []);

  // Legacy inline configs (pre-.kanban): force-convert to a generated file.
  const convertedRef = useRef(false);
  useEffect(() => {
    if (kanbanPath || convertedRef.current) return;
    const hasInlineDefinition = Boolean((cfg.folder ?? "").trim() || (cfg.title ?? "").trim());
    if (!hasInlineDefinition) return;
    convertedRef.current = true;
    void (async () => {
      const path = await writeDefinitionFile(boardDefinitionFromConfig(cfg), widgetId ?? "board");
      onChangeRef.current({ kanban: path, cardOrder: cfg.cardOrder });
    })();
  }, [kanbanPath, cfg, widgetId]);

  // Load the referenced .kanban file.
  useEffect(() => {
    if (!kanbanPath) {
      setDefinition(null);
      setFileId(null);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const found = await findFileByNameLocal(kanbanPath);
        if (!found) throw new Error("board file not found");
        const parsed = parseKanbanFile(await readFileLocal(found.id));
        if (cancelled) return;
        setFileId(found.id);
        setDefinition(parsed);
        setLoadError(parsed === null);
      } catch {
        if (!cancelled) {
          setDefinition(null);
          setFileId(null);
          setLoadError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kanbanPath]);

  // Form changes write back to the .kanban file (debounced, flush on unmount).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRef = useRef<KanbanBoardDefinition | null>(null);
  const persist = useCallback(
    async (def: KanbanBoardDefinition) => {
      if (!kanbanPath) return;
      setSaving(true);
      try {
        await writeFileLocal(
          kanbanPath,
          serializeKanbanFile(def),
          fileId ? { existingFileId: fileId } : undefined,
        );
        window.dispatchEvent(
          new CustomEvent(DASHBOARD_KANBAN_FILE_UPDATED_EVENT, {
            detail: { fileId, fileName: kanbanPath },
          }),
        );
      } finally {
        setSaving(false);
      }
    },
    [kanbanPath, fileId],
  );

  const updateDefinition = useCallback(
    (next: KanbanBoardDefinition) => {
      setDefinition(next);
      pendingRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) void persist(pending);
      }, 600);
    },
    [persist],
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pendingRef.current) {
        void persist(pendingRef.current);
        pendingRef.current = null;
      }
    },
    [persist],
  );

  const createNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const def: KanbanBoardDefinition = {
        title: newName.trim(),
        folder: "",
        statusProperty: "status",
        titleProperty: "title",
        columns: [...DEFAULT_COLUMNS],
        showUnspecified: true,
        displayFields: [],
        limit: 100,
      };
      const path = await writeDefinitionFile(def, widgetId ?? "board");
      setKanbanFiles((prev) =>
        prev.some((f) => f.name === path)
          ? prev
          : [...prev, { id: path, name: path }].sort((a, b) => a.name.localeCompare(b.name)),
      );
      onChange({ kanban: path, cardOrder: cfg.cardOrder });
    } finally {
      setCreating(false);
    }
  };

  if (!kanbanPath) {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.kanbanCreateNew")}
        </label>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createNew();
              }
            }}
            placeholder={t("dashboard.kanbanBoardTitlePlaceholder")}
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          />
          <button
            type="button"
            onClick={() => void createNew()}
            disabled={creating}
            className="flex shrink-0 items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} />
            {t("dashboard.baseCreate")}
          </button>
        </div>

        {kanbanFiles.length > 0 && (
          <div className="pt-1">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("dashboard.kanbanImportExisting")}
            </label>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onChange({ kanban: e.target.value, cardOrder: cfg.cardOrder });
              }}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              <option value="">{t("dashboard.kanbanPickFile")}</option>
              {kanbanFiles.map((f) => (
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
          <LayoutGrid size={14} className="shrink-0 text-gray-400" />
          <span className="truncate">{kanbanPath}</span>
        </div>
        <span className="shrink-0 text-xs text-gray-400">{saving ? "Saving..." : "Saved"}</span>
      </div>

      {loadError && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {t("dashboard.kanbanFileMissing")}
        </div>
      )}

      {definition && (
        <KanbanDefinitionFields value={definition} onChange={updateDefinition} />
      )}
    </div>
  );
}

/**
 * The board definition form (folder, title, properties, columns, filters,
 * limit). `value` may carry extra keys (e.g. the file's version); they are
 * passed through untouched on change.
 */
export function KanbanDefinitionFields({
  value,
  onChange,
}: {
  value: KanbanBoardDefinition;
  onChange: (next: KanbanBoardDefinition) => void;
}) {
  const { t } = useI18n();
  const folder = value.folder ?? "";
  const columns = useMemo(() => normalizeColumns(value.columns), [value.columns]);
  const { fields, loading } = useFolderFields(folder);
  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const fieldTypeMap = useMemo(
    () => new Map(fields.map((f) => [f.name, f.type] as const)),
    [fields],
  );

  const update = useCallback(
    (patch: Partial<KanbanBoardDefinition>) => onChange({ ...value, ...patch }),
    [value, onChange],
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
          value={value.title ?? ""}
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
            value={value.statusProperty ?? "status"}
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
            value={value.titleProperty ?? "title"}
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
          checked={value.showUnspecified !== false}
          onChange={(e) => update({ showUnspecified: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {t("dashboard.kanbanShowUnspecified")}
      </label>

      <ColumnsEditor
        columns={value.displayFields ?? []}
        fieldNames={fieldNames}
        onChange={(displayFields) => update({ displayFields })}
      />

      <FilterEditor
        filters={value.filter ?? []}
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
          value={value.limit ?? ""}
          placeholder="100"
          onChange={(e) => {
            const next = e.target.value;
            update({ limit: next === "" ? undefined : Number(next) || 100 });
          }}
          onBlur={() => {
            if (value.limit == null) update({ limit: 100 });
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
