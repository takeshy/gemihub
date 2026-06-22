// Folder widget — the shared renderer behind the `card` and `table` widgets.
// Reads files from a folder, runs filter → sort → limit, and renders
// them as cards or a table. Folder data is always read from the local cache
// (cheap, synchronous, offline OK) — no workflow execution here.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";
import type { CardWidgetConfig, TableWidgetConfig, DataRow, FilterCondition } from "./types";
import { loadFolderRows } from "./folder-source";
import { applyPostSource, detectFields } from "./filter";
import { TableView } from "./TableView";
import { CardsView } from "./CardsView";
import { ViewControls, deriveFieldsFromRows } from "./ViewControls";

export default function FolderWidget({
  config,
  ctx,
  view,
}: {
  config: unknown;
  ctx?: WidgetContext;
  view: "cards" | "table";
}) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as CardWidgetConfig & TableWidgetConfig;
  const folder = cfg.folder ?? "";

  const [rows, setRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  // View-time (ephemeral) filter/sort from the header icons — not persisted.
  const [viewFilter, setViewFilter] = useState<FilterCondition[]>([]);
  const [viewSort, setViewSort] = useState<string | undefined>(undefined);

  const loadData = useCallback(async () => {
    setLoading(true);
    const folderRows = await loadFolderRows(folder);
    setRows(folderRows);
    setLoading(false);
  }, [folder]);

  // Debounced load (mirrors the original file-table behaviour).
  useEffect(() => {
    const timer = setTimeout(() => loadData(), 300);
    return () => clearTimeout(timer);
  }, [loadData]);

  // Refresh when another widget edits data in the same folder.
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("dashboard-data-changed", handler);
    return () => window.removeEventListener("dashboard-data-changed", handler);
  }, [loadData]);

  const processedRows = useMemo(
    () =>
      applyPostSource(rows, {
        // View-time conditions are ANDed on top of the configured filter; the
        // header sort overrides the configured sort when set.
        filter: [...(cfg.filter ?? []), ...viewFilter],
        sort: viewSort ?? cfg.sort,
        limit: cfg.limit,
      }),
    [rows, cfg.filter, cfg.sort, cfg.limit, viewFilter, viewSort],
  );

  // Filterable/sortable fields derived from the loaded rows (+ file.* builtins).
  const fields = useMemo(
    () => deriveFieldsFromRows(rows.map((r) => r.cells), true, detectFields),
    [rows],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.loading")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-gray-100 dark:border-gray-800 px-2 py-1 flex-shrink-0">
        <ViewControls
          fields={fields}
          isWorkflow={false}
          viewFilter={viewFilter}
          onViewFilterChange={setViewFilter}
          viewSort={viewSort}
          onViewSortChange={setViewSort}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "cards" ? (
          <CardsView rows={processedRows} card={cfg.card ?? {}} cols={cfg.cols} clickable />
        ) : (
          <TableView
            rows={processedRows}
            columns={cfg.columns ?? []}
            editable
            editMode={ctx?.editMode}
            folder={folder}
          />
        )}
      </div>
    </div>
  );
}
