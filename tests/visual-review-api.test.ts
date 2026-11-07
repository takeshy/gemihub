import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { sample, planSummary } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import * as intelligence from "../server/ai.ts";

process.env.DEMO_MODE = "true";
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
