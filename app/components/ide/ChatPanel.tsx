import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Plus, Trash2, ChevronDown, HardDrive, Loader2, Check } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type {
  Message,
  Attachment,
  ChatHistory,
  ChatHistoryItem,
  GeneratedImage,
  McpAppInfo,
} from "~/types/chat";
import type { UserSettings, ModelType, DriveToolMode, SlashCommand } from "~/types/settings";

import {
  getAvailableModels,
  getDefaultModelForPlan,
  getDriveToolModeConstraint,
  normalizeSelectedMcpServerIds,
} from "~/types/settings";
import type { TranslationStrings } from "~/i18n/translations";
import { MessageList } from "~/components/chat/MessageList";
import { ChatInput } from "~/components/chat/ChatInput";
import { useI18n } from "~/i18n/context";
import { shouldUseImageModel, shouldEnableThinking } from "~/utils/keyword-detection";
import { isImageGenerationModel } from "~/types/settings";
import { isEncryptedFile, decryptWithPrivateKey, decryptFileContent } from "~/services/crypto-core";
import { cryptoCache } from "~/services/crypto-cache";
import { CryptoPasswordPrompt } from "~/components/shared/CryptoPasswordPrompt";
import {
  setCachedFile,
  getLocalSyncMeta,
  setLocalSyncMeta,
} from "~/services/indexeddb-cache";
import { getCachedApiKey } from "~/services/api-key-cache";
import { executeLocalChat, chatStream } from "~/hooks/useLocalChat";
import { executeInteractionsChat } from "~/hooks/useInteractionsChat";
import { processDriveEvent } from "~/utils/drive-file-local";
import { useSkills } from "~/contexts/SkillContext";

export interface ChatOverrides {
  model?: ModelType | null;
  searchSetting?: string | null;
  driveToolMode?: DriveToolMode | null;
  enabledMcpServers?: string[] | null;
  skillId?: string;
}

function isPlanApprovalMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  return [
    /^(ok|okay|yes|y|sure|go ahead|proceed|continue|approved|approve)$/i,
    /^(looks good|sounds good|that works|do it)$/i,
    /^(進めて|続けて|そのまま|お願いします|お願い|承認|okです|了解|はい)$/i,
  ].some((pattern) => pattern.test(normalized));
}

interface ChatPanelProps {
  settings: UserSettings;
  hasApiKey: boolean;
  hasEncryptedApiKey?: boolean;
  onNeedUnlock?: () => void;
  slashCommands?: SlashCommand[];
  onSkillWorkflowStart?: (workflowId: string, workflowName: string) => void;
  onSkillWorkflowEnd?: (workflowId: string, status: string) => void;
  onSkillWorkflowLog?: (log: import("~/engine/types").ExecutionLog) => void;
}

export function ChatPanel({
  settings,
  hasApiKey,
  hasEncryptedApiKey = false,
  onNeedUnlock,
  slashCommands = [],
  onSkillWorkflowStart,
  onSkillWorkflowEnd,
  onSkillWorkflowLog,
}: ChatPanelProps) {
  const { t } = useI18n();
  const { skills, activeSkillIds, toggleSkill, activateSkill, getActiveSkillsSystemPrompt, getActiveSkillWorkflows } = useSkills();
  const [histories, setHistories] = useState<ChatHistoryItem[]>([]);

  // Fetch chat histories on mount
  useEffect(() => {
    fetch("/api/chat/history")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ChatHistoryItem[]) => setHistories(data))
      .catch((e) => console.error("Failed to fetch chat histories:", e));
  }, []);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatFileId, setActiveChatFileId] = useState<string | null>(null);
  const [activeChatCreatedAt, setActiveChatCreatedAt] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<Message["toolCalls"]>([]);
  const [streamingRagSources, setStreamingRagSources] = useState<string[]>([]);
  const [streamingRagUsed, setStreamingRagUsed] = useState(false);
  const [streamingWebSearchUsed, setStreamingWebSearchUsed] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatListOpen, setChatListOpen] = useState(false);
  const [saveMarkdownState, setSaveMarkdownState] = useState<"idle" | "saving" | "saved">("idle");
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingSendRef = useRef<{ content: string; attachments?: Attachment[]; overrides?: ChatOverrides } | null>(null);
  const [pendingEncryptedContent, setPendingEncryptedContent] = useState<string | null>(null);
  const [showCryptoPrompt, setShowCryptoPrompt] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);

  const availableModels = getAvailableModels(settings.apiPlan);
  const defaultModel =
    settings.selectedModel || getDefaultModelForPlan(settings.apiPlan);
  const [selectedModel, setSelectedModel] = useState<ModelType>(defaultModel);

  const [selectedRagSetting, setSelectedRagSetting] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem("gemihub:selectedRagSetting");
      if (stored !== null) return stored || null;
    } catch { /* ignore */ }
    return null;
  });
  const initialConstraint = getDriveToolModeConstraint(defaultModel, selectedRagSetting);
  const [driveToolMode, setDriveToolMode] = useState<DriveToolMode>(
    initialConstraint.forcedMode ?? initialConstraint.defaultMode
  );
  const [enabledMcpServerIds, setEnabledMcpServerIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("gemihub:enabledMcpServers");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    return [];
  });

  // Thinking toggles for Flash / Flash Lite models
  const [thinkFlash, setThinkFlash] = useState(false);
  const [thinkFlashLite, setThinkFlashLite] = useState(true);

  // Resolve thinking toggle for a given model name
  const getThinkingToggle = useCallback((model: string): boolean | undefined => {
    const m = model.toLowerCase();
    if (m.includes("flash-lite")) return thinkFlashLite ? true : undefined;
    if (m.includes("flash") && !m.includes("pro")) return thinkFlash ? true : undefined;
    return undefined;
  }, [thinkFlash, thinkFlashLite]);

  // Persist MCP selection to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("gemihub:enabledMcpServers", JSON.stringify(enabledMcpServerIds));
    } catch { /* ignore */ }
  }, [enabledMcpServerIds]);

  // Migrate legacy name-based selections to ID-based selections and drop stale entries.
  useEffect(() => {
    setEnabledMcpServerIds((prev) => {
      const normalized = normalizeSelectedMcpServerIds(prev, settings.mcpServers);
      if (
        normalized.length === prev.length &&
        normalized.every((id, i) => id === prev[i])
      ) {
        return prev;
      }
      return normalized;
    });
  }, [settings.mcpServers]);

  // ---- Chat history management ----
  const handleNewChat = useCallback(() => {
    setMessages([]);
    setActiveChatId(null);
    setActiveChatFileId(null);
    setActiveChatCreatedAt(null);
    setChatListOpen(false);
  }, []);

  const parseChatContent = useCallback((content: string) => {
    try {
      const chat = JSON.parse(content) as Partial<ChatHistory>;
      if (chat.messages) {
        setMessages(chat.messages as Message[]);
      }
      if (typeof chat.createdAt === "number") {
        setActiveChatCreatedAt(chat.createdAt);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSelectChat = useCallback(
    async (chatId: string, fileId: string) => {
      setChatListOpen(false);
      setActiveChatId(chatId);
      setActiveChatFileId(fileId);
      setActiveChatCreatedAt(
        histories.find((h) => h.id === chatId)?.createdAt ?? null
      );
      setMessages([]);

      try {
        const res = await fetch(
          `/api/drive/files?action=read&fileId=${fileId}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.content) {
            if (isEncryptedFile(data.content)) {
              // Try cached private key first
              const cachedKey = cryptoCache.getPrivateKey();
              if (cachedKey) {
                try {
                  const plain = await decryptWithPrivateKey(data.content, cachedKey);
                  parseChatContent(plain);
                  return;
                } catch { /* cached key failed, try password */ }
              }
              // Try cached password
              const cachedPw = cryptoCache.getPassword();
              if (cachedPw) {
                try {
                  const plain = await decryptFileContent(data.content, cachedPw);
                  parseChatContent(plain);
                  return;
                } catch { /* cached password failed */ }
              }
              // No cached credentials — show password prompt
              setPendingEncryptedContent(data.content);
              setShowCryptoPrompt(true);
            } else {
              parseChatContent(data.content);
            }
          }
        }
      } catch {
        // ignore
      }
    },
    [histories, parseChatContent]
  );

  const handleCryptoUnlock = useCallback(
    async (privateKey: string) => {
      setShowCryptoPrompt(false);
      if (pendingEncryptedContent) {
        try {
          const plain = await decryptWithPrivateKey(pendingEncryptedContent, privateKey);
          parseChatContent(plain);
        } catch {
          // ignore
        }
        setPendingEncryptedContent(null);
      }
    },
    [pendingEncryptedContent, parseChatContent]
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
      const now = Date.now();
      const chatId = activeChatId || `chat-${Date.now()}`;
      const createdAt = activeChatCreatedAt ?? now;
      const chatHistory: ChatHistory = {
        id: chatId,
        title:
          title ||
          updatedMessages[0]?.content?.slice(0, 50) ||
          "Untitled Chat",
        messages: updatedMessages,
        createdAt,
        updatedAt: now,
      };

      try {
        const res = await fetch("/api/chat/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatHistory),
        });
        if (res.ok) {
          const data = await res.json();
          const fileId =
            typeof data.fileId === "string" ? data.fileId : activeChatFileId ?? "";
          if (!activeChatId) {
            setActiveChatId(chatId);
            setActiveChatCreatedAt(createdAt);
          }
          if (fileId) {
            setActiveChatFileId(fileId);
          }
          setHistories((prev) => [
            {
              id: chatId,
              fileId,
              title: chatHistory.title,
              createdAt: chatHistory.createdAt,
              updatedAt: chatHistory.updatedAt,
              isEncrypted: chatHistory.isEncrypted,
            },
            ...prev.filter((h) => h.id !== chatId),
          ]);
        }
      } catch {
        // ignore
      }
    },
    [activeChatCreatedAt, activeChatFileId, activeChatId]
  );

  // Extract the last fileId mentioned in user messages via [Currently open file: ..., fileId: ...]
  const lastFileIdInMessages = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user") {
        const match = msg.content.match(/\[Currently open file: .+?, fileId: (.+?)\]/);
        if (match) return match[1];
      }
    }
    return null;
  }, [messages]);

  // ---- Constraint-based auto-control ----
  const toolConstraint = useMemo(
    () => getDriveToolModeConstraint(selectedModel, selectedRagSetting),
    [selectedModel, selectedRagSetting]
  );

  const applyConstraint = useCallback(
    (model: string, ragSetting: string | null) => {
      const c = getDriveToolModeConstraint(model, ragSetting);
      setDriveToolMode(c.forcedMode ?? c.defaultMode);
      // Modes that disable function calling should also disable MCP.
      const hasRag = !!(ragSetting && ragSetting !== "__websearch__");
      if (
        ragSetting === "__websearch__" ||
        (model.toLowerCase().includes("flash-lite") && hasRag)
      ) {
        setEnabledMcpServerIds([]);
      }
    },
    []
  );

  const handleRagSettingChange = useCallback(
    (name: string | null) => {
      setSelectedRagSetting(name);
      try { localStorage.setItem("gemihub:selectedRagSetting", name ?? ""); } catch { /* ignore */ }
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
      // Paid plan uses server-side API key; free plan needs local key
      const isPaidPlan = settings.apiPlan === "paid";
      const localApiKey = getCachedApiKey();
      if (!isPaidPlan && !localApiKey) {
        if (hasEncryptedApiKey && onNeedUnlock) {
          pendingSendRef.current = { content, attachments, overrides };
          onNeedUnlock();
        }
        return;
      }

      // Apply overrides from slash commands
      let effectiveModel = overrides?.model || selectedModel;
      // Auto-switch to image model when image keywords detected
      if (!isImageGenerationModel(effectiveModel) && shouldUseImageModel(content)) {
        const available = getAvailableModels(settings.apiPlan);
        const preferredImage = available.find((m) => m.name === "gemini-3.1-flash-image-preview")
          || available.find((m) => m.name === "gemini-3-pro-image-preview");
        const fallbackImage = available.find((m) => m.isImageModel);
        if (preferredImage) {
          effectiveModel = preferredImage.name;
        } else if (fallbackImage) {
          effectiveModel = fallbackImage.name;
        }
      }
      const effectiveRagSetting = overrides?.searchSetting !== undefined ? overrides.searchSetting : selectedRagSetting;
      const requestedDriveToolMode = overrides?.driveToolMode || driveToolMode;
      const effectiveConstraint = getDriveToolModeConstraint(
        effectiveModel,
        effectiveRagSetting
      );
      const effectiveDriveToolMode =
        effectiveConstraint.forcedMode ?? requestedDriveToolMode;
      const functionToolsForcedOff =
        effectiveConstraint.locked && effectiveConstraint.forcedMode === "none";
      const mcpOverride = overrides?.enabledMcpServers !== undefined ? overrides.enabledMcpServers : null;

      // When skill invoked with no message, display /skillName
      let displayContent = content;
      if (!displayContent.trim() && overrides?.skillId) {
        const skill = skills.find(s => s.id === overrides.skillId);
        displayContent = skill ? `/${skill.name}` : `/${overrides.skillId}`;
      }

      const userMessage: Message = {
        role: "user",
        content: displayContent,
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

      const effectiveMcpIds = functionToolsForcedOff
        ? []
        : mcpOverride
        ? normalizeSelectedMcpServerIds(mcpOverride, settings.mcpServers)
        : isWebSearch ? [] : enabledMcpServerIds;

      const sendStartTime = Date.now();
      let accumulatedContent = "";
      let accumulatedThinking = "";
      let accumulatedToolCalls: Message["toolCalls"] = [];
      let accumulatedToolResults: Message["toolResults"] = [];
      let ragUsed = false;
      let webSearchUsed = false;
      let ragSources: string[] = [];
      let generatedImages: GeneratedImage[] = [];
      let mcpApps: McpAppInfo[] = [];

      try {
        // Activate skill for future messages; pass as extra so current prompt includes it
        if (overrides?.skillId) {
          activateSkill(overrides.skillId);
        }
        const extraSkillIds = overrides?.skillId ? [overrides.skillId] : undefined;
        const skillPrompt = await getActiveSkillsSystemPrompt(extraSkillIds, settings.hubwork?.accounts);

        // Inject Plan → Create → Verify instruction when webpage-builder skill is active
        // and the user's message looks like a web creation request
        let planInstruction = "";
        if (skillPrompt) {
          const allIds = extraSkillIds
            ? [...new Set([...activeSkillIds, ...extraSkillIds])]
            : activeSkillIds;
          if (allIds.includes("webpage-builder")) {
            planInstruction = [
              "## IMPORTANT: Communication Style",
              "",
              "The user may not be familiar with IT or web development. Always:",
              "- Use plain, non-technical language. Avoid jargon (API, YAML, JSON, endpoint, etc.) unless absolutely necessary, and explain briefly when used.",
              "- Present choices and plans in a simple, easy-to-understand way.",
              "- Focus on WHAT the app will do from the user's perspective, not HOW it works internally.",
              "",
              "## IMPORTANT: Plan Before Action",
              "",
              "If the user's message is a request to create, modify, or build web pages/APIs, you MUST follow this process:",
              "1. **Plan** — Present a numbered list of ALL files (HTML, API YAML, mock JSON) with full `web/` paths. Wait for user confirmation before proceeding.",
              "2. **Create** — After approval, save files one by one using skill workflows.",
              "3. **Verify** — After all saves, read back every file with `read_drive_file` and check against the skill's checklist. Fix any issues.",
              "",
              "Do NOT call `run_skill_workflow` until the user approves the plan.",
            ].join("\n");
          }
        }

        const langInstruction = settings.language === "ja"
          ? "You MUST respond in Japanese (日本語で応答してください)."
          : undefined;
        const fullSystemPrompt = [settings.systemPrompt, langInstruction, planInstruction, skillPrompt]
          .filter(Boolean)
          .join("\n\n") || undefined;
        const skillWorkflows = getActiveSkillWorkflows(extraSkillIds);

        // Paid plan (non-image models) → Interactions API via server
        const useInteractions = settings.apiPlan === "paid" && !isImageGenerationModel(effectiveModel);

        const chatCallbacks = {
          onDriveEvent: (event: import("~/engine/local-executor").DriveEvent) => {
            processDriveEvent(event).catch(() => {});
          },
          onMcpApp: (app: McpAppInfo) => {
            mcpApps = [...mcpApps, app];
          },
          onSkillWorkflowStart,
          onSkillWorkflowEnd,
          onSkillWorkflowLog,
        };

        // Resolve previousInteractionId from last assistant message
        const previousInteractionId = useInteractions
          ? (() => {
              for (let i = updatedMessages.length - 1; i >= 0; i--) {
                if (updatedMessages[i].role === "assistant" && updatedMessages[i].interactionId) {
                  return updatedMessages[i].interactionId;
                }
              }
              return undefined;
            })()
          : undefined;

        // Require explicit approval on the current turn before allowing
        // webpage-builder workflows to run. Prior workflow history in the same
        // thread should not unlock future unrelated requests.
        const needsPlanApproval =
          !!planInstruction && !isPlanApprovalMessage(content);

        const generator = useInteractions
          ? executeInteractionsChat(
              {
                model: effectiveModel,
                messages: updatedMessages,
                systemPrompt: fullSystemPrompt,
                previousInteractionId,
                skillWorkflows: skillWorkflows.length > 0 ? skillWorkflows : undefined,
                driveToolMode: effectiveDriveToolMode,
                mcpServerIds: effectiveMcpIds,
                ragStoreIds: ragStoreIds.length > 0 ? ragStoreIds : undefined,
                webSearchEnabled: isWebSearch,
                enableThinking: getThinkingToggle(effectiveModel) === true || shouldEnableThinking(content),
                maxFunctionCalls: 50,
                functionCallWarningThreshold: 10,
                ragTopK: settings.ragTopK,
                abortSignal: abortController.signal,
                requirePlanApproval: needsPlanApproval,
              },
              chatCallbacks,
            )
          : executeLocalChat(
              {
                apiKey: localApiKey!,
                model: effectiveModel,
                messages: updatedMessages,
                systemPrompt: fullSystemPrompt,
                skillWorkflows: skillWorkflows.length > 0 ? skillWorkflows : undefined,
                driveToolMode: effectiveDriveToolMode,
                mcpServerIds: effectiveMcpIds,
                ragStoreIds: ragStoreIds.length > 0 ? ragStoreIds : undefined,
                webSearchEnabled: isWebSearch,
                enableThinking: getThinkingToggle(effectiveModel) === true || shouldEnableThinking(content),
                maxFunctionCalls: 50,
                functionCallWarningThreshold: 10,
                ragTopK: settings.ragTopK,
                abortSignal: abortController.signal,
              },
              chatCallbacks,
            );

        for await (const chunk of generator) {
          if (abortController.signal.aborted) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
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
                model: effectiveModel,
                interactionId: chunk.interactionId || undefined,
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
                usage: chunk.usage || undefined,
                elapsedMs: Date.now() - sendStartTime,
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
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          if (accumulatedContent) {
            const partialMessage: Message = {
              role: "assistant",
              content: accumulatedContent + "\n\n*(Generation stopped)*",
              timestamp: Date.now(),
              model: effectiveModel,
              thinking: accumulatedThinking || undefined,
              toolCalls:
                accumulatedToolCalls && accumulatedToolCalls.length > 0
                  ? accumulatedToolCalls
                  : undefined,
              toolResults:
                accumulatedToolResults && accumulatedToolResults.length > 0
                  ? accumulatedToolResults
                  : undefined,
              ragUsed: ragUsed || undefined,
              webSearchUsed: webSearchUsed || undefined,
              ragSources: ragSources.length > 0 ? ragSources : undefined,
              generatedImages:
                generatedImages.length > 0 ? generatedImages : undefined,
              mcpApps: mcpApps.length > 0 ? mcpApps : undefined,
              elapsedMs: Date.now() - sendStartTime,
            };
            const finalMessages = [...updatedMessages, partialMessage];
            setMessages(finalMessages);
            await saveChat(finalMessages);
          }
        } else {
          const errorMessage: Message = {
            role: "assistant",
            content: `**Error:** ${(error as Error).message || "Failed to get response"}`,
            timestamp: Date.now(),
          };
          const finalMessages = [...updatedMessages, errorMessage];
          setMessages(finalMessages);
          await saveChat(finalMessages);
        }
      } finally {
        // Only clear streaming state if this is still the active call.
        // A newer handleSend may have already started, in which case
        // abortControllerRef.current points to the new controller.
        if (abortControllerRef.current === abortController) {
          setStreamingContent("");
          setStreamingThinking("");
          setStreamingToolCalls([]);
          setStreamingRagSources([]);
          setStreamingRagUsed(false);
          setStreamingWebSearchUsed(false);
          setIsStreaming(false);
          abortControllerRef.current = null;
        }
      }
    },
    [
      hasEncryptedApiKey,
      onNeedUnlock,
      messages,
      selectedModel,
      selectedRagSetting,
      driveToolMode,
      enabledMcpServerIds,
      settings,
      saveChat,
      getThinkingToggle,
      activateSkill,
      getActiveSkillsSystemPrompt,
      getActiveSkillWorkflows,
      activeSkillIds,
      skills,
      onSkillWorkflowStart,
      onSkillWorkflowEnd,
      onSkillWorkflowLog,
    ]
  );

  // Retry pending send after API key becomes available (password prompt unlock)
  useEffect(() => {
    const handler = () => {
      const pending = pendingSendRef.current;
      if (pending) {
        pendingSendRef.current = null;
        handleSend(pending.content, pending.attachments, pending.overrides);
      }
    };
    window.addEventListener("api-key-cached", handler);
    return () => window.removeEventListener("api-key-cached", handler);
  }, [handleSend]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleSaveAsMarkdown = useCallback(async () => {
    if (saveMarkdownState !== "idle" || messages.length === 0) return;
    setSaveMarkdownState("saving");
    try {
      const lines: string[] = [];
      const title =
        histories.find((h) => h.id === activeChatId)?.title || "Chat";
      lines.push(`# ${title}\n`);
      for (const msg of messages) {
        const ts = new Date(msg.timestamp).toLocaleString();
        if (msg.role === "user") {
          lines.push(`## User (${ts})\n`);
        } else {
          lines.push(
            `## AI${msg.model ? ` [${msg.model}]` : ""} (${ts})\n`
          );
        }
        if (msg.content) lines.push(msg.content + "\n");
        lines.push("---\n");
      }
      const content = lines.join("\n");
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const fileName = `chat-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: fileName,
          content,
          mimeType: "text/markdown",
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      const file = data.file;
      // Cache locally so it doesn't appear in Pull diff
      await setCachedFile({
        fileId: file.id,
        content,
        md5Checksum: file.md5Checksum ?? "",
        modifiedTime: file.modifiedTime ?? "",
        cachedAt: Date.now(),
        fileName: file.name,
      });
      try {
        const localMeta = await getLocalSyncMeta();
        if (localMeta) {
          localMeta.files[file.id] = {
            md5Checksum: file.md5Checksum ?? "",
            modifiedTime: file.modifiedTime ?? "",
          };
          localMeta.lastUpdatedAt = new Date().toISOString();
          await setLocalSyncMeta(localMeta);
        }
      } catch {
        // Non-critical
      }
      setSaveMarkdownState("saved");
      window.dispatchEvent(new Event("sync-complete"));
      setTimeout(() => setSaveMarkdownState("idle"), 3000);
    } catch (e) {
      console.error("Failed to save chat as markdown:", e);
      setSaveMarkdownState("idle");
    }
  }, [saveMarkdownState, messages, histories, activeChatId]);

  // ---- Compact conversation ----
  const handleCompact = useCallback(async () => {
    if (messages.length < 2 || isStreaming || isCompacting) return;
    setIsCompacting(true);

    try {
      // Save current chat first (preserves full history)
      await saveChat(messages);

      // Build conversation text for summarization
      const conversationText = messages
        .map((msg) => {
          const role = msg.role === "user" ? "User" : "Assistant";
          return `${role}: ${msg.content}`;
        })
        .join("\n\n");

      const summaryMessages: Message[] = [
        {
          role: "user",
          content: `Summarize the following conversation concisely. Preserve key information, decisions, file paths, and context that would be needed to continue the conversation. Output the summary in the same language as the conversation.\n\n---\n${conversationText}\n---`,
          timestamp: Date.now(),
        },
      ];

      // Call Gemini directly for compact (local key), or via Interactions API (paid plan)
      let summary = "";
      const compactApiKey = getCachedApiKey();
      if (compactApiKey) {
        const compactGenerator = chatStream(
          compactApiKey,
          selectedModel,
          summaryMessages as Message[],
          "You are a conversation summarizer. Output only the summary without any preamble.",
        );
        for await (const chunk of compactGenerator) {
          if (chunk.type === "text" && chunk.content) {
            summary += chunk.content;
          }
        }
      } else if (settings.apiPlan === "paid") {
        const compactGenerator = executeInteractionsChat({
          model: selectedModel,
          messages: summaryMessages,
          systemPrompt: "You are a conversation summarizer. Output only the summary without any preamble.",
          driveToolMode: "none",
          mcpServerIds: [],
          maxFunctionCalls: 0,
        });
        for await (const chunk of compactGenerator) {
          if (chunk.type === "text" && chunk.content) {
            summary += chunk.content;
          }
        }
      } else {
        throw new Error("API key not available");
      }

      if (!summary.trim()) {
        throw new Error(t("chat.compactFailed"));
      }

      // Start a new chat with compact context
      const now = Date.now();
      const beforeCount = messages.length;
      const userMessage: Message = { role: "user", content: "/compact", timestamp: now };
      const compactedMessage: Message = {
        role: "assistant",
        content: `[${t("chat.compactedContext")}]\n\n${summary}`,
        timestamp: now + 1,
      };
      const newMessages = [userMessage, compactedMessage];

      // Reset to new chat BEFORE saving so saveChat doesn't overwrite the original
      const newChatId = `chat-${Date.now()}`;
      setActiveChatId(newChatId);
      setActiveChatFileId(null);
      setActiveChatCreatedAt(now);
      setMessages(newMessages);

      // Save directly with explicit new chat ID (avoids stale closure of activeChatId)
      const compactTitle = t("chat.compacted").replace("{{before}}", String(beforeCount)).replace("{{after}}", "2");
      const chatHistory: ChatHistory = {
        id: newChatId,
        title: compactTitle,
        messages: newMessages,
        createdAt: now,
        updatedAt: now,
      };
      try {
        const res = await fetch("/api/chat/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatHistory),
        });
        if (res.ok) {
          const data = await res.json();
          const fileId = typeof data.fileId === "string" ? data.fileId : "";
          if (fileId) setActiveChatFileId(fileId);
          setHistories((prev) => [
            { id: newChatId, fileId, title: compactTitle, createdAt: now, updatedAt: now },
            ...prev,
          ]);
        }
      } catch (e) { console.error("Failed to save compacted chat:", e); }
    } catch (error) {
      console.error("Compact failed:", error);
      // Show error to user via a temporary error message in chat
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `**${t("chat.compactFailed")}:** ${error instanceof Error ? error.message : "Unknown error"}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsCompacting(false);
    }
  }, [messages, isStreaming, isCompacting, saveChat, selectedModel, settings.apiPlan, t]);

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
            onClick={handleSaveAsMarkdown}
            disabled={saveMarkdownState === "saving" || messages.length === 0}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
            title={saveMarkdownState === "saved" ? t("chat.savedToDrive") : t("chat.saveToDrive")}
          >
            {saveMarkdownState === "idle" && <HardDrive size={ICON.MD} />}
            {saveMarkdownState === "saving" && <Loader2 size={ICON.MD} className="animate-spin" />}
            {saveMarkdownState === "saved" && <Check size={ICON.MD} className="text-green-500" />}
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
        alwaysThink={getThinkingToggle(selectedModel) === true}
        isPro={settings.hubwork?.plan === "pro" || settings.hubwork?.plan === "granted"}
        onBuildWebApp={() => handleSend("", undefined, { skillId: "webpage-builder" })}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={!hasApiKey && !getCachedApiKey()}
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
        enabledMcpServerIds={enabledMcpServerIds}
        onEnabledMcpServerIdsChange={setEnabledMcpServerIds}
        slashCommands={[
          ...slashCommands,
          ...skills.map((skill) => ({
            id: `__skill__${skill.id}`,
            name: skill.id,
            description: `${skill.name}${skill.description ? ` - ${skill.description}` : ""}`,
            promptTemplate: `/${skill.id} `,
          })),
        ]}
        lastFileIdInMessages={lastFileIdInMessages}
        driveToolModeLocked={toolConstraint.locked}
        driveToolModeReasonKey={toolConstraint.reasonKey as keyof TranslationStrings | undefined}
        thinkFlash={thinkFlash}
        thinkFlashLite={thinkFlashLite}
        onThinkFlashChange={setThinkFlash}
        onThinkFlashLiteChange={setThinkFlashLite}
        onCompact={handleCompact}
        isCompacting={isCompacting}
        messageCount={messages.length}
        skills={skills}
        activeSkillIds={activeSkillIds}
        onToggleSkill={toggleSkill}
      />

      {showCryptoPrompt && settings.encryption.encryptedPrivateKey && (
        <CryptoPasswordPrompt
          encryptedPrivateKey={settings.encryption.encryptedPrivateKey}
          salt={settings.encryption.salt}
          onUnlock={handleCryptoUnlock}
          onCancel={() => { setShowCryptoPrompt(false); setPendingEncryptedContent(null); }}
        />
      )}
    </div>
  );
}
