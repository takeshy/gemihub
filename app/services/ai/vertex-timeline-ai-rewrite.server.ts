import { generateCompact } from "~/services/gemini-vertex.server";
import {
  DEFAULT_MODEL_PAID as DEFAULT_MODEL,
  isImageGenerationModel,
  type ModelType,
} from "~/types/settings";
import {
  assertModelAllowed,
  ModelNotAllowedError,
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (fence ? fence[1] : trimmed).trim();
}

export async function vertexAction(request: Request) {
  const body = await request.json();
  const { content, instruction, model, projectId } = body as {
    content?: string;
    instruction?: string;
    model?: ModelType;
    projectId?: string;
  };

  if (!projectId) return Response.json({ error: "Missing projectId" }, { status: 400 });
  if (!content?.trim()) return Response.json({ error: "Missing content" }, { status: 400 });
  if (!instruction?.trim()) return Response.json({ error: "Missing instruction" }, { status: 400 });

  const selectedModel = model && !isImageGenerationModel(model) ? model : DEFAULT_MODEL;
  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer");
    assertModelAllowed(ctx, selectedModel);
  } catch (err) {
    if (err instanceof ProjectAccessError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof ModelNotAllowedError) {
      return Response.json({ error: err.message, model: err.model, allowed: err.allowed }, { status: err.status });
    }
    throw err;
  }

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

  const result = await generateCompact({
    tenant: ctx.tenant,
    model: selectedModel,
    systemPrompt,
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
    billing: { orgId: ctx.orgId, uid: ctx.uid },
  });
  const generated = result.text;

  const rewritten = stripCodeFence(generated);
  if (!rewritten) return Response.json({ error: "The model returned an empty result." }, { status: 502 });
  return Response.json({ content: rewritten, model: selectedModel });
}
