import { z } from "zod";
export const editorIndexSchema = z.object({
  base: z.number().int(), published: z.boolean(), sharedHash: z.string(), lastPublishedPlanId: z.string().optional(),
  parts: z.object({ header: z.string(), footer: z.string() }),
  pages: z.array(z.object({ id: z.string(), title: z.string(), slug: z.string(), hash: z.string() })),
});
export type EditorIndex = z.infer<typeof editorIndexSchema>;
