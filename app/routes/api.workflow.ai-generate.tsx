import type { Route } from "./+types/api.workflow.ai-generate";
import { requireAuth } from "~/services/session.server";
import { generateWorkflowStream } from "~/services/gemini.server";
import { getWorkflowSpecification } from "~/engine/workflowSpec";
import { getSettings } from "~/services/user-settings.server";
import type { ModelType, ApiPlan } from "~/types/settings";
import { getDefaultModelForPlan } from "~/types/settings";
import type { ExecutionStep } from "~/engine/types";

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);

  if (!tokens.geminiApiKey) {
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

  // Build user prompt based on mode
  let userPrompt: string;
  if (mode === "modify" && currentYaml) {
    let executionContext = "";
    if (executionSteps && executionSteps.length > 0) {
      executionContext = "\n\nEXECUTION HISTORY (selected steps):\n";
      executionSteps.forEach((step, i) => {
        executionContext += `\nStep ${i + 1} [${step.nodeType}] ${step.nodeId}\n`;
        if (step.input) {
          const inputStr = typeof step.input === "string"
            ? step.input
            : JSON.stringify(step.input, null, 2);
          executionContext += `  Input: ${inputStr}\n`;
        }
        if (step.error) {
          executionContext += `  Error: ${step.error}\n`;
        } else if (step.output !== undefined) {
          const outputStr = typeof step.output === "string"
            ? step.output
            : JSON.stringify(step.output, null, 2);
          executionContext += `  Output: ${outputStr}\n`;
        }
        executionContext += `  Status: ${step.status}\n`;
      });
    }
    userPrompt = `Here is the current workflow YAML:\n\n\`\`\`yaml\n${currentYaml}\n\`\`\`${executionContext}\n\nPlease modify this workflow according to the following request:\n${description}\n\nOutput the COMPLETE modified workflow YAML. Do not omit any nodes.`;
  } else {
    userPrompt = name
      ? `Create a workflow named "${name}".\n\n${description}`
      : description;
  }

  const selectedModel = model || (settings?.selectedModel as ModelType) || getDefaultModelForPlan(apiPlan);

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
