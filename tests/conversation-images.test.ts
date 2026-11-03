import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";
import { contentHash } from "../server/editor-sync.ts";
import { memoryCustomerFiles } from "../server/customer-files.ts";
import { uploadMenuImage } from "../server/menu-images.ts";
import type { RequestImage } from "../server/request-images.ts";

process.env.DEMO_MODE = "true";
const image = { mimeType: "image/png" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };

test("images attached earlier in a chat reach later AI replies and the change plan; removed ones are skipped", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  await store.put("session", createHash("sha256").update("owner").digest("hex"), { user: { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id }, expires: Date.now() + 3600000 });
  const files = memoryCustomerFiles(store);
  const sampleImage = await uploadMenuImage(store, shop, { ...image, name: "見本ページ.png", requestId: randomUUID() }, files, "");
  const removed = await uploadMenuImage(store, shop, { ...image, name: "削除予定.png", requestId: randomUUID() }, files, "");
  const seen: { question?: string[][]; plan?: string[] } = { question: [] };
  const server = createApp(store, {
    propose: async (_text, current, _email, _demo, images: RequestImage[] = []) => { seen.plan = images.map(item => item.id); return { config: { ...current!, description: "見本の雰囲気に合わせた紹介文" }, summary: ["お店の紹介を更新"] }; },
    proposeArticle: async () => { throw new Error("unused"); },
    identifyVisual: async () => { throw new Error("unused"); },
    explainSystem: async (_question, _config, _demo, context) => { seen.question!.push((context?.images || []).map(item => item.id)); return { answer: "見本の雰囲気に合わせますね。", changeRequest: true, ready: true }; },
  }, undefined, files);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => { server.close(); await store.close(); });
  const post = async (path: string, data: unknown) => {
    const response = await fetch(`${base}/api/shops/${shop.id}/${path}`, { method: "POST", headers: { Origin: base, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const chat = (await post("conversations", { intent: "modify", requestId: randomUUID(), begin: true })).body as { id: string };
  const context = { revision: shop.revision, hash: contentHash(shop.published) };
  const first = randomUUID();
  assert.equal((await post("system/question", { question: "こういうページにしたい", intent: "modify", imageIds: [sampleImage.imageId, removed.imageId], ...context, chat: { id: chat.id, requestId: first } })).status, 200);
  // The removed image must not break the rest of the conversation.
  await store.put("menuImageUpload", removed.imageId, { ...(await store.get<Record<string, unknown>>("menuImageUpload", removed.imageId)), archived: true });
  const second = randomUUID();
  assert.equal((await post("system/question", { question: "あとはお任せします", intent: "modify", imageIds: [], ...context, chat: { id: chat.id, requestId: second } })).status, 200);
  assert.deepEqual(seen.question, [[sampleImage.imageId, removed.imageId], [sampleImage.imageId]], "a later reply still sees the sample image");
  const plan = await post("plan", { text: "あとはお任せします", intent: "modify", imageIds: [], context, chat: { id: chat.id, requestId: second } });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.deepEqual(seen.plan, [sampleImage.imageId], "the plan sees the sample attached earlier, not only the last message's images");
});
