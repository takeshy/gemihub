import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { sample, type ShopConfig } from "../server/domain.ts";
import { proposeVisualAppearance } from "../server/visual.ts";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import * as intelligence from "../server/ai.ts";

process.env.DEMO_MODE = "true";
const instruction = "店主を反映して。\n紹介メッセージ\n当店では、ただカラーを塗るだけでなく、「丁寧なケア」と「持ちの良さ」にこだわっています。\n「指先を見るたびに気分が上がる」「明日からまた頑張ろうと思える」そんな特別な時間を過ごしていただけるよう、一人ひとりのお悩みに寄り添った施術を心がけています。\n• 保有資格：JNECネイリスト技能検定1級、JNAジェルネイル技能検定上級、ネイルサロン衛生管理士\n• 得意なデザイン：ニュアンスネイル、大人可愛い上品デザイン、シンプルオフィスネイル";
const body = '<section class="profile"><h2>店主の紹介</h2><p>当店では、ただカラーを塗るだけでなく、「丁寧なケア」と「持ちの良さ」にこだわっています。</p><p>「指先を見るたびに気分が上がる」「明日からまた頑張ろうと思える」そんな特別な時間を過ごしていただけるよう、一人ひとりのお悩みに寄り添った施術を心がけています。</p><ul><li>保有資格：JNECネイリスト技能検定1級、JNAジェルネイル技能検定上級、ネイルサロン衛生管理士</li><li>得意なデザイン：ニュアンスネイル、大人可愛い上品デザイン、シンプルオフィスネイル</li></ul></section>';
const config = (): ShopConfig => ({ ...structuredClone(sample), pages: [
  { id: "staff-introduction", slug: "staff", title: "スタッフ紹介", navigationLabel: "スタッフ紹介", body: '<section class="profile"><h2>スタッフ紹介</h2><p>準備中</p></section>', css: ".profile{line-height:1.8}", layout: "standard", imageUrl: "" },
  { id: "access", slug: "access", title: "アクセス", navigationLabel: "アクセス", body: "<p>既存の案内</p>", layout: "standard", imageUrl: "" },
] });

test("owner introduction edits generate only page copy while preserving business data and other drafts", async () => {
  const before = config(), original = structuredClone(before);
  const messages = [{ role: "user" as const, text: "今の配置はそのままにして" }];
  const media = { mimeType: "image/png" as const, data: "aGVsbG8=" };
  const next = await proposeVisualAppearance(before, instruction, [], { target: "page:staff-introduction:body", media, messages, splitStyles: true, generate: async request => {
    const context = JSON.parse(request.contents[0].parts![0].text!);
    assert.equal(context.instruction, instruction);
    assert.deepEqual(context.previousMessages, messages);
    assert.deepEqual(context.selectedPage, before.pages[0]);
    assert.deepEqual(context.allowedFields, ["body", "css"]);
    assert.equal(context.current, undefined);
    assert.equal(context.shop.rules, undefined);
    assert.equal(context.shop.menus, undefined);
    assert.deepEqual(request.contents[0].parts!.at(-1), { inlineData: media });
    assert.deepEqual(Object.keys(request.schema.properties as object), ["body", "css"]);
    assert.equal(request.schema.additionalProperties, false);
    assert.equal(request.timeoutMs, 45000);
    return JSON.stringify({ body });
  } });
  assert.equal(next.config.pages[0].body, body);
  assert.deepEqual(next.config, { ...before, pages: [{ ...before.pages[0], body }, before.pages[1]] });
  assert.deepEqual(before, original);
});

test("page title and design patches cannot change body, URL, other pages or business settings", async () => {
  const before = config();
  for (const [field, patch] of [
    ["title", { title: "店主の紹介", navigationLabel: "店主" }],
    ["design", { layout: "compact", css: ".profile{padding:24px}" }],
  ] as const) {
    const next = await proposeVisualAppearance(before, "選んだ部分を直して", [], { target: `page:staff-introduction:${field}`, generate: async () => JSON.stringify(patch) });
    assert.deepEqual(next.config, { ...before, pages: [{ ...before.pages[0], ...patch }, before.pages[1]] });
  }
  for (const patch of [{ body, staff: [] }, { body, title: "Unexpected title" }, { body, slug: "new-url" }, { body, rules: {} }, { body: '<script>alert(1)</script>' }, { css: '.profile{background:url(https://example.com/track)}' }]) {
    await assert.rejects(proposeVisualAppearance(before, instruction, [], { target: "page:staff-introduction:body", generate: async () => JSON.stringify(patch) }));
  }
});

test("page body API uses scoped patches, reviews repairs and returns a draft without publishing", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = config(); await store.saveShop(shop);
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  let generations = 0, reviews = 0;
  const server = createApp(store, { ...intelligence,
    async identifyVisual() { return { ids: ["page:staff-introduction:body"], explanation: "紹介文を反映します。" }; },
    async propose() { assert.fail("page edits must not regenerate the whole shop"); },
    async visualAppearance(current, text, images, options) {
      return proposeVisualAppearance(current, text, images, { ...options, generate: async request => {
        const context = JSON.parse(request.contents[0].parts![0].text!);
        if (generations++) {
          assert.equal(context.selectedPage.body, "<p>紹介文の案</p>");
          assert.match(context.instruction, /資格も表示/);
        }
        return JSON.stringify({ body: generations === 1 ? "<p>紹介文の案</p>" : body });
      } });
    },
    async visualReview(input) {
      reviews++;
      assert.equal(input.screen, "page:staff-introduction");
      assert.deepEqual(input.after.staff, shop.published!.staff);
      return { approved: reviews > 1, issues: reviews === 1 ? ["資格も表示してください"] : [] };
    },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));await store.close(); });
  const api = async (action: string, data: unknown) => {
    const response = await fetch(`${origin}/api/shops/${shop.id}/${action}`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();assert.equal(response.status, 200, result.error);return result;
  };
  const media = { mimeType: "image/png", data: "aGVsbG8=" };
  const displayed = config();displayed.pages[1].body = "<p>別ページの未反映の編集</p>";
  const identified = await api("visual/identify", { media, instruction, displayed, local: { base: shop.revision, source: shop.published, pageId: "staff-introduction" } });
  const result = await api("visual/propose", { id: identified.id, requestId: randomUUID(), target: "page:staff-introduction:body", instruction, media });
  assert.deepEqual(result.visualReview, { approved: true, attempts: 2 });
  assert.equal(result.config.pages[0].body, body);
  assert.equal(result.config.pages[1].body, displayed.pages[1].body);
  assert.deepEqual((await store.shop(shop.id))!.published, shop.published);
  assert.equal((await store.list("plan")).length, 0);
});
