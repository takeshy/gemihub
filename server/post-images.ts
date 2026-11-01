import type { Post } from "./post-domain.ts";
export const articleImageUrl = (id: string) => `shop-image:${id}`;
export const articleImageId = (url: string) =>
  /^shop-image:([a-f0-9]{64})$/.exec(url)?.[1];
export const postImageIds = (body: string) => [
  ...new Set(
    [...body.matchAll(/shop-image:([a-f0-9]{64})(?=[\s)>"']|$)/g)].map(
      (match) => match[1],
    ),
  ),
];
export const publishedPostImageIds = (posts: Post[]) => [
  ...new Set(
    posts.flatMap((post) =>
      post.published ? postImageIds(post.published.body) : [],
    ),
  ),
];
export const articleImagePath = (id: string, name: string) =>
  `images/${id}/${name.replace(/[\[\]|\\/\r\n]/g, "_")}`;
export const wikiPaths = (text: string) => [
  ...new Set(
    [...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) =>
      match[1].split("|")[0].trim(),
    ),
  ),
];

export const articlePlainText = (body: string) =>
  body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[[^\]]+\]\]/g, "")
    .replace(/[#*`>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
