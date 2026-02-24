"use client";

import { useEffect, useRef } from "react";
import { Brain, ImageIcon, Minimize2, Plus } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { MessageBubble } from "./MessageBubble";
import type { Message, ToolCall } from "~/types/chat";
import { useI18n } from "~/i18n/context";

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  streamingThinking?: string;
  streamingToolCalls?: ToolCall[];
  streamingRagSources?: string[];
  streamingRagUsed?: boolean;
  streamingWebSearchUsed?: boolean;
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
  isStreaming,
}: MessageListProps) {
  const { t } = useI18n();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming content updates
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, streamingThinking]);

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

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      {messages.length === 0 && !streamingMessage ? (
        <div className="flex h-full items-center justify-center">
          <div className="mx-auto max-w-md text-center">
            <h2 className="mb-1 text-lg font-medium text-gray-700 dark:text-gray-300">
              {t("chat.welcomeTitle")}
            </h2>
            <p className="mb-6 text-sm text-gray-400 dark:text-gray-500">
              {t("chat.welcomeHint")}
            </p>
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <Brain size={ICON.LG} className="mb-1.5 text-purple-500" />
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t("chat.welcomeThinking")}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <ImageIcon size={ICON.LG} className="mb-1.5 text-blue-500" />
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t("chat.welcomeImage")}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <Minimize2 size={ICON.LG} className="mb-1.5 text-green-500" />
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t("chat.welcomeCompact")}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <Plus size={ICON.LG} className="mb-1.5 text-orange-500" />
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t("chat.welcomeNewChat")}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((msg, i) => (
            <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
          ))}

          {/* Streaming partial message */}
          {streamingMessage && (
            <MessageBubble
              message={streamingMessage}
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
