import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store, type Shop } from "../server/store.ts";
import { sample, planSummary } from "../server/domain.ts";
import * as intelligence from "../server/ai.ts";

process.env.DEMO_MODE = "true";

test("initial pages publish provisionally once; menu settings and a fresh production preview lead to public access", async t => {
  const store = new Store(":memory:");
  const server = createApp(store, { ...intelligence, async propose() { return { config: structuredClone(sample), summary: planSummary(null, sample) }; } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  let cookie = "";
  async function request(path: string, data?: unknown) {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    cookie ||= response.headers.get("set-cookie")?.split(";")[0] || "";
    return { status: response.status, body: await response.json() };
  }
  await request("/api/demo-login", { role: "owner" });
  const shop: Shop = (await request("/api/workspace")).body.shops[0];
  const base = `/api/shops/${shop.id}`;
  const outline = await request(`${base}/plan`, { text: "予約できるお店のページ。スタッフや料金はこれから決める。" });
  assert.equal(outline.status, 200);
  assert.equal(outline.body.requiresSetup, true);
  assert.equal((await request(`${base}/plans/${outline.body.id}/publish`, {})).status, 409);
  await request(`${base}/plans/${outline.body.id}/approve`, {});
  assert.equal((await request(`${base}/plans/${outline.body.id}/publish`, { publication: "provisional" })).status, 200);
  assert.equal((await request(`${base}/plans/${outline.body.id}/publish`, { publication: "provisional" })).status, 200, "retrying the single provisional publication action is safe");
  const provisional = (await store.shop(shop.id))!;
  assert.equal(provisional.publication, "provisional");
  assert.equal(provisional.revision, 1);
  assert.equal((await request(`/api/preview/${shop.id}?plan=${outline.body.id}`)).status, 404);
  assert.equal((await request(`${base}/publication`, { publication: "public", revision: provisional.revision })).status, 400, "a preview fingerprint is required");
  const settings = await request(`${base}/live-settings/staff`);
  const staff = structuredClone(settings.body.config.staff);
  staff[0].name = "メニューで入力したスタッフ";
  assert.equal((await request(`${base}/live-settings/staff`, { value: staff, previous: settings.body.config.staff, requestId: "11111111-1111-4111-8111-111111111111" })).status, 200);
  const configured = (await store.shop(shop.id))!;
  assert.equal(configured.published!.staff[0].name, staff[0].name);
  assert.equal(configured.publication, "provisional");
  const pending = structuredClone(configured.published!);
  pending.description = "まだ反映していない提案";
  const proposal = await request(`${base}/plan`, { text: "紹介文を変えたい", config: pending });
  assert.equal(proposal.status, 200);
  await request(`${base}/plans/${proposal.body.id}/approve`, {});
  assert.equal((await store.shop(shop.id))!.draft!.description, pending.description);
  const post = { category: "blogs", date: "2026-11-01", slug: "draft", title: "まだ公開していない記事", excerpt: "", body: "下書きの本文" };
  assert.equal((await request(`${base}/posts`, { content: post })).status, 200);
  const snapshot = await request(`${base}/publication-preview`);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.config.staff[0].name, staff[0].name);
  assert.equal(snapshot.body.config.description, configured.published!.description, "approved proposals stay out of the production preview until applied");
  assert.deepEqual(snapshot.body.posts, [], "unpublished article drafts stay out of the preview");
  assert.match(snapshot.body.hash, /^[a-f0-9]{64}$/);
  assert.equal((await store.bookings(shop.id)).length, 0, "loading the preview does not create real bookings");
  // A direct settings edit can change content without changing the publication revision.
  configured.published!.description = "プレビュー後に変わった紹介文";
  await store.saveShop(configured);
  assert.equal((await request(`${base}/publication`, { publication: "public", revision: snapshot.body.revision, hash: snapshot.body.hash })).status, 409);
  const latest = (await request(`${base}/publication-preview`)).body;
  assert.equal((await request(`${base}/publication`, { publication: "public", revision: latest.revision, hash: latest.hash })).status, 200);
  assert.equal((await store.shop(shop.id))!.publication, "public");
});
