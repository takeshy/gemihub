import { getWorkflowSpecification, buildWorkflowUserPrompt } from "~/engine/workflowSpec";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";
import { getEnabledMcpServers } from "~/types/settings";
import type { ExecutionStep } from "~/engine/types";
import {
  requireProjectAccess,
  ProjectAccessError,
} from "~/services/project-acl.server";

export async function vertexAction(request: Request) {
  const body = await request.json();
  const {
    projectId,
    mode = "create",
    name,
    description,
    currentYaml,
    existingInstructions,
    executionSteps,
    skillMode,
    skillFolderName,
  } = body as {
    projectId?: string;
    mode?: "create" | "modify";
    name?: string;
    description?: string;
    currentYaml?: string;
    existingInstructions?: string;
    executionSteps?: ExecutionStep[];
    skillMode?: boolean;
    skillFolderName?: string;
  };

  if (!description) {
    return Response.json({ error: "Missing description" }, { status: 400 });
  }
  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer");
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  let settings;
  try {
    settings = await getSettingsForTenant(ctx);
  } catch {
    // Use defaults if settings can't be loaded
  }

  const systemPrompt = getWorkflowSpecification({
    mcpServers: settings ? getEnabledMcpServers(settings) : undefined,
    ragSettingNames: settings?.ragSettings
      ? Object.keys(settings.ragSettings)
      : undefined,
    outputAsMarkdown: !skillMode,
    includeSkillGeneration: skillMode,
  });

  const userPrompt = buildWorkflowUserPrompt({
    mode,
    name,
    description,
    currentYaml,
    existingInstructions,
    executionSteps,
    outputAsMarkdown: !skillMode,
    skillMode,
    skillFolderName,
  });

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  return Response.json({ prompt: fullPrompt });
}
