import type { Route } from "./+types/api.timeline.ai-rewrite";
import { requireAuth } from "~/services/session.server";
import { generateWorkflowStream } from "~/services/gemini.server";
import { getSettings } from "~/services/user-settings.server";
import {
  getAvailableModels,
  getDefaultModelForPlan,
  isImageGenerationModel,
  isModelAllowedForPlan,
  type ApiPlan,
  type ModelType,
} from "~/types/settings";

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (fence ? fence[1] : trimmed).trim();
}

async function resolveModel(
  accessToken: string,
  rootFolderId: string,
  apiPlanFromToken: string | undefined,
  requested?: ModelType,
): Promise<{ apiPlan: ApiPlan; model: ModelType }> {
  let settings;
  try {
    settings = await getSettings(accessToken, rootFolderId);
  } catch {
    // Fall back to token/default plan below.
  }

  const apiPlan: ApiPlan = settings?.apiPlan ?? (apiPlanFromToken as ApiPlan) ?? "paid";
  const fallback = settings?.selectedModel ?? getDefaultModelForPlan(apiPlan);
  const model = requested && isModelAllowedForPlan(apiPlan, requested) ? requested : fallback;
  if (isImageGenerationModel(model)) {
    return { apiPlan, model: getDefaultModelForPlan(apiPlan) };
  }
  return { apiPlan, model };
}

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { apiPlan, model } = await resolveModel(tokens.accessToken, tokens.rootFolderId, tokens.apiPlan);
  return Response.json({
    models: getAvailableModels(apiPlan).filter((m) => !m.isImageModel),
    defaultModel: model,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  if (!tokens.geminiApiKey) {
    return Response.json(
      { error: "Gemini API key not configured. Please set it in Settings." },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { content, instruction, model } = body as {
    content?: string;
    instruction?: string;
    model?: ModelType;
  };

  if (!content?.trim()) return Response.json({ error: "Missing content" }, { status: 400 });
  if (!instruction?.trim()) return Response.json({ error: "Missing instruction" }, { status: 400 });

  const resolved = await resolveModel(tokens.accessToken, tokens.rootFolderId, tokens.apiPlan, model);
  const systemPrompt = [
    "You rewrite a single GemiHub Timeline post draft.",
    "Return only the rewritten Markdown body.",
    "Do not include explanations, headings about the task, or Markdown code fences.",
    "Preserve image embeds, wikilinks, hashtags, and user-provided facts unless the instruction explicitly changes them.",
  ].join("\n");
  const userPrompt = [
    "Rewrite this Timeline post draft according to the instruction.",
    "",
    `Instruction:\n${instruction}`,
    "",
    "Current draft:",
    "```markdown",
    content,
    "```",
  ].join("\n");

  let generated = "";
  for await (const chunk of generateWorkflowStream(
    userPrompt,
    systemPrompt,
    tokens.geminiApiKey,
    resolved.model,
  )) {
    if (chunk.type === "text" && chunk.content) generated += chunk.content;
    if (chunk.type === "error") {
      return Response.json({ error: chunk.content || "Generation failed" }, { status: 502 });
    }
  }

  const rewritten = stripCodeFence(generated);
  if (!rewritten) return Response.json({ error: "The model returned an empty result." }, { status: 502 });
  return Response.json({ content: rewritten, model: resolved.model });
}
