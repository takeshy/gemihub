import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import { encrypt, syncPostFiles } from "../server/google.ts";
import { generateArticleMetadata } from "../server/post-metadata.ts";
import { postAddress, type Post } from "../server/post-domain.ts";
import * as intelligence from "../server/ai.ts";

process.env.DEMO_MODE = "true";

test("draft saves need no model, Drive or storefront rebuild and do not wait for the configuration lock", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("draft-owner@example.com");
  shop.published = structuredClone(sample);
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  for (const [token, email] of [["owner", shop.owner], ["other", "another@example.com"]]) {
    await store.put("session", digest(token), { user: { email, name: token, role: "owner" }, expires: Date.now() + 600000 });
  }
  const imageId = "a".repeat(64), foreignImageId = "b".repeat(64);
  await store.put("menuImageUpload", imageId, { shopId: shop.id, complete: true, fileId: "private-photo" });
  await store.put("menuImageUpload", foreignImageId, { shopId: "another-shop", complete: true, fileId: "foreign-photo" });
  let tokenCalls = 0, modelCalls = 0;
  mock.method(store, "ownerToken", async () => { tokenCalls++; throw new Error("Drafts must not connect to Drive"); });
  const server = createApp(store, { ...intelligence, async articleMetadata() { modelCalls++; throw new Error("Drafts must not call AI"); } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const background = store.locked(shop.id, async () => { entered(); await gate; });
  t.after(async () => { release(); await background; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); mock.restoreAll(); });
  await started;
  const base = `/api/shops/${shop.id}/posts`;
  const request = async (path: string, data?: unknown, token = "owner") => {
    const response = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST", signal: AbortSignal.timeout(2000),
      headers: { Origin: origin, Cookie: `gemihub_session=${token}`, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  };
  const content = { category: "blogs" as const, date: "2026-11-05", title: "写真つきの下書き", body: `下書きの本文\n\n![写真](shop-image:${imageId})` };
  const input = { content, requestId: randomUUID() };
  assert.equal((await request(`${base}/drafts`, input, "other")).status, 403);
  const created = await request(`${base}/drafts`, input);
  assert.equal(created.status, 200);
  const first: Post = created.body;
  assert.equal(first.published, null); assert.equal(first.draft.excerpt, ""); assert.match(first.draft.slug, /^article-[a-f0-9]+$/);
  assert.equal((await request(`${base}/drafts`, input)).body.id, first.id);
  assert.equal((await store.records<Post>("post", shop)).length, 1, "retrying a creation does not duplicate a draft");
  assert.equal((await request(`${base}/drafts`, { ...input, content: { ...content, title: "changed retry" } })).status, 409);
  assert.equal((await request(base)).status, 200, "reading the article list does not wait for Drive's lock either");
  assert.equal((await request(base, undefined, "other")).status, 403);
  assert.equal((await request(`${base}/drafts`, { ...input, requestId: randomUUID(), content: { ...content, body: `![Other](shop-image:${foreignImageId})` } })).status, 404);
  const live = { ...first, published: { ...first.draft, body: "PUBLIC BODY", excerpt: "OLD INTRODUCTION" }, address: postAddress(first.draft), publishedAt: first.createdAt };
  await store.put("post", first.id, live);
  const update = { content: { ...content, body: "PRIVATE DRAFT BODY" }, requestId: randomUUID(), version: first.version };
  const changed = await request(`${base}/${first.id}/draft`, update);
  assert.equal(changed.status, 200); assert.equal(changed.body.version, 2);
  assert.equal(changed.body.draft.excerpt, ""); assert.equal(changed.body.draft.slug, first.draft.slug);
  assert.deepEqual(changed.body.published, live.published, "a draft save does not touch the live article");
  assert.equal((await request(`${base}/${first.id}/draft`, update)).body.version, 2, "update retries are idempotent");
  assert.equal((await request(`${base}/${first.id}/draft`, { ...update, requestId: randomUUID() })).status, 409);
  assert.equal((await request(`${base}/${first.id}/draft`, { ...update, version: 2, requestId: randomUUID(), content: { ...content, date: "2026-11-06" } })).status, 409);
  const jobs = await store.list<{ type: string; postId: string; attempts: number }>("job");
  assert.equal(jobs.length, 2); assert.ok(jobs.every(job => job.type === "posts" && job.postId === first.id && job.attempts === 0));
  assert.equal(tokenCalls, 0); assert.equal(modelCalls, 0);
  assert.equal((await store.shop(shop.id))?.storefrontRelease, undefined, "draft saving never regenerates public pages");
  const metadata = await generateArticleMetadata(content);
  assert.equal(metadata.excerpt, ""); assert.match(metadata.slug, /^article-[a-f0-9]+$/);
});

test("background draft export updates only the requested Markdown and private index", async t => {
  const writes: string[] = [];
  mock.method(google, "drive", (() => ({ files: {
    async get() { return { data: { parents: ["posts-folder"] } }; },
    async update(input: { fileId: string; media?: unknown }) { if (input.media) writes.push(input.fileId); return { data: {} }; },
    async create() { throw new Error("Draft synchronization must not create public files"); },
  } })) as never);
  t.after(() => mock.restoreAll());
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.google = { folderId: "root", specId: "spec", historyId: "history", artifactFolders: { "admin/posts": "posts-folder" }, artifactIds: {
    "admin/posts/posts.json": "private-index", "admin/posts/draft.md": "draft-file", "admin/posts/other.md": "other-file", "web/blogs/live.html": "live-file",
  } };
  const content = { category: "blogs" as const, date: "2026-11-05", title: "Draft", body: "Body", slug: "draft", excerpt: "" };
  const post: Post = { id: "draft", shopId: shop.id, draft: content, published: null, version: 1, createdAt: "now", updatedAt: "now", updatedBy: shop.owner };
  let progress = 0;
  await syncPostFiles(shop, [post, { ...post, id: "other" }], encrypt("token"), () => { progress++; }, async () => { throw new Error("Draft export must not download public images"); }, post.id);
  assert.deepEqual(writes, ["private-index", "draft-file"]);
  assert.ok(progress > 0);
  assert.equal(shop.google.artifactIds!["web/blogs/live.html"], "live-file", "a draft export cannot move or unpublish live files");
  await store.close();
});
