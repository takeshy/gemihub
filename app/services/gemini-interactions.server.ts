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
  type Part,
  type Tool,
} from "@google/genai";
import type { Message, StreamChunk, StreamChunkUsage, ToolCall, Attachment, WebSearchSource } from "~/types/chat";
import type { ToolDefinition, ToolPropertyDefinition, ModelType } from "~/types/settings";
import { mustUseWebSearchOnly, supportsWebSearch } from "~/types/settings";
import { formatFileSearchSource, MODEL_PRICING, SEARCH_GROUNDING_COST } from "./gemini-chat-core";
import { DEFAULT_SAFETY_SETTINGS } from "./gemini.server";

const FILE_SEARCH_STORE_PREFIX = "fileSearchStores/";

function collectWebSources(value: unknown, sources: WebSearchSource[]): void {
  if (typeof value === "string") {
    const anchorPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of value.matchAll(anchorPattern)) {
      const url = match[1].replace(/&amp;/g, "&");
      const title = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || url;
      if (/^https?:\/\//i.test(url) && !sources.some((source) => source.url === url)) sources.push({ title, url });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWebSources(item, sources);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const url = [record.url, record.uri, record.link].find((candidate) => typeof candidate === "string");
  if (typeof url === "string" && /^https?:\/\//i.test(url) && !sources.some((source) => source.url === url)) {
    const title = [record.title, record.name].find((candidate) => typeof candidate === "string");
    sources.push({ title: typeof title === "string" ? title : url, url });
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectWebSources(nested, sources);
  }
}

function normalizeFileSearchStoreName(storeName: string | null | undefined): string | null {
  const trimmed = storeName?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith(FILE_SEARCH_STORE_PREFIX) ? trimmed : `${FILE_SEARCH_STORE_PREFIX}${trimmed}`;
}

// ---------------------------------------------------------------------------
// RAG pre-retrieval via generateContent API
// ---------------------------------------------------------------------------

export interface RagContext {
  source: string;
  text: string;
}

/**
 * Retrieve RAG context via the generateContent API (file_search tool).
 * The Interactions API does not support the file_search tool (returns 501
 * not_implemented), so RAG retrieval is done as a pre-processing step using
 * the generateContent API. The retrieved contexts are injected into the
 * system prompt for the subsequent Interactions API call, preserving both
 * RAG and function calling capabilities.
 */
export async function retrieveRagContext(
  apiKey: string,
  model: ModelType,
  userMessage: string,
  ragStoreIds: string[],
  topK: number,
  attachments?: Attachment[],
): Promise<{ sources: string[]; contexts: RagContext[] }> {
  const ai = new GoogleGenAI({ apiKey });

  const normalizedStoreIds = ragStoreIds
    .map((id) => normalizeFileSearchStoreName(id))
    .filter((id): id is string => !!id);
  if (normalizedStoreIds.length === 0) return { sources: [], contexts: [] };

  const parts: Part[] = [];
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      parts.push({
        inlineData: { mimeType: attachment.mimeType, data: attachment.data },
      });
    }
    if (userMessage) {
      parts.push({ text: userMessage });
    }
  } else {
    parts.push({ text: userMessage });
  }

  const tools: Tool[] = [{
    fileSearch: {
      fileSearchStoreNames: normalizedStoreIds,
      topK,
    },
  }];

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { tools, safetySettings: DEFAULT_SAFETY_SETTINGS },
  });

  const groundingMetadata = (response.candidates?.[0] as {
    groundingMetadata?: {
      groundingChunks?: Array<{
        retrievedContext?: {
          title?: string;
          text?: string;
          uri?: string;
          pageNumber?: number;
          page_number?: number;
          mediaId?: string;
          media_id?: string;
          customMetadata?: Array<{ key?: string; stringValue?: string; string_value?: string; numericValue?: number; numeric_value?: number }>;
          custom_metadata?: Array<{ key?: string; stringValue?: string; string_value?: string; numericValue?: number; numeric_value?: number }>;
        };
      }>;
    };
  })?.groundingMetadata;

  const chunks = groundingMetadata?.groundingChunks ?? [];
  const sources: string[] = [];
  const contexts: RagContext[] = [];

  for (const chunk of chunks) {
    const ctx = chunk.retrievedContext;
    if (!ctx) continue;
    const source = formatFileSearchSource(ctx);
    if (!source) continue;
    if (!sources.includes(source)) {
      sources.push(source);
    }
    const text = String(ctx.text ?? "").replace(/\s+/g, " ").trim();
    if (text) {
      const excerpt = text.length > 500 ? text.slice(0, 500) + "..." : text;
      if (!contexts.some((c) => c.source === source && c.text === excerpt)) {
        contexts.push({ source, text: excerpt });
      }
    }
  }

  return { sources, contexts };
}

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
 * Convert GemiHub ToolDefinition[] + search flags into Interactions API Tool_2[].
 * Function tools, File Search, and Google Search are represented as native
 * Interactions API tools.
 */
export function buildInteractionsTools(
  tools: ToolDefinition[],
  webSearchEnabled?: boolean,
  model?: ModelType,
  ragStoreIds?: string[],
  ragTopK?: number,
): Interactions.Tool[] {
  const result: Interactions.Tool[] = [];
  const effectiveWebSearch = webSearchEnabled && (!model || supportsWebSearch(model));
  const includeFunctionTools = !(model && mustUseWebSearchOnly(model) && effectiveWebSearch);

  if (includeFunctionTools) {
    for (const tool of tools) {
      result.push({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: toJsonSchema(tool.parameters),
      } as Interactions.Tool);
    }
  }

  const normalizedStoreIds = ragStoreIds
    ?.map((id) => normalizeFileSearchStoreName(id))
    .filter((id): id is string => !!id);
  if (normalizedStoreIds && normalizedStoreIds.length > 0 && (!model || !model.toLowerCase().includes("gemma"))) {
    result.push({
      type: "file_search" as const,
      file_search_store_names: normalizedStoreIds,
      top_k: ragTopK,
    } as Interactions.Tool);
  }

  if (effectiveWebSearch) {
    result.push({
      type: "google_search" as const,
    } as Interactions.Tool);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

function buildSingleMessageContent(msg: Message): Interactions.Content[] {
  if (!msg.attachments || msg.attachments.length === 0) {
    return [{ type: "text" as const, text: msg.content || "" } as Interactions.Content];
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
 * Build Interactions API input from messages using the step_list schema.
 * When previousInteractionId is present, sends only the last message (server knows history).
 * When absent, replays conversation history as a text prefix in a single user_input step.
 */
export function buildInteractionInput(
  messages: Message[],
  previousInteractionId?: string,
): Interactions.Step[] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return [];

  // Chaining: server already has context via previous_interaction_id
  if (previousInteractionId) {
    return [{
      type: "user_input" as const,
      content: buildSingleMessageContent(lastMessage),
    } as Interactions.Step];
  }

  // No chaining: replay history
  const historyMessages = messages.slice(0, -1);
  if (historyMessages.length === 0) {
    return [{
      type: "user_input" as const,
      content: buildSingleMessageContent(lastMessage),
    } as Interactions.Step];
  }

  const lines: string[] = [];
  for (const msg of historyMessages) {
    lines.push(buildHistoryMessageText(msg));
  }
  const historyText = "[Previous conversation]\n" + lines.join("\n\n") + "\n\n[Current message]\n";

  // Text-only last message — merge into single text content
  if (!lastMessage.attachments || lastMessage.attachments.length === 0) {
    return [{
      type: "user_input" as const,
      content: [{ type: "text" as const, text: historyText + (lastMessage.content || "") } as Interactions.Content],
    } as Interactions.Step];
  }

  // Multimodal: history as text prefix, then attachments
  const contents: Interactions.Content[] = [
    { type: "text" as const, text: historyText } as Interactions.Content,
    ...buildSingleMessageContent(lastMessage),
  ];
  return [{
    type: "user_input" as const,
    content: contents,
  } as Interactions.Step];
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
  // Gemma 4: thinking is built-in (always on), config parameters not supported
  if (modelLower.includes("gemma")) return undefined;

  const thinkingRequired = modelLower.includes("gemini-3-pro") || modelLower.includes("gemini-3.1-pro");
  let thinkingLevel: ThinkingLevel;

  if (thinkingRequired) {
    thinkingLevel = "high";
  } else if (modelLower.includes("gemini-3.6-flash") || modelLower.includes("gemini-3.5-flash-lite")) {
    thinkingLevel = enableThinking ? "high" : "low";
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

/**
 * Strip empty arrays/objects and null/undefined from tool results
 * to avoid Gemini API "empty value" errors in function_response.
 */
function sanitizeToolResult(val: unknown): unknown {
  if (val === null || val === undefined) return "(empty)";
  if (Array.isArray(val)) {
    if (val.length === 0) return "(empty list)";
    return val.map(sanitizeToolResult);
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      cleaned[k] = sanitizeToolResult(v);
    }
    return Object.keys(cleaned).length > 0 ? cleaned : "(empty)";
  }
  return val;
}

function serializeToolResult(value: unknown): string {
  const sanitized = sanitizeToolResult(value);
  if (typeof sanitized === "string") return sanitized || "null";
  try {
    return JSON.stringify(sanitized) || "null";
  } catch {
    return "null";
  }
}

export function buildToolResultInput(toolResults: ToolResultInput[]): Interactions.Step[] {
  return toolResults.map((tr) => ({
    type: "function_result" as const,
    call_id: tr.callId,
    name: tr.name,
    result: serializeToolResult(tr.result),
  } as Interactions.Step));
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
  input: Interactions.Step[];
  systemPrompt?: string;
  tools?: Interactions.Tool[];
  previousInteractionId?: string;
  generationConfig?: Interactions.GenerationConfig;
  webSearchEnabled?: boolean;
  // RAG pre-retrieval params (only on initial round, not resume)
  ragStoreIds?: string[];
  ragTopK?: number;
  ragUserMessage?: string;
  ragAttachments?: Attachment[];
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

  let ragEmitted = false;

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
  const functionCallByIndex = new Map<number, { id: string; name: string; args: Record<string, unknown> }>();
  const argumentsBufferByIndex = new Map<number, string>();
  const accumulatedSources: string[] = [];
  const webSearchSources: WebSearchSource[] = [];
  let fileSearchUsed = false;
  let webSearchEmitted = false;
  let finalUsage: StreamChunkUsage | undefined;

  try {
    const stream = await ai.interactions.create(
      createParams as unknown as Interactions.CreateModelInteractionParamsStreaming,
    );

    for await (const event of stream) {
      const eventType = (event as { event_type?: string }).event_type;

      switch (eventType) {
        case "interaction.created": {
          const interaction = (event as { interaction?: { id?: string } }).interaction;
          currentInteractionId = interaction?.id;
          break;
        }

        case "step.start": {
          const step = (event as { step?: { type?: string } }).step;
          const index = (event as { index?: number }).index ?? 0;
          if (step?.type === "function_call") {
            const fc = step as { id: string; name: string; arguments: Record<string, unknown> };
            functionCallByIndex.set(index, {
              id: fc.id,
              name: fc.name,
              args: fc.arguments ?? {},
            });
          } else if (step?.type === "google_search_call") {
            if (!webSearchEmitted) {
              webSearchEmitted = true;
              yield { type: "web_search_used", ragSources: [] };
            }
          } else if (step?.type === "file_search_call") {
            fileSearchUsed = true;
          }
          break;
        }

        case "step.delta": {
          const delta = (event as { delta?: Record<string, unknown> }).delta;
          const index = (event as { index?: number }).index ?? 0;
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

            case "arguments_delta":
              if ("arguments" in delta && delta.arguments) {
                const existing = argumentsBufferByIndex.get(index) ?? "";
                argumentsBufferByIndex.set(index, existing + (delta.arguments as string));
              }
              break;

            case "file_search_result":
              fileSearchUsed = true;
              if ("result" in delta && Array.isArray(delta.result)) {
                for (const r of delta.result as Array<{
                  title?: string;
                  uri?: string;
                  pageNumber?: number;
                  page_number?: number;
                  mediaId?: string;
                  media_id?: string;
                  customMetadata?: Array<{ key?: string; stringValue?: string; string_value?: string; numericValue?: number; numeric_value?: number }>;
                  custom_metadata?: Array<{ key?: string; stringValue?: string; string_value?: string; numericValue?: number; numeric_value?: number }>;
                }>) {
                  const source = formatFileSearchSource({
                    title: r.title,
                    uri: r.uri,
                    pageNumber: r.pageNumber,
                    page_number: r.page_number,
                    mediaId: r.mediaId,
                    media_id: r.media_id,
                    customMetadata: r.customMetadata ?? r.custom_metadata,
                  });
                  if (source && !accumulatedSources.includes(source)) {
                    accumulatedSources.push(source);
                  }
                }
              }
              break;

            case "google_search_result":
              collectWebSources(delta, webSearchSources);
              if (!webSearchEmitted) {
                webSearchEmitted = true;
                yield { type: "web_search_used", ragSources: [] };
              }
              break;
          }
          break;
        }

        case "interaction.completed": {
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

    // Merge streamed arguments into function calls
    for (const [index, argsStr] of argumentsBufferByIndex) {
      const fc = functionCallByIndex.get(index);
      if (fc && argsStr) {
        try {
          fc.args = JSON.parse(argsStr);
        } catch {
          // keep original args from step.start
        }
      }
    }
    for (const [, fc] of functionCallByIndex) {
      functionCallsToProcess.push({ id: fc.id, name: fc.name, args: fc.args });
    }

    // Emit RAG usage even when File Search returned no matching sources.
    if (fileSearchUsed && !ragEmitted) {
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
        webSearchSources: webSearchSources.length > 0 ? webSearchSources : undefined,
      };
    } else {
      yield {
        type: "done",
        interactionId: currentInteractionId,
        usage: finalUsage,
        webSearchSources: webSearchSources.length > 0 ? webSearchSources : undefined,
      };
    }
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Interactions API call failed",
    };
  }
}
