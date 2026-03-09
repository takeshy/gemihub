import type { Route } from "./+types/api.workflow.ai-generate";
import { requireAuth } from "~/services/session.server";
import { generateWorkflowStream } from "~/services/gemini.server";
import { getWorkflowSpecification, buildWorkflowUserPrompt } from "~/engine/workflowSpec";
import { getSettings } from "~/services/user-settings.server";
import type { ModelType, ApiPlan } from "~/types/settings";
import { getDefaultModelForPlan } from "~/types/settings";
import type { ExecutionStep } from "~/engine/types";
import { createLogContext, emitLog } from "~/services/logger.server";

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
    mode = "create",
    name,
    description,
    currentYaml,
    model,
    history,
    executionSteps,
  } = body as {
    mode?: "create" | "modify";
    name?: string;
    description?: string;
    currentYaml?: string;
    model?: ModelType;
    history?: Array<{ role: "user" | "model"; text: string }>;
    executionSteps?: ExecutionStep[];
  };

  if (!description) {
    emitLog(logCtx, 400, { error: "Missing description" });
    return Response.json({ error: "Missing description" }, { status: 400 });
  }

  // Build dynamic workflow spec with user's settings context
  let settings;
  try {
    settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
  } catch {
    // Use defaults if settings can't be loaded
  }

  const apiPlan: ApiPlan = settings?.apiPlan ?? (tokens.apiPlan as ApiPlan) ?? "paid";

  const spec = getWorkflowSpecification({
    apiPlan,
    mcpServers: settings?.mcpServers,
    ragSettingNames: settings?.ragSettings
      ? Object.keys(settings.ragSettings)
      : undefined,
  });

  const userPrompt = buildWorkflowUserPrompt({
    mode,
    name,
    description,
    currentYaml,
    executionSteps,
  });

  const selectedModel = model || (settings?.selectedModel as ModelType) || getDefaultModelForPlan(apiPlan);

  logCtx.details = { model: selectedModel, streaming: true };
  emitLog(logCtx, 200);

  // SSE streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generateWorkflowStream(
          userPrompt,
          spec,
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
