import { GoogleGenAI, Modality } from "@google/genai";
import type { GenerateImageInput } from "./image-library-domain.ts";
import { menuImageDataSchema, type MenuImageData } from "./menu-image-domain.ts";

export async function generateImage(input: GenerateImageInput, reference?: MenuImageData): Promise<MenuImageData & { model: string }> {
  if (!process.env.GOOGLE_CLOUD_PROJECT) throw Object.assign(new Error("AI画像生成にはサーバーの Vertex AI 接続設定が必要です。"), { status: 503 });
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1";
  const client = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.VERTEX_IMAGE_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "global" });
  const response = await client.models.generateContent({
    model, contents: [{ role: "user", parts: [{ text: input.prompt }, ...(reference ? [{ inlineData: reference }] : [])] }],
    config: { responseModalities: [Modality.TEXT, Modality.IMAGE], imageConfig: { aspectRatio: input.aspectRatio }, httpOptions: { timeout: 180000 } },
  });
  const data = response.candidates?.[0]?.content?.parts?.find(part => !part.thought && part.inlineData?.data)?.inlineData;
  if (!data) throw Object.assign(new Error("画像を生成できませんでした。指示を見直して再度お試しください。"), { status: 422 });
  return { ...menuImageDataSchema.parse(data), model };
}
