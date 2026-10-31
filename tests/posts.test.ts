import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import {
  postArtifacts,
  renderArticle,
  renderHomeWithPosts,
} from "../server/post-renderer.tsx";
import {
  publicPosts,
  summarizePost,
  postContentSchema,
  type Post,
  type PostContent,
} from "../server/post-domain.ts";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
const content: PostContent = {
  category: "blogs",
  date: "2030-01-01",
  slug: "new-design",
  title: "新しいデザイン",
  excerpt: "季節のおすすめ",
  body: "## お店のお便り\n\nゆっくりお過ごしください。",
};
process.env.DEMO_MODE = "true";
test("article drafts, approval, authorization, stable URLs, edits, withdrawal, archives and recent posts", async (t) => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  await store.saveShop(shop);
  const other = await store.createShop("other@example.com");
  other.published = structuredClone(sample);
  await store.saveShop(other);
  const server = createApp(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => {
    server.close();
    void store.close();
  });
  async function api(path: string, data?: unknown, cookie = "") {
    const res = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  const owner = (await api("/api/demo-login", { role: "owner" })).cookie;
  const customer = (
    await api("/api/demo-login", {
      role: "customer",
      shopId: shop.id,
      email: "guest@example.com",
    })
  ).cookie;
  const admin = `/api/shops/${shop.id}/posts`,
    publicBase = `/api/public/${shop.slug}`,
    home = `/s/${shop.slug}`;
  assert.equal((await api(admin, undefined, customer)).status, 403);
  assert.equal((await api(admin, { content }, customer)).status, 403);
  assert.equal((await api(admin, { content })).status, 403);
  const before = (await store.list("post")).length;
  const proposed = await api(
    `${admin}/propose`,
    { instruction: "紹介文にして", source: "元のメモ", title: "メモのお便り" },
    owner,
  );
  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.body, "元のメモ");
  assert.equal((await store.list("post")).length, before);
  assert.equal(
    (await api(admin, { content: { ...content, slug: "../../admin" } }, owner))
      .status,
    400,
  );
  const created = await api(admin, { content }, owner);
  assert.equal(created.status, 200);
  let post: Post = created.body;
  const articleKey = `${content.date}-${content.slug}`;
  assert.equal((await api(`${publicBase}/posts`)).body.total, 0);
  assert.equal(
    (await api(`${publicBase}/posts/blogs/${articleKey}`)).status,
    404,
  );
  assert.equal(
    (await fetch(origin + `${home}/blogs/${articleKey}`)).status,
    404,
  );
  assert.equal((await api(admin, { content }, owner)).status, 409);
  assert.equal(
    (
      await api(
        `${admin}/${post.id}/publish`,
        { version: post.version, approved: false },
        owner,
      )
    ).status,
    400,
  );
  post = (
    await api(
      `${admin}/${post.id}/publish`,
      { version: post.version, approved: true },
      owner,
    )
  ).body;
  assert.equal(post.version, 2);
  const live = await api(`${publicBase}/posts/blogs/${articleKey}`);
  assert.equal(live.status, 200);
  assert.equal(live.body.body, content.body);
  assert.equal(live.body.draft, undefined);
  const listing = await api(`${publicBase}/posts?category=blogs`);
  assert.equal(listing.body.items[0].body, undefined);
  assert.equal(listing.body.items[0].title, content.title);
  const html = await (
    await fetch(origin + `${home}/blogs/${articleKey}`)
  ).text();
  assert.match(html, /gemihub-post-date/);
  assert.match(html, /お店のお便り/);
  const changed = {
    ...content,
    title: "編集中の新タイトル",
    body: "この下書きはまだ公開しません",
  };
  assert.equal(
    (
      await api(
        `${admin}/${post.id}/save`,
        { version: 1, content: changed },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await api(
        `${admin}/${post.id}/save`,
        { version: post.version, content: { ...changed, slug: "changed-url" } },
        owner,
      )
    ).status,
    409,
  );
  post = (
    await api(
      `${admin}/${post.id}/save`,
      { version: post.version, content: changed },
      owner,
    )
  ).body;
  assert.equal(
    (await api(`${publicBase}/posts/blogs/${articleKey}`)).body.title,
    content.title,
  );
  assert.equal(
    (await api(`${publicBase}/posts/blogs/${articleKey}`)).body.body,
    content.body,
  );
  assert.doesNotMatch(
    await (await fetch(origin + `${home}/blogs/${articleKey}`)).text(),
    /この下書きはまだ公開しません/,
  );
  assert.equal(
    (
      await api(
        `/api/shops/${other.id}/posts/${post.id}/publish`,
        { version: post.version, approved: true },
        owner,
      )
    ).status,
    403,
  );
  const otherOwner = (
    await api("/api/demo-login", { role: "owner", email: "other@example.com" })
  ).cookie;
  assert.equal(
    (
      await api(
        `/api/shops/${other.id}/posts/${post.id}/publish`,
        { version: post.version, approved: true },
        otherOwner,
      )
    ).status,
    404,
  );
  await store.put("member", `${shop.id}:guest@example.com`, {
    shopId: shop.id,
    email: "guest@example.com",
    accepted: true,
  });
  assert.equal((await api(admin, undefined, customer)).status, 200);
  assert.equal(
    (
      await api(
        `${admin}/${post.id}/publish`,
        { version: post.version, approved: true },
        customer,
      )
    ).status,
    403,
  );
  post = (
    await api(
      `${admin}/${post.id}/publish`,
      { version: post.version, approved: true },
      owner,
    )
  ).body;
  assert.equal(
    (await api(`${publicBase}/posts/blogs/${articleKey}`)).body.title,
    changed.title,
  );
  for (let i = 0; i < 6; i++) {
    const c = {
      ...content,
      date: `2030-01-${String(i + 2).padStart(2, "0")}`,
      slug: `post-${i}`,
      category: i % 2 ? "announcements" : "blogs",
    };
    const draft = (await api(admin, { content: c }, owner)).body;
    assert.equal(
      (
        await api(
          `${admin}/${draft.id}/publish`,
          { version: draft.version, approved: true },
          owner,
        )
      ).status,
      200,
    );
  }
  const recent = (await api(publicBase)).body.recentPosts;
  assert.equal(recent.length, 5);
  assert.equal(recent[0].date, "2030-01-07");
  assert.ok(
    recent.some((p: { category: string }) => p.category === "announcements"),
  );
  assert.equal(recent[0].body, undefined);
  assert.equal(
    (await api(`${publicBase}/posts?category=announcements`)).body.total,
    3,
  );
  assert.equal((await api(`${publicBase}/posts?category=admin`)).status, 400);
  post = (
    await api(`${admin}/${post.id}/unpublish`, { version: post.version }, owner)
  ).body;
  assert.equal(post.published, null);
  assert.ok((await store.get<Post>("post", post.id))?.draft);
  assert.equal(
    (await api(`${publicBase}/posts/blogs/${articleKey}`)).status,
    404,
  );
  assert.equal(
    (await fetch(origin + `${home}/blogs/${articleKey}`)).status,
    404,
  );
  assert.match((await store.shop(shop.id))!.history.at(-1)!.summary, /非公開/);
  const unpublished = await store.createShop("new@example.com");
  const newOwner = (
    await api("/api/demo-login", { role: "owner", email: "new@example.com" })
  ).cookie;
  const draft = (
    await api(`/api/shops/${unpublished.id}/posts`, { content }, newOwner)
  ).body;
  assert.equal(
    (
      await api(
        `/api/shops/${unpublished.id}/posts/${draft.id}/publish`,
        { version: draft.version, approved: true },
        newOwner,
      )
    ).status,
    409,
  );
  const custom = (await store.shop(shop.id))!;
  custom.domain = "blog.example.com";
  custom.domainVerified = true;
  await store.saveShop(custom);
  const hostRequest = (path: string) =>
    new Promise<{
      status: number;
      text: string;
    }>((resolve) => {
      const req = httpRequest(
        origin + path,
        { headers: { host: "blog.example.com" } },
        (res) => {
          let text = "";
          res.on("data", (v) => (text += v));
          res.on("end", () => resolve({ status: res.statusCode!, text }));
        },
      );
      req.end();
    });
  assert.equal((await hostRequest("/blogs")).status, 200);
  assert.equal((await hostRequest("/announcements/index")).status, 200);
  assert.equal((await hostRequest(`${admin}`)).status, 404);
  assert.equal(
    (await hostRequest(`/api/public/${other.slug}/posts`)).status,
    404,
  );
});
test("safe Markdown exports keep draft bodies out of public files and all published items in archives", () => {
  const shell =
    '<html><head><title>old</title></head><body><div id="root"></div></body></html>';
  const now = new Date().toISOString();
  const live: Post = {
    id: "live",
    shopId: "shop",
    draft: { ...content, body: "PRIVATE-EDIT" },
    published: {
      ...content,
      title: "$& <img src=x onerror=alert(1)>",
      body: "## Welcome\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![unsafe](data:text/html,bad)",
    },
    version: 2,
    createdAt: now,
    updatedAt: now,
    updatedBy: "owner",
    publishedAt: now,
  };
  const draft: Post = {
    ...live,
    id: "draft",
    draft: { ...content, body: "PRIVATE-DRAFT" },
    published: null,
  };
  const rendered = renderArticle(publicPosts([live])[0], shell);
  assert.doesNotMatch(
    rendered,
    /<img|<script>alert|href="javascript:|data:text/,
  );
  assert.match(rendered, /Welcome/);
  assert.match(rendered, /\$&amp;/);
  const home = renderHomeWithPosts(
    sample,
    shell,
    publicPosts([live]).map(summarizePost),
  );
  assert.match(home, /\$&amp;/);
  assert.equal((home.match(/<\/noscript>/g) || []).length, 1);
  const list = [
    live,
    draft,
    ...Array.from({ length: 6 }, (_, i) => ({
      ...live,
      id: `more-${i}`,
      published: {
        ...content,
        date: `2030-01-${String(i + 2).padStart(2, "0")}`,
        slug: `more-${i}`,
      },
    })),
  ];
  const files = postArtifacts(sample, list, shell);
  assert.doesNotMatch(files["web/blogs/index.html"], /PRIVATE/);
  assert.doesNotMatch(files["web/index.html"], /PRIVATE/);
  // The post-sync queue must not overwrite the runnable Drive home with a server shell.
  assert.match(files["web/index.html"], /<script src="\.\/data\.js"><\/script>/);
  assert.match(files["web/data.js"], /window\.__OMAIWEB_MOCK__ = /);
  assert.deepEqual(JSON.parse(files["web/mock.json"]).shop, JSON.parse(files["web/shop.json"]));
  assert.match(files["admin/posts/posts.json"], /PRIVATE-DRAFT/);
  assert.equal(JSON.parse(files["web/recent-articles.json"]).length, 5);
  assert.equal((files["web/blogs/index.html"].match(/<li>/g) || []).length, 7);
  assert.equal(
    postContentSchema.safeParse({ ...content, body: "" }).success,
    false,
  );
});
