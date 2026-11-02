import { tr } from "../shared/i18n.ts";
import type { GenerateImageInput } from "./image-library-domain.ts";
import { menuImageDataSchema, type MenuImageData } from "./menu-image-domain.ts";
import { generateImageData } from "./llm.ts";

export async function generateImage(input: GenerateImageInput, reference?: MenuImageData): Promise<MenuImageData & { model: string }> {
  const result = await generateImageData({ prompt: input.prompt, aspectRatio: input.aspectRatio, reference });
  if (!result) throw Object.assign(new Error(tr("画像を生成できませんでした。指示を見直して再度お試しください。")), { status: 422 });
  return { ...menuImageDataSchema.parse({ mimeType: result.mimeType, data: result.data }), model: result.model };
}
