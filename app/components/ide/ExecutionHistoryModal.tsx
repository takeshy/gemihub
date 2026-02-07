import { useState, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { ExecutionRecordItem, ExecutionRecord, ExecutionStep } from "~/engine/types";

interface ExecutionHistoryModalProps {
  workflowId: string;
  workflowName?: string;
  onClose: () => void;
}

export function ExecutionHistoryModal({
  workflowId,
  workflowName,
  onClose,
}: ExecutionHistoryModalProps) {
  const [records, setRecords] = useState<ExecutionRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRecord, setExpandedRecord] = useState<ExecutionRecord | null>(
    null
  );
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/workflow/history?workflowId=${encodeURIComponent(workflowId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleExpand = useCallback(
    async (record: ExecutionRecordItem) => {
      if (expandedId === record.id) {
        setExpandedId(null);
        setExpandedRecord(null);
        setExpandedStepIndex(null);
        return;
      }

      setExpandedId(record.id);
      setExpandedStepIndex(null);
      setLoadingDetail(true);
      try {
        const res = await fetch(
          `/api/workflow/history?fileId=${encodeURIComponent(record.fileId)}`
        );
        if (res.ok) {
          const data = await res.json();
          setExpandedRecord(data.record);
        }
      } catch {
        // ignore
      } finally {
        setLoadingDetail(false);
      }
    },
    [expandedId]
  );

  const handleDelete = useCallback(
    async (record: ExecutionRecordItem) => {
      if (!confirm("Delete this execution record?")) return;
      try {
        await fetch("/api/workflow/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", fileId: record.fileId }),
        });
        setRecords((prev) => prev.filter((r) => r.id !== record.id));
        if (expandedId === record.id) {
          setExpandedId(null);
          setExpandedRecord(null);
        }
      } catch {
        // ignore
      }
    },
    [expandedId]
  );

  const handleClearAll = useCallback(async () => {
    if (
      !confirm(
        `Delete all ${records.length} execution records for this workflow?`
      )
    )
      return;
    for (const record of records) {
      try {
        await fetch("/api/workflow/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", fileId: record.fileId }),
        });
      } catch {
        // ignore
      }
    }
    setRecords([]);
    setExpandedId(null);
    setExpandedRecord(null);
  }, [records]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Execution History
            </h3>
            {workflowName && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {workflowName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={ICON.XL} className="animate-spin text-gray-400" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              No execution history yet
            </div>
          ) : (
            <div className="space-y-1">
              {records.map((record) => {
                const isExpanded = expandedId === record.id;
                const duration = getDuration(
                  record.startTime,
                  record.endTime
                );

                return (
                  <div
                    key={record.id}
                    className="rounded border border-gray-200 dark:border-gray-700"
                  >
                    {/* Record header */}
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        onClick={() => handleExpand(record)}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        {isExpanded ? (
                          <ChevronDown size={ICON.MD} className="text-gray-400" />
                        ) : (
                          <ChevronRight size={ICON.MD} className="text-gray-400" />
                        )}
                        <StatusIcon status={record.status} />
                        <span className="text-xs text-gray-700 dark:text-gray-300">
                          {formatDate(record.startTime)}
                        </span>
                        {duration && (
                          <span className="text-xs text-gray-400">
                            ({duration})
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {record.stepCount} steps
                        </span>
                      </button>
                      <button
                        onClick={() => handleDelete(record)}
                        className="rounded p-1 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900"
                        title="Delete"
                      >
                        <Trash2 size={ICON.SM} />
                      </button>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-700">
                        {loadingDetail ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2
                              size={ICON.MD}
                              className="animate-spin text-gray-400"
                            />
                          </div>
                        ) : expandedRecord ? (
                          <div className="space-y-1">
                            {expandedRecord.steps.map(
                              (step: ExecutionStep, i: number) => {
                                const isStepExpanded = expandedStepIndex === i;
                                const hasDetail = step.input || step.output || step.error;
                                return (
                                  <div key={i}>
                                    <div
                                      onClick={() => hasDetail && setExpandedStepIndex(isStepExpanded ? null : i)}
                                      className={`flex items-start gap-2 text-xs ${hasDetail ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1" : ""}`}
                                    >
                                      <StepStatusIcon status={step.status} />
                                      {hasDetail && (isStepExpanded
                                        ? <ChevronDown size={ICON.SM} className="flex-shrink-0 mt-0.5 text-gray-400" />
                                        : <ChevronRight size={ICON.SM} className="flex-shrink-0 mt-0.5 text-gray-400" />
                                      )}
                                      <span className="font-medium text-gray-700 dark:text-gray-300 min-w-[80px]">
                                        {step.nodeId}
                                      </span>
                                      <span className="text-gray-500 dark:text-gray-400 min-w-[60px]">
                                        {step.nodeType}
                                      </span>
                                      {step.error && !isStepExpanded && (
                                        <span className="text-red-500 truncate">
                                          {step.error}
                                        </span>
                                      )}
                                      {!!step.output && !step.error && !isStepExpanded && (
                                        <span className="truncate text-gray-400">
                                          {typeof step.output === "string"
                                            ? step.output.slice(0, 80)
                                            : JSON.stringify(step.output).slice(0, 80)}
                                        </span>
                                      )}
                                    </div>
                                    {isStepExpanded && (
                                      <div className="ml-8 mb-1 space-y-1 text-xs">
                                        {step.input && (
                                          <div>
                                            <span className="font-semibold text-gray-500">Input:</span>
                                            <pre className="mt-0.5 max-h-[300px] overflow-auto rounded bg-gray-100 p-1.5 text-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-pre-wrap">{formatStepValue(step.input)}</pre>
                                          </div>
                                        )}
                                        {step.output !== undefined && (
                                          <div>
                                            <span className="font-semibold text-gray-500">Output:</span>
                                            <pre className="mt-0.5 max-h-[300px] overflow-auto rounded bg-gray-100 p-1.5 text-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-pre-wrap">{formatStepValue(step.output)}</pre>
                                          </div>
                                        )}
                                        {step.error && (
                                          <div>
                                            <span className="font-semibold text-red-500">Error:</span>
                                            <pre className="mt-0.5 max-h-[300px] overflow-auto rounded bg-red-50 p-1.5 text-red-600 dark:bg-red-900/30 dark:text-red-400 whitespace-pre-wrap">{step.error}</pre>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {records.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
            >
              Clear All
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle size={ICON.MD} className="flex-shrink-0 text-green-500" />;
    case "error":
    case "cancelled":
      return <XCircle size={ICON.MD} className="flex-shrink-0 text-red-500" />;
    default:
      return <Clock size={ICON.MD} className="flex-shrink-0 text-yellow-500" />;
  }
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle size={ICON.SM} className="flex-shrink-0 mt-0.5 text-green-500" />;
    case "error":
      return <XCircle size={ICON.SM} className="flex-shrink-0 mt-0.5 text-red-500" />;
    case "skipped":
      return <Clock size={ICON.SM} className="flex-shrink-0 mt-0.5 text-gray-400" />;
    default:
      return <Clock size={ICON.SM} className="flex-shrink-0 mt-0.5 text-gray-400" />;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatStepValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getDuration(
  start: string,
  end?: string
): string | null {
  if (!end) return null;
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  } catch {
    return null;
  }
}
