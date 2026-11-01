import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { gatherArticleSources } from "../server/article-tools.ts";
import { articleFiles, articleToolContext } from "../server/article-files.ts";
import {
  articleImagePath,
  articleImageUrl,
  wikiPaths,
} from "../server/post-images.ts";
import { Store } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import { createApp } from "../server/app.ts";
import { uploadMenuImage, menuImageSnapshot } from "../server/menu-images.ts";
import { archiveImage } from "../server/image-library.ts";
import { memoryCustomerFiles } from "../server/customer-files.ts";
import { postArtifacts } from "../server/post-renderer.tsx";
import {
  propose,
  proposeArticle,
  identifyVisual,
  explainSystem,
} from "../server/ai.ts";
import type { Post } from "../server/post-domain.ts";
const png = {
  mimeType: "image/png",
  name: "お店の写真.png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
};

test("article tool loop reads required wiki paths, preserves call identities and passes image bytes", async () => {
  assert.deepEqual(
    wikiPaths("[[spec.md]] [[images/photo.png|写真]] [[spec.md]]"),
    ["spec.md", "images/photo.png"],
  );
  const read: string[] = [];
  let round = 0;
  const history = await gatherArticleSources(
    async (contents) => {
      round++;
      if (round === 1) return { functionCalls: [], text: "資料未確認" };
      if (round === 2)
        return {
          functionCalls: [
            {
              id: "text-call",
              name: "read_shop_file",
              args: { path: "spec.md" },
            },
            {
              id: "image-call",
              name: "read_shop_file",
              args: { path: "images/photo.png" },
            },
          ],
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      id: "text-call",
                      name: "read_shop_file",
                      args: { path: "spec.md" },
                    },
                    thoughtSignature: "preserve-this-signature",
                  },
                  {
                    functionCall: {
                      id: "image-call",
                      name: "read_shop_file",
                      args: { path: "images/photo.png" },
                    },
                  },
                ],
              },
            },
          ],
        };
      assert.ok(
        contents.some((item) =>
          item.parts?.some(
            (part) => part.functionResponse?.id === "image-call",
          ),
        ),
      );
      assert.ok(
        contents.some((item) =>
          item.parts?.some((part) => part.inlineData?.data === png.data),
        ),
      );
      return { functionCalls: [], text: "確認済み" };
    },
    [{ role: "user", parts: [{ text: "[[spec.md]] [[images/photo.png]]" }] }],
    {
      files: [],
      requiredPaths: ["spec.md", "images/photo.png"],
      async readFile(path) {
        read.push(path);
        return path === "spec.md"
          ? { path, text: "お店の設定" }
          : { path, image: png };
      },
    },
  );
  assert.deepEqual(read, ["spec.md", "images/photo.png"]);
  assert.ok(
    history.some((item) =>
      item.parts?.some(
        (part) => part.thoughtSignature === "preserve-this-signature",
      ),
    ),
  );
});

test("article file tools exclude private CRM and other shops; article images publish only on save and survive offline export", async (t) => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  await store.saveShop(shop);
  const other = await store.createShop("other@example.com");
  const files = memoryCustomerFiles(store);
  const uploaded = await uploadMenuImage(
    store,
    shop,
    { ...png, requestId: randomUUID() },
    files,
    "",
  );
  const foreign = await uploadMenuImage(
    store,
    other,
    { ...png, requestId: randomUUID() },
    files,
    "",
  );
  await store.put("customerNote", "private-note", {
    shopId: shop.id,
    email: "private@example.com",
    text: "PRIVATE CUSTOMER CONTENT",
    attachments: [],
    status: "active",
  });
  const catalog = await articleFiles(store, shop, shop.published!);
  const path = articleImagePath(uploaded.imageId, png.name);
  assert.ok(catalog.files.some((file) => file.path === path));
  assert.ok(!JSON.stringify(catalog).includes("PRIVATE CUSTOMER CONTENT"));
  assert.ok(!JSON.stringify(catalog).includes(foreign.imageId));
  const context = await articleToolContext(
    store,
    shop,
    shop.published!,
    [path, "spec.md"],
    files,
    "",
  );
  assert.equal((await context.readFile(path)).image!.data, png.data);
  for (const bad of [
    "../../etc/passwd",
    "https://example.com/a",
    "customers/private.md",
    articleImagePath(foreign.imageId, png.name),
  ])
    await assert.rejects(context.readFile(bad), /見つかりません/);
  for (const [id, email] of [
    ["owner", shop.owner],
    ["staff", "staff@example.com"],
    ["customer", "guest@example.com"],
  ])
    await store.put("session", digest(id), {
      user: { email, name: id, role: id === "owner" ? "owner" : "customer" },
      expires: Date.now() + 600000,
    });
  await store.put("member", `${shop.id}:staff@example.com`, {
    shopId: shop.id,
    email: "staff@example.com",
    accepted: true,
  });
  let toolReads = 0;
  const server = createApp(store, {
    propose,
    proposeArticle: async (instruction, source, title, demo, tools) => {
      assert.ok(tools);
      assert.ok(instruction.includes(path));
      const image = await tools!.readFile(path);
      toolReads++;
      assert.equal(image.image?.data, png.data);
      return {
        title: "写真付きのお便り",
        excerpt: "",
        body: `## 新しいお便り\n\n![お店](${articleImageUrl(uploaded.imageId)})`,
      };
    },
    identifyVisual,
    explainSystem,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    server.close();
    await store.close();
  });
  async function api(path: string, data?: unknown, user = "owner") {
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
  const base = `/api/shops/${shop.id}/posts`;
  for (const user of ["staff", "customer", "anonymous"])
    assert.equal((await api(`${base}/files`, undefined, user)).status, 403);
  const request = {
    instruction: `[[${path}]]を使って記事を書いて`,
    requestId: randomUUID(),
  };
  const draft = await api(`${base}/propose`, request);
  assert.equal(draft.status, 200);
  assert.equal(toolReads, 1);
  assert.equal((await api(`${base}/propose`, request)).status, 200);
  assert.equal(toolReads, 1, "retry reuses saved conversation result");
  assert.equal(
    (await api(`${base}/propose`, { ...request, source: "別の編集内容" }))
      .status,
    409,
  );
  assert.equal(
    (
      await api(`${base}/propose`, {
        instruction: "[[../../etc/passwd]]を読んで",
        requestId: randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(toolReads, 1, "invalid paths are rejected before more AI work");
  const transcript = await store.records<{
    email: string;
    conversationId: string;
    detail: { article?: unknown };
  }>("shopChatMessage", shop);
  assert.equal(
    transcript.filter(
      (message) => message.conversationId === draft.body.conversationId,
    ).length,
    2,
  );
  assert.equal(
    transcript.length,
    3,
    "the failed file reference also leaves the owner's request for context",
  );
  assert.ok(transcript.some((message) => !!message.detail.article));
  assert.equal(
    (
      await api(
        `/api/public/${shop.slug}/images/${uploaded.imageId}`,
        undefined,
        "anonymous",
      )
    ).status,
    404,
  );
  const content = {
    category: "blogs",
    date: "2026-11-01",
    slug: "with-photo",
    ...draft.body,
  };
  const post = await api(base, { content, publish: true });
  assert.equal(post.status, 200);
  assert.equal(
    (
      await api(
        `/api/public/${shop.slug}/images/${uploaded.imageId}`,
        undefined,
        "anonymous",
      )
    ).status,
    200,
  );
  await assert.rejects(
    archiveImage(store, shop, uploaded.imageId, shop.published!),
    /使用中/,
  );
  const posts = await store.records<Post>("post", shop);
  const images = await menuImageSnapshot(
    store,
    shop,
    shop.published!,
    files,
    "",
    [uploaded.imageId],
  );
  const artifacts = postArtifacts(
    shop.published!,
    posts,
    '<title></title><div id="root"></div>',
    images,
  );
  assert.ok(
    artifacts["web/blogs/2026-11-01-with-photo.html"].includes(
      `data:image/png;base64,${png.data}`,
    ),
  );
  const forbidden = {
    ...content,
    slug: "foreign",
    body: `![private](${articleImageUrl(foreign.imageId)})`,
  };
  assert.equal(
    (await api(base, { content: forbidden, publish: true })).status,
    404,
  );
  assert.equal(
    (
      await api(`${base}/${post.body.id}/unpublish`, {
        version: post.body.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        `/api/public/${shop.slug}/images/${uploaded.imageId}`,
        undefined,
        "anonymous",
      )
    ).status,
    404,
  );
});
