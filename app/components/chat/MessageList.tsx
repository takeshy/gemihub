import { useEffect, useRef } from "react";
import { BookOpen, Brain, ImageIcon, LayoutDashboard, Minimize2, Plus, Globe, Users, Calendar, Code } from "lucide-react";
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
  alwaysThink?: boolean;
  isPro?: boolean;
  onBuildWebApp?: () => void;
  onGoToDashboard?: () => void;
  onCreateDashboard?: () => void;
  onAskAboutGemihub?: () => void;
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
  alwaysThink,
  isPro,
  onBuildWebApp,
  onGoToDashboard,
  onCreateDashboard,
  onAskAboutGemihub,
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
  const hasStreamingData = streamingContent || streamingThinking || (streamingToolCalls && streamingToolCalls.length > 0);
  const streamingMessage: Message | null =
    isStreaming
      ? {
          role: "assistant",
          content: hasStreamingData ? (streamingContent || "") : "",
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
            {isPro && onBuildWebApp ? (
              <>
                <Globe size={32} className="mx-auto mb-3 text-blue-500" />
                <h2 className="mb-1 text-lg font-medium text-gray-700 dark:text-gray-300">
                  {t("chat.welcomeBuilderTitle")}
                </h2>
                <p className="mb-5 text-sm text-gray-400 dark:text-gray-500">
                  {t("chat.welcomeBuilderHint")}
                </p>
                <button
                  type="button"
                  onClick={onBuildWebApp}
                  className="mb-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                >
                  <Globe size={ICON.MD} />
                  {t("chat.welcomeBuilderButton")}
                </button>
                <div className="space-y-2.5 text-left">
                  <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                    <Users size={ICON.LG} className="mt-0.5 shrink-0 text-green-500" />
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t("chat.welcomeBuilderLogin")}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                    <Calendar size={ICON.LG} className="mt-0.5 shrink-0 text-blue-500" />
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t("chat.welcomeBuilderCalendar")}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                    <Code size={ICON.LG} className="mt-0.5 shrink-0 text-purple-500" />
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t("chat.welcomeBuilderApi")}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-1 text-lg font-medium text-gray-700 dark:text-gray-300">
                  {t("chat.welcomeTitle")}
                </h2>
                <p className="mb-6 text-sm text-gray-400 dark:text-gray-500">
                  {t("chat.welcomeHint")}
                </p>
                <div className="grid grid-cols-2 gap-3 text-left">
                  {!alwaysThink && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                      <Brain size={ICON.LG} className="mb-1.5 text-purple-500" />
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {t("chat.welcomeThinking")}
                      </p>
                    </div>
                  )}
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
              </>
            )}

            {(onAskAboutGemihub || onGoToDashboard || onCreateDashboard) && (
              <div className="mt-6 space-y-3 text-left">
                {onAskAboutGemihub && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <BookOpen size={ICON.MD} className="text-indigo-500" />
                      {t("chat.helpTitle")}
                    </div>
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                      {t("chat.helpDescription")}
                    </p>
                    <button
                      type="button"
                      onClick={onAskAboutGemihub}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <BookOpen size={13} />
                      {t("chat.askAboutGemihub")}
                    </button>
                  </div>
                )}
                {(onGoToDashboard || onCreateDashboard) && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <LayoutDashboard size={ICON.MD} className="text-blue-500" />
                      {t("chat.dashboardTitle")}
                    </div>
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                      {t("chat.dashboardDescription")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {onGoToDashboard && (
                        <button
                          type="button"
                          onClick={onGoToDashboard}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          <LayoutDashboard size={13} />
                          {t("chat.openCurrentDashboard")}
                        </button>
                      )}
                      {onCreateDashboard && (
                        <button
                          type="button"
                          onClick={onCreateDashboard}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                        >
                          <Plus size={13} />
                          {t("chat.createDashboard")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
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
