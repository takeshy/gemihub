import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { McpAppRenderer } from "~/components/chat/McpAppRenderer";
import type { McpAppInfo } from "~/types/chat";

interface McpAppModalProps {
  mcpApps: McpAppInfo[];
  onClose: () => void;
}

export function McpAppModal({ mcpApps, onClose }: McpAppModalProps) {
  const [expandedApps, setExpandedApps] = useState<Set<number>>(
    () => new Set(mcpApps.map((_, i) => i))
  );

  const toggleApp = (index: number) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            MCP App
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          {mcpApps.map((app, i) => (
            <McpAppRenderer
              key={i}
              serverId={app.serverId}
              serverUrl={app.serverUrl}
              serverHeaders={app.serverHeaders}
              toolResult={app.toolResult}
              uiResource={app.uiResource}
              expanded={expandedApps.has(i)}
              onToggleExpand={() => toggleApp(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}
