import { useState, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import type {
  ExecutionRecordItem,
  ExecutionRecord,
  ExecutionStep,
} from "~/engine/types";

interface ExecutionHistorySelectModalProps {
  workflowId: string;
  onSelect: (steps: ExecutionStep[]) => void;
  onClose: () => void;
}

export function ExecutionHistorySelectModal({
  workflowId,
  onSelect,
  onClose,
}: ExecutionHistorySelectModalProps) {
  const { t } = useI18n();

  // Left panel: execution runs list
  const [records, setRecords] = useState<ExecutionRecordItem[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);

  // Right panel: selected run's steps
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ExecutionRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Checkboxes
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set());

  // Fetch runs list
  useEffect(() => {
    (async () => {
      setLoadingRecords(true);
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
        setLoadingRecords(false);
      }
    })();
  }, [workflowId]);

  // Select a run and load its detail
  const handleSelectRun = useCallback(
    async (record: ExecutionRecordItem) => {
      if (selectedRunId === record.id) return;

      setSelectedRunId(record.id);
      setCheckedIndices(new Set());
      setLoadingDetail(true);
      try {
        const res = await fetch(
          `/api/workflow/history?fileId=${encodeURIComponent(record.fileId)}`
        );
        if (res.ok) {
          const data = await res.json();
          const rec = data.record as ExecutionRecord;
          setSelectedRecord(rec);
          // Pre-select error steps
          const errorIndices = new Set<number>();
          rec.steps.forEach((step, i) => {
            if (step.status === "error") errorIndices.add(i);
          });
          setCheckedIndices(errorIndices);
        }
      } catch {
        // ignore
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectedRunId]
  );

  const toggleCheck = useCallback((index: number) => {
    setCheckedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleIncludeSelected = useCallback(() => {
    if (!selectedRecord) return;
    const steps = selectedRecord.steps.filter((_, i) => checkedIndices.has(i));
    onSelect(steps);
  }, [selectedRecord, checkedIndices, onSelect]);

  const handleIncludeAll = useCallback(() => {
    if (!selectedRecord) return;
    onSelect(selectedRecord.steps);
  }, [selectedRecord, onSelect]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-3xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("workflow.historySelect.title")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body: two-panel layout */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left panel: runs list */}
          <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500">
              {t("workflow.historySelect.recentExecutions")}
            </div>
            {loadingRecords ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
              </div>
            ) : records.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-500 text-center">
                No execution history
              </div>
            ) : (
              <div className="space-y-0.5 px-1 pb-2">
                {records.map((record) => {
                  const isActive = selectedRunId === record.id;
                  const duration = getDuration(record.startTime, record.endTime);
                  return (
                    <button
                      key={record.id}
                      onClick={() => handleSelectRun(record)}
                      className={`w-full text-left rounded px-2 py-1.5 text-xs ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/30"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={record.status} />
                        <span className="text-gray-700 dark:text-gray-300 truncate">
                          {formatDate(record.startTime)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 ml-5 text-[10px] text-gray-400">
                        <span>{record.stepCount} steps</span>
                        {duration && <span>{duration}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right panel: steps with checkboxes */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500">
              {t("workflow.historySelect.steps")}
            </div>
            {!selectedRunId ? (
              <div className="px-3 py-8 text-xs text-gray-500 text-center">
                {t("workflow.historySelect.selectRunToView")}
              </div>
            ) : loadingDetail ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
              </div>
            ) : selectedRecord ? (
              <div className="px-2 pb-2 space-y-0.5">
                {selectedRecord.steps.map((step, i) => (
                  <button
                    key={i}
                    onClick={() => toggleCheck(i)}
                    className={`w-full text-left flex items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      checkedIndices.has(i) ? "bg-blue-50/50 dark:bg-blue-900/20" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checkedIndices.has(i)}
                      onChange={() => toggleCheck(i)}
                      className="mt-0.5 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <StepStatusIcon status={step.status} />
                    <span className="font-medium text-gray-700 dark:text-gray-300 min-w-[60px]">
                      {step.nodeId}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 min-w-[50px]">
                      {step.nodeType}
                    </span>
                    <span className="truncate text-gray-400">
                      {step.error
                        ? step.error.slice(0, 60)
                        : step.output
                          ? formatStepPreview(step.output).slice(0, 60)
                          : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="text-[10px] text-gray-400">
            {checkedIndices.size > 0 &&
              t("workflow.historySelect.stepsSelected").replace(
                "{count}",
                String(checkedIndices.size)
              )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {t("common.cancel")}
            </button>
            {selectedRecord && (
              <>
                <button
                  onClick={handleIncludeAll}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {t("workflow.historySelect.includeAll")}
                </button>
                <button
                  onClick={handleIncludeSelected}
                  disabled={checkedIndices.size === 0}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {t("workflow.historySelect.includeSelected")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helpers (re-used patterns from ExecutionHistoryModal)

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle size={ICON.SM} className="flex-shrink-0 text-green-500" />;
    case "error":
    case "cancelled":
      return <XCircle size={ICON.SM} className="flex-shrink-0 text-red-500" />;
    default:
      return <Clock size={ICON.SM} className="flex-shrink-0 text-yellow-500" />;
  }
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle size={ICON.SM} className="flex-shrink-0 mt-0.5 text-green-500" />;
    case "error":
      return <XCircle size={ICON.SM} className="flex-shrink-0 mt-0.5 text-red-500" />;
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

function getDuration(start: string, end?: string): string | null {
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

function formatStepPreview(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
