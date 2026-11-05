import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store, bookingLockKey } from "../server/store.ts";
import { sample, shopDate, slots, type Booking } from "../server/domain.ts";
import { issueCoupons, couponWallet, applyCoupon, validateCouponRule, grantManualCoupons, campaignEnabled, issueLimit, visitSettleMs } from "../server/coupons.ts";
import { couponRuleSchema, couponRuleIssues, couponTemplate, couponTemplateIds, couponDiscount, type CouponRule, type CouponCampaign, type CouponGrant } from "../shared/coupons.ts";
import { proposeCoupon } from "../server/coupon-ai.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import { paypalValue } from "../shared/region.ts";
import type { PaymentGateway, PayPalOrder } from "../server/paypal.ts";
const hour = 3600000;
const rule = (changes: Partial<CouponRule> = {}): CouponRule => ({ title: "Welcome", match: "all", conditions: [{ type: "first_visit" }], discount: { type: "percent", value: 10 }, schedule: { type: "registration" }, validDays: 30, ...changes });
function visit(shopId: string, id: string, customer: string, end: number): Booking {
  return { id, shopId, customer, name: customer, menuId: "simple", staffId: "aoi", price: 5500, message: "", start: new Date(end - hour).toISOString(), end: new Date(end).toISOString(), status: "active", createdAt: new Date(end - 86400000).toISOString() };
}
test("discounts cap at the total and round in yen/cents; invalid rules are rejected", () => {
  assert.equal(couponDiscount(55.01, { type: "percent", value: 10 }, "USD"), 5.5);
  assert.equal(couponDiscount(5501, { type: "percent", value: 15 }, "JPY"), 825);
  assert.equal(couponDiscount(100, { type: "amount", value: 500 }, "JPY"), 100);
  for (const value of [0, 101, -10, 1.5]) assert.equal(couponRuleSchema.safeParse(rule({ discount: { type: "percent", value } })).success, false);
  assert.equal(couponRuleSchema.safeParse(rule({ conditions: [] })).success, false);
});

test("templates remain valid and contradictory visit conditions explain the invalid field", () => {
  for (const type of couponTemplateIds) {
    const preset = couponTemplate(type,"2026-11-10");
    assert.equal(couponRuleSchema.safeParse(preset).success,true);
    assert.deepEqual(couponRuleIssues(preset),[]);
  }
  const invalid = rule({schedule:{type:"after_visit"}});
  assert.equal(couponRuleIssues(invalid)[0].field,"schedule");
  assert.equal(couponRuleIssues(rule({conditions:[{type:"first_visit"},{type:"visit_count",comparison:"exact",count:5}]}))[0].field,"conditions");
  assert.equal(couponRuleIssues(rule({conditions:[{type:"visit_count",comparison:"exact",count:5},{type:"visit_count",comparison:"multiple",count:2}]}))[0].field,"conditions");
  assert.deepEqual(couponRuleIssues(rule({match:"any",conditions:[{type:"first_visit"},{type:"visit_count",count:5,comparison:"exact"}],schedule:{type:"after_visit"}})),[]);
});

test("first visit, birthday month, fifth visit and anniversary issue once from actual visits and local schedules", async () => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
    const now = Date.parse("2026-11-06T00:00:00Z");
    for (const [email, birthDate] of [["new@example.com", "1990-11-01"], ["return@example.com", "1990-11-30"], ["other@example.com", "1990-12-01"]])
      await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: email, birthDate, gender: "not_specified", createdAt: "2026-10-01T00:00:00Z" });
    for (let i = 0; i < 5; i++) await store.saveBooking(visit(shop.id, `visit-${i}`, "return@example.com", now - visitSettleMs - (5 - i) * hour));
    for (const status of ["cancelled", "no_show"] as const) await store.saveBooking({ ...visit(shop.id, status, "new@example.com", now - hour), status });
    await store.saveBooking(visit(shop.id, "future", "new@example.com", now + hour));
    const save = async (id: string, changes: Partial<CouponRule>) => {
      const c: CouponCampaign = { ...rule(changes), id, shopId: shop.id, enabled: true, currency: "JPY", createdAt: "2026-11-01T00:00:00Z", updatedAt: new Date(now).toISOString() };
      await store.put("couponCampaign", id, c); return c;
    };
    await save("first", {});
    await save("birthday", { conditions: [{ type: "birthday_month" }], schedule: { type: "monthly", day: 1, hour: 9 } });
    await save("fifth", { conditions: [{ type: "visit_count", count: 5, comparison: "exact" }], schedule: { type: "after_visit" }, discount: { type: "amount", value: 500 } });
    const anniversary = await save("anniversary", { conditions: [{ type: "everyone" }], schedule: { type: "once", date: "2026-11-06", hour: 9 } });
    await store.locked(bookingLockKey(shop.id), () => issueCoupons(store, shop, now - 1));
    assert.equal((await store.records("couponGrant", shop)).length, 5);
    await Promise.all([1, 2, 3].map(() => store.locked(bookingLockKey(shop.id), () => issueCoupons(store, shop, now))));
    const grants = await store.records<CouponGrant>("couponGrant", shop);
    assert.equal(grants.length, 8);
    assert.deepEqual(grants.filter(g => g.campaignId === "first").map(g => g.customer).sort(), ["new@example.com", "other@example.com"]);
    assert.deepEqual(grants.filter(g => g.campaignId === "fifth").map(g => g.customer), ["return@example.com"]);
    await store.put("couponCampaign", "anniversary", { ...anniversary, enabled: false, discount: { type: "percent", value: 80 } });
    assert.equal((await couponWallet(store, shop, "new@example.com", now)).find(g => g.campaignId === "anniversary")!.discount.value, 10);
    await store.put("couponCampaign", "anniversary", anniversary);
    await store.put("customer", `${shop.id}:late@example.com`, { shopId: shop.id, email: "late@example.com", name: "Late", birthDate: "1990-12-01", gender: "female", createdAt: new Date(now + 1).toISOString() });
    await issueCoupons(store, shop, now + hour);
    assert.ok(!(await couponWallet(store, shop, "late@example.com", now + hour)).some(g => g.campaignId === "anniversary"));
    assert.equal((await couponWallet(store, shop, "return@example.com", now + 31 * 86400000)).every(g => g.state === "expired"), true);
    assert.throws(() => validateCouponRule(rule({ discount: { type: "amount", value: 0.5 } }), shop));
  } finally { await store.close(); }
});

test("monthly dates clamp to month end in shop time and conditions combine with all/any", async () => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); shop.published.region = { country: "US", timeZone: "America/New_York" }; await store.saveShop(shop);
    await store.put("customer", "member", { shopId: shop.id, email: "member@example.com", name: "Member", birthDate: "1990-03-01", gender: "female" });
    for (const match of ["all", "any"] as const) await store.put("couponCampaign", match, { ...rule({ match, conditions: [{ type: "birthday_month" }, { type: "first_visit" }], schedule: { type: "monthly", day: 31, hour: 9 } }), id: match, shopId: shop.id, currency: "USD", enabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    const at = Date.parse("2026-02-28T09:00:00-05:00");
    await issueCoupons(store, shop, at - 1); assert.equal((await store.records("couponGrant", shop)).length, 0);
    await issueCoupons(store, shop, at); assert.deepEqual((await store.records<CouponGrant>("couponGrant", shop)).map(g => g.campaignId), ["any"]);
    await issueCoupons(store, shop, Date.parse("2026-03-31T09:00:00-04:00")); assert.equal((await store.records("couponGrant", shop)).length, 3);
  } finally { await store.close(); }
});

test("AI produces a validated reviewable proposal and can ask for an anniversary date", async () => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample);
  try {
    const proposal = await proposeCoupon(shop, "birthday 20% monthly", async input => {
      assert.ok(input.schema.properties); assert.match(JSON.stringify(input.contents), /JPY/);
      return JSON.stringify({ rule: rule({ conditions: [{ type: "birthday_month" }], discount: { type: "percent", value: 20 }, schedule: { type: "monthly", day: 1, hour: 9 } }), question: "" });
    });
    assert.equal(proposal.rule!.discount.value, 20);
    assert.deepEqual(await store.records("couponCampaign", shop), [], "a proposal cannot enable or issue a campaign");
    const clarification = await proposeCoupon(shop, "anniversary", async () => JSON.stringify({ rule: null, question: "Which date?" })); assert.equal(clarification.rule, null);
    await assert.rejects(proposeCoupon(shop, "bad rule", async () => JSON.stringify({ rule: rule({ discount: { type: "percent", value: 200 } }), question: "" })));
  } finally { await store.close(); }
});

test("a scheduled hour missing at the DST transition waits until the next valid local time",async()=>{
  const store=new Store(":memory:");
  try{
    const shop=await store.createShop("owner@example.com");shop.published=structuredClone(sample);shop.published.region={country:"US",timeZone:"America/New_York"};await store.saveShop(shop);
    await store.put("customer","member",{shopId:shop.id,email:"member@example.com",name:"Member",birthDate:"1990-01-01",gender:"female"});
    await store.put("couponCampaign","dst",{...rule({conditions:[{type:"everyone"}],schedule:{type:"once",date:"2026-03-08",hour:2}}),id:"dst",shopId:shop.id,currency:"USD",enabled:true,createdAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z"});
    await issueCoupons(store,shop,Date.parse("2026-03-08T01:59:59-05:00"));assert.equal((await store.records("couponGrant",shop)).length,0);
    await issueCoupons(store,shop,Date.parse("2026-03-08T03:00:00-04:00"));assert.equal((await store.records("couponGrant",shop)).length,1);
  }finally{await store.close();}
});

async function fixture(t: TestContext, paid = false) {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.published.hours.closedWeekdays = []; shop.published.rules.cancelHours = 0;
  shop.published.rules.payment = { enabled: paid, refundTiers: structuredClone(defaultRefundTiers) }; await store.saveShop(shop);
  for (const who of ["owner", "alice", "bob", "staff"]) {
    const email = `${who}@example.com`;
    await store.put("session", digest(who), { user: { email, name: who, role: who === "owner" || who === "staff" ? "owner" : "customer", shopId: shop.id }, expires: Date.now() + 600000 });
    if (["alice", "bob"].includes(who)) await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: who, birthDate: "1990-11-01", gender: "female" });
  }
  await store.put("member", "staff", { shopId: shop.id, email: "staff@example.com", accepted: true });
  const orders = new Map<string, PayPalOrder>(), calls = { create: 0, capture: 0, refund: 0 }, amounts: number[] = [];
  const gateway: PaymentGateway = {
    environment: "sandbox", async ready() {},
    async create(id, amount, _return, _cancel, currency = "JPY") { calls.create++; amounts.push(amount); const order: PayPalOrder = { id, status: "APPROVED", purchase_units: [{ custom_id: id, amount: { currency_code: currency, value: paypalValue(amount, currency) } }], links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] }; orders.set(id, order); return order; },
    async order(id) { return orders.get(id)!; }, async capture(id) { calls.capture++; const o = orders.get(id)!; o.purchase_units![0].payments = { captures: [{ id: `cap-${id}`, status: "COMPLETED", amount: o.purchase_units![0].amount! }] }; return o; },
    async refund(_capture, amount, id, currency = "JPY") { calls.refund++; amounts.push(-amount); return { id, status: "COMPLETED", amount: { currency_code: currency, value: paypalValue(amount, currency) } }; }, async refundStatus() { throw new Error("unexpected poll"); },
  };
  const server = createApp(store, undefined, undefined, undefined, gateway); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await store.close(); });
  const call = async (path: string, data?: unknown, who = "alice") => { const r = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Cookie: `gemihub_session=${who}`, Origin: origin, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: r.status, body: await r.json() }; };
  const base = `/api/public/${shop.slug}`, ownerBase = `/api/shops/${shop.id}/coupons`;
  const input = (days: number, couponId: string, price: number) => ({ name: "Alice", menuId: "simple", staffId: "aoi", start: slots(shop.published!, [], shopDate(shop.published!, Date.now() + days * 86400000), "simple", "aoi")[0].start, couponId, requestId: randomUUID(), expectedPrice: price, ...(paid ? { paymentConsent: { amount: price, policy: defaultRefundTiers } } : {}) });
  const calculate = () => call(`${ownerBase}/calculate`, {}, "owner");
  return { store, shop, call, base, ownerBase, input, calls, amounts, calculate };
}

test("HTTP owner controls, private wallet, server prices, concurrent reuse protection and zero-price booking", async t => {
  const f = await fixture(t);
  assert.equal((await f.call(f.ownerBase, undefined, "alice")).status, 403);
  assert.equal((await f.call(f.ownerBase, undefined, "staff")).status, 403);
  const invalid=await f.call(f.ownerBase,{requestId:randomUUID(),rule:rule({schedule:{type:"after_visit"}})},"owner");
  assert.equal(invalid.status,409);assert.match(invalid.body.error,/初回来店前/);
  assert.equal((await f.store.records("couponCampaign",f.shop)).length,0);
  const request = { requestId: randomUUID(), rule: rule() };
  assert.equal((await f.call(f.ownerBase, request, "owner")).status, 200);
  await f.call(f.ownerBase, request, "owner"); assert.equal((await f.store.records("couponCampaign", f.shop)).length, 1);
  await f.calculate();
  const alice = await f.call(`${f.base}/coupons`), bob = await f.call(`${f.base}/coupons`, undefined, "bob");
  assert.equal(alice.body.length, 1); assert.notEqual(alice.body[0].id, bob.body[0].id);
  assert.equal((await f.call(`${f.base}/bookings`, f.input(3, bob.body[0].id, 4950))).status, 409);
  assert.equal((await f.call(`${f.base}/bookings`, f.input(3, alice.body[0].id, 1))).status, 409);
  const first = f.input(3, alice.body[0].id, 4950), other = f.input(4, alice.body[0].id, 4950);
  const results = await Promise.all([f.call(`${f.base}/bookings`, first), f.call(`${f.base}/bookings`, other)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = results.find(r => r.status === 200)!.body.booking;
  assert.equal(saved.price, 4950); assert.equal(saved.coupon.discountAmount, 550);
  assert.equal((await f.call(`${f.base}/bookings`, results[0].status === 200 ? first : other)).body.booking.id, saved.id);
  await f.call(`${f.base}/bookings/${saved.id}/cancel`, {});
  assert.equal((await f.call(`${f.base}/coupons`)).body[0].state, "used", "confirmed bookings consume coupons even after cancellation");
  await f.call(f.ownerBase, { requestId: randomUUID(), rule: rule({ title: "Free", discount: { type: "percent", value: 100 } }) }, "owner");
  await f.calculate();
  const free = (await f.call(`${f.base}/coupons`)).body.find((g: CouponGrant) => g.title === "Free");
  assert.equal((await f.call(`${f.base}/bookings`, f.input(5, free.id, 0))).body.booking.price, 0);
  assert.equal(f.calls.create, 0);
});

test("PayPal reserves a coupon while pending, releases on abandonment, captures discounted money and refunds only money paid", async t => {
  const f = await fixture(t, true);
  await f.call(f.ownerBase, { requestId: randomUUID(), rule: rule({ discount: { type: "amount", value: 500 } }) }, "owner");
  await f.calculate();
  const grant = (await f.call(`${f.base}/coupons`)).body[0];
  const pending = await f.call(`${f.base}/bookings`, f.input(3, grant.id, 5000));
  assert.equal(pending.status, 200); assert.deepEqual(f.amounts, [5000]);
  assert.equal((await f.call(`${f.base}/coupons`)).body[0].state, "reserved");
  assert.equal((await f.call(`${f.base}/bookings`, f.input(4, grant.id, 5000))).status, 409);
  await f.call(`${f.base}/checkouts/${pending.body.checkout.id}/abandon`, {});
  assert.equal((await f.call(`${f.base}/coupons`)).body[0].state, "available");
  const retry = await f.call(`${f.base}/bookings`, f.input(4, grant.id, 5000));
  const id = retry.body.checkout.id;
  assert.equal((await f.call(`${f.base}/checkouts/${id}/capture`, {})).body.booking.price, 5000);
  assert.equal((await f.call(`${f.base}/coupons`)).body[0].state, "used");
  const cancelled = await f.call(`/api/shops/${f.shop.id}/bookings/${id}/status`, { status: "cancelled" }, "owner");
  assert.equal(cancelled.status, 200); assert.deepEqual(f.amounts, [5000, 5000, -5000]);
  assert.equal((await f.call(`${f.base}/coupons`)).body[0].state, "used");
});

test("manual grants are owner-only, scoped to selected members, retryable without duplication and usable in bookings", async t => {
  const f=await fixture(t);
  const payload={requestId:randomUUID(),title:"Manual gift",discount:{type:"amount",value:1000},validDays:7,customers:["alice@example.com","bob@example.com"]};
  assert.equal((await f.call(`${f.ownerBase}/manual`,payload,"alice")).status,403);
  assert.equal((await f.call(`${f.ownerBase}/manual`,payload,"staff")).status,403);
  assert.equal((await f.call(`${f.ownerBase}/manual`,{...payload,customers:["stranger@example.com"]},"owner")).status,409);
  assert.equal((await f.store.records("couponGrant",f.shop)).length,0);
  let failOnce=true;
  const put=f.store.put.bind(f.store);
  t.mock.method(f.store,"put",async(kind:string,id:string,value:unknown)=>{
    if(kind==="couponGrant"&&(value as CouponGrant).customer==="bob@example.com"&&failOnce){failOnce=false;throw new Error("Interrupted batch");}
    return put(kind,id,value);
  });
  await assert.rejects(grantManualCoupons(f.store,f.shop,f.shop.owner,payload));
  const first=(await f.store.records<CouponGrant>("couponGrant",f.shop))[0];
  assert.equal((await f.call(`${f.ownerBase}/manual`,payload,"owner")).body.count,2);
  assert.equal((await f.call(`${f.ownerBase}/manual`,payload,"owner")).status,200);
  assert.equal((await f.call(`${f.ownerBase}/manual`,{...payload,title:"Changed"},"owner")).status,409);
  assert.equal((await f.store.records("couponGrant",f.shop)).length,2);
  const own=(await f.call(`${f.base}/coupons`)).body;
  assert.equal(own.length,1);assert.equal(own[0].issuedAt,first.issuedAt);
  assert.equal((await f.call(`${f.base}/bookings`,f.input(3,own[0].id,4500))).body.booking.price,4500);
  const foreign=await f.store.createShop("foreign@example.com");foreign.published=structuredClone(sample);await f.store.saveShop(foreign);
  await assert.rejects(applyCoupon(f.store,foreign,"alice@example.com",5500,own[0].id));
});

test("scheduled issuance runs without a customer visit to the website, catches up and does not repeat on the next tick", async t=>{
  t.mock.timers.enable({apis:["setInterval"]});
  const f=await fixture(t);
  await f.call(f.ownerBase,{requestId:randomUUID(),rule:rule()},"owner");
  assert.equal((await f.store.records("couponGrant",f.shop)).length,0);
  const until=async()=>{for(let i=0;i<200;i++){if((await f.store.records("couponGrant",f.shop)).length===2)return;await new Promise(r=>setTimeout(r,10));}assert.fail("scheduler did not issue coupons");};
  t.mock.timers.tick(60000);await until();
  t.mock.timers.tick(60000);await new Promise(r=>setTimeout(r,30));
  assert.equal((await f.store.records("couponGrant",f.shop)).length,2);
});

test("after-visit coupons wait for no-shows and a late no-show cannot repeat a visit milestone", async () => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
    const now = Date.parse("2026-11-06T00:00:00Z"), counted = now - visitSettleMs;
    await store.put("customer", "member", { shopId: shop.id, email: "member@example.com", name: "Member", birthDate: "1990-01-01", gender: "female", createdAt: "2026-01-01T00:00:00Z" });
    await store.put("couponCampaign", "fifth", { ...rule({ conditions: [{ type: "visit_count", count: 5, comparison: "exact" }], schedule: { type: "after_visit" } }), id: "fifth", shopId: shop.id, currency: "JPY", enabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    for (let i = 0; i < 4; i++) await store.saveBooking(visit(shop.id, `visit-${i}`, "member@example.com", counted - (10 - i) * hour));
    await store.saveBooking(visit(shop.id, "fifth-visit", "member@example.com", counted + hour));
    await issueCoupons(store, shop, now); assert.equal((await store.records("couponGrant", shop)).length, 0, "the fifth visit is still open for a no-show");
    await store.saveBooking({ ...visit(shop.id, "fifth-visit", "member@example.com", counted + hour), status: "no_show" });
    await issueCoupons(store, shop, now + 2 * hour); assert.equal((await store.records("couponGrant", shop)).length, 0, "a recorded no-show is not a visit");
    await store.saveBooking(visit(shop.id, "real-fifth", "member@example.com", counted + 2 * hour));
    await issueCoupons(store, shop, now + 3 * hour); assert.equal((await store.records("couponGrant", shop)).length, 1);
    await store.saveBooking(visit(shop.id, "sixth", "member@example.com", counted + 3 * hour));
    await issueCoupons(store, shop, now + 4 * hour);
    await store.saveBooking({ ...visit(shop.id, "visit-0", "member@example.com", counted - 10 * hour), status: "no_show" });
    await issueCoupons(store, shop, now + 5 * hour); assert.equal((await store.records("couponGrant", shop)).length, 1, "renumbered visits do not pay the fifth visit twice");
  } finally { await store.close(); }
});

test("a first-visit coupon waits while an ended booking could still be a real visit", async () => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
    const now = Date.parse("2026-11-06T00:00:00Z");
    await store.put("customer", "member", { shopId: shop.id, email: "member@example.com", name: "Member", birthDate: "1990-01-01", gender: "female" });
    await store.put("couponCampaign", "first", { ...rule(), id: "first", shopId: shop.id, currency: "JPY", enabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    await store.saveBooking(visit(shop.id, "recent", "member@example.com", now - hour));
    await issueCoupons(store, shop, now); assert.equal((await store.records("couponGrant", shop)).length, 0);
  } finally { await store.close(); }
});

test("monthly campaigns start at their next date and skip members who joined after the distribution", async () => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
    await store.put("customer", "early", { shopId: shop.id, email: "early@example.com", name: "Early", birthDate: "1990-01-01", gender: "female", createdAt: "2026-01-01T00:00:00Z" });
    await store.put("customer", "late", { shopId: shop.id, email: "late@example.com", name: "Late", birthDate: "1990-01-01", gender: "female", createdAt: "2026-12-02T00:00:00Z" });
    await store.put("couponCampaign", "monthly", { ...rule({ conditions: [{ type: "everyone" }], schedule: { type: "monthly", day: 1, hour: 9 } }), id: "monthly", shopId: shop.id, currency: "JPY", enabled: true, createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z" });
    await issueCoupons(store, shop, Date.parse("2026-11-06T00:01:00Z")); assert.equal((await store.records("couponGrant", shop)).length, 0, "November's date passed before the campaign existed");
    await issueCoupons(store, shop, Date.parse("2026-12-03T00:00:00Z"));
    assert.deepEqual((await store.records<CouponGrant>("couponGrant", shop)).map(g => g.customer), ["early@example.com"]);
  } finally { await store.close(); }
});

test("resuming a paused campaign does not catch up on visits or dates inside the pause", async () => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
    await store.put("customer", "member", { shopId: shop.id, email: "member@example.com", name: "Member", birthDate: "1990-01-01", gender: "female", createdAt: "2026-01-01T00:00:00Z" });
    const base = { shopId: shop.id, currency: "JPY" as const, enabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    const paused = (c: CouponCampaign) => campaignEnabled(campaignEnabled(c, false, "2026-10-01T00:00:00Z"), true, "2026-11-01T00:00:00Z");
    const each = paused({ ...rule({ conditions: [{ type: "everyone" }], schedule: { type: "after_visit" } }), ...base, id: "each" });
    const once = paused({ ...rule({ conditions: [{ type: "everyone" }], schedule: { type: "once", date: "2026-10-15", hour: 9 } }), ...base, id: "once" });
    assert.equal(each.pausedAt, undefined); assert.deepEqual(campaignEnabled(each, true, "2026-11-02T00:00:00Z"), each, "a repeated resume adds no pause");
    await store.put("couponCampaign", "each", each); await store.put("couponCampaign", "once", once);
    await store.saveBooking(visit(shop.id, "before", "member@example.com", Date.parse("2026-09-20T00:00:00Z")));
    await store.saveBooking(visit(shop.id, "during", "member@example.com", Date.parse("2026-10-20T00:00:00Z")));
    await store.saveBooking(visit(shop.id, "after", "member@example.com", Date.parse("2026-11-02T00:00:00Z")));
    await issueCoupons(store, shop, Date.parse("2026-11-06T00:00:00Z"));
    const grants = await store.records<CouponGrant>("couponGrant", shop);
    assert.deepEqual(grants.map(g => g.campaignId), ["each", "each"], "the visits before and after the pause, and neither the paused visit nor the paused date");
  } finally { await store.close(); }
});

test("issuance reads records in bulk, limits each run and continues on the next", async t => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
    const count = issueLimit + 5, now = Date.parse("2026-11-06T00:00:00Z");
    for (let i = 0; i < count; i++) await store.put("customer", `member-${i}`, { shopId: shop.id, email: `member-${i}@example.com`, name: "Member", birthDate: "1990-01-01", gender: "female" });
    await store.put("couponCampaign", "all", { ...rule({ conditions: [{ type: "everyone" }] }), id: "all", shopId: shop.id, currency: "JPY", enabled: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    const get = t.mock.method(store, "get");
    await issueCoupons(store, shop, now); assert.equal((await store.records("couponGrant", shop)).length, issueLimit);
    await issueCoupons(store, shop, now); assert.equal((await store.records("couponGrant", shop)).length, count);
    const before = get.mock.callCount(); await issueCoupons(store, shop, now);
    assert.equal(get.mock.callCount() - before, 1, "a run with nothing to issue reads only the shop, rather than every grant");
    assert.equal((await store.records("couponGrant", shop)).length, count);
  } finally { await store.close(); }
});

test("a customer note before registration does not backdate membership", async t => {
  const f = await fixture(t), email = "bob@example.com", key = `${f.shop.id}:${email}`, noted = "2026-01-01T00:00:00Z";
  await f.store.put("customer", key, { shopId: f.shop.id, email, updatedAt: noted, updatedBy: "owner@example.com" });
  const saved = await f.call(`${f.base}/profile`, { name: "Bob", birthDate: "1990-11-01", gender: "male" }, "bob");
  assert.equal(saved.status, 200);
  assert.ok(Date.parse((await f.store.get<{ createdAt: string }>("customer", key))!.createdAt) > Date.parse(noted));
});
