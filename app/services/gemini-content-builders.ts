/**
 * Pure helpers for translating GemiHub chat / tool definitions into the
 * `@google/genai` SDK request shape.
 *
 * Lives outside `.server.ts` so Vertex chat, compacting, and workflow
 * generation share the same canonical conversion logic.
 *
 * No GCP / network / IO — pure data transforms.
 */

import {
  Type,
  ThinkingLevel,
  type Content,
  type Part,
  type Schema,
  type Tool,
} from "@google/genai";
import type { Message } from "~/types/chat";
import type {
  ModelType,
  ToolDefinition,
  ToolPropertyDefinition,
} from "~/types/settings";

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

/**
 * Strip empty arrays/objects and null/undefined from tool results to avoid
 * Gemini API "empty value" errors in function_response payloads.
 */
export function sanitizeToolResult(val: unknown): unknown {
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

/** Convert GemiHub Message[] to the SDK's Content[]. */
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
              response: { result: sanitizeToolResult(tr.result) } as Record<string, unknown>,
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

/** Convert GemiHub tool definitions to the SDK's Tool[]. */
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

/**
 * Pick the right thinking-config shape per model.
 *
 * Notes from production:
 *   - Gemma: thinking is built-in, `thinkingConfig` is not accepted at all.
 *   - Gemini 3.8 Flash and 3.5 Flash Lite use `thinkingLevel` (categorical)
 *     instead of `thinkingBudget` (integer).
 *   - gemini-3-pro / gemini-3.1-pro: thinking is mandatory; you cannot
 *     opt out with thinkingBudget: 0.
 */
export function getThinkingConfig(model: ModelType, enableThinking?: boolean) {
  const modelLower = model.toLowerCase();
  if (modelLower.includes("gemma")) return undefined;
  if (modelLower.includes("gemini-3.8-flash")) {
    return enableThinking
      ? { includeThoughts: true, thinkingLevel: ThinkingLevel.HIGH }
      : { thinkingLevel: ThinkingLevel.LOW };
  }
  if (modelLower.includes("gemini-3.5-flash-lite")) {
    if (!enableThinking) return undefined;
    return { includeThoughts: true, thinkingLevel: ThinkingLevel.HIGH };
  }
  const thinkingRequired =
    modelLower.includes("gemini-3-pro") || modelLower.includes("gemini-3.1-pro");
  if (!enableThinking && !thinkingRequired) return { thinkingBudget: 0 };
  if (modelLower === "gemini-2.5-flash-lite") {
    return { includeThoughts: true, thinkingBudget: -1 };
  }
  return { includeThoughts: true };
}
