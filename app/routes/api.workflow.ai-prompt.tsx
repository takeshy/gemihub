import type { Route } from "./+types/api.workflow.ai-prompt";
import { requireAuth } from "~/services/session.server";
import { getWorkflowSpecification, buildWorkflowUserPrompt } from "~/engine/workflowSpec";
import { getSettings } from "~/services/user-settings.server";
import type { ApiPlan } from "~/types/settings";
import type { ExecutionStep } from "~/engine/types";

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);

  const body = await request.json();
  const {
    mode = "create",
    name,
    description,
    currentYaml,
    executionSteps,
  } = body as {
    mode?: "create" | "modify";
    name?: string;
    description?: string;
    currentYaml?: string;
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

  const systemPrompt = getWorkflowSpecification({
    apiPlan,
    mcpServers: settings?.mcpServers,
    ragSettingNames: settings?.ragSettings
      ? Object.keys(settings.ragSettings)
      : undefined,
    outputAsMarkdown: true,
  });

  const userPrompt = buildWorkflowUserPrompt({
    mode,
    name,
    description,
    currentYaml,
    executionSteps,
    outputAsMarkdown: true,
  });

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  return Response.json({ prompt: fullPrompt });
}
