import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { WorkflowNode, WorkflowNodeType } from "~/engine/types";
import { getNodePropertyDefs, type NodePropertyContext } from "~/utils/workflow-node-properties";
import { getNodeTypeLabel } from "~/utils/workflow-node-summary";

const ALL_NODE_TYPES: WorkflowNodeType[] = [
  "variable", "set", "if", "while", "command", "http", "json",
  "drive-file", "drive-read", "drive-search", "drive-list",
  "drive-folder-list", "drive-file-picker", "drive-save", "drive-delete",
  "dialog", "prompt-value", "prompt-file", "prompt-selection",
  "workflow", "mcp", "rag-sync", "sleep",
];

interface NodeEditorModalProps {
  node: Partial<WorkflowNode> | null;
  existingNodeIds: string[];
  allNodeIds: string[];
  onSave: (node: WorkflowNode, nextInfo: { next?: string; trueNext?: string; falseNext?: string }) => void;
  onCancel: () => void;
  initialNext?: { next?: string; trueNext?: string; falseNext?: string };
  propertyContext?: NodePropertyContext;
}

export function NodeEditorModal({
  node,
  existingNodeIds,
  allNodeIds,
  onSave,
  onCancel,
  initialNext,
  propertyContext,
}: NodeEditorModalProps) {
  const isNew = !node?.id || !existingNodeIds.includes(node.id);

  const [id, setId] = useState(node?.id || "");
  const [type, setType] = useState<WorkflowNodeType>(node?.type || "variable");
  const [properties, setProperties] = useState<Record<string, string>>(
    node?.properties || {}
  );
  const [next, setNext] = useState(initialNext?.next || "");
  const [trueNext, setTrueNext] = useState(initialNext?.trueNext || "");
  const [falseNext, setFalseNext] = useState(initialNext?.falseNext || "");
  const [idError, setIdError] = useState("");

  const isConditional = type === "if" || type === "while";
  const propDefs = getNodePropertyDefs(type, propertyContext);

  useEffect(() => {
    // Reset properties when type changes (keep properties that match new type)
    const newProps: Record<string, string> = {};
    const newDefs = getNodePropertyDefs(type, propertyContext);
    for (const def of newDefs) {
      if (properties[def.key] !== undefined) {
        newProps[def.key] = properties[def.key];
      } else if (def.defaultValue !== undefined) {
        newProps[def.key] = def.defaultValue;
      }
    }
    setProperties(newProps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const handleSave = () => {
    const trimmedId = id.trim();
    if (!trimmedId) {
      setIdError("ID is required");
      return;
    }
    if (isNew && existingNodeIds.includes(trimmedId)) {
      setIdError("ID already exists");
      return;
    }
    if (/\s/.test(trimmedId)) {
      setIdError("ID must not contain spaces");
      return;
    }

    const workflowNode: WorkflowNode = {
      id: trimmedId,
      type,
      properties: { ...properties },
    };

    const nextInfo = isConditional
      ? { trueNext: trueNext || undefined, falseNext: falseNext || undefined }
      : { next: next || undefined };

    onSave(workflowNode, nextInfo);
  };

  const nextOptions = ["", "end", ...allNodeIds.filter((nid) => nid !== id)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {isNew ? "Add Node" : `Edit Node: ${node?.id}`}
          </h3>
          <button
            onClick={onCancel}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* ID */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Node ID
            </label>
            <input
              type="text"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setIdError("");
              }}
              readOnly={!isNew}
              className={`w-full rounded border px-2 py-1.5 text-xs ${
                !isNew
                  ? "bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
                  : "bg-white dark:bg-gray-800"
              } border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500`}
              placeholder="node-id"
            />
            {idError && (
              <p className="mt-0.5 text-xs text-red-500">{idError}</p>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as WorkflowNodeType)}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {ALL_NODE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {getNodeTypeLabel(t)} ({t})
                </option>
              ))}
            </select>
          </div>

          {/* Dynamic properties */}
          {propDefs.map((def) => (
            <div key={def.key}>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {def.label}
                {def.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              {def.options ? (
                <select
                  value={properties[def.key] || def.defaultValue || ""}
                  onChange={(e) =>
                    setProperties((p) => ({ ...p, [def.key]: e.target.value }))
                  }
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  {def.defaultValue === undefined && <option value="">—</option>}
                  {def.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : def.multiline ? (
                <textarea
                  value={properties[def.key] || ""}
                  onChange={(e) =>
                    setProperties((p) => ({ ...p, [def.key]: e.target.value }))
                  }
                  placeholder={def.placeholder}
                  rows={3}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y"
                />
              ) : (
                <input
                  type="text"
                  value={properties[def.key] || ""}
                  onChange={(e) =>
                    setProperties((p) => ({ ...p, [def.key]: e.target.value }))
                  }
                  placeholder={def.placeholder}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              )}
            </div>
          ))}

          {/* Next node selector */}
          {isConditional ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  True Next
                </label>
                <select
                  value={trueNext}
                  onChange={(e) => setTrueNext(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  {nextOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt || "(auto / next in list)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  False Next
                </label>
                <select
                  value={falseNext}
                  onChange={(e) => setFalseNext(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  {nextOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt || "(auto / next in list)"}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Next Node
              </label>
              <select
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                {nextOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt || "(auto / next in list)"}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {isNew ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
