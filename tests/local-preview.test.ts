import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST, type ShopConfig } from "../server/domain.ts";
import { createPreviewClient, sampleFixtures, draftKey, writeDraft, readDraft } from "../src/local-preview.ts";

process.env.DEMO_MODE = "true";
test("local fixtures use an isolated API, allow practice operations and persist by account/shop", async () => {
  const config = structuredClone(sample);
  config.hours.closedWeekdays = [];
  const fixtures = sampleFixtures(config);
  const client = createPreviewClient(config, fixtures, "real-shop");
  const start = fixtures.bookings[0].start;
  const date = dateJST(new Date(start));
  const available = await client<{ start: string; staffId: string }[]>(`/api/public/local-preview/slots?date=${date}&menu=simple`);
  assert.equal(available.find(s => s.start === start)?.staffId, "haru");
  await client("/api/public/local-preview/bookings", { start, menuId: "simple", name: "練習" });
  assert.equal((await client<unknown[]>("/api/public/local-preview/bookings")).length, 2);
  await client("/api/public/local-preview/bookings/sample-booking/cancel", {});
  assert.equal((await client<{status: string}[]>("/api/public/local-preview/bookings"))[0].status, "cancelled");
  await client("/api/public/local-preview/inquiries", { name: "練習", message: "テスト" });
  assert.equal(fixtures.bookings[0].status, "active"); // source fixtures never mutated
  await assert.rejects(client("/api/shops/real-shop/invite", {}));
  await assert.rejects(client("/api/public/real-shop/bookings", {}));
  const posts = await client<{ items: { title: string }[] }>("/api/public/local-preview/posts?category=blogs");
  assert.equal(posts.items.length, 1);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const key = draftKey("owner@example.com", "real-shop");
  writeDraft(storage, key, { config, source: null, base: 0, fixtures });
  assert.deepEqual(readDraft(storage, key)?.config, config);
  assert.equal(readDraft(storage, draftKey("other@example.com", "real-shop")), undefined);
  assert.equal(readDraft(storage, draftKey("owner@example.com", "other-shop")), undefined);
  assert.throws(() => writeDraft({ setItem() { throw new Error("quota"); } }, key, { config, source: null, base: 0, fixtures }));
});

test("local pen changes stay drafts; stale releases fail and retries publish once without mock data", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  let badProposal = false;
  const intelligence = {
    async propose(_text: string, current: ShopConfig | null) {
      const config = structuredClone(current || sample);
      config.name = "ペンで変更した店名";
      if (badProposal) config.menus[0].price++;
      return { config, summary: ["店名を変更"] };
    },
    async proposeArticle() { return { title: "title", excerpt: "", body: "body" }; },
    async identifyVisual() { return { ids: ["name"], explanation: "店名を選択しました" }; },
    async explainSystem() { return { answer: "説明", changeRequest: false }; },
  };
  const server = createApp(store, intelligence);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  for (const [id, email] of [["owner", shop.owner], ["customer", "guest@example.com"]])
    await store.put("session", digest(id), { user: { email, name: id, role: id, shopId: shop.id }, expires: Date.now() + 600000 });
  async function request(action: string, data?: unknown, user = "owner") {
    const res = await fetch(`${origin}/api/shops/${shop.id}/${action}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${user}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  }
  assert.equal((await request("local-editor", undefined, "customer")).status, 403);
  const initial = await request("local-editor");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.source, null);
  const edited = structuredClone(initial.body.config);
  edited.description = "ブラウザだけで編集した紹介文";
  const media = { mimeType: "image/png", data: "aGVsbG8=" };
  const identification = await request("visual/identify", { media, instruction: "店名を変更", displayed: edited, local: { base: 0, source: null } });
  assert.equal(identification.status, 200);
  assert.equal((await store.list("plan")).length, 0);
  assert.equal((await store.shop(shop.id))!.published, null);
  const proposed = await request("visual/propose", { id: identification.body.id, target: "name", instruction: "店名を変更" });
  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.config.name, "ペンで変更した店名");
  assert.equal(proposed.body.config.description, edited.description);
  assert.equal((await store.list("plan")).length, 0);
  assert.equal((await request("visual/propose", { id: identification.body.id, target: "name", instruction: "変更" }, "customer")).status, 403);
  badProposal = true;
  assert.equal((await request("visual/propose", { id: identification.body.id, target: "name", instruction: "料金も変えて" })).status, 400);
  const config = proposed.body.config;
  const local = { base: 0, source: null, requestId: "11111111-1111-4111-8111-111111111111" };
  assert.equal((await request("plan", { text: "反映", config, local: { ...local, base: -1 } })).status, 409);
  assert.equal((await request("plan", { text: "反映", config, local: { ...local, source: config } })).status, 409);
  const created = await request("plan", { text: "反映", config, local });
  assert.equal(created.status, 200);
  assert.equal((await request("plan", { text: "反映", config, local })).body.id, created.body.id);
  const id = created.body.id;
  assert.equal((await request(`plans/${id}/publish`, {})).status, 409);
  await request(`plans/${id}/approve`, {});
  assert.equal((await request(`plans/${id}/publish`, {})).status, 200);
  // Lost successful responses are retried with the saved identity.
  assert.equal((await request(`plans/${id}/approve`, {})).status, 200);
  assert.equal((await request(`plans/${id}/publish`, {})).status, 200);
  const updated = (await store.shop(shop.id))!;
  assert.equal(updated.revision, 1);
  assert.equal(updated.history.length, 1);
  assert.equal(updated.published!.name, config.name);
  assert.equal((await store.bookings(shop.id)).length, 0);
  assert.equal((await store.records("post", updated)).length, 0);
  assert.equal((await request("visual/propose", { id: identification.body.id, target: "name", instruction: "変更" })).status, 409);
  assert.equal((await request("plan", { text: "反映", config, local: { ...local, requestId: "22222222-2222-4222-8222-222222222222" } })).status, 409);
  const snapshot = (await request("local-editor")).body;
  assert.equal(snapshot.lastPublishedPlanId, id);
  updated.published!.description = "シートからの変更";
  await store.saveShop(updated);
  assert.equal((await request("plan", { text: "反映", config, local: { base: snapshot.base, source: snapshot.source, requestId: "33333333-3333-4333-8333-333333333333" } })).status, 409);
});
