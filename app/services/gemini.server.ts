import { GoogleGenAI } from "@google/genai";
import type { ModelType } from "~/types/settings";

export async function generateWorkflow(
  userPrompt: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
    },
  });

  let text = response.text || "";

  // Extract YAML from code block if present
  const codeBlockMatch = text.match(/```(?:yaml)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  return text;
}

// Streaming workflow generation with thinking support
export interface WorkflowStreamChunk {
  type: "thinking" | "text" | "error" | "done";
  content?: string;
}

function isGemmaModel(model: string): boolean {
  return model.startsWith("gemma-");
}

export async function* generateWorkflowStream(
  userPrompt: string,
  systemPrompt: string,
  apiKey: string,
  model: ModelType = "gemini-2.5-flash",
  history?: Array<{ role: "user" | "model"; text: string }>
): AsyncGenerator<WorkflowStreamChunk> {
  try {
    const ai = new GoogleGenAI({ apiKey });

    // Build thinking config (Gemma models don't support thinking)
    // Always enable thinking for workflow generation (quality improvement)
    const thinkingConfig = isGemmaModel(model)
      ? undefined
      : model.includes("lite")
        ? { includeThoughts: true, thinkingBudget: -1 }
        : { includeThoughts: true };

    // Build contents with history for regeneration
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
    if (history && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role,
          parts: [{ text: msg.text }],
        });
      }
    }
    contents.push({
      role: "user",
      parts: [{ text: userPrompt }],
    });

    const response = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    for await (const chunk of response) {
      if (!chunk.candidates?.[0]?.content?.parts) continue;

      for (const part of chunk.candidates[0].content.parts) {
        if (part.thought && part.text) {
          yield { type: "thinking", content: part.text };
        } else if (part.text) {
          yield { type: "text", content: part.text };
        }
      }
    }

    yield { type: "done" };
  } catch (err) {
    yield {
      type: "error",
      content: err instanceof Error ? err.message : String(err),
    };
  }
}
