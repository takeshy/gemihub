import type { Route } from "./+types/api.rag.search";
import {
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import { generateEmbedding } from "~/services/rag-embeddings.server";
import {
  getAdjacentChunks,
  listIndexedFiles,
  searchSimilarChunks,
  type RagChunk,
} from "~/services/rag-store.server";

const JSON_HEADERS = { "Content-Type": "application/json" };
const MAX_TOP_K = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function serializeChunk(chunk: RagChunk) {
  return {
    chunkId: chunk.chunkId,
    docPath: chunk.docPath,
    fileName: chunk.metadata.fileName,
    contentType: chunk.metadata.contentType,
    contentKind: chunk.metadata.contentKind ?? "text",
    mimeType: chunk.metadata.mimeType,
    pageLabel: chunk.metadata.pageLabel,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { projectId, query, topK, ragSettingName } = body as {
    projectId?: unknown;
    query?: unknown;
    topK?: unknown;
    ragSettingName?: unknown;
  };

  if (typeof projectId !== "string" || !projectId) {
    return json({ error: "projectId is required" }, 400);
  }
  if (typeof query !== "string" || !query.trim()) {
    return json({ error: "query is required" }, 400);
  }
  if (typeof ragSettingName !== "string" || !ragSettingName) {
    return json({ error: "ragSettingName is required" }, 400);
  }

  const limit = clampInt(topK, 5, 1, MAX_TOP_K);

  try {
    const ctx = await requireProjectAccess(request, projectId, "viewer");
    const embedding = await generateEmbedding(query.trim(), ctx.tenant, {
      taskType: "RETRIEVAL_QUERY",
    });
    if (!embedding) {
      return json({ results: [] });
    }

    const hits = await searchSimilarChunks(ctx.orgId, ctx.projectId, ragSettingName, embedding, limit);
    const results = hits.map(({ chunk, distance }) => ({
      ...serializeChunk(chunk),
      distance,
    }));

    return json({ results });
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return json({ error: e.message }, e.status);
    }
    const message = e instanceof Error ? e.message : "RAG search failed";
    const status = message.includes("index") || message.includes("requires an index") ? 503 : 500;
    return json({ error: message }, status);
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const ragSettingName = url.searchParams.get("ragSettingName") ?? "";
  const mode = url.searchParams.get("mode") ?? "files";
  if (!projectId) return json({ error: "projectId is required" }, 400);
  if (!ragSettingName) return json({ error: "ragSettingName is required" }, 400);

  try {
    const ctx = await requireProjectAccess(request, projectId, "viewer");
    if (mode === "adjacent") {
      const docPath = url.searchParams.get("docPath") ?? "";
      const chunkIndex = Number(url.searchParams.get("chunkIndex"));
      const direction = url.searchParams.get("direction");
      if (!docPath) return json({ error: "docPath is required" }, 400);
      if (!Number.isInteger(chunkIndex)) return json({ error: "chunkIndex is required" }, 400);
      if (direction !== "prev" && direction !== "next") {
        return json({ error: "direction must be prev or next" }, 400);
      }

      const around = await getAdjacentChunks(
        ctx.orgId,
        ctx.projectId,
        ragSettingName,
        docPath,
        chunkIndex,
        direction === "prev" ? 1 : 0,
        direction === "next" ? 1 : 0,
      );
      const chunk = direction === "prev" ? around.before.at(-1) : around.after[0];
      return json({ chunk: chunk ? serializeChunk(chunk) : null });
    }

    const files = await listIndexedFiles(ctx.orgId, ctx.projectId, ragSettingName);
    return json({ files });
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return json({ error: e.message }, e.status);
    }
    return json({ error: e instanceof Error ? e.message : "Failed to list indexed files" }, 500);
  }
}
