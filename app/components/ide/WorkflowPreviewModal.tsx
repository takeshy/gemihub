import { useState, useMemo, useCallback } from "react";
import {
  X,
  Check,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Code,
  Eye,
  FileDiff,
  Loader2,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { parseWorkflowYaml } from "~/engine/parser";
import type { Workflow } from "~/engine/types";
import {
  getNodeSummary,
  getNodeTypeLabel,
  getNodeTypeColor,
} from "~/utils/workflow-node-summary";
import { buildOutgoingMap } from "~/utils/workflow-connections";
import { useI18n } from "~/i18n/context";

interface WorkflowPreviewModalProps {
  yaml: string;
  originalYaml?: string;
  mode: "create" | "modify";
  workflowName?: string;
  onAccept: () => void | Promise<void>;
  onReject: () => void;
  onClose: () => void;
}

type ViewTab = "visual" | "yaml" | "diff";

export function WorkflowPreviewModal({
  yaml,
  originalYaml,
  mode,
  workflowName,
  onAccept,
  onReject,
  onClose,
}: WorkflowPreviewModalProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<ViewTab>(
    mode === "modify" && originalYaml ? "diff" : "visual"
  );
  const [saving, setSaving] = useState(false);

  const handleAccept = useCallback(async () => {
    setSaving(true);
    try {
      await onAccept();
    } finally {
      setSaving(false);
    }
  }, [onAccept]);

  const workflow = useMemo<Workflow | null>(() => {
    try {
      return parseWorkflowYaml(yaml);
    } catch {
      return null;
    }
  }, [yaml]);

  const diffLines = useMemo(() => {
    if (!originalYaml || mode !== "modify") return [];
    return computeSimpleDiff(originalYaml, yaml);
  }, [originalYaml, yaml, mode]);

  return (
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
      <div className="mx-4 flex w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {mode === "create" ? t("workflow.preview.previewPrefix") : t("workflow.preview.changesPrefix")}
              <span className="text-purple-600 dark:text-purple-400">
                {workflowName || t("workflow.preview.defaultName")}
              </span>
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200 px-4 dark:border-gray-700">
          <TabButton
            active={activeTab === "visual"}
            onClick={() => setActiveTab("visual")}
            icon={<Eye size={ICON.SM} />}
            label={t("workflow.preview.visual")}
          />
          <TabButton
            active={activeTab === "yaml"}
            onClick={() => setActiveTab("yaml")}
            icon={<Code size={ICON.SM} />}
            label={t("workflow.preview.yaml")}
          />
          {mode === "modify" && originalYaml && (
            <TabButton
              active={activeTab === "diff"}
              onClick={() => setActiveTab("diff")}
              icon={<FileDiff size={ICON.SM} />}
              label={t("workflow.preview.diff")}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "visual" && (
            <VisualPreview workflow={workflow} yaml={yaml} />
          )}
          {activeTab === "yaml" && <YamlPreview yaml={yaml} />}
          {activeTab === "diff" && <DiffPreview lines={diffLines} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {t("workflow.preview.cancel")}
          </button>
          <button
            onClick={onReject}
            disabled={saving}
            className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RotateCcw size={ICON.SM} />
            {t("workflow.preview.refine")}
          </button>
          <button
            onClick={handleAccept}
            disabled={saving}
            className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={ICON.SM} className="animate-spin" />
            ) : (
              <Check size={ICON.SM} />
            )}
            {saving ? t("workflow.preview.saving") : t("workflow.preview.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-purple-500 text-purple-600 dark:text-purple-400"
          : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Visual Preview ───────────────────────────────────────────────────────────

function VisualPreview({
  workflow,
  yaml,
}: {
  workflow: Workflow | null;
  yaml: string;
}) {
  const { t } = useI18n();
  const [showYaml, setShowYaml] = useState(false);

  if (!workflow) {
    return (
      <div className="text-center text-xs text-red-500">
        {t("workflow.preview.parseFailed")}
      </div>
    );
  }

  const nodeOrder = getNodeOrder(workflow);
  const outgoingMap = buildOutgoingMap(workflow);

  return (
    <div className="space-y-2">
      {nodeOrder.length === 0 ? (
        <p className="text-xs text-gray-500">{t("workflow.preview.noNodes")}</p>
      ) : (
        nodeOrder.map((nodeId) => {
          const node = workflow.nodes.get(nodeId);
          if (!node) return null;
          const summary = getNodeSummary(node);
          const typeLabel = getNodeTypeLabel(node.type);
          const typeColor = getNodeTypeColor(node.type);
          const outgoing = outgoingMap.get(nodeId) || [];

          return (
            <div key={nodeId}>
              <div className="rounded border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${typeColor}`}
                  >
                    {typeLabel}
                  </span>
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                    {nodeId}
                  </span>
                </div>
                {summary && (
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 break-words">
                    {summary}
                  </p>
                )}
              </div>
              {outgoing.length > 0 && (
                <div className="ml-4 mt-0.5 mb-0.5">
                  {outgoing.map((edge, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500"
                    >
                      {edge.label ? (
                        <span
                          className={
                            edge.label === "true"
                              ? "text-green-500"
                              : "text-red-400"
                          }
                        >
                          {edge.label === "true" ? "T" : "F"}
                        </span>
                      ) : (
                        <ArrowRight size={9} />
                      )}
                      <span>{edge.to}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Collapsible YAML */}
      <button
        onClick={() => setShowYaml(!showYaml)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      >
        {showYaml ? <ChevronDown size={ICON.SM} /> : <ChevronRight size={ICON.SM} />}
        <Code size={ICON.SM} />
        {t("workflow.preview.yaml")}
      </button>
      {showYaml && (
        <pre className="max-h-48 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-mono whitespace-pre-wrap">
          {yaml}
        </pre>
      )}
    </div>
  );
}

// ─── YAML Preview ─────────────────────────────────────────────────────────────

function YamlPreview({ yaml }: { yaml: string }) {
  return (
    <pre className="overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-mono whitespace-pre-wrap">
      {yaml}
    </pre>
  );
}

// ─── Diff Preview ─────────────────────────────────────────────────────────────

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

function DiffPreview({ lines }: { lines: DiffLine[] }) {
  const { t } = useI18n();
  if (lines.length === 0) {
    return (
      <p className="text-xs text-gray-500">{t("workflow.preview.noDiff")}</p>
    );
  }

  return (
    <div className="overflow-auto rounded border border-gray-200 dark:border-gray-700 font-mono text-xs">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex ${
            line.type === "added"
              ? "bg-green-50 dark:bg-green-900/20"
              : line.type === "removed"
                ? "bg-red-50 dark:bg-red-900/20"
                : ""
          }`}
        >
          <span className="inline-block w-8 shrink-0 select-none text-right pr-1 text-gray-400 dark:text-gray-500 border-r border-gray-200 dark:border-gray-700">
            {line.oldLineNum ?? ""}
          </span>
          <span className="inline-block w-8 shrink-0 select-none text-right pr-1 text-gray-400 dark:text-gray-500 border-r border-gray-200 dark:border-gray-700">
            {line.newLineNum ?? ""}
          </span>
          <span
            className={`inline-block w-4 shrink-0 select-none text-center ${
              line.type === "added"
                ? "text-green-600 dark:text-green-400"
                : line.type === "removed"
                  ? "text-red-600 dark:text-red-400"
                  : "text-gray-300 dark:text-gray-600"
            }`}
          >
            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
          </span>
          <span
            className={`flex-1 whitespace-pre-wrap px-1 ${
              line.type === "added"
                ? "text-green-800 dark:text-green-300"
                : line.type === "removed"
                  ? "text-red-800 dark:text-red-300"
                  : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {line.content}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNodeOrder(workflow: Workflow): string[] {
  if (!workflow.startNode) return Array.from(workflow.nodes.keys());

  const order: string[] = [];
  const visited = new Set<string>();
  const queue = [workflow.startNode];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    const edges = workflow.edges.filter((e) => e.from === id);
    for (const edge of edges) {
      if (!visited.has(edge.to)) queue.push(edge.to);
    }
  }

  for (const id of workflow.nodes.keys()) {
    if (!visited.has(id)) order.push(id);
  }

  return order;
}

function computeSimpleDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const lcs = computeLCS(oldLines, newLines);
  let oldIdx = 0;
  let newIdx = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const [oi, ni] of lcs) {
    // Lines removed before this match
    while (oldIdx < oi) {
      result.push({
        type: "removed",
        content: oldLines[oldIdx],
        oldLineNum: oldLineNum++,
      });
      oldIdx++;
    }
    // Lines added before this match
    while (newIdx < ni) {
      result.push({
        type: "added",
        content: newLines[newIdx],
        newLineNum: newLineNum++,
      });
      newIdx++;
    }
    // Matching line
    result.push({
      type: "unchanged",
      content: oldLines[oldIdx],
      oldLineNum: oldLineNum++,
      newLineNum: newLineNum++,
    });
    oldIdx++;
    newIdx++;
  }

  // Remaining lines
  while (oldIdx < oldLines.length) {
    result.push({
      type: "removed",
      content: oldLines[oldIdx],
      oldLineNum: oldLineNum++,
    });
    oldIdx++;
  }
  while (newIdx < newLines.length) {
    result.push({
      type: "added",
      content: newLines[newIdx],
      newLineNum: newLineNum++,
    });
    newIdx++;
  }

  return result;
}

function computeLCS(a: string[], b: string[]): [number, number][] {
  const m = a.length;
  const n = b.length;

  // For very large files, limit the LCS computation
  if (m * n > 1_000_000) {
    // Fall back to line-by-line comparison
    return simpleMatch(a, b);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: [number, number][] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

function simpleMatch(a: string[], b: string[]): [number, number][] {
  const result: [number, number][] = [];
  let bi = 0;
  for (let ai = 0; ai < a.length && bi < b.length; ai++) {
    if (a[ai] === b[bi]) {
      result.push([ai, bi]);
      bi++;
    }
  }
  return result;
}
