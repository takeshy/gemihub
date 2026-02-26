// Gemini chat core - browser-safe functions extracted from gemini-chat.server.ts
//
// This module contains pure logic that depends only on @google/genai and types.
// It can be imported from both server and client code.

import {
  GoogleGenAI,
  Type,
  createPartFromFunctionResponse,
  createFunctionResponsePartFromBase64,
  type Content,
  type Part,
  type Tool,
  type Schema,
  type Chat,
} from "@google/genai";
import type { Message, StreamChunk, StreamChunkUsage, ToolCall, GeneratedImage } from "~/types/chat";
import type { ToolDefinition, ToolPropertyDefinition, ModelType } from "~/types/settings";

export interface DriveToolMediaResult {
  __mediaData: {
    mimeType: string;
    base64: string;
    fileName: string;
  };
}

export function isDriveToolMediaResult(value: unknown): value is DriveToolMediaResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "__mediaData" in value &&
    typeof (value as DriveToolMediaResult).__mediaData?.mimeType === "string" &&
    typeof (value as DriveToolMediaResult).__mediaData?.base64 === "string"
  );
}

export interface FunctionCallLimitOptions {
  maxFunctionCalls?: number;
  functionCallWarningThreshold?: number;
}

export interface ChatWithToolsOptions {
  ragTopK?: number;
  functionCallLimits?: FunctionCallLimitOptions;
  disableTools?: boolean;
  webSearchEnabled?: boolean;
  enableThinking?: boolean;
}

const DEFAULT_MAX_FUNCTION_CALLS = 20;
const DEFAULT_WARNING_THRESHOLD = 5;
const DEFAULT_RAG_TOP_K = 5;

// Convert our Message format to Gemini Content format
export function messagesToContents(messages: Message[]): Content[] {
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const fcParts: Part[] = [];
      for (const tc of msg.toolCalls) {
        const part: Part = {
          functionCall: {
            name: tc.name,
            args: tc.args,
          },
        };
        if (tc.thoughtSignature) {
          (part as Record<string, unknown>).thoughtSignature = tc.thoughtSignature;
        }
        fcParts.push(part);
      }
      if (fcParts.length > 0) {
        contents.push({ role: "model", parts: fcParts });
      }

      if (msg.toolResults && msg.toolResults.length > 0) {
        const frParts: Part[] = [];
        for (const tr of msg.toolResults) {
          const matchingCall = msg.toolCalls.find((tc) => tc.id === tr.toolCallId);
          frParts.push({
            functionResponse: {
              name: matchingCall?.name ?? tr.toolCallId,
              id: tr.toolCallId,
              response: { result: tr.result } as Record<string, unknown>,
            },
          });
        }
        if (frParts.length > 0) {
          contents.push({ role: "user", parts: frParts });
        }
      }

      if (msg.content) {
        contents.push({ role: "model", parts: [{ text: msg.content }] });
      }
    } else {
      const parts: Part[] = [];

      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data,
            },
          });
        }
      }

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (parts.length > 0) {
        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts,
        });
      }
    }
  }

  return contents;
}

// Convert tool definitions to Gemini format
export function toolsToGeminiFormat(tools: ToolDefinition[]): Tool[] {
  const convertProperty = (value: ToolPropertyDefinition): Schema => {
    const schema: Schema = {
      type: value.type.toUpperCase() as Type,
      description: value.description,
      enum: value.enum,
    };

    if (value.type === "array" && value.items) {
      const items = value.items as
        | ToolPropertyDefinition
        | {
            type: string;
            properties?: Record<string, ToolPropertyDefinition>;
            required?: string[];
          };

      if (items.type === "object" && items.properties) {
        const nestedProperties: Record<string, Schema> = {};
        for (const [propKey, propValue] of Object.entries(items.properties)) {
          nestedProperties[propKey] = convertProperty(propValue);
        }
        schema.items = {
          type: Type.OBJECT,
          properties: nestedProperties,
          required: items.required,
        };
      } else {
        schema.items = {
          type: items.type.toUpperCase() as Type,
        };
      }
    }

    if (value.type === "object" && value.properties) {
      const nestedProperties: Record<string, Schema> = {};
      for (const [propKey, propValue] of Object.entries(value.properties)) {
        nestedProperties[propKey] = convertProperty(propValue);
      }
      schema.properties = nestedProperties;
      if (value.required && value.required.length > 0) {
        schema.required = value.required;
      }
    }

    return schema;
  };

  const functionDeclarations = tools.map((tool) => {
    const properties: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(tool.parameters.properties)) {
      properties[key] = convertProperty(value);
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: Type.OBJECT,
        properties,
        required: tool.parameters.required,
      },
    };
  });

  return [{ functionDeclarations }];
}

// Model pricing per token (USD)
// Source: https://ai.google.dev/pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash":       { input: 0.30 / 1e6, output: 2.50 / 1e6 },
  "gemini-2.5-flash-lite":  { input: 0.10 / 1e6, output: 0.40 / 1e6 },
  "gemini-2.5-pro":         { input: 1.25 / 1e6, output: 10.00 / 1e6 },
  "gemini-3-flash-preview": { input: 0.50 / 1e6, output: 3.00 / 1e6 },
  "gemini-3-pro-preview":   { input: 2.00 / 1e6, output: 12.00 / 1e6 },
  "gemini-3.1-pro-preview": { input: 2.00 / 1e6, output: 12.00 / 1e6 },
  "gemini-3.1-pro-preview-customtools": { input: 2.00 / 1e6, output: 12.00 / 1e6 },
  "gemini-2.5-flash-image":    { input: 0.30 / 1e6, output: 30.00 / 1e6 },
  "gemini-3-pro-image-preview": { input: 2.00 / 1e6, output: 120.00 / 1e6 },
};

// Grounding with Google Search cost per prompt (USD)
const SEARCH_GROUNDING_COST: Record<string, number> = {
  "gemini-3-flash-preview": 14 / 1000,
  "gemini-3-pro-preview":   14 / 1000,
  "gemini-3.1-pro-preview": 14 / 1000,
  "gemini-3.1-pro-preview-customtools": 14 / 1000,
  "gemini-3-pro-image-preview": 14 / 1000,
  "gemini-2.5-flash":       35 / 1000,
  "gemini-2.5-flash-lite":  35 / 1000,
  "gemini-2.5-pro":         35 / 1000,
  "gemini-2.5-flash-image": 35 / 1000,
};

interface ExtractedUsage {
  input?: number;
  output?: number;
  thinking?: number;
  total?: number;
  inputCost?: number;
  outputCost?: number;
  totalCost?: number;
}

function extractUsage(
  usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; thoughtsTokenCount?: number } | undefined,
  options?: { model?: string; webSearchUsed?: boolean }
): ExtractedUsage | undefined {
  if (!usageMetadata) return undefined;
  const model = options?.model;
  const inputTokens = usageMetadata.promptTokenCount ?? 0;
  const outputTokens = usageMetadata.candidatesTokenCount ?? 0;
  const thinkingTokens = usageMetadata.thoughtsTokenCount ?? 0;
  const pricing = model ? MODEL_PRICING[model] : undefined;
  const inputCost = pricing ? inputTokens * pricing.input : undefined;
  // candidatesTokenCount already includes thinking tokens in Gemini's accounting
  const outputCost = pricing ? outputTokens * pricing.output : undefined;
  let totalCost = inputCost !== undefined && outputCost !== undefined ? inputCost + outputCost : undefined;

  if (options?.webSearchUsed && model && SEARCH_GROUNDING_COST[model] !== undefined) {
    totalCost = (totalCost ?? 0) + SEARCH_GROUNDING_COST[model];
  }

  return {
    input: usageMetadata.promptTokenCount,
    output: usageMetadata.candidatesTokenCount,
    thinking: thinkingTokens > 0 ? thinkingTokens : undefined,
    total: usageMetadata.totalTokenCount,
    inputCost,
    outputCost,
    totalCost,
  };
}

function toStreamChunkUsage(usage: ExtractedUsage | undefined): StreamChunkUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    thinkingTokens: usage.thinking,
    totalTokens: usage.total,
    totalCost: usage.totalCost,
  };
}

export function getThinkingConfig(model: ModelType, enableThinking?: boolean) {
  const modelLower = model.toLowerCase();
  const supportsThinking = !modelLower.includes("gemma");
  if (!supportsThinking) return undefined;
  // gemini-3-pro models require thinking — cannot set thinkingBudget: 0
  const thinkingRequired = modelLower.includes("gemini-3-pro") || modelLower.includes("gemini-3.1-pro");
  if (!enableThinking && !thinkingRequired) return { thinkingBudget: 0 };
  if (modelLower.includes("flash-lite")) {
    return { includeThoughts: true, thinkingBudget: -1 };
  }
  return { includeThoughts: true };
}

/**
 * Simple streaming chat (no tools)
 */
export async function* chatStream(
  apiKey: string,
  model: ModelType,
  messages: Message[],
  systemPrompt?: string
): AsyncGenerator<StreamChunk> {
  const ai = new GoogleGenAI({ apiKey });
  const contents = messagesToContents(messages);

  try {
    const response = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    let hasReceivedChunk = false;
    let lastUsage: ExtractedUsage | undefined;
    for await (const chunk of response) {
      hasReceivedChunk = true;
      if (chunk.usageMetadata) lastUsage = extractUsage(chunk.usageMetadata, { model });
      const text = chunk.text;
      if (text) {
        yield { type: "text", content: text };
      }
    }

    if (!hasReceivedChunk) {
      yield { type: "error", error: "No response received from API (possible server error)" };
      return;
    }

    yield { type: "done", usage: toStreamChunkUsage(lastUsage) };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "API call failed",
    };
  }
}

/**
 * Streaming chat with function calling, RAG, and thinking support
 */
export async function* chatWithToolsStream(
  apiKey: string,
  model: ModelType,
  messages: Message[],
  tools: ToolDefinition[],
  systemPrompt?: string,
  executeToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ragStoreIds?: string[],
  options?: ChatWithToolsOptions
): AsyncGenerator<StreamChunk> {
  const ai = new GoogleGenAI({ apiKey });

  const maxFunctionCalls =
    options?.functionCallLimits?.maxFunctionCalls ?? DEFAULT_MAX_FUNCTION_CALLS;
  const warningThreshold = Math.min(
    options?.functionCallLimits?.functionCallWarningThreshold ?? DEFAULT_WARNING_THRESHOLD,
    maxFunctionCalls
  );
  const rawTopK = options?.ragTopK ?? DEFAULT_RAG_TOP_K;
  const clampedTopK = Number.isFinite(rawTopK) ? Math.min(20, Math.max(1, rawTopK)) : DEFAULT_RAG_TOP_K;
  let functionCallCount = 0;
  let warningEmitted = false;
  let geminiTools: Tool[] | undefined;

  const isGemma = model.toLowerCase().includes("gemma");
  const ragEnabled = !isGemma && ragStoreIds && ragStoreIds.length > 0;
  const webSearchEnabled = options?.webSearchEnabled ?? false;

  if (webSearchEnabled) {
    geminiTools = [{ googleSearch: {} } as Tool];
  } else if (!options?.disableTools) {
    if (tools.length > 0 && !ragEnabled) {
      geminiTools = toolsToGeminiFormat(tools);
    }
    if (ragEnabled) {
      if (!geminiTools) {
        geminiTools = [];
      }
      geminiTools.push({
        fileSearch: {
          fileSearchStoreNames: ragStoreIds,
          topK: clampedTopK,
        },
      } as Tool);
    }
  }

  const historyMessages = messages.slice(0, -1);
  const history = messagesToContents(historyMessages);
  const thinkingConfig = getThinkingConfig(model, options?.enableThinking);

  const chat: Chat = ai.chats.create({
    model,
    history,
    config: {
      systemInstruction: systemPrompt,
      ...(geminiTools ? { tools: geminiTools } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  });

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    yield { type: "error", error: "No user message to send" };
    yield { type: "done" };
    return;
  }

  let continueLoop = true;
  let groundingEmitted = false;
  let searchCostAdded = false;
  const accumulatedSources: string[] = [];
  const messageParts: Part[] = [];
  const totalUsage: ExtractedUsage = { input: 0, output: 0, total: 0 };

  if (lastMessage.attachments && lastMessage.attachments.length > 0) {
    for (const attachment of lastMessage.attachments) {
      messageParts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data,
        },
      });
    }
  }

  if (lastMessage.content) {
    messageParts.push({ text: lastMessage.content });
  }

  try {
    let response = await chat.sendMessageStream({ message: messageParts });

    while (continueLoop) {
      const functionCallsToProcess: Array<{ name: string; args: Record<string, unknown>; thoughtSignature?: string }> = [];
      let hasReceivedChunk = false;
      let roundUsage: ExtractedUsage | undefined;

      for await (const chunk of response) {
        hasReceivedChunk = true;
        if (chunk.usageMetadata) roundUsage = extractUsage(chunk.usageMetadata, { model });
        const chunkWithCandidates = chunk as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown }; thoughtSignature?: string }>;
            };
            groundingMetadata?: {
              groundingChunks?: Array<{
                retrievedContext?: { uri?: string; title?: string };
              }>;
            };
          }>;
        };
        const candidates = chunkWithCandidates.candidates;

        if (candidates && candidates.length > 0) {
          const parts = candidates[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.functionCall) {
                functionCallsToProcess.push({
                  name: part.functionCall.name ?? "",
                  args: (part.functionCall.args as Record<string, unknown>) ?? {},
                  thoughtSignature: part.thoughtSignature,
                });
              }
            }
          }
        }

        if (candidates && candidates.length > 0) {
          const parts = candidates[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.thought && part.text) {
                yield { type: "thinking", content: part.text };
              }
            }
          }
        }

        if (!groundingEmitted && candidates && candidates.length > 0) {
          const groundingMetadata = candidates[0]?.groundingMetadata;
          if (groundingMetadata) {
            if (groundingMetadata.groundingChunks) {
              for (const gc of groundingMetadata.groundingChunks) {
                const ctx = gc.retrievedContext as { uri?: string; title?: string } | undefined;
                const web = (gc as { web?: { uri?: string; title?: string } }).web;
                const source = ctx?.title || ctx?.uri || web?.title || web?.uri;
                if (source && !accumulatedSources.includes(source)) {
                  accumulatedSources.push(source);
                }
              }
            }
          }
        }

        const text = chunk.text;
        if (text) {
          yield { type: "text", content: text };
        }
      }

      if (!hasReceivedChunk) {
        yield { type: "error", error: "No response received from API (possible server error)" };
        break;
      }

      if (accumulatedSources.length > 0 && !groundingEmitted) {
        if (webSearchEnabled) {
          yield { type: "web_search_used", ragSources: accumulatedSources };
        } else {
          yield { type: "rag_used", ragSources: accumulatedSources };
        }
        groundingEmitted = true;
      }

      // Accumulate usage across rounds
      if (roundUsage) {
        totalUsage.input = (totalUsage.input ?? 0) + (roundUsage.input ?? 0);
        totalUsage.output = (totalUsage.output ?? 0) + (roundUsage.output ?? 0);
        if (roundUsage.thinking !== undefined) totalUsage.thinking = (totalUsage.thinking ?? 0) + roundUsage.thinking;
        totalUsage.total = (totalUsage.total ?? 0) + (roundUsage.total ?? 0);
        if (roundUsage.inputCost !== undefined) totalUsage.inputCost = (totalUsage.inputCost ?? 0) + roundUsage.inputCost;
        if (roundUsage.outputCost !== undefined) totalUsage.outputCost = (totalUsage.outputCost ?? 0) + roundUsage.outputCost;
        if (roundUsage.totalCost !== undefined) totalUsage.totalCost = (totalUsage.totalCost ?? 0) + roundUsage.totalCost;
      }
      // Add search grounding cost if web search was used (once)
      if (groundingEmitted && !searchCostAdded && webSearchEnabled && SEARCH_GROUNDING_COST[model] !== undefined) {
        totalUsage.totalCost = (totalUsage.totalCost ?? 0) + SEARCH_GROUNDING_COST[model];
        searchCostAdded = true;
      }

      if (functionCallsToProcess.length > 0 && executeToolCall) {
        const remainingBefore = maxFunctionCalls - functionCallCount;

        if (remainingBefore <= 0) {
          yield {
            type: "text",
            content: "\n\n[Function call limit reached. Summarizing with available information...]",
          };
          response = await chat.sendMessageStream({
            message: [
              {
                text: "You have reached the function call limit. Please provide a final answer based on the information gathered so far.",
              },
            ],
          });
          for await (const chunk of response) {
            const text = chunk.text;
            if (text) {
              yield { type: "text", content: text };
            }
          }
          continueLoop = false;
          continue;
        }

        const callsToExecute = functionCallsToProcess.slice(0, remainingBefore);
        const skippedCount = functionCallsToProcess.length - callsToExecute.length;
        const remainingAfter = remainingBefore - callsToExecute.length;

        if (!warningEmitted && remainingAfter <= warningThreshold) {
          warningEmitted = true;
          yield {
            type: "text",
            content: `\n\n[Note: ${remainingAfter} function calls remaining. Please work efficiently.]`,
          };
        }

        const functionResponseParts: Part[] = [];

        for (const fc of callsToExecute) {
          const toolCall: ToolCall = {
            id: (fc as { id?: string }).id ?? `${fc.name}_${Date.now()}`,
            name: fc.name,
            args: fc.args,
            thoughtSignature: fc.thoughtSignature,
          };

          yield { type: "tool_call", toolCall };

          const result = await executeToolCall(fc.name, fc.args);

          if (isDriveToolMediaResult(result)) {
            yield {
              type: "tool_result",
              toolResult: {
                toolCallId: toolCall.id,
                result: { mediaFile: result.__mediaData.fileName, mimeType: result.__mediaData.mimeType },
              },
            };
          } else {
            yield {
              type: "tool_result",
              toolResult: { toolCallId: toolCall.id, result },
            };
          }

          if (isDriveToolMediaResult(result)) {
            functionResponseParts.push(
              createPartFromFunctionResponse(
                toolCall.id,
                fc.name,
                { fileName: result.__mediaData.fileName },
                [createFunctionResponsePartFromBase64(result.__mediaData.base64, result.__mediaData.mimeType)]
              )
            );
          } else {
            functionResponseParts.push({
              functionResponse: {
                name: fc.name,
                id: toolCall.id,
                response: { result } as Record<string, unknown>,
              },
            });
          }
        }

        functionCallCount += callsToExecute.length;

        if (skippedCount > 0 || functionCallCount >= maxFunctionCalls) {
          const skippedMsg = skippedCount > 0 ? ` (${skippedCount} additional calls were skipped)` : "";
          yield {
            type: "text",
            content: `\n\n[Function call limit reached${skippedMsg}. Summarizing with available information...]`,
          };

          if (functionResponseParts.length > 0) {
            functionResponseParts.push({
              text: "[System: Function call limit reached. Please provide a final answer based on the information gathered so far.]",
            } as Part);
            response = await chat.sendMessageStream({
              message: functionResponseParts,
            });
          } else {
            response = await chat.sendMessageStream({
              message: [
                {
                  text: "You have reached the function call limit. Please provide a final answer based on the information gathered so far.",
                },
              ],
            });
          }

          for await (const chunk of response) {
            const text = chunk.text;
            if (text) {
              yield { type: "text", content: text };
            }
          }
          continueLoop = false;
          continue;
        }

        if (warningEmitted && remainingAfter <= warningThreshold) {
          functionResponseParts.push({
            text: `[System: You have ${remainingAfter} function calls remaining. Please complete your task efficiently or provide a summary.]`,
          } as Part);
        }

        response = await chat.sendMessageStream({
          message: functionResponseParts,
        });
      } else {
        continueLoop = false;
      }
    }

    yield { type: "done", usage: toStreamChunkUsage(totalUsage.total ? totalUsage : undefined) };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "API call failed",
    };
  }
}

/**
 * Image generation using Gemini
 */
export async function* generateImageStream(
  apiKey: string,
  messages: Message[],
  imageModel: ModelType,
  systemPrompt?: string
): AsyncGenerator<StreamChunk> {
  const ai = new GoogleGenAI({ apiKey });

  const historyMessages = messages.slice(0, -1);
  const history = messagesToContents(historyMessages);

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    yield { type: "error", error: "No user message to send" };
    yield { type: "done" };
    return;
  }

  const messageParts: Part[] = [];

  if (lastMessage.attachments && lastMessage.attachments.length > 0) {
    for (const attachment of lastMessage.attachments) {
      messageParts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data,
        },
      });
    }
  }

  if (lastMessage.content) {
    messageParts.push({ text: lastMessage.content });
  }

  try {
    const response = await ai.models.generateContent({
      model: imageModel,
      contents: [...history, { role: "user", parts: messageParts }],
      config: {
        systemInstruction: systemPrompt,
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          if ("text" in part && part.text) {
            yield { type: "text", content: part.text };
          }
          if ("inlineData" in part && part.inlineData) {
            const imageData = part.inlineData as { mimeType?: string; data?: string };
            if (imageData.mimeType && imageData.data) {
              const generatedImage: GeneratedImage = {
                mimeType: imageData.mimeType,
                data: imageData.data,
              };
              yield { type: "image_generated", generatedImage };
            }
          }
        }
      }
    }

    const imageUsage = extractUsage(response.usageMetadata, { model: imageModel });
    yield { type: "done", usage: toStreamChunkUsage(imageUsage) };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Image generation failed",
    };
    yield { type: "done" };
  }
}
