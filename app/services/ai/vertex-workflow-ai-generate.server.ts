import { generateWorkflowStream } from "~/services/gemini-vertex.server";
import { getWorkflowSpecification, buildWorkflowUserPrompt } from "~/engine/workflowSpec";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";
import { DEFAULT_MODEL_PAID as DEFAULT_MODEL, getEnabledMcpServers, type ModelType, type Language } from "~/types/settings";
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
import {
  requireProjectAccess,
  ProjectAccessError,
  assertModelAllowed,
  ModelNotAllowedError,
} from "~/services/project-acl.server";

type Phase = "generate" | "plan" | "review" | "refine";

export async function vertexAction(request: Request) {
  const logCtx = createLogContext(request, "/api/workflow/ai-generate", "");

  const body = await request.json();
  const {
    projectId,
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
    projectId?: string;
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
  if (!projectId) {
    emitLog(logCtx, 400, { error: "Missing projectId" });
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  const selectedModel: ModelType = (model || DEFAULT_MODEL) as ModelType;

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer");
    assertModelAllowed(ctx, selectedModel);
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      emitLog(logCtx, err.status, { error: err.message });
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ModelNotAllowedError) {
      emitLog(logCtx, err.status, { error: err.message });
      return Response.json(
        { error: err.message, model: err.model, allowed: err.allowed },
        { status: err.status },
      );
    }
    throw err;
  }

  let settings;
  try {
    settings = await getSettingsForTenant(ctx);
  } catch {
    // Use defaults if settings can't be loaded
  }

  const locale: Language = (settings?.language as Language) ?? "en";

  const spec = getWorkflowSpecification({
    mcpServers: settings ? getEnabledMcpServers(settings) : undefined,
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

  logCtx.details = { model: selectedModel, streaming: true, phase };
  emitLog(logCtx, 200);

  const encoder = new TextEncoder();
  const tenant = ctx.tenant;
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generateWorkflowStream(
          userPrompt,
          systemPrompt,
          tenant,
          selectedModel,
          history,
          { orgId: ctx.orgId, uid: ctx.uid },
        )) {
          const data = JSON.stringify(chunk);
          controller.enqueue(
            encoder.encode(`event: ${chunk.type}\ndata: ${data}\n\n`),
          );
        }
      } catch (err) {
        const errorData = JSON.stringify({
          type: "error",
          content: err instanceof Error ? err.message : String(err),
        });
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${errorData}\n\n`),
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
