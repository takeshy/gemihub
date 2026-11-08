import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { sample, planSummary, type ShopConfig } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import * as intelligence from "../server/ai.ts";
import { proposeVisualAppearance } from "../server/visual.ts";
import { standardTheme } from "../shared/theme-editing.ts";

process.env.DEMO_MODE = "true";
test("content visual retries ignore unrelated frame updates and Firestore key ordering while retaining real conflicts", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  const baseline = structuredClone(sample);
  shop.published = { ...structuredClone(baseline), header: { ...baseline.header, title: "Updated live header" }, appearance: { accent: "rose", layout: "standard", imageUrl: "" } };
  shop.revision = 1;
  await store.saveShop(shop);
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  let identifications = 0;
  const server = createApp(store, { ...intelligence,
    async identifyVisual() { identifications++;return { ids: ["description"], explanation: "Adjust the description" }; },
    async propose(_text, current) { return { config: { ...structuredClone(current!), description: "Edited description" }, summary: [] }; },
    async visualReview() { return { approved: true, issues: [] }; },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));await store.close(); });
  const api = (path: string, data: unknown) => fetch(`${origin}/api/shops/${shop.id}/${path}`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const identify = { media: { mimeType: "image/png", data: "aGVsbG8=" }, instruction: "Change the description", displayed: baseline, local: { base: 0, source: baseline, content: true } };
  const response = await api("visual/identify", identify);
  assert.equal(response.status, 200);
  const identified = await response.json();
  const visual = (await store.get<{ source: ShopConfig }>("visual", identified.id))!;
  const reversed = JSON.parse(JSON.stringify(visual.source, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
  await store.put("visual", identified.id, { ...visual, source: reversed });
  const generated = await api("visual/propose", { id: identified.id, target: "description", instruction: "Change the description" });
  assert.equal(generated.status, 200);
  assert.equal((await generated.json()).config.description, "Edited description");
  assert.equal((await store.shop(shop.id))!.published!.header.title, "Updated live header");
  assert.equal((await store.shop(shop.id))!.published!.description, baseline.description);
  assert.equal((await api("visual/identify", { ...identify, local: { ...identify.local, content: false } })).status, 409, "older shared-scope clients still check their whole scope");
  assert.equal((await api("visual/identify", { ...identify, local: { ...identify.local, theme: true } })).status, 409, "a real frame conflict is retained");
  shop.published!.description = "Updated live description";shop.revision++;await store.saveShop(shop);
  assert.equal((await api("visual/identify", identify)).status, 409, "a real content conflict is retained");
  assert.equal(identifications, 1, "stale requests are rejected before spending a model call");
});
test("oversized CSS preserves the visual request and live configuration for a successful retry", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = { ...structuredClone(sample), appearance: { accent: "sage", layout: "standard", imageUrl: "", theme: structuredClone(standardTheme) } };
  await store.saveShop(shop);
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  let oversized = true, generations = 0, reviews = 0;
  const server = createApp(store, { ...intelligence,
    async identifyVisual() { return { ids: ["theme"], explanation: "Adjust the page" }; },
    async visualAppearance(current, instruction, images, options) {
      return proposeVisualAppearance(current, instruction, images, { ...options, generate: async () => {
        generations++;
        return JSON.stringify({ appearance: { theme: { css: oversized ? ':root{--large:"' + "x".repeat(24000) + '"}' : '.public-nav{gap:24px}' } } });
      } });
    },
    async visualReview() { reviews++;return { approved: true, issues: [] }; },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { server.close();await store.close(); });
  const api = (path: string, data: unknown) => fetch(`${origin}/api/shops/${shop.id}/${path}`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const identified = await (await api("visual/identify", { media: { mimeType: "image/png", data: "aGVsbG8=" }, instruction: "Adjust the menu", displayed: shop.published, local: { base: shop.revision, source: shop.published, theme: true } })).json();
  const request = { id: identified.id, target: "theme", instruction: "Adjust the menu" };
  const failed = await api("visual/propose", request);
  assert.equal(failed.status, 422);assert.equal(generations, 3);assert.equal(reviews, 0);
  assert.match((await failed.json()).error, /依頼の内容は保持/);
  assert.deepEqual((await store.shop(shop.id))!.published, shop.published);
  assert.equal((await store.list("plan")).length, 0);
  oversized = false;
  const retry = await api("visual/propose", request);
  assert.equal(retry.status, 200);assert.equal((await retry.json()).visualReview.approved, true);
  assert.equal(reviews, 1);assert.deepEqual((await store.shop(shop.id))!.published, shop.published);
});

test("rendered review releases the shop lock, rejects stale results and never saves rejected proposals", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); await store.saveShop(shop);
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let gate = new Promise<void>(resolve => { release = resolve; });
  let reject = false, reviews = 0;
  const server = createApp(store, { ...intelligence,
    async identifyVisual() { return { ids: ["description"], explanation: "Change the description" }; },
    async propose(_text, current) { const config = { ...structuredClone(current!), description: "The corrected description" };return { config, summary: planSummary(current, config) }; },
    async visualReview() { reviews++;started();await gate;return { approved: !reject, issues: reject ? ["The text is clipped on phones"] : [] }; },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN = origin;
  t.after(async () => { release();server.close();await store.close(); });
  const api = (path: string, data?: unknown, signal?: AbortSignal) => fetch(`${origin}/api/shops/${shop.id}/${path}`, { method: data ? "POST" : "GET", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined, signal });
  const media = { mimeType: "image/png", data: "aGVsbG8=" };
  const identified = await (await api("visual/identify", { media, instruction: "Change the description", displayed: shop.published, local: { base: shop.revision, source: shop.published } })).json();
  const request = { id: identified.id, target: "description", instruction: "Change the description" };
  const pending = api("visual/propose", request);
  await entered;
  const editor = await api("local-editor", undefined, AbortSignal.timeout(1500));
  assert.equal(editor.status, 200, "ordinary shop operations remain available during review");
  await store.locked(shop.id, async () => { const latest = (await store.shop(shop.id))!;latest.revision++;await store.saveShop(latest); });
  release();
  assert.equal((await pending).status, 409, "a result reviewed against an old live version is rejected");
  assert.deepEqual((await store.shop(shop.id))!.published, shop.published);
  const latest = (await store.shop(shop.id))!;
  const second = await (await api("visual/identify", { media, instruction: "Change the description", displayed: latest.published, local: { base: latest.revision, source: latest.published } })).json();
  reject = true;gate = Promise.resolve();reviews = 0;
  const rejected = await api("visual/propose", { ...request, id: second.id });
  assert.equal(rejected.status, 422);assert.equal(reviews, 3);
  assert.equal((await store.list("plan")).length, 0);
  assert.deepEqual((await store.shop(shop.id))!.published, shop.published);
  reject = false;
  const retried = await api("visual/propose", { ...request, id: second.id });
  assert.equal(retried.status, 200);assert.equal((await retried.json()).visualReview.approved, true);
});
