import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST, slots, type Booking } from "../server/domain.ts";
import { encrypt } from "../server/google.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import type { Checkout } from "../server/payments.ts";
import type { PaymentGateway, PayPalOrder } from "../server/paypal.ts";
import { Store } from "../server/store.ts";
import { paypalValue } from "../shared/region.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

async function setup(t: TestContext) {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  const config = structuredClone(sample);
  config.hours.closedWeekdays = [];
  config.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
  shop.published = config;
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  await store.put("user", shop.owner, { email: shop.owner, role: "owner", refreshToken: encrypt("refresh") });
  const email = "customer@example.com";
  for (const who of ["owner", "customer"]) await store.put("session", digest(who), {
    user: { email: who === "owner" ? shop.owner : email, name: who, role: who, shopId: shop.id }, expires: Date.now() + 600000,
  });
  await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: "Customer", birthDate: "1990-01-01", gender: "not_specified" });
  await store.put("job", "files", { id: "files", shopId: shop.id, type: "posts", attempts: 0 });
  const fileStarted = deferred(), finishFiles = deferred(), paymentStarted = deferred(), finishPayment = deferred();
  let fileId = 0, blockPayment = false;
  t.mock.method(google, "drive", (() => ({ files: {
    async create() { fileStarted.resolve(); await finishFiles.promise; return { data: { id: `file-${++fileId}` } }; },
    async get() { return { data: { parents: ["folder"] } }; },
    async update() { return { data: {} }; },
  } })) as never);
  const sent: string[] = [];
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: any) { sent.push(input.requestBody.raw); } } } })) as never);
  const orders = new Map<string, PayPalOrder>();
  const calls = { create: 0, capture: 0, refund: 0 };
  const gateway: PaymentGateway = {
    environment: "sandbox", async ready() {},
    async create(id, amount, _return, _cancel, currency = "JPY") {
      calls.create++;
      const order: PayPalOrder = { id: `order-${id}`, status: "APPROVED", purchase_units: [{ custom_id: id, amount: { currency_code: currency, value: paypalValue(amount, currency) } }], links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
      orders.set(order.id, order); return structuredClone(order);
    },
    async order(id) { if (blockPayment) { paymentStarted.resolve(); await finishPayment.promise; } return structuredClone(orders.get(id)!); },
    async capture(id) {
      calls.capture++; const order = orders.get(id)!;
      order.purchase_units![0].payments = { captures: [{ id: `capture-${id}`, status: "COMPLETED", amount: order.purchase_units![0].amount! }] };
      return structuredClone(order);
    },
    async refund(_capture, amount, id, currency = "JPY") { calls.refund++; return { id, status: "COMPLETED", amount: { currency_code: currency, value: paypalValue(amount, currency) } }; },
    async refundStatus() { throw new Error("unexpected poll"); },
  };
  const server = createApp(store, undefined, undefined, undefined, gateway);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    finishFiles.resolve(); finishPayment.resolve();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close();
  });
  const call = async (path: string, data?: unknown, who = "customer", timeout = 3000) => {
    const res = await fetch(origin + path, { signal: AbortSignal.timeout(timeout), method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${who}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  };
  const menu = config.menus[0], slot = slots(config, [], dateJST(new Date(Date.now() + 4 * 86400000)), menu.id)[0];
  const input = () => ({ requestId: randomUUID(), name: "Customer", menuId: menu.id, staffId: slot.staffId, start: slot.start, paymentConsent: { amount: menu.price, policy: defaultRefundTiers } });
  return { store, shop, call, input, slot, menu, email, gateway, calls, sent, fileStarted, finishFiles, paymentStarted, finishPayment, blockPayment: () => { blockPayment = true; } };
}

test("initial page data loads during a blocked Drive export for owners, customers and visitors", { timeout: 10000 }, async t => {
  const f = await setup(t), base = `/api/public/${f.shop.slug}`;
  const retry = f.call(`/api/shops/${f.shop.id}/retry`, {}, "owner", 9000);
  await f.fileStarted.promise;
  try {
    for (const who of ["owner", "customer", "visitor"]) {
      const page = await f.call(base, undefined, who);
      assert.equal(page.status, 200, `${who} can load the page before the export finishes`);
      assert.equal(page.body.shopId, f.shop.id);
      assert.equal(page.body.config.name, f.shop.published!.name);
      assert.equal(page.body.canEdit, who === "owner");
      assert.equal(page.body.isOperator, who === "owner");
      assert.equal(page.body.customerProfile?.name, who === "customer" ? "Customer" : undefined);
      assert.equal(page.body.registrationRequired, false);
      if (who !== "owner") assert.equal(page.body.config.notificationEmail, undefined);
      const wallet = await f.call(`${base}/coupons`, undefined, who);
      assert.equal(wallet.status, who === "customer" ? 200 : 403);
      if (who === "customer") assert.deepEqual(wallet.body, []);
    }
    assert.ok(await f.store.get("job", "files"), "reading never consumes the pending export");
    assert.deepEqual(f.calls, { create: 0, capture: 0, refund: 0 });
  } finally { f.finishFiles.resolve(); await retry; }
});

test("page reads during sync still enforce private access and in-flight publication guards", { timeout: 10000 }, async t => {
  const f = await setup(t), base = `/api/public/${f.shop.slug}`;
  f.shop.publication = "provisional"; await f.store.saveShop(f.shop);
  const entered = deferred(), finish = deferred();
  const sync = f.store.locked(f.shop.id, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  try {
    assert.equal((await f.call(base, undefined, "owner")).status, 200);
    const customer = await f.call(base); assert.equal(customer.status, 403); assert.equal(customer.body.config, undefined);
    const visitor = await f.call(base, undefined, "visitor"); assert.equal(visitor.status, 401); assert.equal(visitor.body.config, undefined);
    f.shop.publishingPlanId = "publishing"; await f.store.saveShop(f.shop);
    const publishing = await f.call(base, undefined, "owner");
    assert.equal(publishing.status, 503); assert.equal(publishing.body.config, undefined);
  } finally { finish.resolve(); await sync; }
});

test("initial page reads reject a shop archived or unpublished after route lookup", async t => {
  const f = await setup(t), hidden = structuredClone(f.shop), readShop = f.store.shop.bind(f.store);
  t.mock.method(f.store, "shop", async (id: string) => id === hidden.id ? structuredClone(hidden) : readShop(id));
  hidden.archivedAt = new Date().toISOString();
  const archived = await f.call(`/api/public/${f.shop.slug}`);
  assert.equal(archived.status, 404); assert.equal(archived.body.config, undefined);
  delete hidden.archivedAt; hidden.published = null;
  const unpublished = await f.call(`/api/public/${f.shop.slug}`);
  assert.equal(unpublished.status, 404); assert.equal(unpublished.body.config, undefined);
});

test("a blocked Drive export does not block bookings, captures, refunds or operation reads", { timeout: 10000 }, async t => {
  const f = await setup(t), base = `/api/public/${f.shop.slug}`;
  const retry = f.call(`/api/shops/${f.shop.id}/retry`, {}, "owner");
  await f.fileStarted.promise;
  const attempts = await Promise.all([f.call(`${base}/bookings`, f.input()), f.call(`${base}/bookings`, f.input())]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409], "same-slot operations still serialize");
  const checkout = attempts.find(result => result.status === 200)!.body.checkout;
  const captures = await Promise.all([f.call(`${base}/checkouts/${checkout.id}/capture`, {}), f.call(`${base}/checkouts/${checkout.id}/capture`, {})]);
  assert.ok(captures.every(result => result.status === 200 && result.body.ok));
  assert.deepEqual(f.calls, { create: 1, capture: 1, refund: 0 });
  assert.equal(f.sent.length, 1);
  const operations = await f.call(`/api/shops/${f.shop.id}/operations`, undefined, "owner");
  assert.equal(operations.status, 200); assert.equal(operations.body.bookings.length, 1);
  assert.equal((await f.call(`/api/shops/${f.shop.id}/bookings/${checkout.id}/status`, { status: "cancelled" }, "owner")).status, 200);
  assert.equal(f.calls.refund, 1);
  assert.equal((await f.store.bookings(f.shop.id))[0].status, "cancelled");
  assert.ok(await f.store.get("job", "files"), "payment handlers never consume file jobs");
  f.finishFiles.resolve(); assert.equal((await retry).status, 200);
  assert.equal(await f.store.get("job", "files"), undefined);
});

test("file synchronization completes even while payment reconciliation is waiting on PayPal", { timeout: 10000 }, async t => {
  const f = await setup(t);
  const booking: Booking = { id: digest("pending"), shopId: f.shop.id, customer: f.email, name: "Customer", menuId: f.menu.id, price: f.menu.price, message: "", ...f.slot, status: "active", createdAt: new Date().toISOString() };
  const order = await f.gateway.create(booking.id, booking.price, "https://shop.invalid/return", "https://shop.invalid/cancel");
  await f.store.put("checkout", booking.id, { id: booking.id, shopId: f.shop.id, customer: f.email, booking, policy: defaultRefundTiers, environment: "sandbox", phase: "capturing", orderId: order.id, createdAt: Date.now(), expires: Date.now() + 600000, captureAttemptedAt: Date.now(), returnUrl: "", cancelUrl: "" } satisfies Checkout);
  const filesDone = deferred(), originalDelete = f.store.delete.bind(f.store);
  t.mock.method(f.store, "delete", async (kind: string, id: string) => { await originalDelete(kind, id); if (kind === "job" && id === "files") filesDone.resolve(); });
  f.blockPayment();
  const retry = f.call(`/api/shops/${f.shop.id}/retry`, {}, "owner");
  await Promise.all([f.paymentStarted.promise, f.fileStarted.promise]);
  f.finishFiles.resolve(); await filesDone.promise;
  assert.equal(await f.store.get("job", "files"), undefined);
  assert.equal(f.calls.capture, 0, "PayPal is still blocked while files finish");
  f.finishPayment.resolve(); assert.equal((await retry).status, 200);
  assert.equal((await f.store.get<Checkout>("checkout", booking.id))!.phase, "confirmed");
  assert.equal(f.sent.length, 1, "the newly completed payment's notice is delivered after reconciliation");
});

test("replacement booking payment and notices finish during a blocked export; shop history is applied after configuration work", { timeout: 10000 }, async t => {
  const f = await setup(t), base = `/api/public/${f.shop.slug}`;
  const created = await f.call(`${base}/bookings`, f.input());
  const id = created.body.checkout.id;
  assert.equal((await f.call(`${base}/checkouts/${id}/capture`, {})).body.ok, true);
  const c = (await f.store.get<Checkout>("checkout", id))!;
  c.booking.start = new Date(Date.now() + 18 * 3600000).toISOString();
  c.booking.end = new Date(Date.now() + 19 * 3600000).toISOString();
  await f.store.put("checkout", id, c);
  await f.store.put("session", digest("buyer"), { user: { email: "buyer@example.com", name: "Buyer", role: "customer", shopId: f.shop.id }, expires: Date.now() + 600000 });
  await f.store.put("customer", `${f.shop.id}:buyer@example.com`, { shopId: f.shop.id, email: "buyer@example.com", name: "Buyer", birthDate: "1990-01-01", gender: "not_specified" });
  const retry = f.call(`/api/shops/${f.shop.id}/retry`, {}, "owner");
  await f.fileStarted.promise;
  try {
    const quote = (await f.call(`${base}/bookings/${id}/cancel-quote`)).body;
    const cancelled = await f.call(`${base}/bookings/${id}/cancel`, { expectedRefund: quote.amount, expectedTransfer: quote.transfer });
    assert.equal(cancelled.body.cancellationPending, true);
    const offer = (await f.call(`${base}/transfers`)).body[0];
    assert.equal((await f.call(`${base}/transfers/${offer.id}/checkout`, { name: "Buyer", requestId: randomUUID(), consent: { amount: offer.amount, policy: offer.policy } }, "buyer")).status, 200);
    const fresh = (await f.store.shop(f.shop.id))!;
    fresh.publishingPlanId = "publishing"; await f.store.saveShop(fresh);
    const captured = await f.call(`${base}/transfers/${offer.id}/capture`, {}, "buyer");
    assert.equal(captured.status, 200); assert.equal(captured.body.ok, true);
    assert.equal(captured.body.booking.customer, "buyer@example.com");
    assert.deepEqual(f.calls, { create: 2, capture: 2, refund: 1 });
    assert.ok(await f.store.get("paymentNotice", `transfer:${offer.id}:sold`), "mail intent commits without waiting for the configuration lock");
    assert.ok(await f.store.get("transferHistory", offer.id), "history intent is durable while Drive is blocked");
    assert.equal((await f.store.shop(f.shop.id))!.history.length, 0, "booking operations do not write the shop under the booking lock");
    const operations = await f.call(`/api/shops/${f.shop.id}/operations`, undefined, "owner");
    assert.equal(operations.status, 200); assert.equal(operations.body.bookings[0].customer, "buyer@example.com");
    f.finishFiles.resolve(); assert.equal((await retry).status, 200);
    assert.equal((await f.store.shop(f.shop.id))!.history.length, 1);
    assert.equal((await f.store.get<{ applied: boolean }>("transferHistory", offer.id))!.applied, true);
    assert.ok(f.sent.length >= 5, "payment and replacement notices are delivered without waiting for Drive");
  } finally { f.finishFiles.resolve(); await retry; }
});

test("an in-flight publication keeps new bookings paused but does not prevent finishing or refunding an existing payment", { timeout: 10000 }, async t => {
  const f = await setup(t), base = `/api/public/${f.shop.slug}`;
  const created = await f.call(`${base}/bookings`, f.input());
  assert.equal(created.status, 200);
  const id = created.body.checkout.id;
  f.shop.publishingPlanId = "publishing";
  await f.store.saveShop(f.shop);
  const entered = deferred(), finish = deferred();
  const publication = f.store.locked(f.shop.id, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  try {
    const captured = await f.call(`${base}/checkouts/${id}/capture`, {});
    assert.equal(captured.status, 200); assert.equal(captured.body.ok, true);
    assert.equal((await f.call(`${base}/bookings`, f.input())).status, 503);
    assert.equal((await f.call(`${base}/bookings`)).status, 200);
    assert.equal((await f.call(`/api/shops/${f.shop.id}/bookings/${id}/status`, { status: "cancelled" }, "owner")).status, 200);
    assert.deepEqual(f.calls, { create: 1, capture: 1, refund: 1 });
  } finally { finish.resolve(); await publication; }
});
