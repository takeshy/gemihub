import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { sample, shopSchema } from "../server/domain.ts";
import { applySettingsFacts, proposeSettings } from "../server/settings-ai.ts";
import { liveValue } from "../server/live-settings.ts";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import * as intelligence from "../server/ai.ts";

const current = () => shopSchema.parse(structuredClone(sample));
test("AI settings apply only selected facts, preserve existing rows and append inactive services", () => {
  const before = current(); before.region = { country: "US", timeZone: "America/New_York" };
  const basic = applySettingsFacts(before, "basic", { name: "Moon Atelier", notificationEmail: "attacker@example.com", region: { country: "JP", timeZone: "Asia/Tokyo" }, menus: [] }).config;
  assert.equal(basic.name, "Moon Atelier"); assert.equal(basic.notificationEmail, before.notificationEmail); assert.deepEqual(basic.region, before.region); assert.deepEqual(basic.menus, before.menus);
  before.menus[0].imageId = "a".repeat(64);
  const menus = applySettingsFacts(before, "menus", { items: [{ id: before.menus[0].id, name: before.menus[0].name, price: 65.5, currency: "USD", imageId: "b".repeat(64) }, { name: "New care", price: 80, duration: 90, active: true }] }).config;
  assert.equal(menus.menus[0].price, 65.5); assert.equal(menus.menus[0].imageId, before.menus[0].imageId);
  assert.deepEqual(menus.menus[1], before.menus[1]); assert.equal(menus.menus.at(-1)!.active, false); assert.deepEqual(menus.staff, before.staff);
  const missing = applySettingsFacts(before, "menus", { items: [{ name: "Unknown time", price: 50 }] }); assert.equal(missing.config.menus.length, before.menus.length); assert.equal(missing.warnings.length, 1);
  const currency = applySettingsFacts(before, "menus", { items: [{ id: before.menus[0].id, name: before.menus[0].name, price: 2000, currency: "JPY" }] }); assert.equal(currency.config.menus[0].price, before.menus[0].price); assert.equal(currency.warnings.length, 1);
  assert.throws(() => applySettingsFacts(before, "menus", { items: [{ id: "not-existing", name: "Overwrite", price: 1 }] }));
  assert.throws(() => applySettingsFacts(before, "staff", { items: [{ name: "New staff", menuIds: ["not-existing"] }] }));
  const incomplete = applySettingsFacts(before, "staff", { items: [{ name: "New staff" }] }); assert.equal(incomplete.config.staff.length, before.staff.length); assert.equal(incomplete.warnings.length, 1);
  assert.throws(() => applySettingsFacts(before, "hours", { start: "19:00", end: "18:00" }));
  assert.deepEqual(applySettingsFacts(before, "rules", { advanceDays: 45, payment: { enabled: true } }).config.rules.payment, before.rules.payment);
});

test("AI extraction receives fetched page contents and keeps unknown facts unchanged", async () => {
  const before = current(); let fetched = 0;
  const result = await proposeSettings("basic", before, "店名はメモを優先 https://public.example/shop", {
    readPage: async url => { fetched++; return { url, title: "Public shop", text: "Page shop name: Other name. Address: Example street" }; },
    generate: async input => {
      const data = JSON.parse(input.contents[0].parts![0].text!);
      assert.equal(data.sources[0].text, "Page shop name: Other name. Address: Example street"); assert.match(data.note, /店名はメモを優先/);
      return JSON.stringify({ facts: { name: "Memo name" }, warnings: ["住所は確認してください"] });
    },
  });
  assert.equal(fetched, 1); assert.equal((result.value as any).name, "Memo name"); assert.equal((result.value as any).address, before.address); assert.equal(result.changes.length, 1); assert.equal(result.sources[0].title, "Public shop");
  await assert.rejects(proposeSettings("basic", before, "https://127.0.0.1/", { generate: async () => { throw new Error("must not generate"); } }), /参考URL/);
  await assert.rejects(proposeSettings("basic", before, "memo", { generate: async () => "invalid JSON" }), /設定案/);
});

test("settings suggestions are owner-only, idempotent drafts and do not block live settings reads", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com"); shop.published = current(); await store.saveShop(shop);
  await store.put("member", `${shop.id}:staff@example.com`, { shopId: shop.id, email: "staff@example.com", accepted: true });
  for (const [id, email] of [["owner", shop.owner], ["staff", "staff@example.com"], ["other", "other@example.com"]]) await store.put("session", digest(id), { user: { email, name: id, role: "owner", shopId: shop.id }, expires: Date.now() + 3600000 });
  let calls = 0, release!: () => void, started!: () => void;
  let hold = false;
  const began = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const server = createApp(store, { ...intelligence, settings: async (section, config, note) => {
    calls++; if (hold) { started(); await gate; }
    return proposeSettings(section, config, note, { generate: async () => JSON.stringify({ facts: section === "menus" ? { items: [{ name: "Care", duration: 90, price: 8500 }] } : { name: "AI shop" }, warnings: [] }) });
  } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { release(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const request = async (path: string, data?: unknown, user = "owner") => {
    const response = await fetch(`${origin}/api/shops/${shop.id}/${path}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${user}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const original = structuredClone(shop.published), value = structuredClone(original.menus); value[0].price = 6200;
  const input = { value, note: "Care 90 min 8500 yen", requestId: randomUUID() };
  for (const user of ["staff", "other", "anonymous"]) assert.equal((await request("live-settings/menus/ai", input, user)).status, 403);
  assert.equal(calls, 0);
  const [first, repeat] = await Promise.all([request("live-settings/menus/ai", input), request("live-settings/menus/ai", input)]);
  assert.equal(first.status, 200); assert.deepEqual(first.body, repeat.body); assert.equal(calls, 1);
  assert.equal(first.body.value[0].price, 6200, "manual edits survive the suggestion"); assert.equal(first.body.value.at(-1).active, false);
  assert.deepEqual((await store.shop(shop.id))!.published, original, "generation does not save or publish"); assert.equal((await store.shop(shop.id))!.revision, 0);
  assert.equal((await request("live-settings/menus/ai", { ...input, note: "different" })).status, 409);
  assert.equal((await request("live-settings/menus", { previous: original.menus, value: first.body.value, requestId: randomUUID() })).status, 200);
  assert.equal((await store.shop(shop.id))!.published!.menus.at(-1)!.name, "Care");
  hold = true;
  const generating = request("live-settings/basic/ai", { value: liveValue((await store.shop(shop.id))!.published!, "basic"), note: "name", requestId: randomUUID() });
  await began;
  const read = await Promise.race([request("live-settings/basic"), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI held the shop lock")), 1000))]);
  assert.equal(read.status, 200); release(); assert.equal((await generating).status, 200);
});
