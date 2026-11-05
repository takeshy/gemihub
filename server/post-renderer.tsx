import { localizeShell } from "../shared/html.ts";
import { tr } from "../shared/i18n.ts";
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
  tr("<!-- recent-articles:start --><section class=\"recent-posts\"><h2>お店からのお便り</h2><ul>{0}</ul></section><!-- recent-articles:end -->", posts.map((p) => `<li><time>${p.date}</time> <span>${postLabel(p.category)}</span> <a href="${escapeHtml(postPath(base, p))}">${escapeHtml(p.title)}</a></li>`).join(""));
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
export function renderArticle(post: PublicPost, shell: string, base = "", images?:Record<string,import("./menu-image-domain.ts").MenuImageData>) {
  const body = renderToStaticMarkup(
    <>
      <nav>
        <a href={`${base}/`}>{tr("お店に戻る")}</a> ·{" "}
        <a href={`${base}/${post.category}`}>{postLabel(post.category)}{tr("一覧")}</a>
      </nav>
      <PostContent post={post} inlineImages={images} />
    </>,
  );
  return localizeShell(shell)
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
  const body = tr("<nav><a href=\"{0}/\">お店に戻る</a></nav><h1>{1}</h1>{2}", escapeHtml(base), postLabel(category), recentMarkup(posts.filter((p) => p.category === category).map(summarizePost), base));
  return localizeShell(shell)
    .replace(/<title>.*?<\/title>/s, `<title>${postLabel(category)}</title>`)
    .replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}
export function postArtifacts(
  config: ShopConfig,
  posts: Post[],
  shell: string,
  menuImages?: Record<string, import("./menu-image-domain.ts").MenuImageData>,
) {
  posts = posts.filter(post => !post.deletedAt);
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
    files[`web/${p.category}/${postKey(p)}.html`] = renderArticle(p, shell, "", menuImages);
  for (const p of posts)
    files[`admin/posts/${p.id}.md`] = `# ${p.draft.title}\n\n${p.draft.body}\n`;
  return files;
}
