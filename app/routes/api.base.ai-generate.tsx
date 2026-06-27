import type { Route } from "./+types/api.base.ai-generate";
import { requireAuth } from "~/services/session.server";
import { generateWorkflow } from "~/services/gemini.server";
import { compileBase } from "~/bases/index";
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

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  if (!tokens.geminiApiKey) {
    return Response.json(
      { error: "Gemini API key not configured. Please set it in Settings." },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { instruction, currentYaml, fileName } = body as {
    instruction?: string;
    currentYaml?: string;
    fileName?: string;
  };

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

  const generated = await generateWorkflow(userPrompt, BASE_SYSTEM_PROMPT, tokens.geminiApiKey);
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
