import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { Store } from "../server/store.ts";
import { sample, dateJST, slots, type Booking } from "../server/domain.ts";
import { paypalValue } from "../shared/region.ts";
import { defaultRefundTiers, refundQuote } from "../server/payment-domain.ts";
import { transferTerms } from "../server/transfer-domain.ts";
import { paymentService, type Checkout } from "../server/payments.ts";
import { transferService, type Transfer } from "../server/transfers.ts";
import { couponWallet, applyCoupon, syncCouponUse } from "../server/coupons.ts";
import type { CouponGrant } from "../shared/coupons.ts";
import { PayPalError, type PaymentGateway, type PayPalOrder, type PayPalRefund } from "../server/paypal.ts";

process.env.DEMO_MODE = "true";
const hour = 3600000;
function fakePayPal() {
  const orders = new Map<string, PayPalOrder>();
  const refunds = new Map<string, PayPalRefund>();
  const calls = { create: 0, capture: 0, refund: 0 };
  const state = { lostCapture: false, lostRefund: false };
  const requests: { capture: string; amount: number; id: string }[] = [];
  const gateway: PaymentGateway = {
    environment: "sandbox", async ready() {},
    async create(id, amount, _return, _cancel, currency = "JPY") {
      calls.create++;
      const value: PayPalOrder = { id: `order-${id}`, status: "CREATED", purchase_units: [{ custom_id: id, amount: { currency_code: currency, value: paypalValue(amount, currency) } }], links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
      orders.set(value.id, value); return structuredClone(value);
    },
    async order(id) { return structuredClone(orders.get(id)!); },
    async capture(id) {
      calls.capture++;
      const o = orders.get(id)!;
      o.status = "COMPLETED";
      o.purchase_units![0].payments = { captures: [{ id: `capture-${id}`, status: "COMPLETED", amount: o.purchase_units![0].amount! }] };
      if (state.lostCapture) { state.lostCapture = false; throw new PayPalError(); }
      return structuredClone(o);
    },
    async refund(capture, amount, id, currency = "JPY") {
      calls.refund++; requests.push({ capture, amount, id });
      if (!refunds.has(id)) refunds.set(id, { id: `refund-${id}`, status: "COMPLETED", amount: { currency_code: currency, value: paypalValue(amount, currency) } });
      if (state.lostRefund) { state.lostRefund = false; throw new PayPalError(); }
      return structuredClone(refunds.get(id)!);
    },
    async refundStatus(id) { return structuredClone([...refunds.values()].find(r => r.id === id)!); },
  };
  /** Net amount the shop keeps across all captures and refunds, in minor units. */
  const net = () => [...orders.values()].flatMap(o => o.purchase_units![0].payments?.captures || []).reduce((sum, c) => sum + Number(c.amount.value), 0)
    - [...refunds.values()].reduce((sum, r) => sum + Number(r.amount!.value), 0);
  return { gateway, orders, refunds, calls, state, requests, net };
}
async function setup(hoursAhead: number) {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  const config = structuredClone(sample);
  config.hours = { start: "00:00", end: "23:30", closedWeekdays: [], holidays: [] };
  config.staff = config.staff.map(person => ({ ...person, start: "00:00", end: "23:30" }));
  config.rules.leadMinutes = 0;
  config.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
  shop.published = config; await store.saveShop(shop);
  const target = Date.now() + hoursAhead * hour;
  const all = [0, 1, 2].flatMap(day => slots(config, [], dateJST(new Date(target + (day - 1) * 86400000)), "simple"));
  const start = all.find(slot => Date.parse(slot.start) >= target)!;
  const requestKey = `${shop.id}:alice@example.com:${randomUUID()}`;
  const booking: Booking = { id: digest(requestKey), requestKey, shopId: shop.id, customer: "alice@example.com", name: "Alice", menuId: "simple", price: 5500, message: "Alice private consultation / phone 090-1234-5678", ...start, start: new Date(target).toISOString(), end: new Date(target + hour).toISOString(), status: "active", createdAt: new Date().toISOString() };
  const f = fakePayPal();
  const notices: string[] = [];
  const payments = paymentService(store, f.gateway);
  const transfers = transferService(store, f.gateway, payments, async (t, _b, event) => { notices.push(`${t.id}:${event}`); });
  let c = await payments.begin(booking, defaultRefundTiers, "https://s.invalid/r", "https://s.invalid/c");
  f.orders.get(c.orderId!)!.status = "APPROVED";
  c = await payments.capture(c, async () => true);
  return { store, shop, config, booking, f, payments, transfers, notices, checkout: async () => (await store.get<Checkout>("checkout", booking.id))! };
}
const approve = (f: ReturnType<typeof fakePayPal>, t: Transfer) => { f.orders.get(t.buyer!.orderId!)!.status = "APPROVED"; };

test("default policy uses 10%, 30%, 50% discounts with zone deadlines and safe custom-policy recovery", () => {
  const start = "2026-12-01T10:00:00.000Z";
  const at = (hours: number) => new Date(Date.parse(start) - hours * hour).toISOString();
  const payment = { amount: 5501, policy: defaultRefundTiers };
  assert.equal(transferTerms(payment, start, at(24)), undefined);
  assert.deepEqual(transferTerms(payment, start, at(23.9)), { refundPercent: 70, discountPercent: 10, price: 4950, basis: 5501, deadline: at(12), unsold: { percent: 70, amount: 3850 } });
  assert.equal(transferTerms(payment, start, at(12)), undefined, "settlement at the exact boundary still refunds 70%");
  assert.deepEqual(transferTerms(payment, start, at(11.9)), { refundPercent: 40, discountPercent: 30, price: 3850, basis: 5501, deadline: at(1), unsold: { percent: 40, amount: 2200 } });
  assert.equal(transferTerms(payment, start, at(1)), undefined, "settlement at the exact boundary still refunds 40%");
  const half = transferTerms(payment, start, at(0.9))!;
  assert.equal(half.discountPercent, 50); assert.equal(half.price, 2750);
  assert.equal(half.deadline, at(1 / 6)); assert.deepEqual(half.unsold, { percent: 0, amount: 0 });
  assert.equal(transferTerms(payment, start, at(1 / 6)), undefined);
  const custom = [{ hoursBefore: 72, percent: 100 }, { hoursBefore: 48, percent: 30 }, { hoursBefore: 12, percent: 30 }, { hoursBefore: 0, percent: 0 }];
  const merged = transferTerms({ amount: 1000, policy: custom }, start, at(60))!;
  assert.equal(merged.deadline, at(12)); assert.equal(merged.price, 500); assert.deepEqual(merged.unsold, { percent: 30, amount: 300 });
  for (let rate = 0; rate <= 100; rate++) {
    const terms = transferTerms({ amount: 10000, policy: [{ hoursBefore: 0, percent: rate }] }, start, at(6));
    if (rate > 70) { assert.equal(terms, undefined); continue; }
    assert.ok(terms); assert.ok(100 - terms.discountPercent >= rate + 20);
    assert.ok(terms.price <= 10000); assert.ok(terms.price >= terms.unsold.amount);
  }
  // Saved old policies remain unchanged and select a safe fixed discount.
  const legacy = [{ hoursBefore: 48, percent: 100 }, { hoursBefore: 24, percent: 50 }, { hoursBefore: 0, percent: 0 }];
  const snapshot = structuredClone(legacy);
  assert.equal(transferTerms({ amount: 5500, policy: legacy }, start, at(30))!.price, 3850);
  assert.deepEqual(legacy, snapshot);
});

test("a sale charges the transferee, refunds the same amount to the holder and hands over the booking; the shop total is unchanged", async () => {
  const { store, shop, f, transfers, payments, notices, checkout, booking } = await setup(18);
  const before = f.net();
  const quote = (await transfers.quote(await checkout())).terms!;
  assert.equal(quote.price, 4950);
  await assert.rejects(transfers.list(await checkout(), "alice@example.com", { price: 4000, deadline: quote.deadline }), /条件が変わりました/);
  const t = await transfers.list(await checkout(), "alice@example.com", quote);
  await assert.rejects(transfers.list(await checkout(), "alice@example.com", quote), /すでにキャンセル/, "one active listing per booking");
  await assert.rejects(transfers.begin(t, { customer: "alice@example.com", name: "Alice", requestKey: "a" }, "https://r", "https://c"), /ご自身/);
  await transfers.begin(t, { customer: "bob@example.com", name: "Bob", requestKey: "b1" }, "https://r", "https://c");
  await assert.rejects(transfers.begin(t, { customer: "carol@example.com", name: "Carol", requestKey: "c1" }, "https://r", "https://c"), /お支払い手続き中/, "one checkout per listing");
  await assert.rejects(transfers.withdraw(t), /取り消せません/);
  await assert.rejects(transfers.release(shop.id, booking.id), /決済が進行中/, "cancellation is refused while the transferee pays");
  approve(f, t);
  await transfers.capture(t);
  assert.equal(t.phase, "sold");
  const c = await checkout();
  assert.equal(c.customer, "bob@example.com"); assert.equal(c.booking.customer, "bob@example.com"); assert.equal(c.booking.name, "Bob");
  assert.equal(c.booking.payment!.amount, 4950); assert.deepEqual(c.booking.payment!.policy, defaultRefundTiers);
  assert.equal(c.booking.transfers!.length, 1); assert.equal(c.booking.transfers![0].refund.status, "completed");
  assert.equal(c.booking.message, "", "the previous holder's message is not inherited");
  assert.equal(c.booking.transfers![0].from.message, booking.message, "operators keep the previous holder's message in transfer history");
  assert.equal(f.requests[0].capture, `capture-order-${booking.id}`); assert.equal(f.requests[0].amount, 4950);
  assert.equal(f.net(), before, "new capture and same-amount refund cancel out");
  assert.equal((await store.bookings(shop.id))[0].customer, "bob@example.com");
  assert.deepEqual(notices, [`${t.id}:listed`, `${t.id}:sold`]);
  // Retries never charge or refund twice.
  await transfers.capture(t); await transfers.reconcile(shop.id); await payments.reconcile(shop.id);
  assert.equal(f.calls.capture, 2); assert.equal(f.calls.refund, 1);
  // The transferee's own cancellation refunds against what they paid, by the inherited policy.
  const at = new Date(Date.parse(booking.start) - 18 * hour).toISOString();
  const cancelled = await payments.cancel(await checkout(), "bob@example.com", "customer", at);
  assert.equal(cancelled.payment!.cancellation!.amount, 3465);
  assert.equal(f.requests[1].capture, `capture-order-${(await store.get<Transfer>("transfer", t.id))!.buyer!.id}`);
});

test("a shop cancellation after a transfer refunds exactly what the transferee paid, from the transferee's capture", async () => {
  const { f, transfers, payments, checkout, booking } = await setup(18);
  const t = await transfers.list(await checkout(), "alice@example.com", (await transfers.quote(await checkout())).terms!);
  await transfers.begin(t, { customer: "bob@example.com", name: "Bob", requestKey: "b" }, "https://r", "https://c");
  approve(f, t); await transfers.capture(t);
  const cancelled = await payments.cancel(await checkout(), "owner@example.com", "shop");
  assert.equal(cancelled.payment!.cancellation!.percent, 100);
  assert.equal(cancelled.payment!.cancellation!.amount, 4950, "not the original 5,500");
  assert.deepEqual(f.requests.map(r => [r.capture, r.amount]), [[`capture-order-${booking.id}`, 4950], [`capture-order-${t.buyer!.id}`, 4950]]);
  // Bob gets back all 4,950 he paid; the 550 Alice gave up by transferring is not returned, as specified.
  assert.equal(f.net(), 550);
});

test("replacement booking completion returns the seller's coupon without passing it to the buyer or disturbing its later use",async()=>{
  const {store,shop,f,transfers,payments,checkout,booking}=await setup(18);
  try{
    const grant:CouponGrant={id:"c".repeat(64),shopId:shop.id,campaignId:"gift",customer:"alice@example.com",title:"Gift",discount:{type:"amount",value:500},currency:"JPY",issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*86400000).toISOString()};
    await store.put("couponGrant",grant.id,grant);
    const c=await checkout();c.booking.coupon={grantId:grant.id,campaignId:grant.campaignId,title:grant.title,originalPrice:6000,discountAmount:500,currency:"JPY"};await payments.sync(c);
    const first=await transfers.list(await checkout(),grant.customer,(await transfers.quote(await checkout())).terms!);
    assert.equal((await couponWallet(store,shop,grant.customer))[0].state,"used","a pending cancellation listing does not return the coupon");
    await transfers.withdraw(first);assert.equal((await couponWallet(store,shop,grant.customer))[0].state,"used");
    const listing=await transfers.list(await checkout(),grant.customer,(await transfers.quote(await checkout())).terms!);
    await transfers.begin(listing,{customer:"bob@example.com",name:"Bob",requestKey:"coupon-buyer"},"https://r","https://c");approve(f,listing);await transfers.capture(listing);
    assert.equal((await couponWallet(store,shop,grant.customer))[0].state,"available");
    assert.equal((await checkout()).booking.coupon,undefined);assert.deepEqual(await couponWallet(store,shop,"bob@example.com"),[]);
    const quoted=await applyCoupon(store,shop,grant.customer,5500,grant.id),next:Booking={...booking,id:randomUUID(),...quoted};
    await store.transaction(async()=>{await store.saveBooking(next);await syncCouponUse(store,next);});
    await transfers.capture(listing);await transfers.reconcile(shop.id);await payments.reconcile(shop.id);
    await payments.cancel(await checkout(),"bob@example.com","customer");
    assert.equal((await couponWallet(store,shop,grant.customer))[0].state,"used","the buyer's later cancellation does not release the seller's later booking");
  }finally{await store.close();}
});

test("repeated transfers never pay anyone more than they paid", async () => {
  const { f, transfers, checkout } = await setup(18);
  const people = ["alice", "bob", "carol", "dave"];
  for (let i = 1; i < people.length; i++) {
    const c = await checkout();
    const terms = (await transfers.quote(c)).terms!;
    assert.ok(terms.price <= c.booking.payment!.amount);
    const t = await transfers.list(c, `${people[i - 1]}@example.com`, terms);
    await transfers.begin(t, { customer: `${people[i]}@example.com`, name: people[i], requestKey: people[i] }, "https://r", "https://c");
    approve(f, t); await transfers.capture(t);
  }
  const final = await checkout();
  assert.equal(final.booking.customer, "dave@example.com");
  assert.deepEqual(final.booking.transfers!.map(entry => [entry.previous.amount, entry.price]), [[5500, 4950], [4950, 4455], [4455, 4009]]);
  for (const entry of final.booking.transfers!) assert.ok(entry.refund.amount <= entry.previous.amount);
});

test("unsold offers settle at the original 70%, 40% or 0% refund at their deadline", async () => {
  for (const [hours, percent, amount] of [[18, 70, 3850], [6, 40, 2200], [0.5, 0, 0]] as const) {
    const { store, shop, transfers, checkout, notices } = await setup(hours);
    const t = await transfers.list(await checkout(), "alice@example.com", (await transfers.quote(await checkout())).terms!);
    assert.deepEqual(t.unsold, { percent, amount });
    await transfers.reconcile(shop.id);
    assert.equal((await checkout()).booking.status, "active", "nothing settles before the deadline");
    t.deadline = new Date(Date.now() - 1000).toISOString(); // The deadline passed while nobody was paying.
    await store.put("transfer", t.id, t);
    await transfers.reconcile(shop.id);
    const c = await checkout();
    assert.equal(c.booking.status, "cancelled");
    assert.equal(c.booking.payment!.cancellation!.percent, percent);
    assert.equal(c.booking.payment!.cancellation!.amount, amount);
    assert.equal(c.booking.payment!.cancellation!.at, t.deadline);
    assert.equal((await store.get<Transfer>("transfer", t.id))!.phase, "expired");
    assert.ok(notices.includes(`${t.id}:expired`));
    await assert.rejects(transfers.list(await checkout(), "alice@example.com", { price: t.price, deadline: t.deadline }), /処理済み/, "a settled request cannot be relisted in the next zone");
  }
});

test("a checkout started before the deadline is not cut off; an expired hold then settles", async () => {
  const { store, shop, f, transfers, checkout } = await setup(18);
  let t = await transfers.list(await checkout(), "alice@example.com", (await transfers.quote(await checkout())).terms!);
  await transfers.begin(t, { customer: "bob@example.com", name: "Bob", requestKey: "b" }, "https://r", "https://c");
  t.deadline = new Date(Date.now() - 1000).toISOString(); await store.put("transfer", t.id, t);
  await transfers.reconcile(shop.id);
  assert.equal((await checkout()).booking.status, "active");
  t = (await store.get<Transfer>("transfer", t.id))!;
  approve(f, t); await transfers.capture(t);
  assert.equal(t.phase, "sold"); assert.equal((await checkout()).booking.customer, "bob@example.com");

  const second = await setup(18);
  let u = await second.transfers.list(await second.checkout(), "alice@example.com", (await second.transfers.quote(await second.checkout())).terms!);
  await second.transfers.begin(u, { customer: "bob@example.com", name: "Bob", requestKey: "b" }, "https://r", "https://c");
  u.deadline = new Date(Date.now() - 1000).toISOString(); u.buyer!.expires = Date.now() - 1; await second.store.put("transfer", u.id, u);
  await second.transfers.reconcile(second.shop.id);
  u = (await second.store.get<Transfer>("transfer", u.id))!;
  assert.equal(u.phase, "expired"); assert.equal(u.buyer!.phase, "expired");
  assert.equal((await second.checkout()).booking.payment!.cancellation!.percent, 70);
  assert.equal(second.f.calls.capture, 1, "the abandoned buyer was never charged");
});

test("withdrawing returns the booking to normal and a new listing can follow", async () => {
  const { transfers, checkout, f } = await setup(18);
  const t = await transfers.list(await checkout(), "alice@example.com", (await transfers.quote(await checkout())).terms!);
  await transfers.begin(t, { customer: "bob@example.com", name: "Bob", requestKey: "b" }, "https://r", "https://c");
  t.buyer!.expires = Date.now() - 1; // An abandoned checkout no longer blocks withdrawal.
  await transfers.withdraw(t);
  assert.equal(t.phase, "withdrawn");
  const c = await checkout();
  assert.equal(c.booking.status, "active"); assert.equal(c.booking.customer, "alice@example.com");
  approve(f, t); await assert.rejects(transfers.capture(t), /期限/);
  assert.equal(f.calls.capture, 1);
  assert.ok((await transfers.quote(await checkout())).terms);
});

test("lost capture and lost refund responses recover through the reconciler without double charge or refund", async () => {
  const { store, shop, f, transfers, payments, checkout, booking } = await setup(18);
  let t = await transfers.list(await checkout(), "alice@example.com", (await transfers.quote(await checkout())).terms!);
  await transfers.begin(t, { customer: "bob@example.com", name: "Bob", requestKey: "b" }, "https://r", "https://c");
  approve(f, t);
  f.state.lostCapture = true;
  await assert.rejects(transfers.capture(t), PayPalError);
  t = (await store.get<Transfer>("transfer", t.id))!;
  assert.equal(t.buyer!.phase, "capturing"); assert.equal(t.phase, "listed");
  assert.equal((await checkout()).booking.customer, "alice@example.com");
  f.state.lostRefund = true;
  await transfers.reconcile(shop.id);
  let c = await checkout();
  assert.equal(c.booking.customer, "bob@example.com");
  // The lost refund response is retried with the same request ID in the same reconcile pass.
  assert.equal(c.booking.transfers![0].refund.status, "completed");
  await transfers.reconcile(shop.id); await payments.reconcile(shop.id); await transfers.reconcile(shop.id);
  c = await checkout();
  assert.equal(c.booking.transfers![0].refund.status, "completed");
  assert.equal(f.refunds.size, 1, "one refund despite retries");
  assert.deepEqual(f.requests[0], f.requests[1], "the retry reuses the refund request ID");
  assert.equal(f.calls.capture, 2, "the reconciler finds the lost capture on the order instead of capturing again");
  assert.equal((await store.bookings(shop.id)).find(b => b.id === booking.id)!.payment!.amount, 4950);
});

test("HTTP: listing, browsing, buying and privacy; non-transferable menus and cancellation", async t => {
  const { store, shop, config, f, booking } = await setup(18);
  const server = createApp(store, undefined, undefined, undefined, f.gateway);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  for (const id of ["alice", "bob", "carol"]) {
    const email = `${id}@example.com`;
    await store.put("session", digest(`t-${id}`), { user: { email, name: id, role: "customer", shopId: shop.id }, expires: Date.now() + 600000 });
    await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: id, birthDate: "1990-01-01", gender: "not_specified" });
  }
  async function request(path: string, id = "alice", data?: unknown) {
    const res = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=t-${id}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  }
  const base = `/api/public/${shop.slug}`;
  const original = (await request(`${base}/bookings`)).body[0];
  assert.equal(original.requestKey, undefined, "internal request keys are never sent to customers");
  assert.equal(original.message, booking.message, "holders can still read their own booking message");
  assert.equal((await request(`${base}/bookings/${booking.id}/transfer-quote`, "bob")).status, 404);
  config.menus[0].transferable = false; shop.published = config; await store.saveShop(shop);
  assert.equal((await request(`${base}/bookings/${booking.id}/transfer-quote`)).status, 409);
  delete config.menus[0].transferable; shop.published = config; await store.saveShop(shop);
  const quote = (await request(`${base}/bookings/${booking.id}/transfer-quote`)).body;
  assert.equal(quote.eligible, true); assert.equal(quote.price, 4950); assert.equal(quote.discountPercent, 10);
  const cancelQuote = (await request(`${base}/bookings/${booking.id}/cancel-quote`)).body;
  assert.equal(cancelQuote.amount, 3850); assert.equal(cancelQuote.transfer.price, 4950);
  assert.equal((await request(`${base}/bookings/${booking.id}/cancel`, "alice", { expectedRefund: cancelQuote.amount })).status, 409, "the increased refund and deadline must be confirmed");
  const listed = await request(`${base}/bookings/${booking.id}/cancel`, "alice", { expectedRefund: cancelQuote.amount, expectedTransfer: cancelQuote.transfer });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.cancellationPending, true);
  assert.equal(listed.body.booking.payment.cancellation, undefined);
  const id = (await request(`${base}/transfers/mine`)).body.selling[0].id;
  assert.equal((await request(`${base}/bookings/${booking.id}/cancel`, "alice", { expectedRefund: cancelQuote.amount, expectedTransfer: cancelQuote.transfer })).body.cancellationPending, true);
  assert.equal((await request(`${base}/transfers/mine`)).body.selling.length, 1, "retries create only one cancellation request");
  const offers = (await request(`${base}/transfers`, "bob")).body;
  assert.equal(offers.length, 1); assert.equal(offers[0].amount, 4950); assert.equal(offers[0].mine, false);
  assert.ok(!JSON.stringify(offers).includes("alice"), "listings never reveal the holder");
  assert.equal((await request(`${base}/transfers/mine`)).body.selling[0].phase, "listed");
  const consent = { amount: 4950, policy: defaultRefundTiers };
  assert.equal((await request(`${base}/transfers/${id}/checkout`, "bob", { name: "Bob", requestId: randomUUID(), consent: { ...consent, amount: 4000 } })).status, 409);
  const requestId = randomUUID();
  const started = await request(`${base}/transfers/${id}/checkout`, "bob", { name: "Bob", requestId, consent });
  assert.equal(started.status, 200); assert.equal(started.body.checkout.phase, "awaiting_approval");
  assert.equal((await request(`${base}/transfers/${id}/checkout`, "bob", { name: "Bob", requestId, consent })).body.checkout.id, id);
  assert.equal(f.calls.create, 2, "the same request resumes the same order");
  assert.equal((await request(`${base}/transfers/${id}/checkout`, "carol", { name: "Carol", requestId: randomUUID(), consent })).status, 409);
  assert.equal((await request(`${base}/transfers/${id}/withdraw`, "alice", {})).status, 409);
  assert.equal((await request(`${base}/bookings/${booking.id}/cancel`, "alice", { expectedRefund: 3850 })).body.cancellationPending, true, "repeating the request never cancels or refunds while someone pays");
  assert.equal((await request(`${base}/transfers/${id}/capture`, "carol", {})).status, 404);
  f.orders.get((await store.get<Transfer>("transfer", id))!.buyer!.orderId!)!.status = "APPROVED";
  const done = await request(`${base}/transfers/${id}/capture`, "bob", {});
  assert.equal(done.body.ok, true); assert.equal(done.body.booking.customer, "bob@example.com");
  assert.equal(done.body.booking.transferredIn, true); assert.equal(done.body.booking.transfers, undefined);
  assert.equal(done.body.booking.requestKey, undefined);
  assert.equal(done.body.booking.message, "");
  assert.ok(!JSON.stringify(done.body).includes("alice"));
  const mine = (await request(`${base}/bookings`, "bob")).body;
  assert.equal(mine.length, 1); assert.ok(!JSON.stringify(mine).includes("alice"), "the transferee never sees the previous holder");
  assert.equal((await request(`${base}/bookings`, "alice")).body.length, 0);
  assert.equal((await request(`${base}/transfers/mine`)).body.selling[0].refund.status, "completed");
  assert.equal((await request(`${base}/transfers`, "carol")).body.length, 0);
  // Bob's cancellation automatically waits for another reservation, and can be undone.
  const again = (await request(`${base}/bookings/${booking.id}/transfer-quote`, "bob")).body;
  assert.equal(again.price, 4455);
  const refund = (await request(`${base}/bookings/${booking.id}/cancel-quote`, "bob")).body;
  assert.equal(refund.amount, 3465);
  assert.equal((await request(`${base}/bookings/${booking.id}/cancel`, "bob", { expectedRefund: 3465, expectedTransfer: refund.transfer })).body.cancellationPending, true);
  const pending = (await request(`${base}/transfers/mine`, "bob")).body.selling[0];
  assert.equal((await request(`${base}/transfers/${pending.id}/withdraw`, "bob", {})).status, 200);
  assert.equal((await request(`${base}/bookings`, "bob")).body[0].status, "active");
  assert.equal((await request(`${base}/transfers/mine`, "bob")).body.selling[0].phase, "withdrawn");
  const operatorView = (await store.bookings(shop.id))[0];
  assert.equal(operatorView.transfers![0].from.customer, "alice@example.com", "operators keep the full transfer record");
  assert.equal(operatorView.transfers![0].from.message, booking.message);
  assert.match((await store.shop(shop.id))!.history.at(-1)!.summary, /Alice 様 → Bob 様/);
});

test("reconciliation retries a failed sold event and commits its acknowledgement with side effects", async () => {
  const { store, shop, f, payments, checkout } = await setup(18);
  const notices: string[] = [];
  const transfers = transferService(store, f.gateway, payments, async (_t, _b, event) => {
    notices.push(event);
    await store.put("transferTestNotice", event, { event });
  });
  const listing = await transfers.list(await checkout(), "alice@example.com", (await transfers.quote(await checkout())).terms!);
  await transfers.begin(listing, { customer: "bob@example.com", name: "Bob", requestKey: "b" }, "https://r", "https://c");
  approve(f, listing);
  const put = store.put.bind(store);
  let failOnce = true;
  store.put = async (kind, id, value) => {
    if (kind === "transfer" && (value as Transfer).notified?.sold && failOnce) {
      failOnce = false;
      throw new Error("temporary event commit failure");
    }
    return put(kind, id, value);
  };
  await assert.rejects(transfers.capture(listing), /temporary event commit failure/);
  const sold = (await store.get<Transfer>("transfer", listing.id))!;
  assert.equal(sold.phase, "sold");
  assert.equal(sold.notified?.sold, undefined);
  assert.equal((await checkout()).booking.transfers![0].refund.status, "completed");
  assert.equal(await store.get("transferTestNotice", "sold"), undefined, "failed acknowledgement rolls back event effects too");
  // A new service instance recovers the persisted sale without the buyer retrying capture.
  const restarted = transferService(store, f.gateway, payments, async (_t, _b, event) => {
    notices.push(event);
    await store.put("transferTestNotice", event, { event });
  });
  await restarted.reconcile(shop.id);
  assert.deepEqual(await store.get("transferTestNotice", "sold"), { event: "sold" });
  assert.equal((await store.get<Transfer>("transfer", listing.id))!.notified?.sold, true);
  await restarted.reconcile(shop.id); await transfers.capture((await store.get<Transfer>("transfer", listing.id))!);
  assert.deepEqual(notices, ["listed", "sold", "sold"], "a committed event is not delivered again");
  assert.equal(f.calls.capture, 2); assert.equal(f.calls.refund, 1);
  await store.close();
});

test("HTTP: cancellation uses normal refunds when ineligible and settles a zero-refund request without charging twice", async t => {
  for (const mode of ["full-refund", "disabled-menu", "too-late", "zero-refund"] as const) await t.test(mode, async t => {
    const { store, shop, config, f, booking, checkout } = await setup(mode === "full-refund" ? 60 : mode === "zero-refund" ? 0.5 : 18);
    if (mode === "disabled-menu") { config.menus[0].transferable = false; shop.published = config; await store.saveShop(shop); }
    if (mode === "too-late") {
      const c = await checkout(); c.booking.start = new Date(Date.now() + 5 * 60000).toISOString();
      c.booking.end = new Date(Date.now() + 65 * 60000).toISOString(); await store.put("checkout", c.id, c);
    }
    const server = createApp(store, undefined, undefined, undefined, f.gateway);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
    t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
    for (const id of ["alice", "owner"]) await store.put("session", digest(`cancel-${id}`), { user: { email: `${id}@example.com`, name: id, role: id === "owner" ? "owner" : "customer", shopId: shop.id }, expires: Date.now() + 600000 });
    async function request(path: string, data?: unknown, id = "alice") {
      const res = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=cancel-${id}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
      return { status: res.status, body: await res.json() };
    }
    const base = `/api/public/${shop.slug}`;
    const path = `${base}/bookings/${booking.id}`;
    const quote = (await request(`${path}/cancel-quote`)).body;
    const data = { expectedRefund: quote.amount, expectedTransfer: quote.transfer };
    if (mode !== "zero-refund") {
      assert.equal(quote.transfer, undefined);
      assert.equal((await request(`${path}/cancel`, { ...data, expectedTransfer: { price: 4950, deadline: new Date(Date.now() + 10000).toISOString() } })).status, 409, "stale waiting terms never silently become an immediate cancellation");
      const cancelled = await request(`${path}/cancel`, data);
      assert.equal(cancelled.status, 200); assert.equal(cancelled.body.cancellationPending, undefined);
      assert.equal(cancelled.body.booking.status, "cancelled");
      assert.equal(cancelled.body.booking.payment.cancellation.amount, quote.amount);
      assert.equal((await request(`${base}/transfers/mine`)).body.selling.length, 0);
    } else {
      assert.equal(quote.amount, 0); assert.equal(quote.transfer.price, 2750);
      assert.equal((await request(`${path}/cancel`, { ...data, expectedTransfer: { ...quote.transfer, price: 1 } })).status, 409);
      assert.equal((await request(`${path}/cancel`, data)).body.cancellationPending, true);
      const offer = (await store.list<Transfer>("transfer"))[0];
      assert.equal(f.calls.refund, 0);
      offer.deadline = new Date(Date.now() - 1000).toISOString(); await store.put("transfer", offer.id, offer);
      assert.equal((await request(`${base}/transfers/${offer.id}/withdraw`, {})).status, 409, "cancellation cannot be undone after the acceptance deadline");
      assert.equal((await request(`/api/shops/${shop.id}/retry`, {}, "owner")).status, 200);
      const c = await checkout();
      assert.equal(c.booking.status, "cancelled"); assert.equal(c.booking.payment!.cancellation!.amount, 0);
      assert.equal((await store.get<Transfer>("transfer", offer.id))!.phase, "expired");
      assert.equal((await request(`${path}/cancel`, data)).status, 200, "retry only checks the saved settlement");
      assert.equal(f.calls.refund, 0); assert.equal(f.calls.capture, 1);
    }
  });
});

test("HTTP: a failed sale notice and shop history recover once, addressed to that sale's buyer after retransfer", async t => {
  const { store, shop, f, transfers, checkout } = await setup(18);
  // Queue actual mail/export jobs, with no OAuth token so the test cannot send them.
  shop.google = { folderId: "test-folder", specId: "test-spec", historyId: "test-history" };
  await store.saveShop(shop);
  const listing = await transfers.list(await checkout(), "alice@example.com", (await transfers.quote(await checkout())).terms!);
  await transfers.begin(listing, { customer: "bob@example.com", name: "Bob", requestKey: "b" }, "https://r", "https://c");
  approve(f, listing);
  const server = createApp(store, undefined, undefined, undefined, f.gateway);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  for (const id of ["bob", "owner"]) {
    await store.put("session", digest(`recovery-${id}`), { user: { email: `${id}@example.com`, name: id, role: id === "owner" ? "owner" : "customer", shopId: shop.id }, expires: Date.now() + 600000 });
  }
  const post = (path: string, id: string) => fetch(origin + path, { method: "POST", headers: { Origin: origin, Cookie: `gemihub_session=recovery-${id}`, "Content-Type": "application/json", "X-Gemihub-Language": "ja" }, body: "{}" });
  const noticeKey = `transfer:${listing.id}:sold`;
  const put = store.put.bind(store);
  let failOnce = true;
  store.put = async (kind, id, value) => {
    if (kind === "paymentNotice" && id === noticeKey && failOnce) {
      failOnce = false;
      throw new Error("temporary notice transaction failure");
    }
    return put(kind, id, value);
  };
  const failed = await post(`/api/public/${shop.slug}/transfers/${listing.id}/capture`, "bob");
  assert.equal(failed.status, 500);
  assert.equal((await checkout()).booking.customer, "bob@example.com");
  assert.equal((await checkout()).booking.transfers![0].refund.status, "completed");
  assert.equal(await store.get("paymentNotice", noticeKey), undefined);
  assert.equal((await store.shop(shop.id))!.history.length, 0, "failed notice rolls back shop history");
  // Before the next background pass, Bob transfers the reservation to Carol.
  const again = await transfers.list(await checkout(), "bob@example.com", (await transfers.quote(await checkout())).terms!);
  await transfers.begin(again, { customer: "carol@example.com", name: "Carol", requestKey: "c" }, "https://r", "https://c");
  approve(f, again); await transfers.capture(again);
  assert.equal((await checkout()).booking.customer, "carol@example.com");
  assert.equal((await post(`/api/shops/${shop.id}/retry`, "owner")).status, 200);
  const history = (await store.shop(shop.id))!.history;
  assert.equal(history.length, 1);
  assert.match(history[0].summary, /Alice 様 → Bob 様/);
  const jobs = await store.list<{ type: string; subject?: string; to?: string; body?: string }>("job");
  const buyerNotices = jobs.filter(job => job.subject?.includes("ご予約を承りました（お得な空き枠）"));
  assert.equal(buyerNotices.length, 1);
  assert.equal(buyerNotices[0].to, "bob@example.com");
  assert.match(buyerNotices[0].body!, /Bob 様/);
  assert.ok(!buyerNotices[0].body!.includes("Alice private consultation"));
  const shopNotice = jobs.find(job => job.subject?.includes("代わりの予約が入りました") && job.to === shop.published!.notificationEmail)!;
  assert.match(shopNotice.body!, /Alice 様 → Bob 様/);
  assert.equal(jobs.filter(job => job.type === "posts").length, 1);
  assert.ok(await store.get("paymentNotice", noticeKey));
  assert.equal((await post(`/api/shops/${shop.id}/retry`, "owner")).status, 200);
  assert.equal((await store.shop(shop.id))!.history.length, 1);
  assert.equal((await store.list("job")).length, jobs.length, "retries do not enqueue duplicate mail or history exports");
  assert.equal(f.calls.capture, 3); assert.equal(f.calls.refund, 2);
});
