/**
 * Gemini Interactions API wrapper (server-only).
 *
 * Provides a streaming proxy for the Interactions API, translating
 * Interactions SSE events into the same StreamChunk format used by
 * gemini-chat-core.ts so the client can consume them identically.
 *
 * Reference implementation: obsidian-gemini-helper/src/core/gemini.ts
 */

import {
  GoogleGenAI,
  type Interactions,
} from "@google/genai";
import type { Message, StreamChunk, StreamChunkUsage, ToolCall } from "~/types/chat";
import type { ToolDefinition, ToolPropertyDefinition, ModelType } from "~/types/settings";
import { MODEL_PRICING, SEARCH_GROUNDING_COST } from "./gemini-chat-core";

// ---------------------------------------------------------------------------
// Tool conversion — Interactions API format
// ---------------------------------------------------------------------------

function toJsonSchema(params: ToolDefinition["parameters"]): Record<string, unknown> {
  const convertProp = (p: ToolPropertyDefinition): Record<string, unknown> => {
    const s: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.enum) s.enum = p.enum;
    if (p.type === "array" && p.items) {
      const items = p.items as ToolPropertyDefinition | { type: string; properties?: Record<string, ToolPropertyDefinition>; required?: string[] };
      if (items.type === "object" && items.properties) {
        const nested: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(items.properties)) nested[k] = convertProp(v);
        s.items = { type: "object", properties: nested, required: items.required };
      } else {
        s.items = { type: items.type };
      }
    }
    if (p.type === "object" && p.properties) {
      const nested: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p.properties)) nested[k] = convertProp(v);
      s.properties = nested;
      if (p.required && p.required.length > 0) s.required = p.required;
    }
    return s;
  };

  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params.properties)) {
    properties[key] = convertProp(value);
  }
  return { type: "object", properties, required: params.required };
}

/**
 * Convert GemiHub ToolDefinition[] + RAG/Search flags into Interactions API Tool_2[].
 * Unlike Chat API, Interactions API allows function + file_search + google_search simultaneously.
 */
export function buildInteractionsTools(
  tools: ToolDefinition[],
  ragStoreIds?: string[],
  ragTopK?: number,
  webSearchEnabled?: boolean,
): Interactions.Tool[] {
  const result: Interactions.Tool[] = [];

  for (const tool of tools) {
    result.push({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool.parameters),
    } as Interactions.Tool);
  }

  if (ragStoreIds && ragStoreIds.length > 0) {
    result.push({
      type: "file_search" as const,
      file_search_store_names: ragStoreIds,
      top_k: ragTopK,
    } as Interactions.Tool);
  }

  if (webSearchEnabled) {
    result.push({
      type: "google_search" as const,
    } as Interactions.Tool);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

function buildSingleMessageInput(msg: Message): string | Interactions.Content[] {
  if (!msg.attachments || msg.attachments.length === 0) {
    return msg.content || "";
  }

  const contents: Interactions.Content[] = [];
  for (const attachment of msg.attachments) {
    switch (attachment.type) {
      case "image":
        contents.push({ type: "image" as const, data: attachment.data, mime_type: attachment.mimeType } as Interactions.Content);
        break;
      case "audio":
        contents.push({ type: "audio" as const, data: attachment.data, mime_type: attachment.mimeType } as Interactions.Content);
        break;
      case "video":
        contents.push({ type: "video" as const, data: attachment.data, mime_type: attachment.mimeType } as Interactions.Content);
        break;
      case "pdf":
        contents.push({ type: "document" as const, data: attachment.data, mime_type: attachment.mimeType } as Interactions.Content);
        break;
      default:
        if (attachment.data) {
          try {
            const decoded = atob(attachment.data);
            contents.push({ type: "text" as const, text: `[File: ${attachment.name}]\n${decoded}` } as Interactions.Content);
          } catch {
            contents.push({ type: "text" as const, text: `[File: ${attachment.name}]` } as Interactions.Content);
          }
        }
        break;
    }
  }
  if (msg.content) {
    contents.push({ type: "text" as const, text: msg.content } as Interactions.Content);
  }
  return contents;
}

function stringifyForHistory(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildHistoryMessageText(msg: Message): string {
  const role = msg.role === "user" ? "User" : "Assistant";
  const lines: string[] = [];

  if (msg.content) {
    lines.push(`${role}: ${msg.content}`);
  } else {
    lines.push(`${role}:`);
  }

  if (msg.attachments && msg.attachments.length > 0) {
    lines.push("Attachments:");
    for (const attachment of msg.attachments) {
      lines.push(`- ${attachment.name} (${attachment.type}, ${attachment.mimeType})`);
    }
  }

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    lines.push("Tool calls:");
    for (const toolCall of msg.toolCalls) {
      lines.push(`- ${toolCall.name}: ${stringifyForHistory(toolCall.args)}`);
    }
  }

  if (msg.toolResults && msg.toolResults.length > 0) {
    lines.push("Tool results:");
    for (const toolResult of msg.toolResults) {
      lines.push(`- ${toolResult.toolCallId}: ${stringifyForHistory(toolResult.result)}`);
    }
  }

  if (msg.ragSources && msg.ragSources.length > 0) {
    lines.push(`Sources: ${msg.ragSources.join(", ")}`);
  }

  if (msg.thinking) {
    lines.push(`Thinking summary: ${msg.thinking}`);
  }

  return lines.join("\n");
}

/**
 * Build Interactions API input from messages.
 * When previousInteractionId is present, sends only the last message (server knows history).
 * When absent, replays conversation history as a text prefix.
 */
export function buildInteractionInput(
  messages: Message[],
  previousInteractionId?: string,
): string | Interactions.Content[] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return "";

  // Chaining: server already has context via previous_interaction_id
  if (previousInteractionId) {
    return buildSingleMessageInput(lastMessage);
  }

  // No chaining: replay history
  const historyMessages = messages.slice(0, -1);
  if (historyMessages.length === 0) {
    return buildSingleMessageInput(lastMessage);
  }

  const lines: string[] = [];
  for (const msg of historyMessages) {
    lines.push(buildHistoryMessageText(msg));
  }
  const historyText = "[Previous conversation]\n" + lines.join("\n\n") + "\n\n[Current message]\n";

  // Text-only last message — merge into single string
  if (!lastMessage.attachments || lastMessage.attachments.length === 0) {
    return historyText + (lastMessage.content || "");
  }

  // Multimodal: history as text prefix, then attachments
  const contents: Interactions.Content[] = [
    { type: "text" as const, text: historyText } as Interactions.Content,
  ];
  const lastParts = buildSingleMessageInput(lastMessage);
  if (Array.isArray(lastParts)) {
    contents.push(...lastParts);
  } else {
    contents.push({ type: "text" as const, text: lastParts } as Interactions.Content);
  }
  return contents;
}

// ---------------------------------------------------------------------------
// Generation config
// ---------------------------------------------------------------------------

type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export function buildGenerationConfig(
  model: ModelType,
  enableThinking?: boolean,
): Interactions.GenerationConfig | undefined {
  const modelLower = model.toLowerCase();
  const supportsThinking = !modelLower.includes("gemma");
  if (!supportsThinking) return undefined;

  const thinkingRequired = modelLower.includes("gemini-3-pro") || modelLower.includes("gemini-3.1-pro");
  let thinkingLevel: ThinkingLevel;

  if (thinkingRequired) {
    thinkingLevel = "high";
  } else if (!enableThinking) {
    thinkingLevel = "minimal";
  } else {
    thinkingLevel = "high";
  }

  return {
    thinking_level: thinkingLevel,
    thinking_summaries: "auto",
  } as Interactions.GenerationConfig;
}

// ---------------------------------------------------------------------------
// Tool result input builder
// ---------------------------------------------------------------------------

export interface ToolResultInput {
  callId: string;
  name: string;
  result: unknown;
}

export function buildToolResultInput(toolResults: ToolResultInput[]): Interactions.Content[] {
  return toolResults.map((tr) => ({
    type: "function_result" as const,
    call_id: tr.callId,
    name: tr.name,
    result: tr.result,
  } as Interactions.Content));
}

// ---------------------------------------------------------------------------
// Usage extraction
// ---------------------------------------------------------------------------

interface InteractionsUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  total_thought_tokens?: number;
}

function extractUsage(usage: InteractionsUsage | undefined, model?: string): StreamChunkUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.total_input_tokens ?? 0;
  const outputTokens = usage.total_output_tokens ?? 0;
  const thinkingTokens = usage.total_thought_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (inputTokens + outputTokens);
  const pricing = model ? MODEL_PRICING[model] : undefined;
  const inputCost = pricing ? inputTokens * pricing.input : undefined;
  const outputCost = pricing ? outputTokens * pricing.output : undefined;
  const totalCost = inputCost !== undefined && outputCost !== undefined ? inputCost + outputCost : undefined;

  return {
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    thinkingTokens: thinkingTokens > 0 ? thinkingTokens : undefined,
    totalTokens: totalTokens || undefined,
    totalCost,
  };
}

// ---------------------------------------------------------------------------
// Stream interaction — single round
// ---------------------------------------------------------------------------

export interface StreamInteractionParams {
  apiKey: string;
  model: ModelType;
  input: string | Interactions.Content[];
  systemPrompt?: string;
  tools?: Interactions.Tool[];
  previousInteractionId?: string;
  generationConfig?: Interactions.GenerationConfig;
  webSearchEnabled?: boolean;
}

/**
 * Stream a single Interactions API round.
 * Yields StreamChunk events. When the interaction requires tool action,
 * yields a `requires_action` chunk with the pending tool calls and interactionId.
 */
export async function* streamInteraction(
  params: StreamInteractionParams,
): AsyncGenerator<StreamChunk> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const createParams: Record<string, unknown> = {
    model: params.model,
    input: params.input,
    stream: true,
    store: true,
  };
  if (params.systemPrompt) {
    createParams.system_instruction = params.systemPrompt;
  }
  if (params.tools && params.tools.length > 0) {
    createParams.tools = params.tools;
  }
  if (params.previousInteractionId) {
    createParams.previous_interaction_id = params.previousInteractionId;
  }
  if (params.generationConfig) {
    createParams.generation_config = params.generationConfig;
  }

  let currentInteractionId: string | undefined;
  const functionCallsToProcess: ToolCall[] = [];
  const accumulatedSources: string[] = [];
  let ragEmitted = false;
  let webSearchEmitted = false;
  let finalUsage: StreamChunkUsage | undefined;

  try {
    const stream = await ai.interactions.create(
      createParams as unknown as Interactions.CreateModelInteractionParamsStreaming,
    );

    for await (const event of stream) {
      const eventType = (event as { event_type?: string }).event_type;

      switch (eventType) {
        case "interaction.start": {
          const interaction = (event as { interaction?: { id?: string } }).interaction;
          currentInteractionId = interaction?.id;
          break;
        }

        case "content.delta": {
          const delta = (event as { delta?: Record<string, unknown> }).delta;
          if (!delta) break;

          switch (delta.type) {
            case "text":
              if ("text" in delta && delta.text) {
                yield { type: "text", content: delta.text as string };
              }
              break;

            case "thought_summary":
              if ("content" in delta && delta.content) {
                const thought = delta.content as { text?: string };
                if (thought.text) {
                  yield { type: "thinking", content: thought.text };
                }
              }
              break;

            case "function_call":
              if ("name" in delta && "id" in delta) {
                functionCallsToProcess.push({
                  id: delta.id as string,
                  name: delta.name as string,
                  args: (delta.arguments as Record<string, unknown>) ?? {},
                });
              }
              break;

            case "file_search_result":
              if ("result" in delta && Array.isArray(delta.result)) {
                for (const r of delta.result as Array<{ title?: string }>) {
                  if (r.title && !accumulatedSources.includes(r.title)) {
                    accumulatedSources.push(r.title);
                  }
                }
              }
              break;

            case "google_search_result":
              if (!webSearchEmitted) {
                webSearchEmitted = true;
                yield { type: "web_search_used", ragSources: [] };
              }
              break;
          }
          break;
        }

        case "interaction.complete": {
          const interaction = (event as { interaction?: { status?: string; usage?: InteractionsUsage } }).interaction;
          if (interaction?.usage) {
            finalUsage = extractUsage(interaction.usage, params.model);
            // Add search grounding cost
            if (params.webSearchEnabled && webSearchEmitted && SEARCH_GROUNDING_COST[params.model] !== undefined) {
              finalUsage = {
                ...finalUsage,
                totalCost: (finalUsage?.totalCost ?? 0) + SEARCH_GROUNDING_COST[params.model],
              };
            }
          }

          const status = interaction?.status;
          if (status === "failed") {
            yield { type: "error", error: "Response failed (possibly blocked by safety filters)" };
            return;
          }
          if (status && status !== "completed" && status !== "requires_action") {
            yield { type: "error", error: `Response ${status}` };
            return;
          }
          break;
        }

        case "error": {
          const errMsg = ((event as { error?: { message?: string } }).error?.message) ?? "Unknown interaction error";
          yield { type: "error", error: errMsg };
          return;
        }
      }
    }

    // Emit accumulated RAG sources
    if (accumulatedSources.length > 0 && !ragEmitted) {
      ragEmitted = true;
      yield { type: "rag_used", ragSources: accumulatedSources };
    }

    // Emit function calls or done
    if (functionCallsToProcess.length > 0) {
      yield {
        type: "requires_action",
        interactionId: currentInteractionId,
        pendingToolCalls: functionCallsToProcess,
        usage: finalUsage,
      };
    } else {
      yield {
        type: "done",
        interactionId: currentInteractionId,
        usage: finalUsage,
      };
    }
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Interactions API call failed",
    };
  }
}
