import type { Route } from "./+types/api.search";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { searchFiles } from "~/services/google-drive.server";
import { GoogleGenAI, type Tool } from "@google/genai";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}),
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
  }
  const { query, mode, ragStoreIds, topK, model } = body as {
    query: string;
    mode: "rag" | "drive";
    ragStoreIds?: string[];
    topK?: number;
    model?: string;
  };

  if (!query || typeof query !== "string") {
    return new Response(JSON.stringify({ error: "query is required" }), { status: 400, headers });
  }

  try {
    if (mode === "rag") {
      const apiKey = validTokens.geminiApiKey;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Gemini API key not configured" }), { status: 400, headers });
      }
      if (!ragStoreIds || ragStoreIds.length === 0) {
        return new Response(JSON.stringify({ error: "ragStoreIds is required for RAG search" }), { status: 400, headers });
      }

      const ai = new GoogleGenAI({ apiKey });
      const clampedTopK = Math.min(20, Math.max(1, topK ?? 5));
      const tools: Tool[] = [
        {
          fileSearch: {
            fileSearchStoreNames: ragStoreIds,
            topK: clampedTopK,
          },
        } as Tool,
      ];

      const plan = tokens.apiPlan === "free" ? "free" : "paid";
      const allowedModels = plan === "paid"
        ? ["gemini-3-flash-preview", "gemini-3-pro-preview"]
        : ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
      const requestedModel = typeof model === "string" ? model : "";
      const selectedModel = allowedModels.includes(requestedModel)
        ? requestedModel
        : allowedModels[0];
      const fallbackModel = allowedModels.find((m) => m !== selectedModel);

      const runSearch = (model: string) => ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: query }] }],
        config: {
          systemInstruction: `Use the file search tool to find files relevant to the user's query.
Only return files whose content clearly matches the query. If no files are relevant, say "No results."
For each matching file, respond in this exact format (one per line):
[filename] brief reason why this file matches (in the query's language, up to 60 chars)
Do not add any other text or explanation.`,
          tools,
        },
      });

      let response;
      try {
        response = await runSearch(selectedModel);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/tool_type|fileSearch|not supported/i.test(message) && fallbackModel) {
          response = await runSearch(fallbackModel);
        } else {
          throw err;
        }
      }

      const results: Array<{ title: string; uri?: string; snippet?: string }> = [];
      const resp = response as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          groundingMetadata?: {
            groundingChunks?: Array<{
              retrievedContext?: { uri?: string; title?: string; text?: string };
            }>;
          };
        }>;
      };

      const candidates = resp.candidates;
      // Extract AI summary text as fallback snippet
      const aiText = candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";

      if (candidates && candidates.length > 0) {
        const gm = candidates[0]?.groundingMetadata;
        if (gm?.groundingChunks) {
          for (const gc of gm.groundingChunks) {
            const title = gc.retrievedContext?.title;
            const uri = gc.retrievedContext?.uri;
            const chunkText = gc.retrievedContext?.text;
            if (title && !results.some((r) => r.title === title && r.uri === uri)) {
              results.push({ title, uri, snippet: chunkText || undefined });
            }
          }
        }
      }

      return new Response(JSON.stringify({ mode: "rag", results, aiText: aiText || undefined }), { headers });
    }

    if (mode === "drive") {
      const files = await searchFiles(
        validTokens.accessToken,
        validTokens.rootFolderId,
        query,
        true
      );
      const results = files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
      }));
      return new Response(JSON.stringify({ mode: "drive", results }), { headers });
    }

    return new Response(JSON.stringify({ error: "Invalid mode" }), { status: 400, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
}
