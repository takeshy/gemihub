import type { Route } from "./+types/api.base.ai-generate";
import { requireAuth } from "~/services/session.server";
import { generateWorkflow } from "~/services/gemini.server";
import { compileBase } from "~/bases/index";

const BASE_SYSTEM_PROMPT = `You create and edit GemiHub Bases (.base) files.

A .base file is YAML. Return ONLY complete valid YAML, with no prose and no markdown fence.

Schema:
- Top-level keys may include filters, formulas, properties, summaries, views.
- views is an array. Each view has type, name, and may include filters, order, sort, limit.
- View type is one of table, cards, list.
- filters is either a string expression or an object with and/or/not arrays.
- order is a list of property ids.
- sort is a list of { property, direction }, where direction is ASC or DESC.
- limit is a positive integer.

Important property ids:
- File properties use file.*, for example file.name, file.basename, file.ext, file.folder, file.ctime, file.mtime, file.size.
- Note frontmatter properties may be written as status or note.status.
- Formula properties use formula.*.

Examples:
views:
  - type: list
    name: Recent files
    filters: file.inFolder("Projects")
    order:
      - file.name
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC
    limit: 20
`;

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
