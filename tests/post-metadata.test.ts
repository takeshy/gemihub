import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import {
  propose,
  proposeArticle,
  identifyVisual,
  explainSystem,
} from "../server/ai.ts";
import type { Post } from "../server/post-domain.ts";

test("article metadata is generated at save, cached, private, collision-safe and preserves existing addresses", async (t) => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  await store.saveShop(shop);
  for (const [id, email] of [
    ["owner", shop.owner],
    ["staff", "staff@example.com"],
    ["customer", "customer@example.com"],
  ])
    await store.put("session", digest(id), {
      user: { email, name: id, role: id === "owner" ? "owner" : "customer" },
      expires: Date.now() + 600000,
    });
  await store.put("member", `${shop.id}:staff@example.com`, {
    shopId: shop.id,
    email: "staff@example.com",
    accepted: true,
    status: "accepted",
  });
  let calls = 0,
    broken = false;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const server = createApp(store, {
    propose,
    proposeArticle,
    identifyVisual,
    explainSystem,
    async articleMetadata(content) {
      calls++;
      if (calls === 1) {
        entered();
        await gate;
      }
      if (broken) throw new Error("model fixture failure");
      return { slug: "nail-care", excerpt: `紹介：${content.title}` };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    release();
    server.close();
    await store.close();
  });
  const base = `/api/shops/${shop.id}/posts`;
  async function request(path: string, data?: unknown, user = "owner") {
    const response = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: `omai_session=${user}`,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }
  const content = {
    category: "blogs",
    date: "2026-11-01",
    title: "爪のケアについて",
    body: "## 爪のお手入れ\nご自宅でできるお手入れをご案内します。",
  };
  const input = { requestId: randomUUID(), content };
  for (const user of ["staff", "customer", "anonymous"])
    assert.equal((await request(`${base}/metadata`, input, user)).status, 403);
  assert.equal(
    (
      await request(`${base}/metadata`, {
        ...input,
        content: { ...content, title: "" },
      })
    ).status,
    400,
  );
  const generating = request(`${base}/metadata`, input);
  await started;
  assert.equal(
    (await request(`/api/shops/${shop.id}/calendar`)).status,
    200,
    "model generation does not hold the shop lock",
  );
  release();
  const metadata = await generating;
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.excerpt, "紹介：爪のケアについて");
  assert.equal((await request(`${base}/metadata`, input)).status, 200);
  assert.equal(calls, 1, "successful generation cached for retries");
  assert.equal(
    (
      await request(`${base}/metadata`, {
        ...input,
        content: { ...content, title: "別の内容" },
      })
    ).status,
    409,
  );
  const save = {
    content: { ...content, ...metadata.body },
    publish: true,
    requestId: input.requestId,
    autoMetadata: true,
  };
  const first = await request(base, save);
  assert.equal(first.status, 200);
  assert.equal(first.body.published.slug, "nail-care");
  assert.equal((await request(base, save)).body.id, first.body.id);
  assert.equal((await store.records<Post>("post", shop)).length, 1);
  const second = await request(base, { ...save, requestId: randomUUID() });
  assert.equal(second.status, 200);
  assert.equal(second.body.published.slug, "nail-care-2");
  const changed = {
    ...content,
    title: "新しいお手入れの案内",
    body: "新しい本文です。",
  };
  const updateInput = {
    content: changed,
    postId: first.body.id,
    version: first.body.version,
    requestId: randomUUID(),
  };
  const updatedMeta = await request(`${base}/metadata`, updateInput);
  assert.equal(updatedMeta.status, 200);
  assert.equal(updatedMeta.body.slug, first.body.published.slug);
  const updated = await request(`${base}/${first.body.id}/save`, {
    version: first.body.version,
    content: { ...changed, ...updatedMeta.body },
    publish: true,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.published.excerpt, `紹介：${changed.title}`);
  assert.deepEqual(updated.body.address, first.body.address);
  const before = calls;
  assert.equal((await request(`${base}/metadata`, updateInput)).status, 409);
  assert.equal(calls, before, "stale version rejected before more AI work");
  broken = true;
  const failure = await request(`${base}/metadata`, {
    ...input,
    requestId: randomUUID(),
  });
  assert.equal(failure.status, 500);
  assert.equal((await store.records<Post>("post", shop)).length, 2);
});
