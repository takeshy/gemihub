import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { encrypt } from "../server/google.ts";
import { sample, planSummary } from "../server/domain.ts";
import * as intelligence from "../server/ai.ts";
import { createConversation, appendChatMessage, attachChatPlan } from "../server/shop-chat.ts";
import { finalDetailsQuestion } from "../server/request-intent.ts";

process.env.DEMO_MODE = "true";

test("Drive created by image uploads does not affect first publication; stale Firestore proposals are rejected", async t => {
  mock.method(google, "sheets", (() => { throw new Error("Sheets must not be called"); }) as never);
  mock.method(google, "drive", (() => ({ files: { create: async () => ({ data: { id: randomUUID() } }), update: async () => ({ data: {} }) } })) as never);
  t.after(() => mock.restoreAll());
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  // Uploading a reference/photo provisions Drive before publication.
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  const user = { email: shop.owner, role: "owner" as const, name: "Owner", shopId: shop.id };
  await store.put("user", user.email, { ...user, refreshToken: encrypt("token") });
  await store.put("session", digest("owner"), { user, expires: Date.now() + 3600000 });
  const config = structuredClone(sample);
  const server = createApp(store, { ...intelligence, async propose() { return { config, summary: planSummary(null, config) }; } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const request = async (path: string, data: unknown) => {
    const response = await fetch(`${origin}/api/shops/${shop.id}${path}`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const outline = await request("/plan", { text: "初回の画面イメージ" });
  assert.equal(outline.status, 200); assert.equal(outline.body.requiresSetup, true); assert.equal(outline.body.source, null);
  const chat = await createConversation(store, shop, shop.owner, "create-shop", randomUUID(), false);
  const selection = randomUUID(), final = randomUUID();
  await appendChatMessage(store, shop, chat, { role: "assistant", text: "必要な機能を伺います。\n1. お店の紹介\n2. 予約\n3. ブログ\n4. お知らせ\n5. お問い合わせ\n6. スタッフ紹介\n7. メニュー・サービス紹介", requestId: randomUUID() });
  await appendChatMessage(store, shop, chat, { role: "user", text: "1、2、4、5、7", requestId: selection });
  await appendChatMessage(store, shop, chat, { role: "assistant", text: finalDetailsQuestion, requestId: selection });
  await appendChatMessage(store, shop, chat, { role: "user", text: "ありません", requestId: final });
  await appendChatMessage(store, shop, chat, { role: "assistant", text: "画面イメージを作成します", requestId: final, detail: { ready: true, changeRequest: true } });
  // A plan saved before the selection-parser fix had no article flags.
  await store.put("plan", outline.body.id, { ...outline.body, chat: { id: chat.id, requestId: final } });
  await attachChatPlan(store, shop, shop.owner, { id: chat.id, requestId: final }, outline.body.id);
  const workspace = await fetch(`${origin}/api/workspace`, { headers: { Cookie: "gemihub_session=owner" } }).then(response => response.json());
  assert.deepEqual(workspace.shops[0].plans[0].config.appearance.articles, { blogs: false, announcements: true }, "existing initial previews recover the original selection");
  const cached = await request("/plan", { text: "ありません", intent: "create-shop", chat: { id: chat.id, requestId: final } });
  assert.equal(cached.status, 200);assert.equal(cached.body.id, outline.body.id);assert.deepEqual(cached.body.config.appearance.articles, { blogs: false, announcements: true });
  await request(`/plans/${outline.body.id}/approve`, {});
  const published = await request(`/plans/${outline.body.id}/publish`, { publication: "provisional" });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal((await store.shop(shop.id))!.publication, "provisional");
  assert.deepEqual((await store.shop(shop.id))!.published!.appearance!.articles, { blogs: false, announcements: true });
  assert.equal((await request(`/plans/${outline.body.id}/publish`, { publication: "provisional" })).status, 200);
  assert.equal((await store.shop(shop.id))!.revision, 1);
  const next = await request("/plan", { text: "紹介文の更新", config: { ...config, description: "Proposed description" } });
  assert.equal(next.status, 200);
  const latest = (await store.shop(shop.id))!; latest.published!.description = "Changed in Firestore"; await store.saveShop(latest);
  await request(`/plans/${next.body.id}/approve`, {});
  assert.equal((await request(`/plans/${next.body.id}/publish`, {})).status, 409);
  assert.equal((await store.shop(shop.id))!.revision, 1, "external-edit protection still applies to published shops");
  assert.equal((await store.shop(shop.id))!.published!.description, "Changed in Firestore");
});
