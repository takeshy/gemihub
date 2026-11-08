import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST, type Booking, type ShopConfig } from "../server/domain.ts";
import { fixturesSchema, createPreviewClient, sampleFixtures, draftKey, writeDraft, readDraft, syncPreviewArticleFeatures, type LocalDraft } from "../src/local-preview.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScreenTree } from "../src/ScreenTree.tsx";
import { editorIndex } from "../server/editor-sync.ts";
import { syncStatus } from "../src/editor-sync.ts";
import { postKey, type PublicPost } from "../server/post-domain.ts";

process.env.DEMO_MODE = "true";
test("preview trees and sample APIs show only enabled article features, including cached fixtures", async () => {
  const original = structuredClone(sample), fixtures = sampleFixtures(original);
  for (const blogs of [false, true]) for (const announcements of [false, true]) {
    const config: ShopConfig = { ...original, appearance: { accent: "sage", layout: "standard", imageUrl: "", articles: { blogs, announcements } } };
    const draft: LocalDraft = { config, source: config, base: 0, fixtures };
    const html = renderToStaticMarkup(createElement(ScreenTree, { draft, statuses: {}, selected: "reserve", disabled: false, onChoose() {} }));
    for (const category of ["blogs", "announcements"] as const) {
      const title = category === "blogs" ? "ブログ一覧" : "お知らせ一覧";
      assert.equal(html.includes(title), config.appearance!.articles![category]);
      const articleTitle = category === "blogs" ? "ブログ記事" : "お知らせ記事";
      assert.equal(html.includes(articleTitle), config.appearance!.articles![category]);
    }
    const client = createPreviewClient(config, fixtures, "shop");
    const recent = await client<{ recentPosts: PublicPost[] }>("/api/public/local-preview");
    assert.equal(recent.recentPosts.length, Number(blogs) + Number(announcements));
    assert.deepEqual(sampleFixtures(config).posts.map(post => post.category), fixtures.posts.filter(post => config.appearance!.articles![post.category]).map(post => post.category));
    for (const post of fixtures.posts) {
      const list = await client<{ items: PublicPost[] }>(`/api/public/local-preview/posts?category=${post.category}`);
      assert.equal(list.items.length, Number(config.appearance!.articles![post.category]));
      if (!config.appearance!.articles![post.category]) await assert.rejects(client(`/api/public/local-preview/posts/${post.category}/${postKey(post)}`));
    }
  }
});

test("updated live article choices replace cached flags without losing design edits or inventing conflicts", async () => {
  const old: ShopConfig = { ...structuredClone(sample), appearance: { accent: "rose", layout: "compact", imageUrl: "", articles: { blogs: true, announcements: true } } };
  const draft: LocalDraft = { config: { ...old, description: "Keep my local edit" }, source: structuredClone(old), base: 0, fixtures: sampleFixtures(old), index: editorIndex(old, 0) };
  const current: ShopConfig = { ...old, appearance: { ...old.appearance!, articles: { blogs: false, announcements: true } } };
  const updated = syncPreviewArticleFeatures(draft, current);
  assert.deepEqual(updated.config.appearance?.articles, current.appearance?.articles);
  assert.deepEqual(updated.source?.appearance?.articles, current.appearance?.articles);
  assert.equal(updated.config.description, draft.config.description);
  assert.equal(updated.config.appearance?.accent, "rose");
  assert.equal(updated.config.appearance?.layout, "compact");
  assert.equal(updated.index, undefined, "the old feature hashes cannot be reused to invent a conflict");
  assert.equal(await syncStatus(updated, editorIndex(current, 1), { kind: "shared" }), "local");
  assert.equal(syncPreviewArticleFeatures(updated, current), updated);
  assert.equal(draft.config.appearance!.articles!.blogs, true, "the original cached draft is not mutated");
});

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
  assert.equal((await client<unknown[]>("/api/public/local-preview/bookings")).length, fixtures.bookings.length + 1);
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
    async visualReview() { return { approved: true, issues: [] }; },
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

test("sample payment states persist and show paid plus refunded records in yen and cents without live payments", async () => {
  for (const [country, timeZone, currency, price, refund] of [["JP", "Asia/Tokyo", "JPY", 5501, 2750], ["US", "America/New_York", "USD", 55.01, 2750]] as const) {
    const config: ShopConfig = { ...structuredClone(sample), region: { country, timeZone } };
    config.rules.payment = { enabled: false, refundTiers: [{ hoursBefore: 0, percent: 100 }] };
    config.menus[0].price = price;
    const fixtures = sampleFixtures(config);
    const cancelled = fixtures.bookings.find(booking => booking.paymentStatus === "refunded")!;
    assert.ok(cancelled, "priced menus include a paid and refunded example");
    cancelled.refundPercent = 50;
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
    writeDraft(storage, "payment-fixture", { config, source: null, base: 0, fixtures });
    const saved = readDraft(storage, "payment-fixture")!;
    assert.equal(saved.fixtures.bookings.find(booking => booking.id === cancelled.id)?.refundPercent, 50);
    const client = createPreviewClient(config, saved.fixtures, "sample-shop");
    const booking = (await client<Booking[]>("/api/public/local-preview/bookings")).find(booking => booking.id === cancelled.id)!;
    assert.equal(booking.status, "cancelled");
    assert.equal(booking.payment?.provider, "paypal");
    assert.equal(booking.payment?.environment, "sandbox");
    assert.equal(booking.payment?.currency, currency);
    assert.equal(booking.payment?.amount, 5501);
    assert.equal(booking.payment?.cancellation?.status, "completed");
    assert.equal(booking.payment?.cancellation?.amount, refund, "refunds round down in minor units");
    assert.equal(booking.payment?.cancellation?.percent, 50);
    assert.equal(cancelled.status, "cancelled");
    assert.equal("payment" in cancelled, false, "simulated payment details do not mutate stored fixtures");
  }
});

test("explicit sample payments override current settings while legacy samples retain automatic payment behavior", async () => {
  const config = structuredClone(sample);
  config.rules.payment = { enabled: true, refundTiers: [{ hoursBefore: 0, percent: 100 }] };
  const template = sampleFixtures(config).bookings[0];
  const fixtures = fixturesSchema.parse({ customerName: "Sample", posts: [], bookings: [
    { ...template, id: "legacy" },
    { ...template, id: "unpaid", paymentStatus: "unpaid" },
    { ...template, id: "paid", paymentStatus: "paid" },
    { ...template, id: "refunded", status: "cancelled", paymentStatus: "refunded", refundPercent: 70 },
  ] });
  for (const enabled of [true, false]) {
    config.rules.payment.enabled = enabled;
    const client = createPreviewClient(config, fixtures, "shop");
    const [legacy, unpaid, paid, refunded] = await client<Booking[]>("/api/public/local-preview/bookings");
    assert.equal(!!legacy.payment, enabled);
    assert.equal(unpaid.payment, undefined);
    assert.ok(paid.payment);
    assert.equal(paid.payment.cancellation, undefined);
    assert.equal(refunded.payment?.cancellation?.status, "completed");
    assert.equal(refunded.payment?.cancellation?.percent, 70);
  }
  assert.equal(fixturesSchema.safeParse({ ...fixtures, bookings: [{ ...template, paymentStatus: "refunded" }] }).success, false);
  for (const refundPercent of [0, 101, 50.5]) assert.equal(fixturesSchema.safeParse({ ...fixtures, bookings: [{ ...template, status: "cancelled", paymentStatus: "refunded", refundPercent }] }).success, false);
});


test("paid sample defaults skip hidden and free services", () => {
  const config = structuredClone(sample);
  config.menus.forEach(menu => { menu.price = 0; });
  assert.equal(sampleFixtures(config).bookings.some(booking => booking.paymentStatus === "refunded"), false);
  config.menus.forEach(menu => { menu.price = 5000; menu.active = false; });
  assert.deepEqual(sampleFixtures(config).bookings, []);
});
