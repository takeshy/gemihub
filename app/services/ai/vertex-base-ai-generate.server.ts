import { generateCompact } from "~/services/gemini-vertex.server";
import { compileBase } from "~/bases/index";
import { DEFAULT_MODEL_PAID as DEFAULT_MODEL, type ModelType } from "~/types/settings";
import {
  assertModelAllowed,
  ModelNotAllowedError,
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import BASE_SKILL_MD from "~/services/gemihub-skill-templates/base/SKILL.md?raw";
import BASE_REF_FUNCTIONS from "~/services/gemihub-skill-templates/base/references/functions.md?raw";
import BASE_REF_VIEWS from "~/services/gemihub-skill-templates/base/references/views.md?raw";

// The base editor's AI uses the same spec the bundled "base" skill ships to the
// model, so it knows the full Bases syntax (filters, functions, view options,
// formulas, summaries) — not just a hand-written schema summary.
const BASE_SYSTEM_PROMPT = `You create and edit GemiHub Bases (.base) files.

A .base file is YAML. Return ONLY the complete valid .base YAML, with no prose and no markdown code fence.

The following is the authoritative GemiHub Bases reference.

===== BASES SKILL =====
${BASE_SKILL_MD}

===== REFERENCE: FUNCTIONS =====
${BASE_REF_FUNCTIONS}

===== REFERENCE: VIEWS =====
${BASE_REF_VIEWS}
===== END REFERENCE =====

Remember: output ONLY the updated .base YAML (top-level keys among filters, formulas, properties, summaries, views). No explanation, no code fence.`;

export async function vertexAction(request: Request) {
  const body = await request.json();
  const { instruction, currentYaml, fileName, projectId, model } = body as {
    instruction?: string;
    currentYaml?: string;
    fileName?: string;
    projectId?: string;
    model?: ModelType;
  };

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  if (!instruction?.trim()) {
    return Response.json({ error: "Missing instruction" }, { status: 400 });
  }
  if (!currentYaml?.trim()) {
    return Response.json({ error: "Missing currentYaml" }, { status: 400 });
  }

  const userPrompt = `Modify this .base file according to the user's request.

File: ${fileName || "(unknown)"}

User request:
${instruction}

Current YAML:
${currentYaml}

Return the complete updated .base YAML only.`;

  const selectedModel = model || DEFAULT_MODEL;
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

  const result = await generateCompact({
    tenant: ctx.tenant,
    model: selectedModel,
    systemPrompt: BASE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
    billing: { orgId: ctx.orgId, uid: ctx.uid, scope: "org" },
  });
  const generated = result.text;
  const compiled = compileBase(generated);
  const errors = compiled.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    return Response.json(
      { error: errors.map((d) => d.message).join("\n") },
      { status: 422 },
    );
  }

  return Response.json({ yaml: generated });
}
