"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import type { Message, ToolCall, WorkflowExecutionInfo } from "~/types/chat";

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  streamingThinking?: string;
  streamingToolCalls?: ToolCall[];
  streamingRagSources?: string[];
  streamingRagUsed?: boolean;
  streamingWebSearchUsed?: boolean;
  streamingWorkflowExecution?: WorkflowExecutionInfo | null;
  isStreaming?: boolean;
}

export function MessageList({
  messages,
  streamingContent,
  streamingThinking,
  streamingToolCalls,
  streamingRagSources,
  streamingRagUsed,
  streamingWebSearchUsed,
  streamingWorkflowExecution,
  isStreaming,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming content updates
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, streamingThinking, streamingWorkflowExecution]);

  // Build a partial assistant message from streaming data
  const streamingMessage: Message | null =
    isStreaming && (streamingContent || streamingThinking || (streamingToolCalls && streamingToolCalls.length > 0))
      ? {
          role: "assistant",
          content: streamingContent || "",
          thinking: streamingThinking || undefined,
          toolCalls: streamingToolCalls && streamingToolCalls.length > 0 ? streamingToolCalls : undefined,
          ragUsed: streamingRagUsed || undefined,
          webSearchUsed: streamingWebSearchUsed || undefined,
          ragSources: streamingRagSources && streamingRagSources.length > 0 ? streamingRagSources : undefined,
          timestamp: Date.now(),
        }
      : null;

  // Build a partial assistant message for workflow execution streaming
  const streamingWorkflowMessage: Message | null =
    isStreaming && streamingWorkflowExecution
      ? {
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          workflowExecution: streamingWorkflowExecution,
        }
      : null;

  const hasStreamingMessage = !!(streamingMessage || streamingWorkflowMessage);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      {messages.length === 0 && !hasStreamingMessage ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="mb-2 text-4xl text-gray-300 dark:text-gray-600">
              AI
            </div>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Start a conversation by sending a message below.
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((msg, i) => (
            <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
          ))}

          {/* Streaming partial message (regular chat) */}
          {streamingMessage && (
            <MessageBubble
              message={streamingMessage}
              isStreaming={true}
            />
          )}

          {/* Streaming workflow execution message */}
          {streamingWorkflowMessage && (
            <MessageBubble
              message={streamingWorkflowMessage}
              isStreaming={true}
            />
          )}
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
