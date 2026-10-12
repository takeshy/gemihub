import { useCallback, useMemo, useState } from "react";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import { useSkills } from "~/contexts/SkillContext";
import { availableChatModels, chatNeedsNoApiKey, startChatStream } from "~/hooks/chat-dispatch";
import { ensureCachedApiKey, getCachedApiKey } from "~/services/api-key-cache";
import { getCachedLoaderDataInMemory } from "~/services/loader-data-memory";
import { processDriveEvent } from "~/utils/drive-file-local";
import {
  buildTimelineAiPrompt,
  loadTimelineAiSettings,
  saveTimelineAiSettings,
  TIMELINE_ANSWER_INSTRUCTION,
  type TimelineAiSettings,
} from "~/services/timeline-ai";
import type { TimelineEntry } from "~/services/timeline-format";
import {
  getDefaultModelForPlan,
  getDriveToolModeConstraint,
  getEnabledMcpServers,
  isImageGenerationModel,
  normalizeSelectedMcpServerIds,
  supportsWebSearch,
  type ModelType,
  type UserSettings,
} from "~/types/settings";

export interface TimelineAiChoices {
  models: { name: ModelType; displayName: string }[];
  /** The model answers use: the saved one when still offered, else the default. */
  model: ModelType | "";
  webSearch: boolean;
  ragSettings: string[];
  mcpServers: { id: string; name: string }[];
  skills: { id: string; name: string }[];
}

function loaderSettings(): UserSettings | undefined {
  return getCachedLoaderDataInMemory()?.settings;
}

/** @ai answer settings (kept per browser, like the chat's selections) and the answer runner. */
export function useTimelineAi() {
  const projectSelection = useEnterpriseSelection();
  const { skills, getSkillsSystemPrompt, getSkillWorkflows } = useSkills();
  const [aiSettings, setAiSettings] = useState<TimelineAiSettings>(loadTimelineAiSettings);

  const updateAiSettings = useCallback((patch: Partial<TimelineAiSettings>) => {
    setAiSettings((prev) => {
      const next = { ...prev, ...patch };
      saveTimelineAiSettings(next);
      return next;
    });
  }, []);

  const choices = useMemo((): TimelineAiChoices | null => {
    const settings = loaderSettings();
    if (!settings) return null;
    const models = availableChatModels(projectSelection, settings.apiPlan).filter((m) => !m.isImageModel);
    const fallback = settings.selectedModel || getDefaultModelForPlan(settings.apiPlan);
    const model = models.find((m) => m.name === aiSettings.model)?.name
      ?? models.find((m) => m.name === fallback)?.name
      ?? models[0]?.name
      ?? "";
    return {
      models,
      model,
      webSearch: !!model && supportsWebSearch(model),
      ragSettings: settings.ragFeatureEnabled ? Object.keys(settings.ragSettings ?? {}) : [],
      mcpServers: getEnabledMcpServers(settings).map((server) => ({ id: server.id || server.name, name: server.name })),
      skills: skills.map((skill) => ({ id: skill.id, name: skill.name })),
    };
  }, [projectSelection, aiSettings.model, skills]);

  /** Generate the reply to `question`; `thread` is its whole thread, oldest first. */
  const answer = useCallback(async (thread: TimelineEntry[], question: TimelineEntry, language: string): Promise<{ content: string; model: ModelType }> => {
    const settings = loaderSettings();
    if (!settings || !choices?.model) throw new Error("No AI model is available");
    const model = choices.model;
    if (isImageGenerationModel(model)) throw new Error("Choose a text model");

    const apiKey = getCachedApiKey() ?? (await ensureCachedApiKey());
    if (!apiKey && !chatNeedsNoApiKey(settings, projectSelection)) throw new Error("API_KEY_MISSING");

    const webSearchEnabled = aiSettings.search === "web" && choices.webSearch;
    const rag = aiSettings.search.startsWith("rag:") && settings.ragFeatureEnabled
      ? settings.ragSettings[aiSettings.search.slice(4)]
      : undefined;
    const ragStoreIds = rag ? (rag.isExternal ? rag.storeIds : rag.storeId ? [rag.storeId] : []) : [];
    const constraint = getDriveToolModeConstraint(
      model,
      webSearchEnabled ? "__websearch__" : ragStoreIds.length > 0 ? "__rag__" : null,
    );
    const driveToolMode = constraint.forcedMode ?? (aiSettings.driveRead ? "readOnly" : "none");
    const functionToolsForcedOff = constraint.locked && constraint.forcedMode === "none";
    const mcpServerIds = functionToolsForcedOff
      ? []
      : normalizeSelectedMcpServerIds(aiSettings.mcpServers, getEnabledMcpServers(settings));
    const skillIds = aiSettings.skills.filter((id) => skills.some((skill) => skill.id === id));
    const skillPrompt = await getSkillsSystemPrompt(skillIds, settings.hubwork?.accounts);
    const skillWorkflows = getSkillWorkflows(skillIds);
    const languageInstruction = language === "ja"
      ? "If the language of the post is unclear, write in Japanese."
      : "If the language of the post is unclear, write in English.";

    const generator = startChatStream(
      {
        settings,
        projectSelection,
        apiKey,
        model,
        canUseProxy: true,
        messages: [{ role: "user", content: buildTimelineAiPrompt(thread, question), timestamp: Date.now() }],
        systemPrompt: [settings.systemPrompt, skillPrompt, TIMELINE_ANSWER_INSTRUCTION, languageInstruction].filter(Boolean).join("\n\n"),
        skillWorkflows: skillWorkflows.length > 0 ? skillWorkflows : undefined,
        driveToolMode,
        mcpServerIds,
        ragStoreIds: ragStoreIds.length > 0 ? ragStoreIds : undefined,
        webSearchEnabled,
        maxFunctionCalls: 20,
        functionCallWarningThreshold: 10,
        ragTopK: settings.ragTopK,
      },
      {
        onDriveEvent: (event) => { processDriveEvent(event).catch(() => {}); },
      },
    );

    let content = "";
    for await (const chunk of generator) {
      if (chunk.type === "text") content += chunk.content ?? "";
      else if (chunk.type === "error") throw new Error(chunk.error || "AI generation failed");
    }
    if (!content.trim()) throw new Error("AI returned an empty answer");
    return { content: content.trim(), model };
  }, [aiSettings, choices, projectSelection, skills, getSkillsSystemPrompt, getSkillWorkflows]);

  return { aiSettings, updateAiSettings, choices, answer };
}
