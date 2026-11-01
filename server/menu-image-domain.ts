import { z } from "zod";
export const menuImageLimit = 5 * 1024 * 1024;
export const menuImageDataSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  data: z.string().max(Math.ceil(menuImageLimit / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export const menuImageInputSchema = menuImageDataSchema.extend({ requestId: z.uuid(), name: z.string().trim().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/) });
export type MenuImageData = z.infer<typeof menuImageDataSchema>;
