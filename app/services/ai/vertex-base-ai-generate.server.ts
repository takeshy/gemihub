import { generateCompact } from "~/services/gemini-vertex.server";
import { compileBase } from "~/bases/index";
import { DEFAULT_MODEL_PAID as DEFAULT_MODEL, type ModelType } from "~/types/settings";
import type { TenantInfo } from "~/types/enterprise";
import type { AiBillingContext } from "~/services/ai-budget.server";
import { isPersonalVertexModelAllowed, type PersonalVertexRun } from "./personal-vertex.server";
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

interface BaseBody {
  instruction?: string;
  currentYaml?: string;
  fileName?: string;
  projectId?: string;
  model?: ModelType;
}

function validateBody(body: BaseBody): Response | null {
  if (!body.instruction?.trim()) return Response.json({ error: "Missing instruction" }, { status: 400 });
  if (!body.currentYaml?.trim()) return Response.json({ error: "Missing currentYaml" }, { status: 400 });
  return null;
}

export async function vertexAction(request: Request) {
  const body = (await request.json()) as BaseBody;
  const { projectId, model } = body;

  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  const invalid = validateBody(body);
  if (invalid) return invalid;

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

  return generateBase(body, selectedModel, ctx.tenant,
    ctx.tenant.vertexBillingMode === "customer" ? undefined : { orgId: ctx.orgId, uid: ctx.uid, scope: "org" });
}

/** Drive-mount user who selected personal Vertex AI in settings. */
export async function personalVertexAction(request: Request, run: PersonalVertexRun) {
  const body = (await request.json()) as BaseBody;
  const invalid = validateBody(body);
  if (invalid) return invalid;
  const selectedModel = body.model || DEFAULT_MODEL;
  if (!isPersonalVertexModelAllowed(selectedModel)) {
    return Response.json({ error: `model "${selectedModel}" is not available on personal Vertex AI` }, { status: 403 });
  }
  return generateBase(body, selectedModel, run.tenant, run.billing);
}

async function generateBase(body: BaseBody, selectedModel: ModelType, tenant: TenantInfo, billing: AiBillingContext | undefined) {
  const { instruction, currentYaml, fileName } = body;
  const userPrompt = `Modify this .base file according to the user's request.

File: ${fileName || "(unknown)"}

User request:
${instruction}

Current YAML:
${currentYaml}

Return the complete updated .base YAML only.`;

  const result = await generateCompact({
    tenant,
    model: selectedModel,
    systemPrompt: BASE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
    billing,
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
