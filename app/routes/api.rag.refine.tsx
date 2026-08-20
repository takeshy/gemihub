import type { Route } from "./+types/api.rag.refine";
import { requireProjectAccess } from "~/services/project-acl.server";
import { generateCompact } from "~/services/gemini-vertex.server";
import { DEFAULT_MODEL_PAID, type ModelType } from "~/types/settings";
import { VERTEX_MODELS } from "~/services/ai/models";
import type { Message } from "~/types/chat";

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function allowedModel(value: unknown): ModelType {
  if (typeof value !== "string") return DEFAULT_MODEL_PAID;
  return Object.values(VERTEX_MODELS).includes(value as (typeof VERTEX_MODELS)[keyof typeof VERTEX_MODELS])
    ? (value as ModelType)
    : DEFAULT_MODEL_PAID;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
    model?: unknown;
    query?: unknown;
    text?: unknown;
    mode?: unknown;
  } | null;

  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!projectId) return json({ error: "projectId is required" }, 400);
  if (!text) return json({ error: "text is required" }, 400);

  const ctx = await requireProjectAccess(request, projectId, "viewer");
  const model = allowedModel(body?.model);
  const mode = body?.mode === "evaluate-context" ? "evaluate-context" : "refine";
  const messages: Message[] = [
    {
      role: "user",
      timestamp: Date.now(),
      content: [
        query ? `Search query:\n${query}` : "",
        "Chunk text:",
        text,
      ].filter(Boolean).join("\n\n"),
    },
  ];

  if (mode === "evaluate-context") {
    const result = await generateCompact({
      tenant: ctx.tenant,
      model,
      messages,
      systemPrompt: [
        "You evaluate whether a RAG search chunk has enough context for a given search query.",
        "Respond with exactly one token and nothing else:",
        "LOAD_PREV if important preceding context is missing.",
        "LOAD_NEXT if important following context is missing.",
        "LOAD_BOTH if both preceding and following context are missing.",
        "READY if the text has enough context.",
      ].join(" "),
      enableThinking: false,
      billing: { orgId: ctx.orgId, uid: ctx.uid, scope: "org" },
    });
    const decision = result.text.trim().toUpperCase();
    const normalized =
      decision.includes("LOAD_BOTH")
        ? "LOAD_BOTH"
        : decision.includes("LOAD_PREV")
        ? "LOAD_PREV"
        : decision.includes("LOAD_NEXT")
        ? "LOAD_NEXT"
        : "READY";
    return json({ decision: normalized, usage: result.usage });
  }

  const result = await generateCompact({
    tenant: ctx.tenant,
    model,
    messages,
    systemPrompt: [
      "You refine RAG search chunks before they are attached to a chat.",
      "Remove boilerplate and unrelated fragments, preserve all facts, names, numbers, paths, and citations.",
      "Keep the same language as the chunk. Return only the refined chunk text.",
    ].join(" "),
    enableThinking: false,
    billing: { orgId: ctx.orgId, uid: ctx.uid, scope: "org" },
  });

  return json({ text: result.text.trim() || text, usage: result.usage });
}
