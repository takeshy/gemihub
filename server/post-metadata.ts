import { createHash } from "node:crypto";
import { z } from "zod";
import { postContentSchema } from "./post-domain.ts";
export const articleInputSchema = postContentSchema.omit({
  slug: true,
  excerpt: true,
});
export type ArticleInput = z.infer<typeof articleInputSchema>;
export const articleMetadataSchema = postContentSchema
  .pick({ slug: true, excerpt: true });
export async function generateArticleMetadata(
  content: ArticleInput,
  _demo = false,
) {
  // Compatibility for older clients; saving never needs a model or an introduction.
  return {
    slug: `article-${createHash("sha256").update(content.title).digest("hex").slice(0, 12)}`,
    excerpt: "",
  };
}
