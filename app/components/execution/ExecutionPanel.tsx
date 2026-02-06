import { useEffect, useRef } from "react";
import { Play, Square, ChevronDown, ChevronRight, CheckCircle, XCircle, Info, Loader2 } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { PromptModal } from "./PromptModal";
import { useWorkflowExecution } from "~/hooks/useWorkflowExecution";
import { useState } from "react";

interface ExecutionPanelProps {
  workflowId: string;
}

export function ExecutionPanel({ workflowId }: ExecutionPanelProps) {
  const {
    start,
    stop,
    status,
    logs,
    promptData,
    handlePromptResponse,
  } = useWorkflowExecution(workflowId);

  const [isExpanded, setIsExpanded] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const statusIcon = {
    idle: null,
    running: <Loader2 size={ICON.SM} className="animate-spin text-blue-500" />,
    completed: <CheckCircle size={ICON.SM} className="text-green-500" />,
    error: <XCircle size={ICON.SM} className="text-red-500" />,
    "waiting-prompt": <Loader2 size={ICON.SM} className="animate-spin text-yellow-500" />,
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {isExpanded ? <ChevronDown size={ICON.SM} /> : <ChevronRight size={ICON.SM} />}
          Execution
          {statusIcon[status]}
        </button>
        <div className="flex items-center gap-2">
          {status === "running" || status === "waiting-prompt" ? (
            <button
              onClick={stop}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800"
            >
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              onClick={start}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
            >
              <Play size={12} />
              Run
            </button>
          )}
        </div>
      </div>

      {/* Logs */}
      {isExpanded && (
        <div className="max-h-48 overflow-y-auto px-3 py-2 font-mono text-xs">
          {logs.length === 0 && status === "idle" && (
            <div className="text-gray-400 dark:text-gray-600 text-center py-4">
              Click Run to execute the workflow
            </div>
          )}
          {logs.map((log, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 py-0.5 ${
                log.status === "error"
                  ? "text-red-600 dark:text-red-400"
                  : log.status === "success"
                    ? "text-green-600 dark:text-green-400"
                    : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {log.status === "error" ? (
                <XCircle size={12} className="flex-shrink-0 mt-0.5" />
              ) : log.status === "success" ? (
                <CheckCircle size={12} className="flex-shrink-0 mt-0.5" />
              ) : (
                <Info size={12} className="flex-shrink-0 mt-0.5" />
              )}
              <span className="text-gray-400">[{log.nodeId}]</span>
              <span className="break-all">{log.message}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Prompt Modal */}
      {promptData && (
        <PromptModal
          data={promptData}
          onSubmit={handlePromptResponse}
          onCancel={() => handlePromptResponse(null)}
        />
      )}
    </div>
  );
}
