"use client";

import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Info,
  Loader2,
  ChevronDown,
  ChevronRight,
  Play,
  AppWindow,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { WorkflowExecutionInfo, McpAppInfo } from "~/types/chat";
import { useI18n } from "~/i18n/context";
import { McpAppRenderer } from "./McpAppRenderer";

interface WorkflowExecutionBubbleProps {
  execution: WorkflowExecutionInfo;
  isStreaming?: boolean;
}

const STATUS_CONFIG = {
  running: {
    icon: <Loader2 size={ICON.SM} className="animate-spin text-blue-500" />,
    labelKey: "chat.workflowRunning" as const,
    colorClass: "text-blue-600 dark:text-blue-400",
  },
  completed: {
    icon: <CheckCircle size={ICON.SM} className="text-green-500" />,
    labelKey: "chat.workflowCompleted" as const,
    colorClass: "text-green-600 dark:text-green-400",
  },
  error: {
    icon: <XCircle size={ICON.SM} className="text-red-500" />,
    labelKey: "chat.workflowError" as const,
    colorClass: "text-red-600 dark:text-red-400",
  },
  cancelled: {
    icon: <XCircle size={ICON.SM} className="text-orange-500" />,
    labelKey: "chat.workflowCancelled" as const,
    colorClass: "text-orange-600 dark:text-orange-400",
  },
  "waiting-prompt": {
    icon: <Loader2 size={ICON.SM} className="animate-spin text-yellow-500" />,
    labelKey: "chat.workflowWaitingPrompt" as const,
    colorClass: "text-yellow-600 dark:text-yellow-400",
  },
};

export function WorkflowExecutionBubble({
  execution,
  isStreaming,
}: WorkflowExecutionBubbleProps) {
  const { t } = useI18n();
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [mcpAppModal, setMcpAppModal] = useState<McpAppInfo[] | null>(null);

  const statusConfig = STATUS_CONFIG[execution.status];

  return (
    <div className="mt-1">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <Play size={ICON.SM} className="text-gray-400" />
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
          {t("chat.workflowExecution")}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {execution.workflowName}
        </span>
      </div>

      {/* Status */}
      <div className={`mb-2 flex items-center gap-1.5 text-xs font-medium ${statusConfig.colorClass}`}>
        {statusConfig.icon}
        {t(statusConfig.labelKey)}
      </div>

      {/* Logs */}
      {execution.logs.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
          <button
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {logsExpanded ? (
              <ChevronDown size={ICON.SM} />
            ) : (
              <ChevronRight size={ICON.SM} />
            )}
            {t("chat.workflowLogs")} ({execution.logs.length})
          </button>
          {logsExpanded && (
            <div className="max-h-48 overflow-y-auto border-t border-gray-200 px-2 py-1 font-mono text-[11px] dark:border-gray-700">
              {execution.logs.map((log, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 py-0.5 ${
                    log.status === "error"
                      ? "text-red-600 dark:text-red-400"
                      : log.status === "success"
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {log.status === "error" ? (
                    <XCircle size={11} className="mt-0.5 flex-shrink-0" />
                  ) : log.status === "success" ? (
                    <CheckCircle size={11} className="mt-0.5 flex-shrink-0" />
                  ) : (
                    <Info size={11} className="mt-0.5 flex-shrink-0" />
                  )}
                  <span className="text-gray-400 dark:text-gray-500">
                    [{log.nodeId}]
                  </span>
                  <span className="break-all">{log.message}</span>
                  {log.mcpApps && log.mcpApps.length > 0 && (
                    <button
                      onClick={() => setMcpAppModal(log.mcpApps!)}
                      className="ml-1 flex-shrink-0 text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                      title="Open MCP App"
                    >
                      <AppWindow size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && execution.status === "running" && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className="h-1 w-1 animate-pulse rounded-full bg-blue-500" />
          <div className="h-1 w-1 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]" />
          <div className="h-1 w-1 animate-pulse rounded-full bg-blue-500 [animation-delay:300ms]" />
        </div>
      )}

      {/* MCP App inline renderers */}
      {mcpAppModal && (
        <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700">
          {mcpAppModal.map((mcpApp, index) => (
            <McpAppRenderer
              key={index}
              serverId={mcpApp.serverId}
              serverUrl={mcpApp.serverUrl}
              serverHeaders={mcpApp.serverHeaders}
              toolResult={mcpApp.toolResult}
              uiResource={mcpApp.uiResource}
              expanded={true}
              onToggleExpand={() => setMcpAppModal(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
