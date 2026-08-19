/**
 * Vertex-mode chat surface for gemihub.
 *
 * Supersedes the old API-key-based chat paths.
 * All calls run inside the tenant's GCP project via SA impersonation
 * (see vertex-ai.server.ts).
 *
 * Layered build:
 *   - streamCompact / streamWithTools for chat streaming
 *   - generateCompact / generateStructured for one-shot generation
 *   - generateWorkflowStream for workflow YAML generation
 *
 * Patterns ported from /home/takeshy/work/lisa (Rails reference impl):
 *   - No safetySettings (lisa explicitly skips them; Vertex defaults are fine)
 *   - thinkingBudget when thinking is requested (handled by getThinkingConfig)
 *   - tools: [{ google_search: {} }] for web search (next commit)
 *   - retry policy on non-streaming only — streaming partials aren't idempotent
 *
 * See docs/enterprise.md §8.
 */

import { FinishReason, type Part, type Tool } from "@google/genai";
import type {
  Message,
  StreamChunk,
  StreamChunkUsage,
  ToolCall,
} from "~/types/chat";
import type { ModelType, ToolDefinition } from "~/types/settings";
import type { TenantInfo } from "~/types/enterprise";
import { createVertexClient, getVertexAccessToken } from "./vertex-ai.server";
import {
  getThinkingConfig,
  messagesToContents,
  sanitizeToolResult,
  toolsToGeminiFormat,
} from "./gemini-content-builders";
import { callWithVertexRetry } from "./vertex-retry.server";
import {
  buildInlineSchemaPrompt,
  chooseSchemaMode,
} from "./vertex-schema.server";
import {
  assertAiBudgetAvailable,
  recordAiUsage,
  type AiBillingContext,
} from "./ai-budget.server";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? "";

// ---------------------------------------------------------------------------
// Shared types / helpers
// ---------------------------------------------------------------------------

export interface VertexCallParams {
  tenant: TenantInfo;
  model: ModelType;
  messages: Message[];
  systemPrompt?: string;
  enableThinking?: boolean;
  billing?: AiBillingContext;
}

async function recordAiUsageSafely(
  billing: AiBillingContext | undefined,
  model: string,
  usage?: StreamChunkUsage,
): Promise<void> {
  if (!billing || !usage) return;
  try {
    await recordAiUsage(billing, model, usage);
  } catch (error) {
    console.error("[ai-budget] failed to record usage", error);
  }
}

function isOpenModelMaaS(model: string): boolean {
  return model.endsWith("-maas");
}

function toOpenModelPublisherModel(model: string): string {
  return model.includes("/") ? model : `google/${model}`;
}

/** Translate a Vertex finishReason into a user-facing error message, or null if OK. */
function blockReasonOf(candidates: Array<{ finishReason?: string }> | undefined): string | null {
  if (!candidates || candidates.length === 0) return null;
  const reason = candidates[0].finishReason;
  if (reason === FinishReason.SAFETY) {
    return "Response blocked by safety filters. Please rephrase your message.";
  }
  if (reason === FinishReason.RECITATION) {
    return "Response blocked due to potential recitation of copyrighted content.";
  }
  return null;
}

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

function toStreamUsage(meta: UsageMetadata | undefined): StreamChunkUsage | undefined {
  if (!meta) return undefined;
  const usage: StreamChunkUsage = {
    inputTokens: meta.promptTokenCount,
    outputTokens: meta.candidatesTokenCount,
    thinkingTokens: meta.thoughtsTokenCount,
    totalTokens: meta.totalTokenCount,
  };
  return usage;
}

// ---------------------------------------------------------------------------
// streamCompact — text-only streaming
// ---------------------------------------------------------------------------

/**
 * Stream a text-only response. Mirrors the legacy `chatStream` shape so
 * SSE consumers (e.g. api.chat.compact.tsx) don't need to change.
 */
export async function* streamCompact(
  params: VertexCallParams,
): AsyncGenerator<StreamChunk> {
  if (params.billing) await assertAiBudgetAvailable(params.billing);
  if (isOpenModelMaaS(params.model)) {
    let usage: StreamChunkUsage | undefined;
    for await (const chunk of streamOpenModelCompact(params)) {
      if (chunk.type === "done") usage = chunk.usage;
      yield chunk;
    }
    await recordAiUsageSafely(params.billing, params.model, usage);
    return;
  }

  const ai = await createVertexClient(params.tenant);
  const contents = messagesToContents(params.messages);
  const thinkingConfig = getThinkingConfig(params.model, params.enableThinking);

  try {
    const response = await ai.models.generateContentStream({
      model: toOpenModelPublisherModel(params.model),
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    let received = false;
    let lastUsage: UsageMetadata | undefined;
    for await (const chunk of response) {
      received = true;
      const usage = (chunk as { usageMetadata?: UsageMetadata }).usageMetadata;
      if (usage) lastUsage = usage;
      const blockReason = blockReasonOf(
        (chunk as { candidates?: Array<{ finishReason?: string }> }).candidates,
      );
      if (blockReason) {
        yield { type: "error", error: blockReason };
        return;
      }
      const text = chunk.text;
      if (text) yield { type: "text", content: text };
    }

    if (!received) {
      yield { type: "error", error: "No response received from Vertex (possible server error)" };
      return;
    }
    const usage = toStreamUsage(lastUsage);
    await recordAiUsageSafely(params.billing, params.model, usage);
    yield { type: "done", usage };
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : "Vertex call failed",
    };
  }
}

// ---------------------------------------------------------------------------
// generateCompact — non-streaming, retry-wrapped
// ---------------------------------------------------------------------------

export interface GenerateResult {
  text: string;
  usage?: StreamChunkUsage;
}

/**
 * Single-shot text generation. Retry policy from vertex-retry.server.ts
 * applies — caller does NOT need to wrap.
 */
export async function generateCompact(params: VertexCallParams): Promise<GenerateResult> {
  if (params.billing) await assertAiBudgetAvailable(params.billing);
  if (isOpenModelMaaS(params.model)) {
    const result = await generateOpenModelCompact(params);
    await recordAiUsageSafely(params.billing, params.model, result.usage);
    return result;
  }

  const ai = await createVertexClient(params.tenant);
  const contents = messagesToContents(params.messages);
  const thinkingConfig = getThinkingConfig(params.model, params.enableThinking);

  const result = await callWithVertexRetry(async () => {
    const response = await ai.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    const text = response.text ?? "";
    const usage = (response as { usageMetadata?: UsageMetadata }).usageMetadata;
    return { text, usage: toStreamUsage(usage) };
  });
  await recordAiUsageSafely(params.billing, params.model, result.usage);
  return result;
}

// ---------------------------------------------------------------------------
// generateStructured — JSON output with depth-aware schema fallback
// ---------------------------------------------------------------------------

export interface GenerateStructuredParams extends VertexCallParams {
  schema: unknown;
}

export interface GenerateStructuredResult<T = unknown> {
  data: T;
  raw: string;
  mode: "schema" | "inline";
  usage?: StreamChunkUsage;
}

/**
 * Generate a JSON response that conforms to the given schema.
 *   - Shallow schema → uses `responseJsonSchema` directly
 *   - Deep schema (≥ 8 levels) → falls back to inlining the schema in the
 *     prompt + `responseMimeType: application/json` only
 * (See docs/enterprise.md §8.4.)
 */
export async function generateStructured<T = unknown>(
  params: GenerateStructuredParams,
): Promise<GenerateStructuredResult<T>> {
  if (params.billing) await assertAiBudgetAvailable(params.billing);
  const ai = await createVertexClient(params.tenant);
  const thinkingConfig = getThinkingConfig(params.model, params.enableThinking);
  const { mode } = chooseSchemaMode(params.schema);

  const messages =
    mode === "inline"
      ? withInlinedSchemaInLastUserMessage(params.messages, params.schema)
      : params.messages;
  const contents = messagesToContents(messages);

  const result = await callWithVertexRetry(async () => {
    const response = await ai.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        responseMimeType: "application/json",
        ...(mode === "schema"
          ? { responseJsonSchema: params.schema as Record<string, unknown> }
          : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    const raw = response.text ?? "";
    let data: T;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      // Last-ditch: try to slice the first JSON object out of the response
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          data = JSON.parse(raw.slice(start, end + 1)) as T;
        } catch {
          throw new Error(`Vertex returned non-JSON output: ${raw.slice(0, 200)}`);
        }
      } else {
        throw new Error(`Vertex returned non-JSON output: ${raw.slice(0, 200)}`);
      }
    }
    const usage = (response as { usageMetadata?: UsageMetadata }).usageMetadata;
    return { data, raw, mode, usage: toStreamUsage(usage) };
  });
  await recordAiUsageSafely(params.billing, params.model, result.usage);
  return result;
}

// ---------------------------------------------------------------------------
// streamWithTools — function calling + google_search + thinking
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FUNCTION_CALLS = 50;

export interface StreamWithToolsParams extends VertexCallParams {
  tools: ToolDefinition[];
  webSearchEnabled?: boolean;
  /** Server-side dispatcher for function calls. */
  executeToolCall: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  maxFunctionCalls?: number;
  /**
   * Tool names that the SERVER cannot execute and must hand back to the
   * client. When the model emits a function call whose name is in this set,
   * streamWithTools yields a `requires_action` chunk and exits without
   * advancing — the caller is expected to execute the tool client-side and
   * POST again with the tool results appended to the message history.
   *
   * Used for client-only tools like execute_javascript / run_skill_workflow
   * which the server has no way to run safely.
   */
  delegateToolNames?: ReadonlySet<string>;
}

interface VertexCandidatePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name?: string; args?: unknown };
  inlineData?: { mimeType?: string; data?: string };
}

type OpenAiChatRole = "user" | "assistant" | "tool";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiMessage {
  role: OpenAiChatRole;
  content?: string | Array<Record<string, unknown>> | null;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiChoiceDelta {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: OpenAiChoiceDelta;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

interface OpenAiChatCompletion {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: OpenAiStreamChunk["usage"];
  error?: {
    message?: string;
  };
}

function toOpenAiUsage(usage: OpenAiStreamChunk["usage"]): StreamChunkUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function stringifyToolArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return "{}";
  }
}

function extractStringArg(raw: string, key: string): string | undefined {
  const keyMatch = raw.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!keyMatch || keyMatch.index == null) return undefined;
  const start = keyMatch.index + keyMatch[0].length;
  let escaped = false;
  let value = "";
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      value += `\\${ch}`;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") break;
    value += ch;
  }
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function parseToolArguments(raw: string, toolName?: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (err) {
    const args: Record<string, unknown> = {
      __parseError: err instanceof Error ? err.message : "Malformed tool arguments",
    };
    if (toolName === "read_project_file" || toolName === "update_project_file" || toolName === "rename_project_file") {
      const fileId = extractStringArg(raw, "fileId");
      if (fileId) args.fileId = fileId;
    }
    if (toolName === "create_project_file") {
      const name = extractStringArg(raw, "name");
      if (name) args.name = name;
    }
    if (toolName === "search_project_files") {
      const query = extractStringArg(raw, "query");
      const folder = extractStringArg(raw, "folder");
      if (query) args.query = query;
      if (folder) args.folder = folder;
    }
    if (toolName === "list_project_files") {
      const folder = extractStringArg(raw, "folder");
      if (folder) args.folder = folder;
    }
    if (toolName === "run_skill_workflow") {
      const workflowId = extractStringArg(raw, "workflowId");
      const variables = extractStringArg(raw, "variables");
      if (workflowId) args.workflowId = workflowId;
      if (variables) args.variables = variables;
    }
    return args;
  }
}

function attachmentToOpenAiContent(attachment: NonNullable<Message["attachments"]>[number]): Record<string, unknown> {
  if (attachment.type === "image") {
    return {
      type: "image_url",
      image_url: {
        url: `data:${attachment.mimeType};base64,${attachment.data}`,
      },
    };
  }
  return {
    type: "text",
    text: `[Attachment: ${attachment.name} (${attachment.mimeType})]\n${attachment.data}`,
  };
}

function messagesToOpenAiMessages(messages: Message[], systemPrompt?: string): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  let pendingSystemPrompt = systemPrompt?.trim() || "";

  for (const message of messages) {
    if (message.role === "user") {
      const text = pendingSystemPrompt
        ? `${pendingSystemPrompt}\n\n${message.content || ""}`.trim()
        : message.content;
      pendingSystemPrompt = "";
      if (message.attachments && message.attachments.length > 0) {
        out.push({
          role: "user",
          content: [
            { type: "text", text: text || "" },
            ...message.attachments.map(attachmentToOpenAiContent),
          ],
        });
      } else {
        out.push({ role: "user", content: text || "" });
      }
      continue;
    }

    const toolCalls: OpenAiToolCall[] = (message.toolCalls ?? []).map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: stringifyToolArguments(toolCall.args),
      },
    }));
    out.push({
      role: "assistant",
      content: message.content || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
    for (const toolResult of message.toolResults ?? []) {
      out.push({
        role: "tool",
        tool_call_id: toolResult.toolCallId,
        content: JSON.stringify({ result: sanitizeToolResult(toolResult.result) }),
      });
    }
  }

  if (out.length === 0 && pendingSystemPrompt) {
    out.push({ role: "user", content: pendingSystemPrompt });
  }
  return out;
}

function toolsToOpenAiFormat(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function openModelChatUrl(tenant: TenantInfo): string {
  const location = tenant.vertexLocation?.trim() || tenant.region || "global";
  const projectId = tenant.vertexProjectId?.trim() || GCP_PROJECT_ID;
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectId}/locations/${location}/endpoints/openapi/chat/completions`;
}

async function* iterOpenAiSse(response: Response): AsyncGenerator<OpenAiStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const dataLines: string[] = [];
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        dataLines.push(data);
      }
      if (dataLines.length > 0) {
        const joined = dataLines.join("");
        try {
          yield JSON.parse(joined) as OpenAiStreamChunk;
        } catch {
          yield JSON.parse(dataLines.join("\n")) as OpenAiStreamChunk;
        }
      }
    }
  }
}

async function* streamOpenModelCompact(
  params: VertexCallParams,
): AsyncGenerator<StreamChunk> {
  const accessToken = await getVertexAccessToken(params.tenant);
  const response = await fetch(openModelChatUrl(params.tenant), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: toOpenModelPublisherModel(params.model),
      messages: messagesToOpenAiMessages(params.messages, params.systemPrompt),
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    yield { type: "error", error: `Gemma 4 MaaS error ${response.status}: ${text}` };
    return;
  }

  let lastUsage: StreamChunkUsage | undefined;
  for await (const chunk of iterOpenAiSse(response)) {
    if (chunk.error?.message) {
      yield { type: "error", error: chunk.error.message };
      return;
    }
    if (chunk.usage) lastUsage = toOpenAiUsage(chunk.usage);
    for (const choice of chunk.choices ?? []) {
      const text = choice.delta?.content;
      if (text) yield { type: "text", content: text };
    }
  }
  yield { type: "done", usage: lastUsage };
}

async function generateOpenModelCompact(params: VertexCallParams): Promise<GenerateResult> {
  return callWithVertexRetry(async () => {
    const accessToken = await getVertexAccessToken(params.tenant);
    const response = await fetch(openModelChatUrl(params.tenant), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: toOpenModelPublisherModel(params.model),
        messages: messagesToOpenAiMessages(params.messages, params.systemPrompt),
        stream: false,
      }),
    });
    const data = await response.json().catch(() => null) as OpenAiChatCompletion | null;
    if (!response.ok) {
      throw new Error(data?.error?.message || `Gemma 4 MaaS error ${response.status}`);
    }
    return {
      text: data?.choices?.[0]?.message?.content ?? "",
      usage: toOpenAiUsage(data?.usage),
    };
  });
}

async function* streamOpenModelWithTools(
  params: StreamWithToolsParams,
): AsyncGenerator<StreamChunk> {
  if (params.webSearchEnabled) {
    yield { type: "error", error: "Gemma 4 MaaS does not support the Gemini Google Search tool mode. Use normal chat/RAG/tools or switch to a Gemini model for Web Search." };
    yield { type: "done" };
    return;
  }

  const maxFunctionCalls = params.maxFunctionCalls ?? DEFAULT_MAX_FUNCTION_CALLS;
  const accessToken = await getVertexAccessToken(params.tenant);
  const url = openModelChatUrl(params.tenant);
  const tools = params.tools.length > 0 ? toolsToOpenAiFormat(params.tools) : undefined;
  const messages = messagesToOpenAiMessages(params.messages, params.systemPrompt);
  let functionCallsMade = 0;
  let lastUsage: StreamChunkUsage | undefined;

  while (true) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: toOpenModelPublisherModel(params.model),
        messages,
        stream: false,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      }),
    });

    const data = await response.json().catch(() => null) as OpenAiChatCompletion | null;
    if (!response.ok || data?.error?.message) {
      yield {
        type: "error",
        error: data?.error?.message || `Gemma 4 MaaS error ${response.status}`,
      };
      yield { type: "done", usage: lastUsage };
      return;
    }

    lastUsage = toOpenAiUsage(data?.usage) ?? lastUsage;
    const message = data?.choices?.[0]?.message;
    const assistantText = message?.content ?? "";

    const toolCalls = (message?.tool_calls ?? [])
      .filter((toolCall) => toolCall.function.name)
      .map((toolCall): ToolCall => ({
        id: toolCall.id,
        name: toolCall.function.name,
        args: parseToolArguments(toolCall.function.arguments, toolCall.function.name),
      }));

    if (toolCalls.length === 0) {
      if (assistantText) yield { type: "text", content: assistantText };
      yield { type: "done", usage: lastUsage };
      return;
    }

    messages.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: stringifyToolArguments(toolCall.args),
        },
      })),
    });

    const delegated = toolCalls.filter((toolCall) => params.delegateToolNames?.has(toolCall.name));
    if (delegated.length > 0) {
      yield { type: "requires_action", pendingToolCalls: delegated };
      return;
    }

    for (const toolCall of toolCalls) {
      functionCallsMade += 1;
      if (functionCallsMade > maxFunctionCalls) {
        yield {
          type: "error",
          error: `Maximum function calls (${maxFunctionCalls}) exceeded`,
        };
        yield { type: "done", usage: lastUsage };
        return;
      }
      yield { type: "tool_call", toolCall };
      const result = await params.executeToolCall(toolCall.name, toolCall.args);
      const toolResult = { toolCallId: toolCall.id, result };
      yield { type: "tool_result", toolResult };
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify({ result: sanitizeToolResult(result) }),
      });
    }
  }
}

interface VertexGroundingChunk {
  retrievedContext?: { uri?: string; title?: string };
  web?: { uri?: string; title?: string };
}

interface VertexCandidate {
  finishReason?: string;
  content?: { parts?: VertexCandidatePart[] };
  groundingMetadata?: { groundingChunks?: VertexGroundingChunk[] };
}

interface VertexChunk {
  text?: string;
  usageMetadata?: UsageMetadata;
  candidates?: VertexCandidate[];
}

function textPartsFromChunk(chunk: VertexChunk): string {
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("");
}

function splitToolContinuationMessage(message: Message): {
  modelCallParts: Part[];
  userResponseParts: Part[];
} | null {
  if (message.role !== "assistant" || !message.toolCalls?.length || !message.toolResults?.length) {
    return null;
  }

  const modelCallParts: Part[] = message.toolCalls.map((toolCall) => {
    const part: Part = {
      functionCall: {
        name: toolCall.name,
        args: toolCall.args,
      },
    };
    if (toolCall.thoughtSignature) {
      (part as Record<string, unknown>).thoughtSignature = toolCall.thoughtSignature;
    }
    return part;
  });

  const userResponseParts: Part[] = message.toolResults.map((toolResult) => {
    const matchingCall = message.toolCalls?.find((toolCall) => toolCall.id === toolResult.toolCallId);
    return {
      functionResponse: {
        name: matchingCall?.name ?? toolResult.toolCallId,
        id: toolResult.toolCallId,
        response: { result: sanitizeToolResult(toolResult.result) } as Record<string, unknown>,
      },
    };
  });

  return { modelCallParts, userResponseParts };
}

// ---------------------------------------------------------------------------
// generateWorkflowStream — workflow YAML streaming
// ---------------------------------------------------------------------------

export interface WorkflowStreamChunk {
  type: "thinking" | "text" | "error" | "done";
  content?: string;
}

export async function* generateWorkflowStream(
  userPrompt: string,
  systemPrompt: string,
  tenant: TenantInfo,
  model: ModelType,
  history?: Array<{ role: "user" | "model"; text: string }>,
  billing?: AiBillingContext,
): AsyncGenerator<WorkflowStreamChunk> {
  try {
    if (billing) await assertAiBudgetAvailable(billing);
    const ai = await createVertexClient(tenant);
    const thinkingConfig = getThinkingConfig(model, true);

    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
    if (history && history.length > 0) {
      for (const msg of history) {
        contents.push({ role: msg.role, parts: [{ text: msg.text }] });
      }
    }
    contents.push({ role: "user", parts: [{ text: userPrompt }] });

    const response = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    let lastUsage: UsageMetadata | undefined;
    for await (const rawChunk of response) {
      const chunk = rawChunk as VertexChunk;
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
      const blockReason = blockReasonOf(chunk.candidates);
      if (blockReason) {
        yield { type: "error", content: blockReason };
        return;
      }
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.thought && part.text) {
            yield { type: "thinking", content: part.text };
          } else if (part.text) {
            yield { type: "text", content: part.text };
          }
        }
      }
    }

    await recordAiUsageSafely(billing, model, toStreamUsage(lastUsage));
    yield { type: "done" };
  } catch (err) {
    yield {
      type: "error",
      content: err instanceof Error ? err.message : String(err),
    };
  }
}

function accumulateUsage(
  total: UsageMetadata | undefined,
  round: UsageMetadata | undefined,
): UsageMetadata | undefined {
  if (!round) return total;
  if (!total) return { ...round };
  return {
    promptTokenCount: (total.promptTokenCount ?? 0) + (round.promptTokenCount ?? 0),
    candidatesTokenCount:
      (total.candidatesTokenCount ?? 0) + (round.candidatesTokenCount ?? 0),
    thoughtsTokenCount:
      (total.thoughtsTokenCount ?? 0) + (round.thoughtsTokenCount ?? 0),
    totalTokenCount: (total.totalTokenCount ?? 0) + (round.totalTokenCount ?? 0),
  };
}

function extractGroundingSources(metadata: VertexCandidate["groundingMetadata"]): string[] {
  if (!metadata?.groundingChunks) return [];
  const out: string[] = [];
  for (const gc of metadata.groundingChunks) {
    const source =
      gc.retrievedContext?.title ??
      gc.retrievedContext?.uri ??
      gc.web?.title ??
      gc.web?.uri;
    if (source && !out.includes(source)) out.push(source);
  }
  return out;
}

function extractWebSearchSources(metadata: VertexCandidate["groundingMetadata"]): Array<{ title: string; url: string }> {
  if (!metadata?.groundingChunks) return [];
  const sources: Array<{ title: string; url: string }> = [];
  for (const chunk of metadata.groundingChunks) {
    const url = chunk.web?.uri;
    if (!url || !/^https?:\/\//i.test(url) || sources.some((source) => source.url === url)) continue;
    sources.push({ title: chunk.web?.title?.trim() || url, url });
  }
  return sources;
}

/**
 * Multi-round chat with function calling and (optional) Google Search.
 *
 * The client is the orchestrator for tool execution: this generator yields
 * `tool_call` / `tool_result` / `text` chunks; the actual tool function runs
 * via `params.executeToolCall` (server-side, inside this same request).
 *
 * Web search uses `tools: [{ google_search: {} }]` exclusively — when
 * webSearchEnabled is true, function-call tools are dropped (Vertex doesn't
 * mix the two cleanly). Same as lisa.
 *
 * RAG via Vertex's File Search isn't wired in this commit — defer to a
 * follow-up that depends on per-tenant RAG corpora provisioning.
 */
export async function* streamWithTools(
  params: StreamWithToolsParams,
): AsyncGenerator<StreamChunk> {
  if (params.billing) await assertAiBudgetAvailable(params.billing);
  if (isOpenModelMaaS(params.model)) {
    let usage: StreamChunkUsage | undefined;
    for await (const chunk of streamOpenModelWithTools(params)) {
      if (chunk.type === "done") usage = chunk.usage;
      yield chunk;
    }
    await recordAiUsageSafely(params.billing, params.model, usage);
    return;
  }

  const ai = await createVertexClient(params.tenant);
  const maxFunctionCalls = params.maxFunctionCalls ?? DEFAULT_MAX_FUNCTION_CALLS;

  let geminiTools: Tool[] | undefined;
  if (params.webSearchEnabled) {
    geminiTools = [{ googleSearch: {} }];
  } else if (params.tools.length > 0) {
    geminiTools = toolsToGeminiFormat(params.tools);
  }

  const lastMessage = params.messages[params.messages.length - 1];
  if (!lastMessage) {
    yield { type: "error", error: "No user message to send" };
    yield { type: "done" };
    return;
  }

  const history = messagesToContents(params.messages.slice(0, -1));
  const thinkingConfig = getThinkingConfig(params.model, params.enableThinking);

  const initialMessage: Part[] = [];
  if (lastMessage.role === "user") {
    if (lastMessage.attachments) {
      for (const a of lastMessage.attachments) {
        initialMessage.push({
          inlineData: { mimeType: a.mimeType, data: a.data },
        });
      }
    }
    if (lastMessage.content) initialMessage.push({ text: lastMessage.content });
  } else {
    const continuation = splitToolContinuationMessage(lastMessage);
    if (continuation) {
      history.push({ role: "model", parts: continuation.modelCallParts });
      initialMessage.push(...continuation.userResponseParts);
    }
  }

  if (initialMessage.length === 0) {
    yield { type: "error", error: "No user message to send" };
    yield { type: "done" };
    return;
  }

  const isImageModel = params.model.includes("image");

  const chat = ai.chats.create({
    model: params.model,
    history,
    config: {
      systemInstruction: params.systemPrompt,
      ...(geminiTools ? { tools: geminiTools } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
      ...(isImageModel ? { responseModalities: ["TEXT", "IMAGE"] } : {}),
    },
  });

  let response = await chat.sendMessageStream({ message: initialMessage });

  let totalUsage: UsageMetadata | undefined;
  let functionCallsMade = 0;
  let groundingEmitted = false;
  const accumulatedSources: string[] = [];
  const webSearchSources: Array<{ title: string; url: string }> = [];
  let continueLoop = true;

  try {
    while (continueLoop) {
      const pendingCalls: Array<{
        name: string;
        args: Record<string, unknown>;
        thoughtSignature?: string;
      }> = [];
      let receivedAny = false;

      for await (const rawChunk of response) {
        const chunk = rawChunk as VertexChunk;
        receivedAny = true;
        if (chunk.usageMetadata) totalUsage = accumulateUsage(totalUsage, chunk.usageMetadata);

        const candidates = chunk.candidates;
        const finishReason = candidates?.[0]?.finishReason;
        if (finishReason === FinishReason.SAFETY || finishReason === FinishReason.RECITATION) {
          yield {
            type: "error",
            error:
              finishReason === FinishReason.SAFETY
                ? "Response blocked by safety filters."
                : "Response blocked due to potential recitation.",
          };
          continueLoop = false;
          break;
        }

        const parts = candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.functionCall) {
            const name = part.functionCall.name ?? "";
            // Vertex's built-in google_* tools surface results via grounding,
            // not via function responses — skip them here.
            if (name.startsWith("google_")) continue;
            pendingCalls.push({
              name,
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
              thoughtSignature: part.thoughtSignature,
            });
          }
          if (part.thought && part.text) {
            yield { type: "thinking", content: part.text };
          }
          if (part.inlineData) {
            yield {
              type: "image_generated",
              generatedImage: {
                mimeType: part.inlineData.mimeType ?? "image/png",
                data: part.inlineData.data ?? "",
              },
            };
          }
        }

        if (!groundingEmitted && candidates?.[0]?.groundingMetadata) {
          for (const src of extractGroundingSources(candidates[0].groundingMetadata)) {
            if (!accumulatedSources.includes(src)) accumulatedSources.push(src);
          }
          for (const source of extractWebSearchSources(candidates[0].groundingMetadata)) {
            if (!webSearchSources.some((existing) => existing.url === source.url)) webSearchSources.push(source);
          }
        }

        const text = textPartsFromChunk(chunk);
        if (text) yield { type: "text", content: text };
      }

      if (!receivedAny) {
        yield { type: "error", error: "No response received from Vertex" };
        break;
      }

      if (accumulatedSources.length > 0 && !groundingEmitted) {
        yield {
          type: params.webSearchEnabled ? "web_search_used" : "rag_used",
          ragSources: accumulatedSources,
          webSearchSources: params.webSearchEnabled && webSearchSources.length > 0 ? webSearchSources : undefined,
        };
        groundingEmitted = true;
      }

      if (pendingCalls.length === 0) {
        continueLoop = false;
        continue;
      }

      // Phase 5e-step4: split function calls into "delegate to client" and
      // "server runs it now". If any call needs delegation, we exit early —
      // the client will execute and POST back with toolResults appended.
      const delegateNames = params.delegateToolNames;
      if (delegateNames && delegateNames.size > 0) {
        const delegated = pendingCalls.filter((c) => delegateNames.has(c.name));
        if (delegated.length > 0) {
          // Materialize ToolCall objects for the requires_action chunk so the
          // client knows what it's been asked to run.
          const pendingToolCalls: ToolCall[] = delegated.map((c, idx) => ({
            id: `${c.name}_${Date.now()}_${functionCallsMade + idx}`,
            name: c.name,
            args: c.args,
            thoughtSignature: c.thoughtSignature,
          }));
          yield { type: "requires_action", pendingToolCalls };
          continueLoop = false;
          continue;
        }
      }

      // Function-call budget: drain remaining budget and short-circuit if exhausted.
      const remaining = maxFunctionCalls - functionCallsMade;
      const callsToExecute = pendingCalls.slice(0, Math.max(0, remaining));
      const skipped = pendingCalls.length - callsToExecute.length;

      const responseParts: Part[] = [];
      for (const fc of callsToExecute) {
        const toolCall: ToolCall = {
          id: `${fc.name}_${Date.now()}_${functionCallsMade}`,
          name: fc.name,
          args: fc.args,
          thoughtSignature: fc.thoughtSignature,
        };
        yield { type: "tool_call", toolCall };
        const result = await params.executeToolCall(fc.name, fc.args);
        yield {
          type: "tool_result",
          toolResult: { toolCallId: toolCall.id, result },
        };
        responseParts.push({
          functionResponse: {
            name: fc.name,
            id: toolCall.id,
            response: { result: sanitizeToolResult(result) } as Record<string, unknown>,
          },
        });
      }
      functionCallsMade += callsToExecute.length;

      if (skipped > 0 || functionCallsMade >= maxFunctionCalls) {
        yield {
          type: "text",
          content: `\n\n[Function call limit reached${skipped > 0 ? ` (${skipped} call(s) skipped)` : ""}. Summarizing with what we have.]`,
        };
        responseParts.push({
          text: "[System: Function call limit reached. Provide a final answer based on the information gathered so far.]",
        } as Part);
        const finalRound = await chat.sendMessageStream({ message: responseParts });
        for await (const rawChunk of finalRound) {
          const chunk = rawChunk as VertexChunk;
          if (chunk.usageMetadata) totalUsage = accumulateUsage(totalUsage, chunk.usageMetadata);
          const text = textPartsFromChunk(chunk);
          if (text) yield { type: "text", content: text };
        }
        continueLoop = false;
        continue;
      }

      response = await chat.sendMessageStream({ message: responseParts });
    }

    const finalUsage = toStreamUsage(totalUsage);
    await recordAiUsageSafely(params.billing, params.model, finalUsage);
    yield {
      type: "done",
      usage: finalUsage,
      webSearchSources: webSearchSources.length > 0 ? webSearchSources : undefined,
    };
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : "Vertex tool stream failed",
    };
    const finalUsage = toStreamUsage(totalUsage);
    await recordAiUsageSafely(params.billing, params.model, finalUsage);
    yield {
      type: "done",
      usage: finalUsage,
      webSearchSources: webSearchSources.length > 0 ? webSearchSources : undefined,
    };
  }
}

function withInlinedSchemaInLastUserMessage(
  messages: Message[],
  schema: unknown,
): Message[] {
  // Find the last user message and prepend the inline-schema instruction.
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  })();
  if (lastUserIdx === -1) return messages;
  const target = messages[lastUserIdx];
  const updated: Message = {
    ...target,
    content: buildInlineSchemaPrompt(target.content, schema),
  };
  const out = messages.slice();
  out[lastUserIdx] = updated;
  return out;
}
