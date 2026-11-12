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
import { screenIds, screenStarter } from "../shared/screens.ts";
import { pageImageTargets, applyPageImageEdits, samePageImageStructure } from "../server/page-images.ts";
import { validateVisualChange } from "../server/visual.ts";
import { validateProposedImages } from "../server/request-images.ts";
import { uploadMenuImage } from "../server/menu-images.ts";
import { memoryCustomerFiles } from "../server/customer-files.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Presentation } from "../src/Presentation.tsx";
import postcss from "postcss";
import { applyPageCssEdits } from "../server/css-edits.ts";

process.env.DEMO_MODE = "true";
const instruction = "店主を反映して。\n紹介メッセージ\n当店では、ただカラーを塗るだけでなく、「丁寧なケア」と「持ちの良さ」にこだわっています。\n「指先を見るたびに気分が上がる」「明日からまた頑張ろうと思える」そんな特別な時間を過ごしていただけるよう、一人ひとりのお悩みに寄り添った施術を心がけています。\n• 保有資格：JNECネイリスト技能検定1級、JNAジェルネイル技能検定上級、ネイルサロン衛生管理士\n• 得意なデザイン：ニュアンスネイル、大人可愛い上品デザイン、シンプルオフィスネイル";
const body = '<section class="profile"><h2>店主の紹介</h2><p>当店では、ただカラーを塗るだけでなく、「丁寧なケア」と「持ちの良さ」にこだわっています。</p><p>「指先を見るたびに気分が上がる」「明日からまた頑張ろうと思える」そんな特別な時間を過ごしていただけるよう、一人ひとりのお悩みに寄り添った施術を心がけています。</p><ul><li>保有資格：JNECネイリスト技能検定1級、JNAジェルネイル技能検定上級、ネイルサロン衛生管理士</li><li>得意なデザイン：ニュアンスネイル、大人可愛い上品デザイン、シンプルオフィスネイル</li></ul></section>';
const config = (): ShopConfig => ({ ...structuredClone(sample), pages: [
  { id: "staff-introduction", slug: "staff", title: "スタッフ紹介", navigationLabel: "スタッフ紹介", body: '<section class="profile"><h2>スタッフ紹介</h2><p>準備中</p></section>', css: ".profile{line-height:1.8}", layout: "standard", imageUrl: "" },
  { id: "access", slug: "access", title: "アクセス", navigationLabel: "アクセス", body: "<p>既存の案内</p>", layout: "standard", imageUrl: "" },
] });

test("responsive page patches change only selected declarations at the requested breakpoint", async () => {
  const before = config();
  before.pages[0].css = '.card{display:grid;grid-template-columns:260px 1fr;padding:32px}.unrelated{color:green}@media(max-width:760px){.card{grid-template-columns:1fr;padding:22px}.unrelated{font-size:14px}}';
  const patch = { cssEdits: [{ selector: ".card", media: "(max-width:760px)", declarations: [{ property: "min-width", value: "0" }, { property: "padding", value: "12px" }] }] };
  const result = await proposeVisualAppearance(before, "見切れてる。スマホだと。", [], { target: "page:staff-introduction:design", generate: async request => {
    assert.match(request.system, /return only small cssEdits/);
    assert.equal(request.timeoutMs, 120000);
    assert.doesNotMatch(JSON.stringify(request.schema), /"(?:minItems|maxItems)":/);
    return JSON.stringify(patch);
  } });
  const css = result.config.pages[0].css!;
  const root = postcss.parse(css), base = root.nodes.find(node => node.type === "rule" && node.selector === ".card")!;
  assert.equal(base.toString(), '.card{display:grid;grid-template-columns:260px 1fr;padding:32px}');
  assert.match(css, /\.unrelated\{color:green\}/);assert.match(css, /\.unrelated\{font-size:14px\}/);
  assert.match(css, /padding:12px/);assert.match(css, /min-width:0/);
  assert.deepEqual({ ...result.config, pages: before.pages }, before);
  assert.equal(result.config.pages[0].body, before.pages[0].body);
  for (const invalid of [
    [{ selector: ".card", media: "(max-width:760px){}", declarations: [{ property: "width", value: "100%" }] }],
    [{ selector: ".card{}", declarations: [{ property: "width", value: "100%" }] }],
  ]) assert.throws(() => applyPageCssEdits(before.pages[0].css!, invalid));
  await assert.rejects(proposeVisualAppearance(before, "スマホを直して", [], { target: "page:staff-introduction:design", generate: async () => JSON.stringify({ cssEdits: [{ selector: ".card", declarations: [{ property: "background", value: "url(https://example.com/track)" }] }] }) }));
});

test("all built-in screen designs preserve other screens, custom pages and booking data", async () => {
  const before = { ...config(), screens: Object.fromEntries(screenIds.map(id => [id, screenStarter(id)])) };
  for (const id of screenIds) {
    const design = { ...screenStarter(id), css: `${screenStarter(id).css}\nsection{padding:24px}` };
    const next = await proposeVisualAppearance(before, "この画面の余白だけ広げて", [], { target: `screen:${id}`, generate: async () => JSON.stringify({ screens: { [id]: design } }) });
    assert.deepEqual(next.config, { ...before, screens: { ...before.screens, [id]: design } });
    const unrelated = id === "about" ? "contact" : "about";
    await assert.rejects(proposeVisualAppearance(before, "この画面だけ", [], { target: `screen:${id}`, generate: async () => JSON.stringify({ screens: { [id]: design, [unrelated]: { ...screenStarter(unrelated), css: "p{color:red}" } } }) }));
  }
});

test("shop, menu and staff text targets never regenerate other text or business fields", async () => {
  const before = config();
  const targets = ["name", "description", "address", `menu:${before.menus[0].id}`, `staff:${before.staff[0].id}`];
  for (const target of targets) {
    const value = "新しい表示の文章";
    const expected = structuredClone(before);
    if (target.startsWith("menu:")) expected.menus[0].name = value;
    else if (target.startsWith("staff:")) expected.staff[0].name = value;
    else expected[target as "name" | "description" | "address"] = value;
    const result = await proposeVisualAppearance(before, "選んだ文章を直して", [], { target, generate: async request => {
      const context = JSON.parse(request.contents[0].parts![0].text!);
      assert.equal(context.current, undefined);
      assert.equal(context.shop.rules, undefined);
      assert.deepEqual(Object.keys(request.schema.properties as object), ["value"]);
      return JSON.stringify({ value });
    } });
    assert.deepEqual(result.config, expected);
    await assert.rejects(proposeVisualAppearance(before, "選んだ文章だけ", [], { target, generate: async () => JSON.stringify({ value, menus: [] }) }));
  }
});

test("owner introduction edits generate only page copy while preserving business data and other drafts", async () => {
  const before = config(), original = structuredClone(before);
  const messages = [{ role: "user" as const, text: "今の配置はそのままにして" }];
  const media = { mimeType: "image/png" as const, data: "aGVsbG8=" };
  const next = await proposeVisualAppearance(before, instruction, [], { target: "page:staff-introduction:body", media, messages, splitStyles: true, generate: async request => {
    const context = JSON.parse(request.contents[0].parts![0].text!);
    assert.equal(context.instruction, instruction);
    assert.deepEqual(context.previousMessages, messages);
    assert.deepEqual(context.selectedPage, before.pages[0]);
    assert.deepEqual(context.allowedFields, ["body", "css", "cssEdits"]);
    assert.equal(context.current, undefined);
    assert.equal(context.shop.rules, undefined);
    assert.equal(context.shop.menus, undefined);
    assert.deepEqual(request.contents[0].parts!.at(-1), { inlineData: media });
    assert.deepEqual(Object.keys(request.schema.properties as object), ["body", "css", "cssEdits"]);
    assert.equal(request.schema.additionalProperties, false);
    assert.equal(request.timeoutMs, 120000);
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

test("page photo swaps replace the selected illustration in its card without adding a hero or rewriting copy", async () => {
  const before = config(), imageId = "a".repeat(64);
  before.pages[0].body = '<svg class="decoration"><path d="M0 0h10"></path></svg><section class="profile"><div class="portrait"><svg width="160" height="160" class="owner-picture"><circle cx="80" cy="80" r="60"></circle></svg></div><h2>店主の紹介</h2><p>資格と紹介文はそのまま</p></section>';
  const images = [{ id: imageId, name: "写真", mimeType: "image/png", data: "aGVsbG8=" }];
  const next = await proposeVisualAppearance(before, "写真をこの写真にして", images, { target: "page:staff-introduction:design", generate: async request => {
    const context = JSON.parse(request.contents[0].parts![0].text!);
    assert.equal(context.pageImageTargets.length, 2);
    assert.match(context.pageImageTargets[1].html, /owner-picture/);
    assert.match(context.imageEditing, /Do not add a top-level imageId/);
    return JSON.stringify({ imageEdits: [{ index: 1, imageId, alt: "店主の写真" }] });
  } });
  const page = next.config.pages[0];
  assert.equal(page.imageId, undefined);
  assert.match(page.body, /<div class="portrait"><img width="160" height="160" class="owner-picture"/);
  assert.match(page.body, new RegExp(`data-image-id="${imageId}"`));
  assert.match(page.body, /<svg class="decoration">/);
  assert.equal(samePageImageStructure(before.pages[0].body, page.body), true);
  assert.deepEqual({ ...next.config, pages: before.pages }, before);
  assert.doesNotThrow(() => validateProposedImages(next.config, before, images));
  assert.throws(() => validateProposedImages(next.config, before, []));
  for (const body of [page.body.replace("資格と紹介文はそのまま", "勝手な書き換え"), page.body.replace('<section class="profile">', '<section class="different">'), page.body.replace(/<img[^>]+>/, "")]) {
    const invalid = structuredClone(next.config);invalid.pages[0].body = body;
    assert.throws(() => validateVisualChange(before, invalid, "page:staff-introduction:design"));
  }
  assert.throws(() => applyPageImageEdits(before.pages[0].body, [{ index: 99, imageId }]));
  assert.throws(() => applyPageImageEdits(before.pages[0].body, [{ index: 1, imageId }, { index: 1, imageId }]));
  const withHero = structuredClone(before);withHero.pages[0].imageId = imageId;
  const repaired = await proposeVisualAppearance(withHero, "間違えて追加した上部の写真を外して、カードの写真を差し替えて", images, { target: "page:staff-introduction:design", generate: async () => JSON.stringify({ imageId: null, imageUrl: "", imageEdits: [{ index: 1, imageId }] }) });
  assert.equal(repaired.config.pages[0].imageId, undefined);
  assert.equal(pageImageTargets(repaired.config.pages[0].body).length, 2);
});

test("managed photo fitting reaches the actual image in published/offline rendering", () => {
  const id = "a".repeat(64);
  const html = renderToStaticMarkup(createElement(Presentation, { design: { html: `<img data-image-id="${id}" class="portrait" style="width:50%;height:320px;object-fit:cover;object-position:75% center" alt="店主">`, css: "" }, slots: {}, fallback: null, resolvedImages: { [id]: "data:image/png;base64,aGVsbG8=" } }));
  const image = html.match(/<img[^>]+>/)![0];
  assert.match(image, /object-fit:cover/);assert.match(image, /object-position:75% center/);
  assert.match(image, /width:100%;height:100%/, "the photo fills its wrapper even when theme rules set img height:auto");
  assert.doesNotMatch(image, /width:50%|height:320px/, "layout dimensions must not be applied twice to wrapper and image");
});

test("photo-swap API passes the selected attachment into generation and rendered review without publication", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = config();shop.published.pages[0].body = '<section class="profile"><svg width="160" height="160"><circle cx="80" cy="80" r="60"></circle></svg><p>資格と紹介文</p></section>';
  shop.published.menus[0].imageId = "b".repeat(64);
  shop.published.pages[1].body += `<img data-image-id="${"c".repeat(64)}" alt="別ページの写真">`;
  await store.saveShop(shop);
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const photo = await uploadMenuImage(store, shop, { requestId: randomUUID(), name: "店主の写真.png", mimeType: "image/png", data }, memoryCustomerFiles(store), "");
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  let generated = 0, reviewed = 0;
  const server = createApp(store, { ...intelligence,
    async identifyVisual() { return { ids: ["page:staff-introduction:design"], explanation: "カード内の写真を差し替えます。" }; },
    async visualAppearance(current, text, images = [], options) {
      generated++;assert.deepEqual(images.map(image => image.id), [photo.imageId]);
      return proposeVisualAppearance(current, text, images, { ...options, generate: async () => JSON.stringify({ imageEdits: [{ index: 0, imageId: images[0].id, alt: "店主" }] }) });
    },
    async visualReview(input) {
      reviewed++;assert.equal(input.images[0].id, photo.imageId);
      assert.deepEqual(Object.keys(input.renderImages), [photo.imageId], "unavailable photos on unrelated pages/menus cannot delay this page's review");
      assert.equal(input.renderImages[photo.imageId].data, data);
      assert.match(input.after.pages[0].body, new RegExp(photo.imageId));
      assert.equal(input.after.pages[0].imageId, undefined);
      return { approved: true, issues: [] };
    },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));await store.close(); });
  const api = async (action: string, data: unknown) => {
    const response = await fetch(`${origin}/api/shops/${shop.id}/${action}`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();assert.equal(response.status, 200, result.error);return result;
  };
  const instruction = "写真をこの写真にして", media = { mimeType: "image/png", data };
  const identified = await api("visual/identify", { media, instruction, displayed: shop.published, local: { base: shop.revision, source: shop.published, pageId: "staff-introduction" } });
  const next = await api("visual/propose", { id: identified.id, target: "page:staff-introduction:design", instruction, media, imageIds: [photo.imageId] });
  assert.deepEqual(next.visualReview, { approved: true, attempts: 1 });
  assert.equal(generated, 1);assert.equal(reviewed, 1);
  assert.deepEqual((await store.shop(shop.id))!.published, shop.published);
});

test("page body API uses scoped patches, reviews repairs and returns a draft without publishing", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = config(); await store.saveShop(shop);
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  let generations = 0, reviews = 0;
  const server = createApp(store, { ...intelligence,
    async identifyVisual(_media, _targets, text) { return { ids: [text === "紹介文を短くして" ? "description" : "page:staff-introduction:body"], explanation: "紹介文を反映します。" }; },
    async propose() { assert.fail("page edits must not regenerate the whole shop"); },
    async visualAppearance(current, text, images, options) {
      if (options?.target === "description") return proposeVisualAppearance(current, text, images, { ...options, generate: async () => JSON.stringify({ value: "短い紹介文" }) });
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
      if (input.target !== "description") assert.equal(input.screen, "page:staff-introduction");
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
  const textRequest = await api("visual/identify", { media, instruction: "紹介文を短くして", displayed: shop.published, local: { base: shop.revision, source: shop.published, content: true } });
  const textResult = await api("visual/propose", { id: textRequest.id, target: "description", instruction: "紹介文を短くして" });
  assert.equal(textResult.config.description, "短い紹介文");
  assert.deepEqual({ ...textResult.config, description: shop.published.description }, shop.published);
});
