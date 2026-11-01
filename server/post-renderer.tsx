import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostContent } from "../src/PostContent.tsx";
import { escapeHtml, renderShop, driveSnapshot } from "./artifacts.ts";
import {
  postLabel,
  postPath,
  postKey,
  publicPosts,
  summarizePost,
  type Post,
  type PostCategory,
  type PublicPost,
  type PostSummary,
} from "./post-domain.ts";
import type { ShopConfig } from "./domain.ts";
const recentMarkup = (posts: PostSummary[], base: string) =>
  `<!-- recent-articles:start --><section class="recent-posts"><h2>お店からのお便り</h2><ul>${posts.map((p) => `<li><time>${p.date}</time> <span>${postLabel(p.category)}</span> <a href="${escapeHtml(postPath(base, p))}">${escapeHtml(p.title)}</a></li>`).join("")}</ul></section><!-- recent-articles:end -->`;
export function renderHomeWithPosts(
  config: ShopConfig,
  shell: string,
  posts: PostSummary[],
  base = "",
) {
  const page = renderShop(config, shell);
  return page.replace(
    "</noscript>",
    () => `${recentMarkup(posts.slice(0, 5), base)}</noscript>`,
  );
}
export function renderArticle(post: PublicPost, shell: string, base = "") {
  const body = renderToStaticMarkup(
    <>
      <nav>
        <a href={`${base}/`}>お店に戻る</a> ·{" "}
        <a href={`${base}/${post.category}`}>{postLabel(post.category)}一覧</a>
      </nav>
      <PostContent post={post} />
    </>,
  );
  return shell
    .replace(
      /<title>.*?<\/title>/s,
      () =>
        `<title>${escapeHtml(post.title)}</title><meta name="gemihub-post-category" content="${post.category}"><meta name="gemihub-post-title" content="${escapeHtml(post.title)}"><meta name="gemihub-post-date" content="${post.date}">`,
    )
    .replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}
export function renderArchive(
  category: PostCategory,
  posts: PublicPost[],
  shell: string,
  base = "",
) {
  const body = `<nav><a href="${escapeHtml(base)}/">お店に戻る</a></nav><h1>${postLabel(category)}</h1>${recentMarkup(posts.filter((p) => p.category === category).map(summarizePost), base)}`;
  return shell
    .replace(/<title>.*?<\/title>/s, `<title>${postLabel(category)}</title>`)
    .replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}
export function postArtifacts(
  config: ShopConfig,
  posts: Post[],
  shell: string,
  menuImages?: Record<string, import("./menu-image-domain.ts").MenuImageData>,
) {
  const live = publicPosts(posts);
  const files: Record<string, string> = {
    ...driveSnapshot(config, shell, undefined, menuImages),
    "web/recent-articles.json": JSON.stringify(
      live.slice(0, 5).map(summarizePost),
      null,
      2,
    ),
    "web/blogs/index.html": renderArchive("blogs", live, shell),
    "web/announcements/index.html": renderArchive("announcements", live, shell),
    "admin/posts/posts.json": JSON.stringify(posts, null, 2),
  };
  for (const p of live)
    files[`web/${p.category}/${postKey(p)}.html`] = renderArticle(p, shell);
  for (const p of posts)
    files[`admin/posts/${p.id}.md`] = `# ${p.draft.title}\n\n${p.draft.body}\n`;
  return files;
}
