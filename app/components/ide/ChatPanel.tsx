import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type {
  Message,
  StreamChunk,
  Attachment,
  ChatHistory,
  ChatHistoryItem,
  GeneratedImage,
} from "~/types/chat";
import type { UserSettings, ModelType, DriveToolMode, SlashCommand } from "~/types/settings";
import {
  getAvailableModels,
  getDefaultModelForPlan,
  isImageGenerationModel,
} from "~/types/settings";
import { MessageList } from "~/components/chat/MessageList";
import { ChatInput } from "~/components/chat/ChatInput";
import { useI18n } from "~/i18n/context";

export interface ChatOverrides {
  model?: ModelType | null;
  searchSetting?: string | null;
  driveToolMode?: DriveToolMode | null;
  enabledMcpServers?: string[] | null;
}

interface ChatPanelProps {
  settings: UserSettings;
  hasApiKey: boolean;
  slashCommands?: SlashCommand[];
}

export function ChatPanel({
  settings,
  hasApiKey,
  slashCommands = [],
}: ChatPanelProps) {
  const { t } = useI18n();
  const [histories, setHistories] = useState<ChatHistoryItem[]>([]);

  // Fetch chat histories on mount
  useEffect(() => {
    fetch("/api/chat/history")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ChatHistoryItem[]) => setHistories(data))
      .catch(() => {});
  }, []);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatFileId, setActiveChatFileId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatListOpen, setChatListOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const availableModels = getAvailableModels(settings.apiPlan);
  const defaultModel =
    settings.selectedModel || getDefaultModelForPlan(settings.apiPlan);
  const [selectedModel, setSelectedModel] = useState<ModelType>(defaultModel);

  const [selectedRagSetting, setSelectedRagSetting] = useState<string | null>(
    settings.selectedRagSetting
  );
  const [driveToolMode, setDriveToolMode] = useState<DriveToolMode>("all");
  const [enableMcp, setEnableMcp] = useState(
    settings.mcpServers.some((s) => s.enabled)
  );

  // ---- Chat history management ----
  const handleNewChat = useCallback(() => {
    setMessages([]);
    setActiveChatId(null);
    setActiveChatFileId(null);
    setChatListOpen(false);
  }, []);

  const handleSelectChat = useCallback(
    async (chatId: string, fileId: string) => {
      setChatListOpen(false);
      setActiveChatId(chatId);
      setActiveChatFileId(fileId);
      setMessages([]);

      try {
        const res = await fetch(
          `/api/drive/files?action=read&fileId=${fileId}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.content) {
            const chat = JSON.parse(data.content);
            if (chat.messages) {
              setMessages(chat.messages);
            }
          }
        }
      } catch {
        // ignore
      }
    },
    []
  );

  const handleDeleteChat = useCallback(
    async (fileId: string) => {
      try {
        await fetch("/api/chat/history", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        setHistories((prev) => prev.filter((h) => h.fileId !== fileId));
        if (activeChatFileId === fileId) {
          handleNewChat();
        }
      } catch {
        // ignore
      }
    },
    [activeChatFileId, handleNewChat]
  );

  // ---- Save chat ----
  const saveChat = useCallback(
    async (updatedMessages: Message[], title?: string) => {
      const chatId = activeChatId || `chat-${Date.now()}`;
      const chatHistory: ChatHistory = {
        id: chatId,
        title:
          title ||
          updatedMessages[0]?.content?.slice(0, 50) ||
          "Untitled Chat",
        messages: updatedMessages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      try {
        const res = await fetch("/api/chat/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatHistory),
        });
        if (res.ok) {
          const data = await res.json();
          if (!activeChatId) {
            setActiveChatId(chatId);
            if (data.fileId) {
              setActiveChatFileId(data.fileId);
            }
            // Add to histories
            setHistories((prev) => [
              {
                id: chatId,
                fileId: data.fileId || "",
                title: chatHistory.title,
                createdAt: chatHistory.createdAt,
                updatedAt: chatHistory.updatedAt,
              },
              ...prev,
            ]);
          }
        }
      } catch {
        // ignore
      }
    },
    [activeChatId]
  );

  // ---- RAG/WebSearch change with auto-linking ----
  const handleRagSettingChange = useCallback(
    (name: string | null) => {
      setSelectedRagSetting(name);
      if (name === "__websearch__") {
        // Web Search: incompatible with other tools
        setDriveToolMode("none");
        setEnableMcp(false);
      } else if (name) {
        // RAG selected: search tools not needed
        setDriveToolMode("noSearch");
      } else {
        // None: restore defaults
        setDriveToolMode("all");
        setEnableMcp(settings.mcpServers.some((s) => s.enabled));
      }
    },
    [settings.mcpServers]
  );

  // ---- Send message ----
  const handleSend = useCallback(
    async (content: string, attachments?: Attachment[], overrides?: ChatOverrides) => {
      if (!hasApiKey) return;

      // Apply overrides from slash commands
      const effectiveModel = overrides?.model || selectedModel;
      const effectiveRagSetting = overrides?.searchSetting !== undefined ? overrides.searchSetting : selectedRagSetting;
      const effectiveDriveToolMode = overrides?.driveToolMode || driveToolMode;
      const mcpOverride = overrides?.enabledMcpServers;

      const userMessage: Message = {
        role: "user",
        content,
        timestamp: Date.now(),
        attachments,
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setStreamingContent("");
      setStreamingThinking("");
      setIsStreaming(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const isWebSearch = effectiveRagSetting === "__websearch__";

      const ragSetting =
        effectiveRagSetting && !isWebSearch
          ? settings.ragSettings[effectiveRagSetting]
          : null;
      const ragStoreIds =
        settings.ragEnabled && ragSetting
          ? ragSetting.isExternal
            ? ragSetting.storeIds
            : ragSetting.storeId
              ? [ragSetting.storeId]
              : []
          : [];

      const mcpEnabled = mcpOverride
        ? mcpOverride.length > 0
        : enableMcp && !isWebSearch;

      const mcpServers = mcpOverride
        ? settings.mcpServers.filter((s) => mcpOverride.includes(s.name))
        : mcpEnabled
          ? settings.mcpServers.filter((s) => s.enabled)
          : undefined;

      const body = {
        messages: updatedMessages,
        model: effectiveModel,
        systemPrompt: settings.systemPrompt || undefined,
        ragStoreIds: !isWebSearch && ragStoreIds.length > 0 ? ragStoreIds : undefined,
        driveToolMode: effectiveDriveToolMode,
        enableDriveTools: effectiveDriveToolMode !== "none",
        enableMcp: mcpEnabled,
        mcpServers: mcpEnabled ? mcpServers : undefined,
        webSearchEnabled: isWebSearch,
        apiPlan: settings.apiPlan,
        settings: {
          maxFunctionCalls: settings.maxFunctionCalls,
          functionCallWarningThreshold: settings.functionCallWarningThreshold,
          ragTopK: settings.ragTopK,
        },
      };

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let accumulatedContent = "";
        let accumulatedThinking = "";
        let accumulatedToolCalls: Message["toolCalls"] = [];
        let accumulatedToolResults: Message["toolResults"] = [];
        let ragUsed = false;
        let webSearchUsed = false;
        let ragSources: string[] = [];
        let generatedImages: GeneratedImage[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const chunk: StreamChunk = JSON.parse(data);

              switch (chunk.type) {
                case "text":
                  accumulatedContent += chunk.content || "";
                  setStreamingContent(accumulatedContent);
                  break;
                case "thinking":
                  accumulatedThinking += chunk.content || "";
                  setStreamingThinking(accumulatedThinking);
                  break;
                case "tool_call":
                  if (chunk.toolCall) {
                    accumulatedToolCalls = [
                      ...(accumulatedToolCalls || []),
                      chunk.toolCall,
                    ];
                  }
                  break;
                case "tool_result":
                  if (chunk.toolResult) {
                    accumulatedToolResults = [
                      ...(accumulatedToolResults || []),
                      chunk.toolResult,
                    ];
                  }
                  break;
                case "rag_used":
                  ragUsed = true;
                  ragSources = chunk.ragSources || [];
                  break;
                case "web_search_used":
                  webSearchUsed = true;
                  ragSources = chunk.ragSources || [];
                  break;
                case "image_generated":
                  if (chunk.generatedImage) {
                    generatedImages = [...generatedImages, chunk.generatedImage];
                  }
                  break;
                case "error":
                  accumulatedContent +=
                    `\n\n**Error:** ${chunk.error || "Unknown error"}`;
                  setStreamingContent(accumulatedContent);
                  break;
                case "done": {
                  const assistantMessage: Message = {
                    role: "assistant",
                    content: accumulatedContent,
                    timestamp: Date.now(),
                    model: selectedModel,
                    thinking: accumulatedThinking || undefined,
                    toolCalls:
                      accumulatedToolCalls && accumulatedToolCalls.length > 0
                        ? accumulatedToolCalls
                        : undefined,
                    toolResults:
                      accumulatedToolResults &&
                      accumulatedToolResults.length > 0
                        ? accumulatedToolResults
                        : undefined,
                    ragUsed: ragUsed || undefined,
                    webSearchUsed: webSearchUsed || undefined,
                    ragSources:
                      ragSources.length > 0 ? ragSources : undefined,
                    generatedImages:
                      generatedImages.length > 0
                        ? generatedImages
                        : undefined,
                  };

                  const finalMessages = [
                    ...updatedMessages,
                    assistantMessage,
                  ];
                  setMessages(finalMessages);
                  setStreamingContent("");
                  setStreamingThinking("");
                  setIsStreaming(false);
                  await saveChat(finalMessages);
                  break;
                }
              }
            } catch {
              // Skip malformed SSE data
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          if (streamingContent) {
            const partialMessage: Message = {
              role: "assistant",
              content: streamingContent + "\n\n*(Generation stopped)*",
              timestamp: Date.now(),
              model: selectedModel,
            };
            const finalMessages = [...updatedMessages, partialMessage];
            setMessages(finalMessages);
          }
        } else {
          const errorMessage: Message = {
            role: "assistant",
            content: `**Error:** ${(error as Error).message || "Failed to get response"}`,
            timestamp: Date.now(),
          };
          setMessages([...updatedMessages, errorMessage]);
        }
      } finally {
        setStreamingContent("");
        setStreamingThinking("");
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [
      hasApiKey,
      messages,
      selectedModel,
      selectedRagSetting,
      driveToolMode,
      enableMcp,
      settings,
      saveChat,
      streamingContent,
    ]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Chat history selector */}
      <div className="border-b border-gray-200 dark:border-gray-800 px-2 py-1">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setChatListOpen(!chatListOpen)}
            className="flex-1 flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 text-left truncate"
          >
            <ChevronDown size={ICON.SM} className={chatListOpen ? "rotate-180" : ""} />
            {activeChatId
              ? histories.find((h) => h.id === activeChatId)?.title ||
                "Chat"
              : t("chat.newChat")}
          </button>
          <button
            onClick={handleNewChat}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title={t("chat.newChat")}
          >
            <Plus size={ICON.MD} />
          </button>
        </div>

        {chatListOpen && (
          <div className="mt-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900">
            {histories.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">
                {t("chat.noHistory")}
              </div>
            ) : (
              histories.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    chat.id === activeChatId
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                  onClick={() => handleSelectChat(chat.id, chat.fileId)}
                >
                  <span className="flex-1 truncate">
                    {chat.title || "Untitled"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm(t("chat.confirmDelete"))) return;
                      handleDeleteChat(chat.fileId);
                    }}
                    className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={ICON.SM} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        streamingThinking={streamingThinking}
        isStreaming={isStreaming}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={!hasApiKey}
        models={availableModels}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        ragSettings={Object.keys(settings.ragSettings ?? {}).length > 0 ? settings.ragSettings : undefined}
        selectedRagSetting={selectedRagSetting}
        onRagSettingChange={handleRagSettingChange}
        onStop={handleStop}
        isStreaming={isStreaming}
        driveToolMode={driveToolMode}
        onDriveToolModeChange={setDriveToolMode}
        enableMcp={enableMcp}
        onEnableMcpChange={setEnableMcp}
        hasMcpServers={settings.mcpServers.some((s) => s.enabled)}
        slashCommands={slashCommands}
      />
    </div>
  );
}
