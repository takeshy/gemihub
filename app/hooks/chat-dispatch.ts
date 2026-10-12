/**
 * Picks the chat execution path for the active mount and plan, so the chat
 * panel and other callers (Timeline @ai answers) run on the same providers.
 */
import { executeLocalChat, type LocalChatCallbacks, type LocalChatOptions } from "~/hooks/useLocalChat";
import { executeChatStream } from "~/hooks/chat-stream-client";
import { executeInteractionsChat } from "~/hooks/useInteractionsChat";
import { VERTEX_MODELS } from "~/services/ai/models";
import {
  AVAILABLE_MODELS,
  getAvailableModels,
  isImageGenerationModel,
  type ApiPlan,
  type ModelInfo,
  type ModelType,
  type UserSettings,
} from "~/types/settings";
import type { StreamChunk } from "~/types/chat";

export interface ChatProjectSelection {
  projectId: string;
  orgId: string;
  allowedModels: string[];
}

export type ChatDispatchOptions = Omit<LocalChatOptions, "apiKey"> & {
  settings: UserSettings;
  /** Org project selection; the chat then runs on the tenant's Vertex AI. */
  projectSelection: ChatProjectSelection | null;
  /** The browser-held Gemini API key (required on the free plan). */
  apiKey: string | null;
  /** Interactions API continuation (paid plan only). */
  previousInteractionId?: string;
};

/** Paid plan uses Interactions; images always go through the key-based paths. */
export function usesInteractions(settings: Pick<UserSettings, "apiPlan">, model: ModelType): boolean {
  return settings.apiPlan === "paid" && !isImageGenerationModel(model);
}

/** True when chat can run without a browser-held API key. */
export function chatNeedsNoApiKey(settings: Pick<UserSettings, "apiPlan" | "usePersonalVertex">, projectSelection: ChatProjectSelection | null): boolean {
  return !!projectSelection || settings.apiPlan === "paid" || settings.usePersonalVertex === true;
}

/**
 * Models offered for the active mount. Project mount: the Vertex catalogue,
 * narrowed by the project's allowedModels; the user's apiPlan does not apply.
 */
export function availableChatModels(projectSelection: ChatProjectSelection | null, apiPlan: ApiPlan): ModelInfo[] {
  if (projectSelection) {
    const vertexNames = Object.values(VERTEX_MODELS) as ModelType[];
    const allowedNames = projectSelection.allowedModels.length > 0
      ? vertexNames.filter((name) => projectSelection.allowedModels.includes(name))
      : vertexNames;
    return allowedNames.map(
      (name) =>
        AVAILABLE_MODELS.find((m) => m.name === name) ??
        ({ name, displayName: name, description: "" } satisfies ModelInfo),
    );
  }
  return getAvailableModels(apiPlan);
}

export function startChatStream(
  options: ChatDispatchOptions,
  callbacks?: LocalChatCallbacks,
): AsyncGenerator<StreamChunk> {
  const { projectSelection, apiKey, previousInteractionId, ...common } = options;
  if (projectSelection) {
    return executeChatStream(
      {
        ...common,
        projectId: projectSelection.projectId,
        mountKey: `gcs:${projectSelection.orgId}/${projectSelection.projectId}`,
      },
      callbacks,
    );
  }
  // Personal Vertex takes priority for a Drive-mount user who opted into it.
  if (common.settings.usePersonalVertex === true) {
    // No mountKey: that namespaces the PROJECT storage cache. A fabricated one
    // would send skill-workflow file writes into a namespace nothing else
    // reads. The Drive mount's own cache is addressed by file id.
    return executeChatStream({ ...common, personalVertex: true }, callbacks);
  }
  if (usesInteractions(common.settings, common.model)) {
    return executeInteractionsChat(
      { ...common, previousInteractionId, geminiApiKey: apiKey ?? undefined },
      callbacks,
    );
  }
  if (!apiKey) throw new Error("Gemini API key is not available");
  return executeLocalChat({ ...common, apiKey }, callbacks);
}
