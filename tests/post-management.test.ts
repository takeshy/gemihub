import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import { articleFiles } from "../server/article-files.ts";
import { postArtifacts } from "../server/post-renderer.tsx";
import { publicPosts, type Post } from "../server/post-domain.ts";
import { publishedPostImageIds } from "../server/post-images.ts";

process.env.DEMO_MODE = "true";

test("owners can unpublish and delete blogs and announcements without exposing deleted drafts", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.publication = "public";
  await store.saveShop(shop);
  for (const [token, email] of [["owner", shop.owner], ["staff", "staff@example.com"], ["other", "other@example.com"]]) {
    await store.put("session", digest(token), { user: { email, name: token, role: "owner" }, expires: Date.now() + 600000 });
  }
  await store.put("member", `${shop.id}:staff@example.com`, { shopId: shop.id, email: "staff@example.com", accepted: true });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const base = `/api/shops/${shop.id}/posts`, live = `/api/public/${shop.slug}/posts`;
  const api = async (path: string, data?: unknown, token = "owner") => {
    const response = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { Origin: origin, Cookie: `gemihub_session=${token}`, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  };
  for (const category of ["blogs", "announcements"] as const) {
    const content = { category, date: "2026-11-05", title: `Remove ${category}`, body: `PRIVATE ${category}` };
    let post: Post = (await api(`${base}/drafts`, { content, requestId: randomUUID() })).body;
    post = (await api(`${base}/${post.id}/publish`, { version: post.version, approved: true })).body;
    const key = `${category}/${post.draft.date}-${post.draft.slug}`;
    const page = `${origin}/s/${shop.slug}/${key}`;
    assert.equal((await fetch(page)).status, 200);
    assert.equal((await api(`${base}/${post.id}/unpublish`, { version: post.version }, "staff")).status, 403);
    post = (await api(`${base}/${post.id}/unpublish`, { version: post.version })).body;
    assert.equal(post.published, null); assert.equal(post.draft.body, content.body);
    assert.equal((await fetch(page)).status, 404);
    assert.equal((await api(`${live}/${key}`)).status, 404);
    post = (await api(`${base}/${post.id}/publish`, { version: post.version, approved: true })).body;
    assert.equal((await fetch(page)).status, 200, "unpublished articles can be published again");
    const removal = { version: post.version, confirmed: true };
    for (const token of ["staff", "other"]) assert.equal((await api(`${base}/${post.id}/delete`, removal, token)).status, 403);
    assert.equal((await api(`${base}/${post.id}/delete`, { version: post.version })).status, 400);
    assert.equal((await api(`${base}/${post.id}/delete`, { ...removal, version: 1 })).status, 409);
    const deleted = await api(`${base}/${post.id}/delete`, removal);
    assert.equal(deleted.status, 200); assert.ok(deleted.body.deletedAt); assert.equal(deleted.body.published, null);
    assert.equal((await fetch(page)).status, 404);
    assert.equal((await api(`${live}/${key}`)).status, 404);
    assert.equal((await api(live)).body.total, 0);
    assert.deepEqual((await api(base)).body, []);
    assert.match((await store.shop(shop.id))!.history.at(-1)!.summary, /削除/);
    const historyLength = (await store.shop(shop.id))!.history.length;
    assert.equal((await api(`${base}/${post.id}/delete`, removal)).body.version, deleted.body.version, "retrying deletion is idempotent");
    assert.equal((await store.shop(shop.id))!.history.length, historyLength);
    assert.equal((await api(`${base}/${post.id}/publish`, { version: deleted.body.version, approved: true })).status, 404);
    assert.equal((await api(`${base}/${post.id}/draft`, { content, version: deleted.body.version, requestId: randomUUID() })).status, 404);
    assert.equal((await api(`${base}/${post.id}/save`, { content: post.draft, version: deleted.body.version })).status, 404);
    const catalog = await articleFiles(store, shop, shop.published!);
    assert.ok(!catalog.files.some(file => file.path.startsWith("articles/")), "deleted articles cannot be referenced by AI");
    const records = await store.records<Post>("post", shop);
    assert.ok(records.some(record => record.id === post.id && record.deletedAt), "audit records are retained");
    const artifacts = postArtifacts(shop.published!, records, '<html><head></head><body><div id="root"></div></body></html>');
    assert.deepEqual(JSON.parse(artifacts["admin/posts/posts.json"]), []);
    assert.equal(artifacts[`admin/posts/${post.id}.md`], undefined);
    assert.ok(!JSON.stringify(artifacts).includes(content.body));
  }
  const imageId = "a".repeat(64), [deleted] = await store.records<Post>("post", shop);
  const retained = { ...deleted, published: { ...deleted.draft, body: `![photo](shop-image:${imageId})` } };
  assert.deepEqual(publicPosts([retained]), []);
  assert.deepEqual(publishedPostImageIds([retained]), []);
  const privatePost: Post = (await api(`${base}/drafts`, { content: { category: "blogs", date: "2026-11-06", title: "Never public", body: "Private" }, requestId: randomUUID() })).body;
  const release = (await store.shop(shop.id))!.storefrontRelease;
  assert.equal((await api(`${base}/${privatePost.id}/delete`, { version: privatePost.version, confirmed: true })).status, 200);
  assert.deepEqual((await store.shop(shop.id))!.storefrontRelease, release, "deleting a private draft does not rebuild the public shop");
});
