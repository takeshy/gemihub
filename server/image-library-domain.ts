import { z } from "zod";
export const imageIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const requestImageIdsSchema = z.array(imageIdSchema).max(5).refine(ids => new Set(ids).size === ids.length, "同じ画像を重複して選択できません");
export const imageNameSchema = z.string().trim().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/);
export const generateImageSchema = z.object({
  requestId: z.uuid(), name: imageNameSchema, prompt: z.string().trim().min(1).max(4000),
  aspectRatio: z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]).default("4:3"),
  referenceImageId: imageIdSchema.optional(),
});
export type GenerateImageInput = z.infer<typeof generateImageSchema>;
export type LibraryImage = { id: string; name: string; mimeType: string; size: number; createdAt: string; source: "upload" | "ai"; prompt?: string; model?: string; usedBy: string[] };
