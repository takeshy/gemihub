// Workflow widget — runs a workflow headlessly and renders its output as a
// card grid, table, Markdown, or HTML.
//
// EXECUTION MODEL: The render path reads from the per-dashboard sidecar cache
// and does NOT execute the workflow, with ONE deliberate exception — the
// interval auto-run below. Execution is triggered by:
//   (a) the refresh button in the header (user action),
//   (b) the config editor's "Test run" button (creation / config change),
//   (c) interval auto-run: stale-on-open plus a recurring timer while the
//       dashboard view is open.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { RefreshCw, AlertCircle, Clock, XCircle } from "lucide-react";
import { useI18n } from "~/i18n/context";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { buildHtmlPreviewSrcDoc } from "~/components/ide/editors/html-preview-mock";
import type { WidgetContext } from "../types";
import type {
  WorkflowWidgetConfig,
  DataRow,
  WorkflowCacheRecord,
  FilterCondition,
  FieldInfo,
  PropertyType,
} from "./types";
import {
  loadWidgetCache,
  saveWidgetCache,
  resolveWorkflowFileId,
  runWorkflowRows,
  runWorkflowText,
} from "./workflow-runner";
import { applyPostSource, detectFields, fieldsToMap } from "./filter";
import { TableView } from "./TableView";
import { CardsView } from "./CardsView";
import { ViewControls, deriveFieldsFromRows } from "./ViewControls";

function formatTime(ranAt: number): string {
  const d = new Date(ranAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function WorkflowWidget({
  config,
  ctx,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as WorkflowWidgetConfig;
  const output = cfg.output ?? "table";
  const isText = output === "markdown" || output === "html";
  const widgetId = ctx?.widgetId;
  const dashboardFileId = ctx?.dashboardFileId;

  const [cacheRecord, setCacheRecord] = useState<WorkflowCacheRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  // View-time (ephemeral) filter/sort from the header icons — not persisted.
  const [viewFilter, setViewFilter] = useState<FilterCondition[]>([]);
  const [viewSort, setViewSort] = useState<string | undefined>(undefined);
  const execAbortRef = useRef<AbortController | null>(null);
  const executeWorkflowRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // --- Load from sidecar cache (never executes) ---
  useEffect(() => {
    if (!widgetId || !dashboardFileId) {
      setLoading(false);
      setCacheRecord(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const cached = await loadWidgetCache(dashboardFileId, widgetId);
      if (cancelled) return;
      setCacheRecord(cached);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetId, dashboardFileId]);

  // Cleanup any in-flight execution on unmount
  useEffect(() => {
    return () => {
      execAbortRef.current?.abort();
    };
  }, []);

  // --- Execution (refresh button / test-run / interval auto-run only) ---
  const executeWorkflow = useCallback(async () => {
    if (!widgetId || !dashboardFileId) return;
    if (executing) return;
    const workflowPath = cfg.workflow;
    if (!workflowPath) return;

    setExecuting(true);
    execAbortRef.current?.abort();
    const abortController = new AbortController();
    execAbortRef.current = abortController;

    try {
      const workflowFileId = await resolveWorkflowFileId(workflowPath);
      if (!workflowFileId) throw new Error(t("dashboard.workflowNotFound"));

      let record: WorkflowCacheRecord;
      if (isText) {
        const result = await runWorkflowText(
          workflowFileId,
          cfg.outputVariable,
          abortController.signal,
        );
        if (abortController.signal.aborted) return;
        record = {
          widgetId,
          ranAt: Date.now(),
          status: "ok",
          text: result.text,
        };
      } else {
        const result = await runWorkflowRows(
          workflowFileId,
          cfg.outputVariable,
          abortController.signal,
        );
        if (abortController.signal.aborted) return;
        record = {
          widgetId,
          ranAt: Date.now(),
          status: "ok",
          rows: result.rows,
          fields: result.fields,
        };
      }

      await saveWidgetCache(dashboardFileId, widgetId, record);
      setCacheRecord(record);
    } catch (err) {
      if (abortController.signal.aborted) return;
      const errorMsg = err instanceof Error ? err.message : t("dashboard.workflowError");
      // Preserve previous output so a failed refresh shows stale data + error.
      const record: WorkflowCacheRecord = {
        widgetId,
        ranAt: Date.now(),
        status: "error",
        error: errorMsg,
        rows: cacheRecord?.rows,
        fields: cacheRecord?.fields,
        text: cacheRecord?.text,
      };
      await saveWidgetCache(dashboardFileId, widgetId, record);
      setCacheRecord(record);
    } finally {
      if (execAbortRef.current === abortController) {
        execAbortRef.current = null;
        setExecuting(false);
      }
    }
  }, [widgetId, dashboardFileId, executing, isText, cfg.workflow, cfg.outputVariable, cacheRecord, t]);
  executeWorkflowRef.current = executeWorkflow;

  // --- Interval auto-run (stale-on-open + recurring timer while mounted) ---
  useEffect(() => {
    if (loading) return;
    if (!widgetId || !dashboardFileId || !cfg.workflow) return;

    const interval = cfg.refreshInterval ?? 0;
    if (interval <= 0) return;

    const ranAt = cacheRecord?.ranAt ?? 0;
    const isStale = Date.now() - ranAt > interval * 60_000;
    if (isStale) {
      void executeWorkflowRef.current();
    }

    const timer = window.setInterval(() => {
      void executeWorkflowRef.current();
    }, interval * 60_000);
    return () => window.clearInterval(timer);
    // executeWorkflow/cacheRecord intentionally omitted: the timer is keyed by
    // workflow path + interval value; the ref always calls the latest callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, widgetId, dashboardFileId, cfg.workflow, cfg.refreshInterval]);

  // --- Derived rows for card/table output ---
  const rows: DataRow[] = useMemo(
    () => (cacheRecord?.rows ?? []).map((r, i) => ({ id: String(i), cells: r })),
    [cacheRecord],
  );
  const processedRows = useMemo(
    () =>
      applyPostSource(rows, {
        filter: [...(cfg.filter ?? []), ...viewFilter],
        sort: viewSort ?? cfg.sort,
        limit: cfg.limit,
      }),
    [rows, cfg.filter, cfg.sort, cfg.limit, viewFilter, viewSort],
  );

  // Filterable/sortable fields: prefer the cached detected types, else derive
  // from the rows. Workflow rows have no file.* builtins.
  const fields: FieldInfo[] = useMemo(() => {
    if (cacheRecord?.fields && Object.keys(cacheRecord.fields).length > 0) {
      return Object.entries(cacheRecord.fields).map(([name, type]) => ({
        name,
        type: type as PropertyType,
      }));
    }
    return deriveFieldsFromRows(rows.map((r) => r.cells), false, detectFields);
  }, [cacheRecord, rows]);
  const fieldTypes = useMemo(() => fieldsToMap(fields), [fields]);

  const htmlSrcDoc = useMemo(
    () => (output === "html" ? buildHtmlPreviewSrcDoc(cacheRecord?.text ?? "", "", {}) : ""),
    [output, cacheRecord?.text],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.loading")}
      </div>
    );
  }

  const hasError = cacheRecord?.status === "error";
  const hasContent =
    (isText && cacheRecord?.text != null) ||
    (!isText && cacheRecord?.rows != null);
  const isStale = hasError && hasContent;

  // Build the content area
  let content: React.ReactNode;
  if (!cacheRecord || !hasContent) {
    content = (
      <div className="flex h-full items-center justify-center text-xs text-gray-400 px-3 text-center">
        {hasError ? cacheRecord?.error : t("dashboard.workflowNotRun")}
      </div>
    );
  } else if (output === "card") {
    content = (
      <CardsView rows={processedRows} card={cfg.card ?? {}} cols={cfg.cols} clickable fieldTypes={fieldTypes} />
    );
  } else if (output === "table") {
    content = <TableView rows={processedRows} columns={cfg.columns ?? []} editable={false} fieldTypes={fieldTypes} />;
  } else if (output === "markdown") {
    content = (
      <div className="prose prose-sm h-full max-w-none overflow-auto p-2 dark:prose-invert">
        <GfmMarkdownPreview content={cacheRecord.text ?? ""} />
      </div>
    );
  } else {
    // html
    content = (
      <iframe
        srcDoc={htmlSrcDoc}
        className="h-full w-full border-0 bg-white"
        title={t("dashboard.widgetWorkflow")}
        sandbox="allow-scripts"
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-2 py-1 flex-shrink-0">
        <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
          {cacheRecord && (
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {t("dashboard.lastUpdated")}: {formatTime(cacheRecord.ranAt)}
            </span>
          )}
          {isStale && (
            <span className="flex items-center gap-1 text-amber-500">
              <AlertCircle size={10} />
              {t("dashboard.stale")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isText && (
            <ViewControls
              fields={fields}
              isWorkflow
              viewFilter={viewFilter}
              onViewFilterChange={setViewFilter}
              viewSort={viewSort}
              onViewSortChange={setViewSort}
            />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              executeWorkflow();
            }}
            disabled={executing}
            title={t("dashboard.refresh")}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw size={10} className={executing ? "animate-spin" : ""} />
            {executing ? t("dashboard.executing") : t("dashboard.refresh")}
          </button>
          {executing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                execAbortRef.current?.abort();
                execAbortRef.current = null;
                setExecuting(false);
              }}
              title={t("dashboard.cancel")}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
            >
              <XCircle size={10} />
            </button>
          )}
        </div>
      </div>
      {hasError && !isStale && cacheRecord?.error && (
        <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-2 py-1 text-xs text-red-600 dark:text-red-400 flex-shrink-0">
          {cacheRecord.error}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">{content}</div>
    </div>
  );
}
