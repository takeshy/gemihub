// Shared building blocks for the card / table / workflow config editors.
// Extracted from the former DataConfigEditor so the three editors compose the
// same Filter / Sort-Limit / Columns / Card-mapping sections.

import { useState, useEffect, useMemo, useRef } from "react";
import { X, Plus, GripVertical } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";
import type {
  FilterCondition,
  FilterOp,
  PropertyType,
  CardMapping,
  FieldInfo,
} from "../types";
import { OPERATORS_BY_TYPE } from "../filter";
import { scanFolderFields } from "../folder-source";

// --- Constants ---

export const OP_LABEL_KEYS: Record<FilterOp, keyof TranslationStrings> = {
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

const VALUELESS_OPS = new Set<FilterOp>(["empty", "notEmpty", "isTrue", "isFalse"]);

const CARD_FIELDS: { key: keyof CardMapping; labelKey: keyof TranslationStrings }[] = [
  { key: "title", labelKey: "dashboard.cardTitle" },
  { key: "subtitle", labelKey: "dashboard.cardSubtitle" },
  { key: "image", labelKey: "dashboard.cardImage" },
  { key: "body", labelKey: "dashboard.cardBody" },
];

const BUILTIN_SORT_OPTIONS = [
  { value: "-mtime", labelKey: "dashboard.sortModifiedNew" as const },
  { value: "mtime", labelKey: "dashboard.sortModifiedOld" as const },
  { value: "-ctime", labelKey: "dashboard.sortCreatedNew" as const },
  { value: "ctime", labelKey: "dashboard.sortCreatedOld" as const },
  { value: "name", labelKey: "dashboard.sortNameAz" as const },
  { value: "-name", labelKey: "dashboard.sortNameZa" as const },
];

export type SortOption = { value: string; labelKey?: keyof TranslationStrings };

/** Format a sort value as "property (asc)" or "property (desc)" for non-builtin keys. */
export function formatSortLabel(value: string): string {
  const desc = value.startsWith("-");
  const key = desc ? value.slice(1) : value;
  return `${key} (${desc ? "desc" : "asc"})`;
}

/**
 * Build the sort dropdown options.
 * Folder source: built-in file.* options + detected frontmatter keys.
 * Workflow source: only detected fields (no mtime/ctime/name builtins).
 */
export function buildSortOptions(fields: FieldInfo[], isWorkflow: boolean): SortOption[] {
  if (isWorkflow) {
    const opts: SortOption[] = [];
    for (const f of fields) {
      opts.push({ value: f.name });
      opts.push({ value: `-${f.name}` });
    }
    return opts;
  }
  const builtin: SortOption[] = BUILTIN_SORT_OPTIONS.map((o) => ({
    value: o.value,
    labelKey: o.labelKey,
  }));
  const fieldExtras: SortOption[] = [];
  for (const f of fields) {
    if (
      f.name === "file.name" || f.name === "name" ||
      f.name === "file.mtime" || f.name === "mtime" ||
      f.name === "file.ctime" || f.name === "ctime"
    ) continue;
    fieldExtras.push({ value: f.name });
    fieldExtras.push({ value: `-${f.name}` });
  }
  return [...builtin, ...fieldExtras];
}

// --- Folder field detection hook ---

/**
 * Detect typed fields from a folder's frontmatter cache for editor suggestions.
 * Built-in file.* keys are forced to their semantic types (date for mtime/ctime).
 */
export function useFolderFields(folder: string): { fields: FieldInfo[]; loading: boolean } {
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const detected = await scanFolderFields(folder);
      if (cancelled) return;
      const builtins: FieldInfo[] = [
        { name: "file.name", type: "string" },
        { name: "file.mtime", type: "date" },
        { name: "file.ctime", type: "date" },
      ];
      const builtinSet = new Set(builtins.map((b) => b.name));
      setFields([...builtins, ...detected.filter((f) => !builtinSet.has(f.name))]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [folder]);

  return { fields, loading };
}

// --- Filter editor ---

export function FilterEditor({
  filters,
  fieldNames,
  fieldTypeMap,
  onChange,
}: {
  filters: FilterCondition[];
  fieldNames: string[];
  fieldTypeMap: Map<string, PropertyType>;
  onChange: (next: FilterCondition[]) => void;
}) {
  const { t } = useI18n();

  const addFilter = () => {
    const firstProp = fieldNames[0] ?? "";
    const propType = fieldTypeMap.get(firstProp) ?? "string";
    const firstOp = OPERATORS_BY_TYPE[propType][0] ?? "eq";
    onChange([...filters, { property: firstProp, op: firstOp }]);
  };
  const updateFilter = (index: number, patch: Partial<FilterCondition>) => {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {t("dashboard.filter")}
      </label>
      {filters.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
          {t("dashboard.noFilters")}
        </p>
      )}
      <div className="space-y-1.5">
        {filters.map((filter, index) => {
          const propType = fieldTypeMap.get(filter.property) ?? "string";
          const availableOps = OPERATORS_BY_TYPE[propType] ?? ["eq"];
          const needsValue = !VALUELESS_OPS.has(filter.op);
          return (
            <div key={index} className="flex items-center gap-1.5">
              <select
                value={filter.property}
                onChange={(e) => {
                  const newType = fieldTypeMap.get(e.target.value) ?? "string";
                  const newOps = OPERATORS_BY_TYPE[newType] ?? ["eq"];
                  updateFilter(index, {
                    property: e.target.value,
                    op: newOps[0],
                    value: undefined,
                  });
                }}
                className="flex-1 min-w-0 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
              >
                {fieldNames.length === 0 && (
                  <option value="">{t("dashboard.noFields")}</option>
                )}
                {fieldNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={filter.op}
                onChange={(e) => updateFilter(index, { op: e.target.value as FilterOp })}
                className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
              >
                {availableOps.map((op) => (
                  <option key={op} value={op}>
                    {t(OP_LABEL_KEYS[op])}
                  </option>
                ))}
              </select>
              {needsValue ? (
                <input
                  type={propType === "number" ? "number" : propType === "date" ? "date" : "text"}
                  value={filter.value == null ? "" : String(filter.value)}
                  onChange={(e) => {
                    let val: unknown = e.target.value;
                    if (propType === "number") val = Number(val);
                    updateFilter(index, { value: val });
                  }}
                  className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
                />
              ) : (
                <div className="w-24" />
              )}
              <button
                type="button"
                onClick={() => removeFilter(index)}
                className="text-gray-400 hover:text-red-500 p-1"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addFilter}
        disabled={fieldNames.length === 0}
        className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
      >
        <Plus size={12} />
        {t("dashboard.addFilter")}
      </button>
    </div>
  );
}

// --- Sort + limit ---

export function SortLimitFields({
  sort,
  limit,
  sortOptions,
  defaultSort,
  onChange,
}: {
  sort: string | undefined;
  limit: number | undefined;
  sortOptions: SortOption[];
  defaultSort: string;
  onChange: (patch: { sort?: string; limit?: number }) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.sort")}
        </label>
        <select
          value={sort ?? defaultSort}
          onChange={(e) => onChange({ sort: e.target.value || undefined })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          <option value="">{t("dashboard.sortNone")}</option>
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.labelKey ? t(opt.labelKey) : formatSortLabel(opt.value)}
            </option>
          ))}
        </select>
      </div>
      <div className="w-24">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.limit")}
        </label>
        <input
          type="number"
          min={1}
          max={500}
          value={limit ?? ""}
          placeholder="50"
          onChange={(e) => {
            const value = e.target.value;
            onChange({ limit: value === "" ? undefined : Number(value) || 50 });
          }}
          onBlur={() => {
            if (limit == null) onChange({ limit: 50 });
          }}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>
    </div>
  );
}

// --- Table columns ---

export function ColumnsEditor({
  columns,
  fieldNames,
  onChange,
}: {
  columns: string[];
  fieldNames: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const [newColumn, setNewColumn] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const addColumn = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed || columns.includes(trimmed)) return;
    onChange([...columns, trimmed]);
    setNewColumn("");
    setShowSuggestions(false);
  };
  const removeColumn = (index: number) => {
    onChange(columns.filter((_, i) => i !== index));
  };
  const moveColumn = (from: number, to: number) => {
    if (from === to) return;
    const next = [...columns];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const filteredSuggestions = useMemo(() => {
    if (!newColumn.trim()) return fieldNames;
    const lower = newColumn.toLowerCase();
    return fieldNames.filter((s) => s.toLowerCase().includes(lower));
  }, [fieldNames, newColumn]);

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {t("dashboard.columns")}
      </label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {columns.map((col, index) => (
          <div
            key={col}
            draggable
            onDragStart={() => {
              dragIndexRef.current = index;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(index);
            }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={() => {
              if (dragIndexRef.current !== null) moveColumn(dragIndexRef.current, index);
              dragIndexRef.current = null;
              setDragOverIndex(null);
            }}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs cursor-move ${
              dragOverIndex === index
                ? "border-blue-400 bg-blue-50 dark:bg-blue-900/30"
                : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800"
            }`}
          >
            <GripVertical size={10} className="text-gray-400" />
            <span className="text-gray-700 dark:text-gray-300">{col}</span>
            <button
              type="button"
              onClick={() => removeColumn(index)}
              className="text-gray-400 hover:text-red-500"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="relative">
        <div className="flex gap-1">
          <input
            type="text"
            value={newColumn}
            onChange={(e) => {
              setNewColumn(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addColumn(newColumn);
              }
            }}
            placeholder={t("dashboard.addColumnKey")}
            className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            type="button"
            onClick={() => addColumn(newColumn)}
            disabled={!newColumn.trim()}
            className="px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-sm"
          >
            <Plus size={14} />
          </button>
        </div>
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-40 overflow-auto">
            <ul className="py-1">
              {filteredSuggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => addColumn(s)}
                    disabled={columns.includes(s)}
                    className="flex w-full items-center px-3 py-1 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  >
                    {s}
                    {columns.includes(s) && (
                      <span className="ml-auto text-xs text-gray-400">
                        {t("dashboard.added")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Card field mapping ---

export function CardMappingEditor({
  card,
  cols,
  fieldNames,
  onChange,
}: {
  card: CardMapping;
  cols: number | undefined;
  fieldNames: string[];
  onChange: (patch: { card?: CardMapping; cols?: number }) => void;
}) {
  const { t } = useI18n();

  const updateCardField = (field: keyof CardMapping, value: string) => {
    const nextCard: CardMapping = { ...card, [field]: value || undefined };
    if (field === "badges") {
      const badges = value
        ? value.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      nextCard.badges = badges.length > 0 ? badges : undefined;
    }
    onChange({ card: nextCard });
  };

  const cardBadgesStr = Array.isArray(card.badges) ? card.badges.join(", ") : "";

  return (
    <div className="space-y-2">
      {CARD_FIELDS.map(({ key, labelKey }) => (
        <div key={key}>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
            {t(labelKey)}
          </label>
          <select
            value={String(card[key] ?? "")}
            onChange={(e) => updateCardField(key, e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
          >
            <option value="">—</option>
            {fieldNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
          {t("dashboard.cardBadges")}
        </label>
        <input
          type="text"
          value={cardBadgesStr}
          onChange={(e) => updateCardField("badges", e.target.value)}
          placeholder={t("dashboard.cardBadgesPlaceholder")}
          className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
          {t("dashboard.cardCols")}
        </label>
        <input
          type="number"
          min={1}
          max={6}
          value={cols ?? 3}
          onChange={(e) => onChange({ cols: Number(e.target.value) || 3 })}
          className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
        />
      </div>
    </div>
  );
}
