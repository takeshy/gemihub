import type { Route } from "./+types/api.hubwork.webpage-review";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "~/services/session.server";
import { getSettings } from "~/services/user-settings.server";
import { DEFAULT_SAFETY_SETTINGS } from "~/services/gemini.server";
import {
  buildWebpageReviewSystemPrompt,
  buildWebpageReviewUserPrompt,
  parseReviewResponse,
  type WebpageReviewFile,
} from "~/services/webpage-review.server";
import type { ModelType, ApiPlan, Language } from "~/types/settings";
import { getDefaultModelForPlan } from "~/types/settings";
import { createLogContext, emitLog } from "~/services/logger.server";

/**
 * POST /api/hubwork/webpage-review
 * Body: { description: string, files: WebpageReviewFile[], model?: ModelType }
 * Response: ReviewResult | { error: string }
 */
export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const logCtx = createLogContext(request, "/api/hubwork/webpage-review", tokens.rootFolderId);

  if (!tokens.geminiApiKey) {
    emitLog(logCtx, 400, { error: "Gemini API key not configured" });
    return Response.json(
      { error: "Gemini API key not configured. Please set it in Settings." },
      { status: 400 },
    );
  }

  const body = (await request.json()) as {
    description?: string;
    files?: WebpageReviewFile[];
    model?: ModelType;
  };

  const description = (body.description ?? "").trim();
  const files = Array.isArray(body.files) ? body.files : [];
  if (!description) {
    return Response.json({ error: "Missing description" }, { status: 400 });
  }
  if (files.length === 0) {
    return Response.json({ error: "No files to review" }, { status: 400 });
  }

  let settings;
  try {
    settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
  } catch {
    // defaults are fine
  }

  const apiPlan: ApiPlan = settings?.apiPlan ?? (tokens.apiPlan as ApiPlan) ?? "paid";
  const locale: Language = (settings?.language as Language) ?? "en";
  const model: ModelType = body.model ?? (settings?.selectedModel as ModelType) ?? getDefaultModelForPlan(apiPlan);

  const systemPrompt = buildWebpageReviewSystemPrompt(locale);
  const userPrompt = buildWebpageReviewUserPrompt({ description, files });

  logCtx.details = { model, fileCount: files.length };
  emitLog(logCtx, 200);

  try {
    const ai = new GoogleGenAI({ apiKey: tokens.geminiApiKey });
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        safetySettings: DEFAULT_SAFETY_SETTINGS,
      },
    });
    const text = response.text ?? "";
    const review = parseReviewResponse(text);
    if (!review) {
      return Response.json(
        { verdict: "fail", summary: text || "Empty review response", issues: [], rawText: text },
      );
    }
    return Response.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
