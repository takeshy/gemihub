import { tr } from "../shared/i18n.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { GoogleGenAI, Modality, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import OpenAI, { toFile } from "openai";
import { observedAiCall } from "./ai-diagnostics.ts";

// Provider-neutral AI access. Callers speak Gemini-shaped Content/Part; the OpenAI
// implementation translates them, so prompts, schemas and tool loops stay shared.
export type AiProvider = "vertex" | "openai";
export type ToolDeclaration = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };
export type ToolResponse = Partial<Pick<GenerateContentResponse, "functionCalls" | "candidates" | "text">>;

let providerResolver: () => Promise<AiProvider> = async () => "vertex";
/** The app installs a resolver that reads the administrator's provider setting. */
export function setProviderResolver(resolve: () => Promise<AiProvider>) { providerResolver = resolve; }
export const currentProvider = () => providerResolver();

/** Per-request usage hook. Judge requests charge their quota once, before the first model call. */
export const aiUsage = new AsyncLocalStorage<{ charge: () => Promise<void>; charged?: boolean }>();
async function beforeModelCall() {
  const usage = aiUsage.getStore();
  if (!usage || usage.charged) return;
  usage.charged = true;
  await usage.charge();
}

const unavailable = (message: string) => Object.assign(new Error(message), { status: 503 });
const modelTimeout = () => Object.assign(new Error(tr("AIの応答に時間がかかっています。少し時間をおいてお試しください。")), { status: 504 });
const aiDeadline = new AsyncLocalStorage<{ signal: AbortSignal; until: number; onRetry?: (attempt: number) => Promise<void> }>();
export const currentAiSignal = () => aiDeadline.getStore()?.signal;

/** One budget includes generation, repairs and rendered reviews; provider retries cannot extend it. */
export async function withAiDeadline<T>(timeoutMs: number, run: () => Promise<T>, onRetry?: (attempt: number) => Promise<void>): Promise<T> {
  const parent = aiDeadline.getStore();
  if (parent && (parent.signal.aborted || parent.until <= Date.now())) throw modelTimeout();
  const until = Math.min(Date.now() + timeoutMs, parent?.until ?? Infinity);
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([controller.signal, parent.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await aiDeadline.run({ signal, until, onRetry: onRetry || parent?.onRetry }, () => Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        abort = () => reject(modelTimeout());
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => controller.abort(), Math.max(1, until - Date.now()));
      }),
    ]));
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
/**
 * Runs one model call. With `timeoutMs`, a call that has not answered in time is aborted and retried
 * once: an occasional response takes minutes while the same request normally answers in seconds.
 */
/** The limit a call really runs under: its own timeout, cut short by what is left of the operation. */
const effectiveTimeout = (timeoutMs: number | undefined, until: number | undefined) =>
  until === undefined ? timeoutMs : Math.max(0, Math.min(timeoutMs ?? Infinity, until - Date.now()));
async function withDeadline<T>(timeoutMs: number | undefined, run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  const operation = aiDeadline.getStore();
  if (!timeoutMs && !operation) return run();
  for (let attempt = 0; ; attempt++) {
    if (operation && (operation.signal.aborted || operation.until <= Date.now())) throw modelTimeout();
    const remaining = operation ? operation.until - Date.now() : Infinity;
    const duration = Math.min(timeoutMs || Infinity, remaining);
    const controller = new AbortController();
    const signal = operation ? AbortSignal.any([controller.signal, operation.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      // SDK work such as credential lookup may not observe the signal.
      // Enforce the deadline ourselves as well as asking the provider to abort.
      const deadline = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => controller.abort(), duration);
      });
      return await Promise.race([run(signal), deadline]);
    } catch (error) {
      if (!signal.aborted) throw error;
      if (operation?.signal.aborted || operation && duration >= remaining || attempt >= 1) throw modelTimeout();
      console.warn(`Model call exceeded ${duration} ms; retrying once`);
      await operation?.onRetry?.(attempt + 2);
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
  }
}
export function openAiStatus() {
  return { key: !!process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || "", designModel: process.env.OPENAI_DESIGN_MODEL || "", imageModel: process.env.OPENAI_IMAGE_MODEL || "" };
}
export function vertexStatus() {
  return { project: !!process.env.GOOGLE_CLOUD_PROJECT, model: process.env.VERTEX_MODEL || "", designModel: process.env.VERTEX_DESIGN_MODEL || "", imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1" };
}
/** Whether a provider has the credentials and models every feature needs. */
export function providerReady(provider: AiProvider) {
  if (provider === "openai") { const s = openAiStatus(); return s.key && !!s.model && !!s.imageModel; }
  const s = vertexStatus();
  return s.project && !!s.model;
}

function vertexClient(location = process.env.GOOGLE_CLOUD_LOCATION || "global") {
  return new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location });
}
let openAiClient: OpenAI | undefined;
let openAiKey = "";
function openai() {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw unavailable(tr("OpenAI の API キーがサーバーに設定されていません"));
  if (!openAiClient || openAiKey !== key) { openAiClient = new OpenAI({ apiKey: key }); openAiKey = key; }
  return openAiClient;
}
/** Tests replace the OpenAI client with a fake. */
export function setOpenAiClient(client: OpenAI | undefined) { openAiClient = client; openAiKey = client ? process.env.OPENAI_API_KEY || "" : ""; }

/** Fail early, with the caller's own message, when the selected provider is not configured. */
export async function requireText(message: string) {
  const provider = await currentProvider();
  if (provider === "vertex" && (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.VERTEX_MODEL)) throw unavailable(message);
  if (provider === "openai" && (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)) throw unavailable(message);
  return provider;
}

type OpenAiInput = OpenAI.Responses.ResponseInputItem;
function dataUrl(data: { mimeType?: string; data?: string }) { return `data:${data.mimeType || "image/png"};base64,${data.data || ""}`; }
/** Translates Gemini contents, including function calls and responses, to Responses API input items. */
export function toOpenAiInput(contents: Content[]): OpenAiInput[] {
  const items: OpenAiInput[] = [];
  for (const content of contents) {
    const role = content.role === "model" ? "assistant" : "user";
    let message: ({ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" })[] = [];
    const flush = () => {
      if (!message.length) return;
      // Assistant turns accept text only; model-side images never occur in these histories.
      if (role === "assistant") items.push({ role: "assistant", content: message.map(part => part.type === "input_text" ? part.text : "").join("\n") });
      else items.push({ role: "user", content: message });
      message = [];
    };
    for (const part of content.parts || []) {
      if (part.functionCall) {
        flush();
        items.push({ type: "function_call", call_id: part.functionCall.id || part.functionCall.name || "call", name: part.functionCall.name || "", arguments: JSON.stringify(part.functionCall.args || {}) });
      } else if (part.functionResponse) {
        flush();
        items.push({ type: "function_call_output", call_id: part.functionResponse.id || part.functionResponse.name || "call", output: JSON.stringify(part.functionResponse.response || {}) });
      } else if (part.inlineData) {
        message.push({ type: "input_image", image_url: dataUrl(part.inlineData), detail: "auto" });
      } else if (typeof part.text === "string" && !part.thought) {
        message.push({ type: "input_text", text: part.text });
      }
    }
    flush();
  }
  return items;
}

/** "design" is HTML/CSS generation for themes and pages; "review" is the independent check of a generated design. */
export type AiPurpose = "review" | "design";
/** Each purpose may name its own model; an unset one uses the provider's normal text model. */
function textModel(provider: AiProvider, purpose?: AiPurpose) {
  const prefix = provider === "openai" ? "OPENAI" : "VERTEX";
  return purpose && process.env[`${prefix}_${purpose.toUpperCase()}_MODEL`] || process.env[`${prefix}_MODEL`]!;
}

/** Generates JSON text matching the schema. Callers keep validating with zod. */
export async function generateJson(input: { system: string; contents: Content[]; schema: Record<string, unknown>; location?: string; unavailableMessage?: string; purpose?: AiPurpose; diagnosticStage?: "identify"; timeoutMs?: number }): Promise<string> {
  const provider = await requireText(input.unavailableMessage || tr("AI の接続がまだ設定されていません"));
  await beforeModelCall();
  const operation = aiDeadline.getStore();
  return observedAiCall({ provider, model: textModel(provider, input.purpose), stage: input.diagnosticStage || input.purpose || "text", timeoutMs: effectiveTimeout(input.timeoutMs, operation?.until) }, async () => {
    if (provider === "openai") {
      const response = await withDeadline(input.timeoutMs, signal => openai().responses.create({
        model: textModel("openai", input.purpose),
        instructions: input.system,
        input: toOpenAiInput(input.contents),
        text: { format: { type: "json_schema", name: "result", schema: input.schema, strict: false } },
      }, signal ? { signal, maxRetries: 0 } : undefined));
      return response.output_text || "{}";
    }
    const response = await withDeadline(input.timeoutMs, signal => vertexClient(input.location).models.generateContent({
      model: textModel("vertex", input.purpose), contents: input.contents,
      config: { responseMimeType: "application/json", responseJsonSchema: input.schema, systemInstruction: input.system, ...(signal ? { abortSignal: signal } : {}) },
    }));
    return response.text || "{}";
  });
}

/** One tool-calling round. The result keeps Gemini's shape so the shared tool loop is unchanged. */
export async function generateWithTools(input: { system: string; contents: Content[]; tools: ToolDeclaration[]; timeoutMs?: number }): Promise<ToolResponse> {
  const provider = await requireText(tr("AI の接続がまだ設定されていません"));
  await beforeModelCall();
  if (provider === "openai") {
    const response = await withDeadline(input.timeoutMs, signal => openai().responses.create({
      model: process.env.OPENAI_MODEL!,
      instructions: input.system,
      input: toOpenAiInput(input.contents),
      tools: input.tools.map(tool => ({ type: "function" as const, name: tool.name, description: tool.description, parameters: tool.parametersJsonSchema, strict: false })),
    }, signal ? { signal, maxRetries: 0 } : undefined));
    const calls = response.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call");
    const functionCalls = calls.map(call => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { /* The tool loop reports invalid arguments as a missing path. */ }
      return { id: call.call_id, name: call.name, args };
    });
    const parts: Part[] = functionCalls.length ? functionCalls.map(functionCall => ({ functionCall })) : [{ text: response.output_text || "" }];
    return { functionCalls, text: response.output_text || "", candidates: [{ content: { role: "model", parts } }] } as ToolResponse;
  }
  return withDeadline(input.timeoutMs, signal => vertexClient().models.generateContent({
    model: process.env.VERTEX_MODEL!, contents: input.contents,
    config: { systemInstruction: input.system, tools: [{ functionDeclarations: input.tools }], ...(signal ? { abortSignal: signal } : {}) },
  }));
}

const openAiSizes: Record<string, "1024x1024" | "1536x1024" | "1024x1536"> = { "1:1": "1024x1024", "4:3": "1536x1024", "16:9": "1536x1024", "3:4": "1024x1536", "9:16": "1024x1536" };
/** Generates one image. A reference image switches OpenAI to its edit endpoint. */
export async function generateImageData(input: { prompt: string; aspectRatio: string; reference?: { mimeType: string; data: string } }): Promise<{ mimeType: string; data: string; model: string } | undefined> {
  const provider = await currentProvider();
  if (provider === "openai") {
    const status = openAiStatus();
    if (!status.key || !status.imageModel) throw unavailable(tr("AI画像生成には OpenAI の API キーと画像モデルの設定が必要です。"));
    await beforeModelCall();
    const common = { model: status.imageModel, prompt: input.prompt, size: openAiSizes[input.aspectRatio] || "1024x1024", output_format: "jpeg" as const, n: 1 };
    const response = input.reference
      ? await openai().images.edit({ ...common, image: await toFile(Buffer.from(input.reference.data, "base64"), "reference", { type: input.reference.mimeType }) })
      : await openai().images.generate(common);
    const data = response.data?.[0]?.b64_json;
    return data ? { mimeType: "image/jpeg", data, model: status.imageModel } : undefined;
  }
  if (!process.env.GOOGLE_CLOUD_PROJECT) throw unavailable(tr("AI画像生成にはサーバーの Vertex AI 接続設定が必要です。"));
  await beforeModelCall();
  const model = vertexStatus().imageModel;
  const response = await vertexClient(process.env.VERTEX_IMAGE_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "global").models.generateContent({
    model, contents: [{ role: "user", parts: [{ text: input.prompt }, ...(input.reference ? [{ inlineData: input.reference }] : [])] }],
    config: { responseModalities: [Modality.TEXT, Modality.IMAGE], imageConfig: { aspectRatio: input.aspectRatio }, httpOptions: { timeout: 180000 } },
  });
  const data = response.candidates?.[0]?.content?.parts?.find(part => !part.thought && part.inlineData?.data)?.inlineData;
  return data?.data ? { mimeType: data.mimeType || "image/png", data: data.data, model } : undefined;
}

/** Administrator connection check: one short JSON answer from the given provider, without a quota charge. */
export async function testProvider(provider: AiProvider) {
  if (!providerReady(provider)) throw Object.assign(new Error(tr("このAIプロバイダの設定が足りません")), { status: 400 });
  const started = Date.now();
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
  const contents: Content[] = [{ role: "user", parts: [{ text: "Return {\"ok\":true}." }] }];
  let text: string;
  if (provider === "openai") {
    const response = await openai().responses.create({ model: process.env.OPENAI_MODEL!, input: toOpenAiInput(contents), text: { format: { type: "json_schema", name: "result", schema, strict: false } } });
    text = response.output_text || "";
  } else {
    const response = await vertexClient().models.generateContent({ model: process.env.VERTEX_MODEL!, contents, config: { responseMimeType: "application/json", responseJsonSchema: schema } });
    text = response.text || "";
  }
  return { ok: JSON.parse(text || "{}").ok === true, milliseconds: Date.now() - started };
}
