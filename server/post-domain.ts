import { z } from "zod";
export const postCategorySchema = z.enum(["blogs", "announcements"]);
export type PostCategory = z.infer<typeof postCategorySchema>;
export const postContentSchema = z.object({
  category: postCategorySchema,
  title: z.string().trim().min(1).max(160),
  date: z.iso.date(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  excerpt: z.string().trim().max(300),
  body: z.string().trim().min(1).max(20000),
});
export type PostContent = z.infer<typeof postContentSchema>;
export type Post = {
  id: string;
  shopId: string;
  draft: PostContent;
  published: PostContent | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  publishedAt?: string;
  address?: { category: PostCategory; date: string; slug: string };
};
export type PublicPost = PostContent & { id: string; publishedAt: string };
export type PostSummary = Omit<PublicPost, "body">;
export const postLabel = (category: PostCategory) =>
  category === "blogs" ? "ブログ" : "お知らせ";
export const postKey = (post: Pick<PostContent, "date" | "slug">) =>
  `${post.date}-${post.slug}`;
export const postPath = (
  base: string,
  post: Pick<PostContent, "category" | "date" | "slug">,
) => `${base}/${post.category}/${postKey(post)}`;
export const postAddress = (content: PostContent) => ({
  category: content.category,
  date: content.date,
  slug: content.slug,
});
export function publicPosts(posts: Post[]): PublicPost[] {
  return posts
    .filter((p) => p.published)
    .map((p) => ({ ...p.published!, id: p.id, publishedAt: p.publishedAt! }))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.publishedAt.localeCompare(a.publishedAt) ||
        a.id.localeCompare(b.id),
    );
}
export function summarizePost({
  body: _,
  ...summary
}: PublicPost): PostSummary {
  return summary;
}
export function validatePostAddress(
  post: Post,
  content: PostContent,
  others: Post[],
) {
  if (
    post.address &&
    JSON.stringify(post.address) !== JSON.stringify(postAddress(content))
  )
    throw Object.assign(
      new Error(
        "公開した記事の種類・日付・アドレスは変更できません。本文とタイトルは編集できます。",
      ),
      { status: 409 },
    );
  if (
    others.some(
      (p) =>
        p.id !== post.id &&
        JSON.stringify(p.address || postAddress(p.draft)) ===
          JSON.stringify(postAddress(content)),
    )
  )
    throw Object.assign(
      new Error(
        "同じ日付・アドレスの記事があります。アドレスを変更してください。",
      ),
      { status: 409 },
    );
}

export function uniquePostSlug(content: PostContent, posts: Post[], id: string) {
  const original=content.slug;
  let slug=original,index=2;
  while(posts.some(post=>post.id!==id&&JSON.stringify(post.address||postAddress(post.draft))===JSON.stringify(postAddress({...content,slug})))) {
    const suffix=`-${index++}`;slug=original.slice(0,80-suffix.length).replace(/-+$/,"")+suffix;
  }
  return slug;
}
