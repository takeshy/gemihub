import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { proposeCoupon } from "../server/coupon-ai.ts";
import { couponRuleSchema, type CouponRule } from "../shared/coupons.ts";
import { sample } from "../server/domain.ts";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { requestLocale } from "../server/i18n.ts";
import { setOpenAiClient, setProviderResolver } from "../server/llm.ts";

type Context = {
  request: string; language: string; currency: string;
  examples: { request: string; result: { rule: CouponRule; question: string } }[];
};
const request = "10% off for first-time customers, valid 30 days";

test("the AI contract explicitly represents zero visits and distinguishes after-first-visit offers in both languages", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  t.after(() => store.close());
  for (const language of ["ja", "en"] as const) {
    await requestLocale.run(language, () => proposeCoupon(shop, request, async input => {
      assert.match(input.system, /first_visit/);
      assert.match(input.system, /registration/);
      const schema = JSON.stringify(input.schema);
      assert.match(schema, /"const":"first_visit"/);
      assert.match(schema, /dedicated condition has no count or comparison fields/);
      assert.match(schema, /visit_count.*count must be at least 1/);
      assert.match(schema, /default to.*registration/);
      const context = JSON.parse(input.contents[0].parts![0].text!) as Context;
      assert.equal(context.language, language);
      assert.equal(context.request, request);
      assert.equal(context.currency, "JPY");
      const first = context.examples.find(example => example.request === request)!;
      assert.deepEqual(first.result.rule.conditions, [{ type: "first_visit" }]);
      assert.deepEqual(first.result.rule.schedule, { type: "registration" });
      assert.deepEqual(first.result.rule.discount, { type: "percent", value: 10 });
      assert.equal(first.result.rule.validDays, 30);
      assert.equal(first.result.question, "");
      assert.equal(couponRuleSchema.safeParse(first.result.rule).success, true);
      const after = context.examples.find(example => example.request.includes("after the first completed visit"))!;
      assert.deepEqual(after.result.rule.conditions, [{ type: "visit_count", count: 1, comparison: "exact" }]);
      assert.deepEqual(after.result.rule.schedule, { type: "after_visit" });
      assert.equal(couponRuleSchema.safeParse(after.result.rule).success, true);
      return JSON.stringify(first.result);
    }));
  }
  assert.deepEqual(await store.records("couponCampaign", shop), []);
  assert.deepEqual(await store.records("couponGrant", shop), []);
});

test("the proposal endpoint sends first-visit guidance to the provider and returns editable rules without issuing coupons", async t => {
  const original = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, demo: process.env.DEMO_MODE, origin: process.env.APP_ORIGIN };
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_MODEL = "test-model"; process.env.DEMO_MODE = "true";
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com"), token = randomUUID();
  shop.published = structuredClone(sample); await store.saveShop(shop);
  await store.put("setting", "aiProvider", { provider: "openai" });
  await store.put("session", digest(token), { user: { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id }, expires: Date.now() + 600000 });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    setOpenAiClient(undefined); setProviderResolver(async () => "vertex");
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close();
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: original.key, OPENAI_MODEL: original.model, DEMO_MODE: original.demo, APP_ORIGIN: original.origin })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let calls = 0;
  setOpenAiClient({ responses: { create: async (body: { instructions: string; input: { content: { text: string }[] }[]; text: { format: { schema: object } } }) => {
    calls++;
    assert.match(body.instructions, /first_visit/);
    assert.match(JSON.stringify(body.text.format.schema), /"const":"first_visit"/);
    const context = JSON.parse(body.input[0].content[0].text) as Context;
    assert.equal(context.request, request);
    return { output_text: JSON.stringify(context.examples[0].result), output: [] };
  } } } as unknown as OpenAI);
  for (const language of ["ja", "en"]) {
    const response = await fetch(`${origin}/api/shops/${shop.id}/coupons/propose`, {
      method: "POST",
      headers: { Cookie: `gemihub_session=${token}`, Origin: origin, "Content-Type": "application/json", "X-Gemihub-Language": language },
      body: JSON.stringify({ request }),
    });
    assert.equal(response.status, 200);
    const proposal = await response.json();
    assert.deepEqual(proposal.rule.conditions, [{ type: "first_visit" }]);
    assert.deepEqual(proposal.rule.schedule, { type: "registration" });
    assert.deepEqual(proposal.rule.discount, { type: "percent", value: 10 });
    assert.equal(proposal.rule.validDays, 30);
    assert.equal(proposal.question, "");
    assert.equal(proposal.rule.title, language === "en" ? "Welcome coupon" : "初回クーポン");
  }
  assert.equal(calls, 2);
  assert.deepEqual(await store.records("couponCampaign", shop), []);
  assert.deepEqual(await store.records("couponGrant", shop), []);
});
