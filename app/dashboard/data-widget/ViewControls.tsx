// View-time filter & sort controls — two separate header icons that work in
// view mode (no edit mode / config editor needed).
//
// The state is EPHEMERAL: it overlays the widget's configured filter/sort and
// resets when the dashboard is reloaded. Nothing is written back to the
// `.dashboard` file, so "filter/sort without editing" stays non-destructive.
//
// Popovers render through a portal because widget cells are `overflow-hidden`
// (an in-flow absolute popover would be clipped).

import { useState, useRef, useLayoutEffect, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Filter, ArrowUpDown, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { FilterCondition, FieldInfo, PropertyType } from "./types";
import { FilterEditor, buildSortOptions, formatSortLabel } from "./config-parts";

interface ViewControlsProps {
  fields: FieldInfo[];
  isWorkflow: boolean;
  /** Extra (view-time) filter conditions, ANDed with the configured filter. */
  viewFilter: FilterCondition[];
  onViewFilterChange: (next: FilterCondition[]) => void;
  /** View-time sort override; undefined falls back to the configured sort. */
  viewSort: string | undefined;
  onViewSortChange: (next: string | undefined) => void;
}

/** Portal popover anchored under an element, closing on outside click / Escape. */
export function Popover({
  anchorRef,
  onClose,
  children,
  widthClass = "w-72",
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [anchorRef]);

  useEffect(() => {
    const onDocPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`fixed z-[1000] ${widthClass} max-w-[90vw] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 shadow-lg`}
      style={{ top: pos.top, right: pos.right }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ViewControls({
  fields,
  isWorkflow,
  viewFilter,
  onViewFilterChange,
  viewSort,
  onViewSortChange,
}: ViewControlsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<"filter" | "sort" | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);

  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const fieldTypeMap = useMemo(
    () => new Map(fields.map((f) => [f.name, f.type] as const)),
    [fields],
  );
  const sortOptions = useMemo(() => buildSortOptions(fields, isWorkflow), [fields, isWorkflow]);

  const hasFilter = viewFilter.length > 0;
  const hasSort = viewSort != null && viewSort !== "";

  const iconClass = (active: boolean) =>
    `relative flex items-center rounded px-1 py-0.5 ${
      active
        ? "text-blue-600 dark:text-blue-400"
        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
    }`;

  return (
    <div className="flex items-center gap-0.5">
      <button
        ref={filterBtnRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => (o === "filter" ? null : "filter"));
        }}
        title={t("dashboard.filter")}
        className={iconClass(hasFilter)}
      >
        <Filter size={12} />
        {hasFilter && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>
      <button
        ref={sortBtnRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => (o === "sort" ? null : "sort"));
        }}
        title={t("dashboard.sort")}
        className={iconClass(hasSort)}
      >
        <ArrowUpDown size={12} />
        {hasSort && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>

      {open === "filter" && (
        <Popover anchorRef={filterBtnRef} onClose={() => setOpen(null)} widthClass="w-80">
          <FilterEditor
            filters={viewFilter}
            fieldNames={fieldNames}
            fieldTypeMap={fieldTypeMap}
            onChange={onViewFilterChange}
          />
        </Popover>
      )}

      {open === "sort" && (
        <Popover anchorRef={sortBtnRef} onClose={() => setOpen(null)}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("dashboard.sort")}
            </span>
            {hasSort && (
              <button
                type="button"
                onClick={() => onViewSortChange(undefined)}
                className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-red-500"
              >
                <X size={11} />
                {t("dashboard.viewSortReset")}
              </button>
            )}
          </div>
          <div className="max-h-60 overflow-auto">
            {sortOptions.length === 0 && (
              <p className="px-2 py-1 text-xs text-gray-400">{t("dashboard.noFields")}</p>
            )}
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onViewSortChange(opt.value)}
                className={`block w-full rounded px-2 py-1 text-left text-xs ${
                  viewSort === opt.value
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {opt.labelKey ? t(opt.labelKey) : formatSortLabel(opt.value)}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

/**
 * Derive filterable/sortable fields from a set of rows for the view controls.
 * Folder rows expose file.* builtins in addition to their frontmatter cells.
 */
export function deriveFieldsFromRows(
  cells: Record<string, unknown>[],
  includeFileBuiltins: boolean,
  detect: (rows: Record<string, unknown>[]) => FieldInfo[],
): FieldInfo[] {
  const detected = detect(cells);
  if (!includeFileBuiltins) return detected;
  const builtins: FieldInfo[] = [
    { name: "file.name", type: "string" as PropertyType },
    { name: "file.mtime", type: "date" as PropertyType },
    { name: "file.ctime", type: "date" as PropertyType },
  ];
  const seen = new Set(builtins.map((b) => b.name));
  return [...builtins, ...detected.filter((f) => !seen.has(f.name))];
}
