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

test("fixed-amount examples use shop-currency units and known model aliases normalize without changing values", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  t.after(() => store.close());
  for (const language of ["ja", "en"] as const) for (const currency of ["JPY", "USD"] as const) {
    shop.published.region = currency === "USD" ? { country: "US", timeZone: "America/New_York" } : { country: "JP", timeZone: "Asia/Tokyo" };
    const value = currency === "USD" ? 5 : 500;
    const fixedRequest = `${currency === "USD" ? "$5" : "JPY 500"} off for customers who have visited 3 times, valid 60 days, calculated after each visit`;
    for (const type of ["amount", "fixed", "fixed_amount"]) {
      const proposal = await requestLocale.run(language, () => proposeCoupon(shop, fixedRequest, async input => {
        const schema = JSON.stringify(input.schema);
        assert.match(schema, /"const":"amount"/);
        assert.match(schema, /"const":"percent"/);
        assert.match(schema, /Never emit fixed or fixed_amount/);
        assert.match(input.system, /percent/); assert.match(input.system, /amount/);
        const context = JSON.parse(input.contents[0].parts![0].text!) as Context;
        assert.equal(context.currency, currency); assert.equal(context.language, language);
        const example = context.examples.find(example => example.request === fixedRequest)!;
        assert.deepEqual(example.result.rule.discount, { type: "amount", value });
        assert.deepEqual(example.result.rule.conditions, [{ type: "visit_count", count: 3, comparison: "exact" }]);
        assert.deepEqual(example.result.rule.schedule, { type: "after_visit" });
        assert.equal(example.result.rule.validDays, 60);
        return JSON.stringify({ ...example.result, rule: { ...example.result.rule, discount: { type, value } } });
      }));
      assert.deepEqual(proposal.rule!.discount, { type: "amount", value });
      assert.deepEqual(proposal.rule!.conditions, [{ type: "visit_count", count: 3, comparison: "exact" }]);
      assert.deepEqual(proposal.rule!.schedule, { type: "after_visit" });
      assert.equal(proposal.rule!.validDays, 60); assert.equal(proposal.question, "");
    }
  }
  // Saved/user-authored rules remain strict; the alias is accepted only when parsing AI output.
  assert.equal(couponRuleSchema.safeParse({ title: "Gift", match: "all", conditions: [{ type: "everyone" }], discount: { type: "fixed", value: 5 }, schedule: { type: "registration" }, validDays: 60 }).success, false);
  assert.deepEqual(await store.records("couponCampaign", shop), []);
  assert.deepEqual(await store.records("couponGrant", shop), []);
});

test("malformed AI output returns a localized retry message while transport errors keep their useful status", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  t.after(() => store.close());
  const valid = { rule: { title: "Gift", match: "all", conditions: [{ type: "visit_count", count: 3, comparison: "exact" }], discount: { type: "amount", value: 5 }, schedule: { type: "after_visit" }, validDays: 60 }, question: "" };
  const malformed = [
    "{not JSON", JSON.stringify(null), JSON.stringify({}), JSON.stringify({ rule: null, question: "" }),
    ...[{ type: "cash", value: 5 }, { type: "fixed", value: 0 }, { type: "fixed_amount", value: -5 }, { type: "fixed", value: "5" }, { type: "percent", value: 101 }].map(discount => JSON.stringify({ ...valid, rule: { ...valid.rule, discount } })),
    JSON.stringify({ ...valid, rule: { ...valid.rule, conditions: [] } }),
  ];
  for (const language of ["ja", "en"] as const) for (const raw of malformed) {
    await requestLocale.run(language, () => assert.rejects(proposeCoupon(shop, request, async () => raw), (error: Error & { status?: number }) => {
      assert.equal(error.status, 502);
      assert.equal(error.message, language === "en" ? "We couldn't create a coupon proposal. Please try again." : "クーポン案を作成できませんでした。もう一度お試しください。");
      assert.doesNotMatch(error.message, /discriminator|discount|Zod|JSON|rule\./);
      return true;
    }));
  }
  for (const status of [429, 503, 504]) {
    const error = Object.assign(new Error("AI temporarily unavailable"), { status });
    await assert.rejects(proposeCoupon(shop, request, async () => { throw error; }), value => value === error);
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
  let calls = 0, modelOutput: ((context: Context) => unknown) | undefined;
  let expectedRequest = request;
  setOpenAiClient({ responses: { create: async (body: { instructions: string; input: { content: { text: string }[] }[]; text: { format: { schema: object } } }) => {
    calls++;
    assert.match(body.instructions, /first_visit/);
    assert.match(JSON.stringify(body.text.format.schema), /"const":"first_visit"/);
    const context = JSON.parse(body.input[0].content[0].text) as Context;
    assert.equal(context.request, expectedRequest);
    const result = modelOutput ? modelOutput(context) : context.examples[0].result;
    return { output_text: typeof result === "string" ? result : JSON.stringify(result), output: [] };
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
  shop.published!.region = { country: "US", timeZone: "America/New_York" }; await store.saveShop(shop);
  expectedRequest = "$5 off for customers who have visited 3 times, valid 60 days, calculated after each visit";
  for (const language of ["ja", "en"]) {
    const call = () => fetch(`${origin}/api/shops/${shop.id}/coupons/propose`, {
      method: "POST",
      headers: { Cookie: `gemihub_session=${token}`, Origin: origin, "Content-Type": "application/json", "X-Gemihub-Language": language },
      body: JSON.stringify({ request: expectedRequest }),
    });
    for (const type of ["amount", "fixed", "fixed_amount"]) {
      modelOutput = context => {
        assert.equal(context.currency, "USD");
        const example = context.examples.find(example => example.request === expectedRequest)!;
        return { ...example.result, rule: { ...example.result.rule, discount: { type, value: 5 } } };
      };
      const response = await call(); assert.equal(response.status, 200);
      const proposal = await response.json();
      assert.deepEqual(proposal.rule.discount, { type: "amount", value: 5 });
      assert.deepEqual(proposal.rule.conditions, [{ type: "visit_count", count: 3, comparison: "exact" }]);
      assert.deepEqual(proposal.rule.schedule, { type: "after_visit" });
      assert.equal(proposal.rule.validDays, 60); assert.equal(proposal.question, "");
    }
    for (const invalid of ["{not JSON", { rule: { discount: { type: "cash", value: 5 } }, question: "" }]) {
      modelOutput = () => invalid;
      const response = await call(); assert.equal(response.status, 502);
      const failure = await response.json();
      assert.deepEqual(failure, { error: language === "en" ? "We couldn't create a coupon proposal. Please try again." : "クーポン案を作成できませんでした。もう一度お試しください。" });
    }
  }
  assert.equal(calls, 12);
  assert.deepEqual(await store.records("couponCampaign", shop), []);
  assert.deepEqual(await store.records("couponGrant", shop), []);
});
