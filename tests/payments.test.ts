import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { Store } from "../server/store.ts";
import { sample, dateJST, slots, type Booking } from "../server/domain.ts";
import { paypalValue } from "../shared/region.ts";
import { defaultRefundTiers, refundQuote, refundTiersSchema } from "../server/payment-domain.ts";
import { paymentService, paymentHolds, type Checkout } from "../server/payments.ts";
import { paypalGateway, approvalUrl, PayPalError, type PaymentGateway, type PayPalOrder, type PayPalRefund } from "../server/paypal.ts";
import { availableSlots, calendarGateway } from "../server/calendar.ts";
import { createPreviewClient, sampleFixtures } from "../src/local-preview.ts";

process.env.DEMO_MODE = "true";
function fakePayPal() {
  const orders = new Map<string, PayPalOrder>();
  const refunds = new Map<string, PayPalRefund>();
  const calls = { create: 0, capture: 0, refund: 0 };
  const state = { lostCapture: false, lostRefund: false, pending: false, refundDenied: false, refundInsufficient: false, capturePending: false };
  const requests: { amount: number; id: string }[] = [];
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
      o.purchase_units![0].payments = { captures: [{ id: `capture-${id}`, status: state.capturePending ? "PENDING" : "COMPLETED", amount: o.purchase_units![0].amount! }] };
      if (state.lostCapture) { state.lostCapture = false; throw new PayPalError(); }
      return structuredClone(o);
    },
    async refund(_capture, amount, id, currency = "JPY") {
      calls.refund++; requests.push({ amount, id });
      if (state.refundDenied) throw new PayPalError(true);
      if (state.refundInsufficient) throw new PayPalError(true, "REFUND_FAILED_INSUFFICIENT_FUNDS");
      if (!refunds.has(id)) refunds.set(id, { id: `refund-${id}`, status: state.pending ? "PENDING" : "COMPLETED", amount: { currency_code: currency, value: paypalValue(amount, currency) } });
      if (state.lostRefund) { state.lostRefund = false; throw new PayPalError(); }
      return structuredClone(refunds.get(id)!);
    },
    async refundStatus(id) { return structuredClone([...refunds.values()].find(r => r.id === id)!); },
  };
  return { gateway, orders, refunds, calls, state, requests };
}
async function setup() {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  const config = structuredClone(sample);
  config.hours.closedWeekdays = [];
  config.rules.cancelHours = 720; // Paid cancellations must use their snapshot, not this legacy deadline.
  config.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
  shop.published = config; await store.saveShop(shop);
  const start = slots(config, [], dateJST(new Date(Date.now() + 4 * 86400000)), "simple")[0];
  const booking: Booking = { id: digest(randomUUID()), shopId: shop.id, customer: "alice@example.com", name: "Alice", menuId: "simple", price: 5501, message: "", ...start, status: "active", createdAt: new Date().toISOString() };
  return { store, shop, config, booking };
}

test("refund boundaries, rounding, invalid tiers, shop full refund", () => {
  const start = "2026-12-01T10:00:00.000Z";
  const at = (hours: number) => new Date(Date.parse(start) - hours * 3600000).toISOString();
  for (const [hours, percent, amount] of [[73, 100, 5501], [72, 100, 5501], [71.999, 50, 2750], [24, 50, 2750], [23.999, 0, 0], [0, 0, 0], [-1, 0, 0]]) {
    assert.deepEqual(refundQuote(5501, start, at(hours), defaultRefundTiers, "customer"), { percent, amount });
    assert.deepEqual(refundQuote(5501, start, at(hours), defaultRefundTiers, "shop"), { percent: 100, amount: 5501 });
  }
  for (const tiers of [[], [{ hoursBefore: 24, percent: 50 }], [{ hoursBefore: 0, percent: 0 }, { hoursBefore: 24, percent: 50 }], [{ hoursBefore: 24, percent: 40 }, { hoursBefore: 0, percent: 50 }]]) assert.equal(refundTiersSchema.safeParse(tiers).success, false);
});

test("lost capture response, restart, Sheets failure and immutable half refund recover without another capture", async () => {
  const { store, shop, config, booking } = await setup();
  const f = fakePayPal();
  let service = paymentService(store, f.gateway);
  let c = await service.begin(booking, defaultRefundTiers, "https://shop.invalid/return", "https://shop.invalid/cancel");
  assert.equal((await store.bookings(shop.id)).length, 0);
  assert.equal((await paymentHolds(store, shop.id)).length, 1);
  const held = await availableSlots(store, shop, config, dateJST(new Date(booking.start)), "simple", "aoi", calendarGateway);
  assert.ok(!held.some(s => s.start === booking.start));
  assert.equal((await service.begin(booking, defaultRefundTiers, "ignored", "ignored")).id, c.id);
  assert.equal(f.calls.create, 1);
  await assert.rejects(service.capture(c, async () => true), /承認/);
  f.orders.get(c.orderId!)!.status = "APPROVED";
  f.state.lostCapture = true;
  await assert.rejects(service.capture(c, async () => true), PayPalError);
  c = (await store.get<Checkout>("checkout", c.id))!;
  assert.equal(c.phase, "capturing");
  assert.equal((await store.bookings(shop.id)).length, 0);
  service = paymentService(store, f.gateway);
  let broken = true;
  const originalSave = store.saveBooking.bind(store);
  const saveMock = mock.method(store, "saveBooking", async (value: Booking) => { if (broken) throw new Error("Sheets offline"); await originalSave(value); });
  await assert.rejects(service.capture(c, async () => false), /Sheets offline/);
  assert.equal((await store.get<Checkout>("checkout", c.id))!.phase, "captured");
  broken = false; await service.reconcile(shop.id); saveMock.mock.restore();
  c = (await store.get<Checkout>("checkout", c.id))!;
  assert.equal(c.phase, "confirmed"); assert.equal(f.calls.capture, 1);
  config.rules.payment!.refundTiers = [{ hoursBefore: 0, percent: 100 }]; config.menus[0].price = 99999; shop.published = config; await store.saveShop(shop);
  const at = new Date(Date.parse(booking.start) - 48 * 3600000).toISOString();
  f.state.lostRefund = true;
  await service.cancel(c, booking.customer, "customer", at);
  c = (await store.get<Checkout>("checkout", c.id))!;
  assert.equal(c.booking.payment!.cancellation!.status, "retrying");
  // The test's historical cancellation is ahead of real time; retry still uses the first intent.
  await service.cancel(c, shop.owner, "shop", new Date(Date.parse(booking.start) - 3600000).toISOString());
  assert.equal(f.refunds.size, 1); assert.equal(f.calls.refund, 2);
  assert.deepEqual(f.requests[0], f.requests[1]); assert.equal(f.requests[0].amount, 2750);
  assert.equal(c.booking.payment!.cancellation!.reason, "customer");
  assert.equal(c.booking.payment!.cancellation!.at, at);
  assert.equal(c.booking.payment!.cancellation!.status, "completed");
  assert.equal((await store.bookings(shop.id))[0].status, "cancelled");
  await service.reconcile(shop.id); assert.equal(f.calls.refund, 2);
});

test("pending capture holds slot until completion; pending refund is polled and definitive errors stop writes", async () => {
  const { store, shop, booking } = await setup(); const f = fakePayPal();
  const service = paymentService(store, f.gateway);
  const c = await service.begin(booking, defaultRefundTiers, "https://s.invalid", "https://s.invalid");
  f.orders.get(c.orderId!)!.status = "APPROVED"; f.state.capturePending = true;
  await service.capture(c, async () => true);
  assert.equal(c.phase, "capturing"); assert.equal((await store.bookings(shop.id)).length, 0);
  await service.reconcile(shop.id); assert.equal(f.calls.capture, 1);
  f.orders.get(c.orderId!)!.purchase_units![0].payments!.captures![0].status = "COMPLETED";
  await service.reconcile(shop.id);
  const confirmed = (await store.get<Checkout>("checkout", c.id))!;
  f.state.pending = true;
  await service.cancel(confirmed, shop.owner, "shop");
  assert.equal(confirmed.booking.payment!.cancellation!.amount, booking.price);
  assert.equal(confirmed.booking.payment!.cancellation!.status, "pending");
  [...f.refunds.values()][0].status = "COMPLETED";
  await service.reconcile(shop.id); assert.equal(f.calls.refund, 1);
  assert.equal((await store.bookings(shop.id))[0].payment!.cancellation!.status, "completed");
});

test("expired/unavailable slots never charge; mismatched amount and old ambiguous capture require review", async () => {
  const { store, shop, booking } = await setup(); const f = fakePayPal(); const service = paymentService(store, f.gateway);
  const c = await service.begin(booking, defaultRefundTiers, "https://s.invalid", "https://s.invalid");
  f.orders.get(c.orderId!)!.status = "APPROVED";
  await assert.rejects(service.capture(c, async () => false), /課金はしていません/); assert.equal(f.calls.capture, 0);
  assert.equal((await paymentHolds(store, shop.id)).length, 0);
  const other = await service.begin({ ...booking, id: digest(randomUUID()) }, defaultRefundTiers, "https://s.invalid", "https://s.invalid");
  f.orders.get(other.orderId!)!.status = "APPROVED";
  f.orders.get(other.orderId!)!.purchase_units![0].amount!.value = "1";
  await assert.rejects(service.capture(other, async () => true), /金額/); assert.equal(f.calls.capture, 0);
  f.orders.get(other.orderId!)!.purchase_units![0].amount!.value = String(booking.price);
  other.phase = "capturing"; other.captureAttemptedAt = Date.now() - 6 * 3600000; await store.put("checkout", other.id, other);
  await service.reconcile(shop.id); assert.equal(f.calls.capture, 0);
  assert.equal((await store.get<Checkout>("checkout", other.id))!.review, true);
});

test("HTTP flow enforces consent, ownership, charge-before-booking, idempotence and refund snapshot", async t => {
  const { store, shop, config, booking } = await setup(); const f = fakePayPal();
  const server = createApp(store, undefined, undefined, undefined, f.gateway);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  for (const id of ["owner", "alice", "bob"]) {
    const email = `${id}@example.com`;
    await store.put("session", digest(id), { user: { email, name: id, role: id === "owner" ? "owner" : "customer", shopId: shop.id }, expires: Date.now() + 600000 });
    if (id !== "owner") await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: id, birthDate: "1990-01-01", gender: "not_specified" });
  }
  async function request(path: string, id = "alice", data?: unknown) {
    const res = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${id}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  }
  const base = `/api/public/${shop.slug}`;
  const input = { name: "Alice", menuId: "simple", start: booking.start, staffId: "aoi", requestId: randomUUID() };
  assert.equal((await request(base + "/bookings", "alice", input)).status, 409);
  const consent = { ...input, paymentConsent: { amount: config.menus[0].price, policy: defaultRefundTiers } };
  const started = await request(base + "/bookings", "alice", consent); assert.equal(started.status, 200); assert.equal(started.body.ok, false);
  const id = started.body.checkout.id;
  assert.equal((await request(base + "/bookings")).body.length, 0);
  const pendingOperations = await request("/api/workspace", "owner");
  assert.equal(pendingOperations.body.shops[0].paymentCheckouts[0].id, id);
  assert.equal((await request("/api/workspace", "bob")).body.shops.length, 0);
  assert.equal((await request(base + "/bookings", "alice", consent)).body.checkout.id, id); assert.equal(f.calls.create, 1);
  assert.equal((await request(base + "/bookings", "alice", { ...consent, name: "Changed" })).status, 409);
  assert.equal((await request(`${base}/checkouts/${id}/capture`, "bob", {})).status, 404);
  assert.equal((await request(`${base}/checkouts`, "bob")).body.length, 0);
  assert.equal((await request(`${base}/checkouts/${id}/capture`, "alice", {})).status, 409);
  [...f.orders.values()][0].status = "APPROVED";
  const results = await Promise.all([request(`${base}/checkouts/${id}/capture`, "alice", {}), request(`${base}/checkouts/${id}/capture`, "alice", {})]);
  assert.ok(results.every(r => r.body.ok)); assert.equal(f.calls.capture, 1);
  assert.equal((await store.bookings(shop.id)).length, 1);
  config.rules.payment!.refundTiers = [{ hoursBefore: 0, percent: 0 }]; config.menus[0].price = 100; shop.published = config; await store.saveShop(shop);
  const quote = await request(`${base}/bookings/${id}/cancel-quote`); assert.equal(quote.body.amount, 5500);
  assert.equal((await request(`${base}/bookings/${id}/cancel-quote`, "bob")).status, 404);
  assert.equal((await request(`${base}/bookings/${id}/cancel`, "alice", { expectedRefund: 0 })).status, 409);
  const unavailableRows = mock.method(store, "bookings", async () => { throw new Error("Sheets reads unavailable"); });
  assert.equal((await request(`${base}/bookings/${id}/cancel`, "alice", { expectedRefund: 5500 })).status, 200);
  unavailableRows.mock.restore();
  assert.equal((await request(`${base}/bookings/${id}/cancel`, "alice", {})).status, 200); assert.equal(f.calls.refund, 1);
  assert.equal((await request(base + "/bookings", "bob")).body.length, 0);
});

test("PayPal adapter uses Sandbox OAuth, integer JPY, stable request IDs and redacts failures", async () => {
  const old = { ...process.env };
  process.env.PAYPAL_CLIENT_ID = "fixture-client"; process.env.PAYPAL_CLIENT_SECRET = "fixture-secret";
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  const seen: { url: string; data?: any; headers: Record<string, string> }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); const headers = init!.headers as Record<string, string>;
    const data = init?.body && String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : undefined;
    seen.push({ url, data, headers });
    if (url.endsWith("/token")) return Response.json({ access_token: "private-token", expires_in: 3600 });
    if (url.endsWith("/refund")) return Response.json({ id: "refund1", status: "COMPLETED" });
    return Response.json({ id: "order1", status: "CREATED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=order1" }] });
  };
  try {
    const g = paypalGateway(fetcher); await g.create("booking1", 5501, "https://shop.invalid/r", "https://shop.invalid/c");
    await g.refund("capture1", 2750, "stable-refund");
    assert.ok(seen.every(s => s.url.startsWith("https://api-m.sandbox.paypal.com/")));
    assert.equal(seen[1].data.purchase_units[0].amount.value, "5501");
    assert.equal(seen[1].data.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
    await g.create("usd-booking", 5501, "https://shop.invalid/r", "https://shop.invalid/c", "USD");
    await g.refund("usd-capture", 2750, "usd-refund", "USD");
    assert.deepEqual(seen[3].data.purchase_units[0].amount, {currency_code:"USD",value:"55.01"});
    assert.deepEqual(seen[4].data.amount, {currency_code:"USD",value:"27.50"});
    assert.equal(seen[2].data.amount.value, "2750"); assert.equal(seen[2].headers["PayPal-Request-Id"], "stable-refund");
    assert.throws(() => approvalUrl({ id: "x", status: "CREATED", links: [{ rel: "approve", href: "https://evil.invalid" }] }, "sandbox"));
    const broken = paypalGateway(async () => new Response("fixture-secret private-provider-detail", { status: 500 }));
    await assert.rejects(broken.order("x"), error => error instanceof PayPalError && !error.message.includes("fixture-secret") && !error.message.includes("private-provider-detail"));
  } finally { process.env = old; }
});

test("offline preview simulates payment/refund without network or external approval", async () => {
  const { config } = await setup(); const client = createPreviewClient(config, sampleFixtures(config), "preview");
  const base = "/api/public/local-preview";
  assert.equal((await client<{ paymentSimulation: boolean }>(base)).paymentSimulation, true);
  assert.deepEqual(await client(base + "/checkouts"), []);
  const b = (await client<Booking[]>(base + "/bookings"))[0]; assert.ok(b.payment);
  await client(`${base}/bookings/${b.id}/cancel`, {});
  assert.equal((await client<Booking[]>(base + "/bookings"))[0].status, "cancelled");
});

test("zero refund avoids PayPal; definitive refund errors and expired ambiguous writes stop safely", async () => {
  const { store, shop, booking } = await setup(); const f = fakePayPal(); const service = paymentService(store, f.gateway);
  async function paid() {
    const c = await service.begin({ ...booking, id: digest(randomUUID()) }, defaultRefundTiers, "https://s.invalid", "https://s.invalid");
    f.orders.get(c.orderId!)!.status = "APPROVED"; await service.capture(c, async () => true); return c;
  }
  const zero = await paid();
  await service.cancel(zero, booking.customer, "customer", new Date(Date.parse(booking.start) - 3600000).toISOString());
  assert.equal(zero.booking.payment!.cancellation!.status, "not_required"); assert.equal(f.calls.refund, 0);
  const failed = await paid(); f.state.refundDenied = true;
  await service.cancel(failed, shop.owner, "shop");
  assert.equal(failed.booking.payment!.cancellation!.status, "manual_review"); assert.equal(f.calls.refund, 1);
  await service.reconcile(shop.id); assert.equal(f.calls.refund, 1);
  const uncertain = await paid(); f.state.refundDenied = false; f.state.lostRefund = true;
  await service.cancel(uncertain, shop.owner, "shop");
  uncertain.booking.payment!.cancellation!.attemptedAt = new Date(Date.now() - 6 * 3600000).toISOString(); await store.put("checkout", uncertain.id, uncertain);
  const before = f.calls.refund;
  await service.reconcile(shop.id); assert.equal(f.calls.refund, before);
  assert.equal((await store.get<Checkout>("checkout", uncertain.id))!.booking.payment!.cancellation!.status, "manual_review");
  const frozen = await paid(); frozen.environment = "live"; await store.put("checkout", frozen.id, frozen);
  await assert.rejects(service.cancel(frozen, shop.owner, "shop"), /環境/);
  assert.equal(f.calls.refund, before);
});

test("Calendar busy changes and retrieval failures are checked before charging; paid sheet edits cannot change the captured snapshot", async () => {
  const { store, shop, config, booking } = await setup(); const f = fakePayPal(); const service = paymentService(store, f.gateway);
  await store.put("calendar", `${shop.id}:${shop.owner}`, { shopId: shop.id, email: shop.owner, staffId: booking.staffId, refreshToken: "fixture" });
  let broken = true;
  const calendar = { ...calendarGateway, async busy() { if (broken) throw new Error("offline"); return [{ start: booking.start, end: booking.end }]; } };
  const c = await service.begin(booking, defaultRefundTiers, "https://s.invalid", "https://s.invalid"); f.orders.get(c.orderId!)!.status = "APPROVED";
  const available = async () => (await availableSlots(store, shop, config, dateJST(new Date(booking.start)), booking.menuId, booking.staffId, calendar, c.id)).some(s => s.start === booking.start);
  await assert.rejects(service.capture(c, available), /Google Calendar/); assert.equal(f.calls.capture, 0); assert.equal(c.phase, "awaiting_approval");
  broken = false; await assert.rejects(service.capture(c, available), /課金はしていません/); assert.equal(f.calls.capture, 0);
  const good = await service.begin({ ...booking, id: digest(randomUUID()) }, defaultRefundTiers, "https://s.invalid", "https://s.invalid"); f.orders.get(good.orderId!)!.status = "APPROVED";
  await service.capture(good, async () => true);
  await store.saveBooking({ ...good.booking, price: 1, payment: { ...good.booking.payment!, amount: 1, policy: [{ hoursBefore: 0, percent: 0 }] } });
  const row = (await store.bookings(shop.id))[0]; assert.equal(row.price, 5501); assert.equal(row.payment!.amount, 5501); assert.deepEqual(row.payment!.policy, defaultRefundTiers);
});


test("insufficient refund balance is explicit and recovers with the original amount and request ID", async () => {
  const { store, shop, booking } = await setup(); const f = fakePayPal(); const service = paymentService(store, f.gateway);
  const c = await service.begin(booking, defaultRefundTiers, "https://s.invalid", "https://s.invalid");
  f.orders.get(c.orderId!)!.status = "APPROVED"; await service.capture(c, async () => true);
  f.state.refundInsufficient = true;
  await service.cancel(c, shop.owner, "shop");
  const original = structuredClone(c.booking.payment!.cancellation!);
  assert.equal(original.status, "awaiting_funds"); assert.equal(original.amount, booking.price);
  assert.equal((await store.bookings(shop.id))[0].status, "cancelled");
  assert.equal(f.calls.capture, 1); assert.equal(f.calls.refund, 1);
  f.state.refundInsufficient = false;
  await paymentService(store, f.gateway).reconcile(shop.id);
  const finished = (await store.get<Checkout>("checkout", c.id))!.booking.payment!.cancellation!;
  assert.equal(finished.status, "completed"); assert.equal(finished.requestId, original.requestId);
  assert.equal(finished.at, original.at); assert.equal(finished.amount, original.amount);
  assert.deepEqual(f.requests[0], f.requests[1]); assert.equal(f.refunds.size, 1);
  await service.reconcile(shop.id); assert.equal(f.calls.refund, 2);
});

test("PayPal exposes only the known insufficient-balance issue and keeps provider details private", async () => {
  const old = { ...process.env };
  process.env.PAYPAL_CLIENT_ID = "fixture-client"; process.env.PAYPAL_CLIENT_SECRET = "fixture-secret";
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  try {
    const gateway = paypalGateway(async input => String(input).endsWith("/token")
      ? Response.json({ access_token: "private-token", expires_in: 3600 })
      : Response.json({ details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS", description: "private-provider-detail" }] }, { status: 422 }));
    await assert.rejects(gateway.refund("capture", 5500, "stable"), error => error instanceof PayPalError && error.definitive && error.issue === "REFUND_FAILED_INSUFFICIENT_FUNDS" && !error.message.includes("private-provider-detail"));
  } finally { process.env = old; }
});

test("USD capture/refund stores cents, validates currency and preserves the booked currency across setting changes", async () => {
  const {store,shop,config,booking}=await setup();
  config.region={country:"US",timeZone:"America/New_York"};config.menus[0].price=55.01;shop.published=config;await store.saveShop(shop);
  booking.price=55.01;
  const f=fakePayPal();const service=paymentService(store,f.gateway);
  let c=await service.begin(booking,defaultRefundTiers,"https://s.invalid/r","https://s.invalid/c","USD");
  const order=f.orders.get(c.orderId!)!;
  assert.deepEqual(order.purchase_units![0].amount,{currency_code:"USD",value:"55.01"});
  order.status="APPROVED";order.purchase_units![0].amount!.currency_code="JPY";
  await assert.rejects(service.capture(c,async()=>true));assert.equal(f.calls.capture,0);
  order.purchase_units![0].amount!.currency_code="USD";
  c=await service.capture(c,async()=>true);assert.equal(c.booking.payment!.amount,5501);assert.equal(c.booking.payment!.currency,"USD");
  shop.published={...config,region:{country:"JP",timeZone:"Asia/Tokyo"}};await store.saveShop(shop);
  await service.cancel(c,"alice@example.com","customer",new Date(Date.parse(booking.start)-30*3600000).toISOString());
  assert.equal(c.booking.payment!.cancellation!.amount,2750);assert.equal(c.booking.payment!.cancellation!.status,"completed");
  assert.deepEqual([...f.refunds.values()][0].amount,{currency_code:"USD",value:"27.50"});
  assert.equal(f.calls.refund,1);await service.cancel(c,"alice@example.com","customer");assert.equal(f.calls.refund,1);
  await store.close();
});

test("US booking HTTP flow uses local dates and server-owned dollar amounts through capture", async t => {
  const {store,shop,config}=await setup();const f=fakePayPal();
  config.region={country:"US",timeZone:"America/Los_Angeles"};config.menus[0].price=55.01;shop.published=config;await store.saveShop(shop);
  const server=createApp(store,undefined,undefined,undefined,f.gateway);
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;
  t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));await store.close();});
  const email="alice@example.com";
  await store.put("session",digest("us-alice"),{user:{email,name:"Alice",role:"customer",shopId:shop.id},expires:Date.now()+600000});
  await store.put("customer",`${shop.id}:${email}`,{shopId:shop.id,email,name:"Alice",birthDate:"1990-01-01",gender:"not_specified"});
  async function request(path:string,data?:unknown){const r=await fetch(origin+path,{method:data===undefined?"GET":"POST",headers:{Origin:origin,Cookie:"gemihub_session=us-alice","Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json()};}
  const date=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
  const base=`/api/public/${shop.slug}`;
  const available=await request(`${base}/slots?date=${date}&menu=simple`);assert.equal(available.status,200);assert.ok(available.body.length);
  const input={name:"Alice",menuId:"simple",start:available.body[0].start,staffId:available.body[0].staffId,requestId:randomUUID(),paymentConsent:{amount:55.01,policy:defaultRefundTiers}};
  assert.equal((await request(`${base}/bookings`,{...input,paymentConsent:{...input.paymentConsent,amount:5501}})).status,409);
  const started=await request(`${base}/bookings`,input);assert.equal(started.status,200);assert.equal(started.body.checkout.currency,"USD");
  const order=[...f.orders.values()][0];assert.deepEqual(order.purchase_units![0].amount,{currency_code:"USD",value:"55.01"});order.status="APPROVED";
  assert.equal((await request(`${base}/checkouts/${started.body.checkout.id}/capture`,{})).body.ok,true);
  const saved=(await store.bookings(shop.id))[0];assert.equal(saved.price,55.01);assert.equal(saved.payment!.amount,5501);assert.equal(saved.payment!.currency,"USD");
});
