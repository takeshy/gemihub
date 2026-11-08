import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { sample, shopSchema } from "../server/domain.ts";
import { applySettingsFacts, proposeSettings, settingsChanges } from "../server/settings-ai.ts";
import { liveValue } from "../server/live-settings.ts";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import { requestLocale } from "../server/i18n.ts";
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
  const option = applySettingsFacts(before, "menus", {items:[{id:before.menus[1].id,name:before.menus[1].name,optionFor:[before.menus[0].id],optionGroup:"removal"}]}).config;
  assert.deepEqual(option.menus[1].optionFor,[before.menus[0].id]);
  const universal = applySettingsFacts(option,"menus",{items:[{id:option.menus[1].id,name:option.menus[1].name,optionForAll:true}]}).config;
  assert.equal(universal.menus[1].optionForAll,true);assert.deepEqual(universal.menus[1].optionFor,option.menus[1].optionFor);assert.equal(universal.menus[1].optionGroup,"removal");
  assert.match(settingsChanges(option,universal,"menus")[0].after,/すべてのメニュー/);
  const cleared = applySettingsFacts(universal,"menus",{items:[{id:universal.menus[1].id,name:universal.menus[1].name,optionFor:null}]}).config;
  assert.equal(cleared.menus[1].optionForAll,undefined);assert.equal(cleared.menus[1].optionFor,undefined);assert.equal(cleared.menus[1].optionGroup,undefined);
  const standalone = applySettingsFacts(option,"menus",{items:[{id:option.menus[1].id,name:option.menus[1].name,optionFor:null,optionGroup:null}]}).config;
  assert.equal(standalone.menus[1].optionFor,undefined);assert.equal(standalone.menus[1].optionGroup,undefined);
  assert.throws(() => applySettingsFacts(before, "staff", { items: [{ name: "New staff", menuIds: ["not-existing"] }] }));
  const incomplete = applySettingsFacts(before, "staff", { items: [{ name: "New staff" }] }); assert.equal(incomplete.config.staff.length, before.staff.length); assert.equal(incomplete.warnings.length, 1);
  assert.throws(() => applySettingsFacts(before, "hours", { start: "19:00", end: "18:00" }));
  assert.deepEqual(applySettingsFacts(before, "rules", { advanceDays: 45 }).config.rules.payment, before.rules.payment);
});

test("rules AI merges payment fields, preserves unspecified settings and validates refund tiers", () => {
  const before = current();
  before.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
  const tiers = [{ hoursBefore: 24, percent: 100 }, { hoursBefore: 12, percent: 80 }, { hoursBefore: 1, percent: 50 }, { hoursBefore: 0, percent: 0 }];
  const changed = applySettingsFacts(before, "rules", { payment: { refundTiers: tiers } }).config;
  assert.deepEqual(changed.rules.payment, { enabled: true, refundTiers: tiers });
  assert.deepEqual({ ...changed, rules: before.rules }, before);
  assert.deepEqual(before.rules.payment.refundTiers, defaultRefundTiers);
  assert.deepEqual(applySettingsFacts(changed, "rules", { payment: { enabled: false } }).config.rules.payment, { enabled: false, refundTiers: tiers });
  assert.deepEqual(applySettingsFacts(changed, "rules", { advanceDays: 45 }).config.rules.payment, changed.rules.payment);
  assert.deepEqual(applySettingsFacts(changed, "basic", { payment: { enabled: false } }).config.rules.payment, changed.rules.payment);
  const unconfigured = current(); delete unconfigured.rules.payment;
  assert.equal(applySettingsFacts(unconfigured, "rules", { payment: {} }).config.rules.payment, undefined);
  assert.deepEqual(applySettingsFacts(unconfigured, "rules", { payment: { refundTiers: tiers } }).config.rules.payment, { enabled: false, refundTiers: tiers });
  assert.deepEqual(applySettingsFacts(unconfigured, "rules", { payment: { enabled: true } }).config.rules.payment, { enabled: true, refundTiers: defaultRefundTiers });
  for (const refundTiers of [[], [{ hoursBefore: 24, percent: 80 }], [{ hoursBefore: 24, percent: 40 }, { hoursBefore: 0, percent: 70 }], [{ hoursBefore: 0, percent: 101 }]]) {
    assert.throws(() => applySettingsFacts(before, "rules", { payment: { refundTiers } }));
  }
});

test("rules AI exposes payment facts and readable localized refund changes", async () => {
  for (const language of ["ja", "en"] as const) await requestLocale.run(language, async () => {
    const before = current(); before.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
    const tiers = [{ hoursBefore: 48, percent: 100 }, { hoursBefore: 24, percent: 80 }, { hoursBefore: 0, percent: 0 }];
    const proposal = await proposeSettings("rules", before, "48 hours full refund, 24 hours 80%, otherwise zero", { generate: async input => {
      const schema = input.schema as any;
      assert.ok(schema.properties.facts.properties.payment.properties.refundTiers);
      const data = JSON.parse(input.contents[0].parts![0].text!);
      assert.deepEqual(data.current.payment, before.rules.payment);
      assert.match(input.system, /payment.refundTiers/);
      return JSON.stringify({ facts: { payment: { refundTiers: tiers } }, warnings: [] });
    } });
    assert.deepEqual((proposal.value as any).payment, { enabled: true, refundTiers: tiers });
    assert.equal(proposal.changes.length, 1);
    assert.match(proposal.changes[0].before, /70%/); assert.match(proposal.changes[0].after, /80%/);
    assert.ok(!JSON.stringify(proposal.changes).includes("[object Object]"));
    if (language === "en") assert.equal(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(JSON.stringify(proposal.changes)), false);
    const enabled = structuredClone(before); enabled.rules.payment!.enabled = false;
    assert.equal(settingsChanges(before, enabled, "rules").length, 1);
    await assert.rejects(proposeSettings("rules", before, "invalid", { generate: async () => JSON.stringify({ facts: { payment: { refundTiers: [] } }, warnings: [] }) }), /設定案|suggestion/i);
  });
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
    return proposeSettings(section, config, note, { generate: async () => JSON.stringify({ facts: section === "menus" ? { items: [{ name: "Care", duration: 90, price: 8500 }] } : section === "rules" ? { payment: { refundTiers: [{ hoursBefore: 24, percent: 100 }, { hoursBefore: 0, percent: 20 }] } } : { name: "AI shop" }, warnings: [] }) });
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
  const saved = structuredClone((await store.shop(shop.id))!.published!);
  const rulesInput = { value: saved.rules, note: "24h full, otherwise 20% refund", requestId: randomUUID() };
  const rules = await request("live-settings/rules/ai", rulesInput);
  assert.equal(rules.status, 200); assert.equal(rules.body.value.payment.refundTiers[1].percent, 20);
  assert.deepEqual((await request("live-settings/rules/ai", rulesInput)).body, rules.body);
  assert.deepEqual((await store.shop(shop.id))!.published, saved, "refund suggestions do not save");
  assert.equal((await request("live-settings/rules", { value: rules.body.value, requestId: randomUUID() })).status, 200);
  assert.deepEqual((await store.shop(shop.id))!.published!.rules.payment, rules.body.value.payment);
  hold = true;
  const generating = request("live-settings/basic/ai", { value: liveValue((await store.shop(shop.id))!.published!, "basic"), note: "name", requestId: randomUUID() });
  await began;
  const read = await Promise.race([request("live-settings/basic"), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI held the shop lock")), 1000))]);
  assert.equal(read.status, 200); release(); assert.equal((await generating).status, 200);
});
