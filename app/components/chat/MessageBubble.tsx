"use client";

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight, Download, HardDrive, Loader2, Check, Paperclip, FileText, Wrench, BookOpen, Globe, Plug } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { Message, Attachment, GeneratedImage, ToolCall } from "~/types/chat";
import { useI18n } from "~/i18n/context";
import { McpAppRenderer } from "./McpAppRenderer";
import { WorkflowExecutionBubble } from "./WorkflowExecutionBubble";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ThinkingSection({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {expanded ? <ChevronDown size={ICON.MD} /> : <ChevronRight size={ICON.MD} />}
        Thinking
      </button>
      {expanded && (
        <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
          <pre className="whitespace-pre-wrap break-words font-sans">{thinking}</pre>
        </div>
      )}
    </div>
  );
}

function getToolIcon(name: string) {
  if (name.startsWith("mcp_")) return <Plug size={10} />;
  if (name.includes("read")) return <BookOpen size={10} />;
  if (name.includes("create")) return <FileText size={10} />;
  if (name.includes("update")) return <FileText size={10} />;
  if (name.includes("search") || name.includes("list")) return <Globe size={10} />;
  return <Wrench size={10} />;
}

function sanitizeToolIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

function getMcpToolLabel(name: string, mcpServerIds?: string[]) {
  if (!name.startsWith("mcp_")) return name;
  const payload = name.slice(4);

  if (mcpServerIds && mcpServerIds.length > 0) {
    const candidates = Array.from(
      new Set(mcpServerIds.map((id) => sanitizeToolIdentifier(id)).filter(Boolean))
    ).sort((a, b) => b.length - a.length);

    for (const candidate of candidates) {
      const prefix = `${candidate}_`;
      if (payload.startsWith(prefix)) {
        const tool = payload.slice(prefix.length);
        return tool ? `${candidate}:${tool}` : candidate;
      }
    }
  }

  // Fallback when server IDs are unavailable.
  const firstSep = payload.indexOf("_");
  if (firstSep > 0 && firstSep < payload.length - 1) {
    return `${payload.slice(0, firstSep)}:${payload.slice(firstSep + 1)}`;
  }
  return name;
}

function ToolCallBadges({
  toolCalls,
  mcpServerIds,
}: {
  toolCalls: ToolCall[];
  mcpServerIds?: string[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-1">
        {toolCalls.map((tc) => (
          <button
            key={tc.id}
            onClick={() => setExpandedId(expandedId === tc.id ? null : tc.id)}
            className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
            title={JSON.stringify(tc.args, null, 2)}
          >
            {getToolIcon(tc.name)}
            {getMcpToolLabel(tc.name, mcpServerIds)}
          </button>
        ))}
      </div>
      {expandedId && (() => {
        const tc = toolCalls.find(t => t.id === expandedId);
        if (!tc) return null;
        return (
          <div className="mt-1 rounded-md border border-purple-200 bg-purple-50 p-2 text-xs text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
            <div className="font-medium">{tc.name}</div>
            <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10px] opacity-80">
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </div>
        );
      })()}
    </div>
  );
}

function RagSourcesList({ sources }: { sources: string[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white dark:bg-green-700">
        <BookOpen size={10} />
        RAG
      </span>
      {sources.map((source, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300"
          title={source}
        >
          <FileText size={10} />
          {source.split("/").pop() || source}
        </span>
      ))}
    </div>
  );
}

function WebSearchIndicator({ sources }: { sources?: string[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white dark:bg-blue-700">
        <Globe size={10} />
        Web Search
      </span>
      {sources && sources.map((source, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          title={source}
        >
          {source.split("/").pop() || source}
        </span>
      ))}
    </div>
  );
}

function GeneratedImageDisplay({ image }: { image: GeneratedImage }) {
  const { t } = useI18n();
  const dataUrl = `data:${image.mimeType};base64,${image.data}`;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = dataUrl;
    const ext = image.mimeType.split("/")[1] || "png";
    link.download = `generated-image.${ext}`;
    link.click();
  };

  const handleSaveToDrive = async () => {
    if (saveState !== "idle") return;
    setSaveState("saving");
    try {
      const ext = image.mimeType.split("/")[1] || "png";
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const fileName = `generated-image-${ts}.${ext}`;
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-image",
          name: fileName,
          data: image.data,
          mimeType: image.mimeType,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaveState("saved");
      window.dispatchEvent(new Event("sync-complete"));
    } catch {
      setSaveState("idle");
    }
  };

  return (
    <div className="group relative mb-2 inline-block">
      <img
        src={dataUrl}
        alt="Generated image"
        className="max-h-80 max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
      />
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleSaveToDrive}
          disabled={saveState === "saving"}
          className="rounded-md bg-black/50 p-1.5 text-white hover:bg-black/70"
          aria-label={saveState === "saved" ? t("chat.savedToDrive") : t("chat.saveToDrive")}
          title={saveState === "saved" ? t("chat.savedToDrive") : t("chat.saveToDrive")}
        >
          {saveState === "idle" && <HardDrive size={ICON.MD} />}
          {saveState === "saving" && <Loader2 size={ICON.MD} className="animate-spin" />}
          {saveState === "saved" && <Check size={ICON.MD} />}
        </button>
        <button
          onClick={handleDownload}
          className="rounded-md bg-black/50 p-1.5 text-white hover:bg-black/70"
          aria-label="Download image"
        >
          <Download size={ICON.MD} />
        </button>
      </div>
    </div>
  );
}

function AttachmentDisplay({ attachment }: { attachment: Attachment }) {
  if (attachment.type === "image") {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
    return (
      <div className="mb-2">
        <img
          src={dataUrl}
          alt={attachment.name}
          className="max-h-48 max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
        />
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {attachment.name}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
      {attachment.type === "pdf" ? (
        <FileText size={ICON.SM} />
      ) : (
        <Paperclip size={ICON.SM} />
      )}
      {attachment.name}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [collapsedMcpApps, setCollapsedMcpApps] = useState<Set<number>>(new Set());
  const mcpServerIds = (message.mcpApps || [])
    .map((app) => app.serverId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const toggleMcpAppExpand = (index: number) => {
    setCollapsedMcpApps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const hasMcpApps = !isUser && message.mcpApps && message.mcpApps.length > 0;

  return (
    <>
      <div
        className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 md:max-w-[75%] ${
            isUser
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          }`}
        >
          {/* Attachments (shown for user messages) */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2">
              {message.attachments.map((att, i) => (
                <AttachmentDisplay key={i} attachment={att} />
              ))}
            </div>
          )}

          {/* Thinking section (assistant only) */}
          {!isUser && message.thinking && (
            <ThinkingSection thinking={message.thinking} />
          )}

          {/* Tool calls (assistant only) */}
          {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallBadges toolCalls={message.toolCalls} mcpServerIds={mcpServerIds} />
          )}

          {/* RAG sources (assistant only) */}
          {!isUser && message.ragUsed && message.ragSources && message.ragSources.length > 0 && (
            <RagSourcesList sources={message.ragSources} />
          )}

          {/* Web search indicator (assistant only) */}
          {!isUser && message.webSearchUsed && (
            <WebSearchIndicator sources={message.ragSources} />
          )}

          {/* Message content */}
          <div
            className={`prose prose-sm max-w-none break-words ${
              isUser
                ? "prose-invert"
                : "dark:prose-invert"
            }`}
          >
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>

          {/* Generated images (assistant only) */}
          {!isUser &&
            message.generatedImages &&
            message.generatedImages.length > 0 && (
              <div className="mt-2">
                {message.generatedImages.map((img, i) => (
                  <GeneratedImageDisplay key={i} image={img} />
                ))}
              </div>
            )}

          {/* Workflow execution (assistant only) */}
          {!isUser && message.workflowExecution && (
            <WorkflowExecutionBubble
              execution={message.workflowExecution}
              isStreaming={isStreaming}
            />
          )}

          {/* Streaming indicator */}
          {isStreaming && !isUser && !message.workflowExecution && (
            <div className="mt-1 flex items-center gap-1">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:300ms]" />
            </div>
          )}

          {/* Timestamp */}
          <div
            className={`mt-1.5 text-[10px] ${
              isUser
                ? "text-blue-200"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {formatTimestamp(message.timestamp)}
            {!isUser && message.model && (
              <span className="ml-1.5">{message.model}</span>
            )}
          </div>
        </div>
      </div>

      {/* MCP Apps - rendered outside the bubble for full width */}
      {hasMcpApps && (
        <div className="w-full">
          {message.mcpApps!.map((mcpApp, index) => (
            <McpAppRenderer
              key={index}
              serverId={mcpApp.serverId}
              serverUrl={mcpApp.serverUrl}
              serverHeaders={mcpApp.serverHeaders}
              toolResult={mcpApp.toolResult}
              uiResource={mcpApp.uiResource}
              expanded={!collapsedMcpApps.has(index)}
              onToggleExpand={() => toggleMcpAppExpand(index)}
            />
          ))}
        </div>
      )}
    </>
  );
});
