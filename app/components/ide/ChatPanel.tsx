import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type {
  Message,
  StreamChunk,
  Attachment,
  ChatHistory,
  ChatHistoryItem,
  GeneratedImage,
  McpAppInfo,
} from "~/types/chat";
import type { UserSettings, ModelType, DriveToolMode, SlashCommand } from "~/types/settings";
import type { PluginSlashCommand } from "~/types/plugin";
import {
  getAvailableModels,
  getDefaultModelForPlan,
  getDriveToolModeConstraint,
} from "~/types/settings";
import type { TranslationStrings } from "~/i18n/translations";
import { MessageList } from "~/components/chat/MessageList";
import { ChatInput } from "~/components/chat/ChatInput";
import { useI18n } from "~/i18n/context";

export interface ChatOverrides {
  model?: ModelType | null;
  searchSetting?: string | null;
  driveToolMode?: DriveToolMode | null;
  enabledMcpServers?: string[] | null;
  pluginExecute?: (args: string) => Promise<string>;
}

interface ChatPanelProps {
  settings: UserSettings;
  hasApiKey: boolean;
  hasEncryptedApiKey?: boolean;
  onNeedUnlock?: () => void;
  slashCommands?: SlashCommand[];
  pluginSlashCommands?: PluginSlashCommand[];
}

export function ChatPanel({
  settings,
  hasApiKey,
  hasEncryptedApiKey = false,
  onNeedUnlock,
  slashCommands = [],
  pluginSlashCommands = [],
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
  const [streamingToolCalls, setStreamingToolCalls] = useState<Message["toolCalls"]>([]);
  const [streamingRagSources, setStreamingRagSources] = useState<string[]>([]);
  const [streamingRagUsed, setStreamingRagUsed] = useState(false);
  const [streamingWebSearchUsed, setStreamingWebSearchUsed] = useState(false);
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
  const initialConstraint = getDriveToolModeConstraint(defaultModel, settings.selectedRagSetting);
  const [driveToolMode, setDriveToolMode] = useState<DriveToolMode>(
    initialConstraint.forcedMode ?? initialConstraint.defaultMode
  );
  const [enabledMcpServerNames, setEnabledMcpServerNames] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("gemini-hub:enabledMcpServers");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    return [];
  });

  // Persist MCP selection to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("gemini-hub:enabledMcpServers", JSON.stringify(enabledMcpServerNames));
    } catch { /* ignore */ }
  }, [enabledMcpServerNames]);

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

  // ---- Constraint-based auto-control ----
  const toolConstraint = useMemo(
    () => getDriveToolModeConstraint(selectedModel, selectedRagSetting),
    [selectedModel, selectedRagSetting]
  );

  const applyConstraint = useCallback(
    (model: string, ragSetting: string | null) => {
      const c = getDriveToolModeConstraint(model, ragSetting);
      setDriveToolMode(c.forcedMode ?? c.defaultMode);
      // Gemma or WebSearch: disable MCP (no function calling)
      if (model.toLowerCase().includes("gemma") || ragSetting === "__websearch__") {
        setEnabledMcpServerNames([]);
      }
    },
    []
  );

  const handleRagSettingChange = useCallback(
    (name: string | null) => {
      setSelectedRagSetting(name);
      applyConstraint(selectedModel, name);
    },
    [selectedModel, applyConstraint]
  );

  const handleModelChange = useCallback(
    (model: ModelType) => {
      setSelectedModel(model);
      applyConstraint(model, selectedRagSetting);
    },
    [selectedRagSetting, applyConstraint]
  );

  // ---- Send message ----
  const handleSend = useCallback(
    async (content: string, attachments?: Attachment[], overrides?: ChatOverrides) => {
      // Handle plugin slash commands with execute()
      if (overrides?.pluginExecute) {
        const userMessage: Message = {
          role: "user",
          content,
          timestamp: Date.now(),
          attachments,
        };
        const updatedMessages = [...messages, userMessage];
        setMessages(updatedMessages);
        setIsStreaming(true);
        try {
          const result = await overrides.pluginExecute(content);
          const assistantMessage: Message = {
            role: "assistant",
            content: result,
            timestamp: Date.now(),
          };
          const finalMessages = [...updatedMessages, assistantMessage];
          setMessages(finalMessages);
          await saveChat(finalMessages);
        } catch (err) {
          const errorMessage: Message = {
            role: "assistant",
            content: `**Error:** ${err instanceof Error ? err.message : "Plugin command failed"}`,
            timestamp: Date.now(),
          };
          setMessages([...updatedMessages, errorMessage]);
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      if (!hasApiKey) {
        if (hasEncryptedApiKey && onNeedUnlock) {
          onNeedUnlock();
        }
        return;
      }

      // Apply overrides from slash commands
      const effectiveModel = overrides?.model || selectedModel;
      const effectiveRagSetting = overrides?.searchSetting !== undefined ? overrides.searchSetting : selectedRagSetting;
      const effectiveDriveToolMode = overrides?.driveToolMode || driveToolMode;
      const mcpOverride = overrides?.enabledMcpServers !== undefined ? overrides.enabledMcpServers : null;

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

      const effectiveMcpNames = mcpOverride
        ? mcpOverride
        : isWebSearch ? [] : enabledMcpServerNames;

      const mcpEnabled = effectiveMcpNames.length > 0;

      const mcpServersFiltered = mcpEnabled
        ? settings.mcpServers.filter((s) => effectiveMcpNames.includes(s.name))
        : undefined;

      const body = {
        messages: updatedMessages,
        model: effectiveModel,
        systemPrompt: settings.systemPrompt || undefined,
        ragStoreIds: !isWebSearch && ragStoreIds.length > 0 ? ragStoreIds : undefined,
        driveToolMode: effectiveDriveToolMode,
        enableDriveTools: effectiveDriveToolMode !== "none",
        enableMcp: mcpEnabled,
        mcpServers: mcpServersFiltered,
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
        let mcpApps: McpAppInfo[] = [];

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
                    setStreamingToolCalls([...accumulatedToolCalls]);
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
                  setStreamingRagUsed(true);
                  setStreamingRagSources([...ragSources]);
                  break;
                case "web_search_used":
                  webSearchUsed = true;
                  ragSources = chunk.ragSources || [];
                  setStreamingWebSearchUsed(true);
                  setStreamingRagSources([...ragSources]);
                  break;
                case "image_generated":
                  if (chunk.generatedImage) {
                    generatedImages = [...generatedImages, chunk.generatedImage];
                  }
                  break;
                case "mcp_app":
                  if (chunk.mcpApp) {
                    mcpApps = [...mcpApps, chunk.mcpApp];
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
                    mcpApps:
                      mcpApps.length > 0 ? mcpApps : undefined,
                  };

                  const finalMessages = [
                    ...updatedMessages,
                    assistantMessage,
                  ];
                  setMessages(finalMessages);
                  setStreamingContent("");
                  setStreamingThinking("");
                  setStreamingToolCalls([]);
                  setStreamingRagSources([]);
                  setStreamingRagUsed(false);
                  setStreamingWebSearchUsed(false);
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
        setStreamingToolCalls([]);
        setStreamingRagSources([]);
        setStreamingRagUsed(false);
        setStreamingWebSearchUsed(false);
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [
      hasApiKey,
      hasEncryptedApiKey,
      onNeedUnlock,
      messages,
      selectedModel,
      selectedRagSetting,
      driveToolMode,
      enabledMcpServerNames,
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
        streamingToolCalls={streamingToolCalls}
        streamingRagSources={streamingRagSources}
        streamingRagUsed={streamingRagUsed}
        streamingWebSearchUsed={streamingWebSearchUsed}
        isStreaming={isStreaming}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={!hasApiKey}
        models={availableModels}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
        ragSettings={Object.keys(settings.ragSettings ?? {}).length > 0 ? settings.ragSettings : undefined}
        selectedRagSetting={selectedRagSetting}
        onRagSettingChange={handleRagSettingChange}
        onStop={handleStop}
        isStreaming={isStreaming}
        driveToolMode={driveToolMode}
        onDriveToolModeChange={setDriveToolMode}
        mcpServers={settings.mcpServers}
        enabledMcpServerNames={enabledMcpServerNames}
        onEnabledMcpServerNamesChange={setEnabledMcpServerNames}
        slashCommands={[
          ...slashCommands,
          ...pluginSlashCommands.map((cmd) => ({
            id: `plugin-${cmd.pluginId}-${cmd.name}`,
            name: cmd.name,
            description: cmd.description,
            promptTemplate: "",
            execute: cmd.execute,
          })),
        ]}
        driveToolModeLocked={toolConstraint.locked}
        driveToolModeReasonKey={toolConstraint.reasonKey as keyof TranslationStrings | undefined}
      />
    </div>
  );
}
