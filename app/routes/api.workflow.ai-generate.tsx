import type { Route } from "./+types/api.workflow.ai-generate";
import { requireAuth } from "~/services/session.server";
import { generateWorkflowStream } from "~/services/gemini.server";
import { getWorkflowSpecification, buildWorkflowUserPrompt } from "~/engine/workflowSpec";
import { getSettings } from "~/services/user-settings.server";
import type { ModelType, ApiPlan, Language } from "~/types/settings";
import { getDefaultModelForPlan } from "~/types/settings";
import type { ExecutionStep } from "~/engine/types";
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildRefineUserPrompt,
  attachPlanToUserPrompt,
  type ReviewResult,
} from "~/services/ai-workflow-generation.server";
import { createLogContext, emitLog } from "~/services/logger.server";

type Phase = "generate" | "plan" | "review" | "refine";

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const logCtx = createLogContext(request, "/api/workflow/ai-generate", tokens.rootFolderId);

  if (!tokens.geminiApiKey) {
    emitLog(logCtx, 400, { error: "Gemini API key not configured" });
    return Response.json(
      { error: "Gemini API key not configured. Please set it in Settings." },
      { status: 400 }
    );
  }

  const body = await request.json();
  const {
    phase = "generate",
    mode = "create",
    name,
    description,
    currentYaml,
    existingInstructions,
    workflowFilePath,
    model,
    history,
    executionSteps,
    skillMode,
    skillFolderName,
    plan,
    generatedYaml,
    previousYaml,
    previousExplanation,
    review,
  } = body as {
    phase?: Phase;
    mode?: "create" | "modify";
    name?: string;
    description?: string;
    currentYaml?: string;
    existingInstructions?: string;
    workflowFilePath?: string;
    model?: ModelType;
    history?: Array<{ role: "user" | "model"; text: string }>;
    executionSteps?: ExecutionStep[];
    skillMode?: boolean;
    skillFolderName?: string;
    plan?: string;
    generatedYaml?: string;
    previousYaml?: string;
    previousExplanation?: string;
    review?: ReviewResult;
  };

  if (!description) {
    emitLog(logCtx, 400, { error: "Missing description" });
    return Response.json({ error: "Missing description" }, { status: 400 });
  }

  let settings;
  try {
    settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
  } catch {
    // Use defaults if settings can't be loaded
  }

  const apiPlan: ApiPlan = settings?.apiPlan ?? (tokens.apiPlan as ApiPlan) ?? "paid";
  const locale: Language = (settings?.language as Language) ?? "en";

  const spec = getWorkflowSpecification({
    apiPlan,
    mcpServers: settings?.mcpServers,
    ragSettingNames: settings?.ragSettings
      ? Object.keys(settings.ragSettings)
      : undefined,
    includeSkillGeneration: skillMode,
  });

  let systemPrompt: string;
  let userPrompt: string;

  if (phase === "plan") {
    systemPrompt = buildPlanSystemPrompt(skillMode ?? false, locale);
    userPrompt = buildPlanUserPrompt({
      name,
      description,
      currentYaml,
      isSkill: skillMode ?? false,
    });
  } else if (phase === "review") {
    if (!generatedYaml) {
      return Response.json({ error: "Missing generatedYaml for review phase" }, { status: 400 });
    }
    systemPrompt = buildReviewSystemPrompt(skillMode ?? false, spec, locale);
    userPrompt = buildReviewUserPrompt({
      description,
      plan,
      generatedYaml,
      isSkill: skillMode ?? false,
    });
  } else if (phase === "refine") {
    if (!previousYaml || !review) {
      return Response.json({ error: "Missing previousYaml or review for refine phase" }, { status: 400 });
    }
    systemPrompt = spec;
    userPrompt = buildRefineUserPrompt({
      description,
      plan,
      previousYaml,
      previousExplanation,
      review,
      isSkill: skillMode ?? false,
    });
  } else {
    // phase === "generate"
    systemPrompt = spec;
    userPrompt = attachPlanToUserPrompt(
      buildWorkflowUserPrompt({
        mode,
        name,
        description,
        currentYaml,
        existingInstructions,
        workflowFilePath,
        executionSteps,
        skillMode,
        skillFolderName,
      }),
      plan,
    );
  }

  const selectedModel = model || (settings?.selectedModel as ModelType) || getDefaultModelForPlan(apiPlan);

  logCtx.details = { model: selectedModel, streaming: true, phase };
  emitLog(logCtx, 200);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generateWorkflowStream(
          userPrompt,
          systemPrompt,
          tokens.geminiApiKey!,
          selectedModel,
          history
        )) {
          const data = JSON.stringify(chunk);
          controller.enqueue(
            encoder.encode(`event: ${chunk.type}\ndata: ${data}\n\n`)
          );
        }
      } catch (err) {
        const errorData = JSON.stringify({
          type: "error",
          content: err instanceof Error ? err.message : String(err),
        });
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${errorData}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
