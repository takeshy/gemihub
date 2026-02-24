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
        ? ["gemini-3.1-pro-preview", "gemini-3-flash-preview"]
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
          systemInstruction: "Search files and answer the query concisely in the query's language.",
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

      const aiText = resp.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";

      // Build file list from grounding chunks (deduplicated)
      const binaryExts = /\.(mp4|mp3|wav|ogg|webm|avi|mov|mkv|zip|tar|gz|7z|rar|exe|dll|bin|so|woff2?|ttf|otf|eot)$/i;
      const seenTitles = new Set<string>();
      const results: Array<{ title: string; uri?: string }> = [];
      const chunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        for (const gc of chunks) {
          const ctx = gc.retrievedContext;
          const title = ctx?.title;
          if (!title || seenTitles.has(title) || binaryExts.test(title)) continue;
          seenTitles.add(title);
          results.push({ title, uri: ctx?.uri });
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
