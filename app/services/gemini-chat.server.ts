// Gemini chat client - ported from obsidian-gemini-helper (server-side version)

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
import type { Message, StreamChunk, ToolCall, GeneratedImage } from "~/types/chat";
import type { ToolDefinition, ToolPropertyDefinition, ModelType } from "~/types/settings";
import type { DriveToolMediaResult } from "./drive-tools.server";

function isDriveToolMediaResult(value: unknown): value is DriveToolMediaResult {
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
}

const DEFAULT_MAX_FUNCTION_CALLS = 20;
const DEFAULT_WARNING_THRESHOLD = 5;
const DEFAULT_RAG_TOP_K = 5;

// Convert our Message format to Gemini Content format
function messagesToContents(messages: Message[]): Content[] {
  return messages.map((msg) => {
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

    return {
      role: msg.role === "user" ? "user" : "model",
      parts,
    };
  });
}

// Convert tool definitions to Gemini format
function toolsToGeminiFormat(tools: ToolDefinition[]): Tool[] {
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

function getThinkingConfig(model: ModelType) {
  const modelLower = model.toLowerCase();
  const supportsThinking = !modelLower.includes("gemma");
  if (!supportsThinking) return undefined;
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

  const response = await ai.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction: systemPrompt,
    },
  });

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      yield { type: "text", content: text };
    }
  }

  yield { type: "done" };
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
  const isFlashLite = model.toLowerCase().includes("flash-lite");
  const ragEnabled = !isGemma && ragStoreIds && ragStoreIds.length > 0;
  const webSearchEnabled = options?.webSearchEnabled ?? false;

  if (webSearchEnabled) {
    // Web Search mode: use googleSearch only (incompatible with other tools)
    geminiTools = [{ googleSearch: {} } as Tool];
  } else if (!options?.disableTools) {
    if (tools.length > 0 && !(isFlashLite && ragEnabled)) {
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
  const supportsThinking = !model.toLowerCase().includes("gemma");
  const thinkingConfig = getThinkingConfig(model);

  const chat: Chat = ai.chats.create({
    model,
    history,
    config: {
      systemInstruction: systemPrompt,
      ...(geminiTools ? { tools: geminiTools } : {}),
      ...(supportsThinking ? { thinkingConfig } : {}),
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
  const accumulatedSources: string[] = [];
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

  let response = await chat.sendMessageStream({ message: messageParts });

  while (continueLoop) {
    const functionCallsToProcess: Array<{ name: string; args: Record<string, unknown> }> = [];

    for await (const chunk of response) {
      if (chunk.functionCalls && chunk.functionCalls.length > 0) {
        for (const fc of chunk.functionCalls) {
          functionCallsToProcess.push({
            name: fc.name ?? "",
            args: (fc.args as Record<string, unknown>) ?? {},
          });
        }
      }

      const chunkWithCandidates = chunk as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string; thought?: boolean }>;
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

    if (accumulatedSources.length > 0 && !groundingEmitted) {
      if (webSearchEnabled) {
        yield { type: "web_search_used", ragSources: accumulatedSources };
      } else {
        yield { type: "rag_used", ragSources: accumulatedSources };
      }
      groundingEmitted = true;
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

  yield { type: "done" };
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

    yield { type: "done" };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Image generation failed",
    };
    yield { type: "done" };
  }
}
