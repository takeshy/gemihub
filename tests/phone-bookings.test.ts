import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { sample, type Booking } from "../server/domain.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { aggregateCustomers, phoneKey, type CustomerRecord, type CustomerSummary } from "../server/customers.ts";
import { queueBookingReminders } from "../server/booking-reminders.ts";
import { paypalValue } from "../shared/region.ts";
import type { Checkout } from "../server/payments.ts";
import type { PaymentGateway, PayPalOrder } from "../server/paypal.ts";

const now = Date.parse("2026-11-06T01:00:00Z"); // 10:00 on a Friday in Japan.
const start = (day: string, time: string) => new Date(`${day}T${time}:00+09:00`).toISOString();
const today = "2026-11-06", tomorrow = "2026-11-07";

async function fixture(t: TestContext) {
  process.env.DEMO_MODE = "true";
  t.mock.timers.enable({ apis: ["Date"], now });
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  const config = structuredClone(sample);
  config.staff = []; config.ownerBooking = true; config.hours.closedWeekdays = [];
  // Online customers can book neither today nor within a day; the phone can.
  config.rules.sameDay = false; config.rules.leadMinutes = 1440;
  shop.published = config; shop.publication = "public"; await store.saveShop(shop);
  for (const [token, email, role] of [["owner", shop.owner, "owner"], ["alice", "alice@example.com", "customer"]])
    await store.put("session", digest(token), { user: { email, name: token, role, shopId: shop.id }, expires: now + 3600000 });
  await store.put("customer", `${shop.id}:alice@example.com`, { shopId: shop.id, email: "alice@example.com", name: "Alice", birthDate: "1990-11-01", gender: "female" });
  const orders = new Map<string, PayPalOrder>();
  const gateway: PaymentGateway = {
    environment: "sandbox", async ready() {},
    async create(id, amount, _return, _cancel, currency = "JPY") { const order: PayPalOrder = { id, status: "APPROVED", purchase_units: [{ custom_id: id, amount: { currency_code: currency, value: paypalValue(amount, currency) } }], links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] }; orders.set(id, order); return order; },
    async order(id) { return orders.get(id)!; },
    async capture(id) { const order = orders.get(id)!; order.purchase_units![0].payments = { captures: [{ id: `cap-${id}`, status: "COMPLETED", amount: order.purchase_units![0].amount! }] }; return order; },
    async refund() { throw new Error("unexpected refund"); }, async refundStatus() { throw new Error("unexpected poll"); },
  };
  const server = createApp(store, undefined, undefined, undefined, gateway); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await store.close(); });
  const call = async (path: string, data?: unknown, who = "owner") => {
    const r = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Cookie: `gemihub_session=${who}`, Origin: origin, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, body: await r.json() };
  };
  const base = `/api/shops/${shop.id}/bookings`, menu = config.menus.find(item => !item.optionFor)!;
  const input = (at: string) => ({ requestId: randomUUID(), name: "Hanako", phone: "03-1234-5678", menuId: menu.id, start: at, expectedPrice: menu.price });
  return { store, shop, config, call, base, menu, input, gateway };
}

test("a phone booking takes today's slot, bypassing online cut-offs, and records cash without an account", async t => {
  const f = await fixture(t), at = start(today, "13:00");
  assert.ok((await f.call(`/api/public/${f.shop.slug}/slots?date=${today}&menu=${f.menu.id}`)).body.length === 0, "online customers cannot book today");
  const offered = await f.call(`${f.base}/phone-slots?menu=${f.menu.id}`);
  assert.ok(offered.body.slots.some((slot: { start: string }) => slot.start === at));
  const saved = await f.call(`${f.base}/phone`, f.input(at));
  assert.equal(saved.status, 200);
  const booking: Booking = saved.body.booking;
  assert.equal(booking.customer, "tel:0312345678"); assert.equal(booking.phone, "03-1234-5678"); assert.equal(booking.payment, undefined); assert.equal(booking.price, f.menu.price);
  assert.ok(!(await f.call(`${f.base}/phone-slots?menu=${f.menu.id}`)).body.slots.some((slot: { start: string }) => slot.start === at), "the slot is taken");
});

test("only today can be booked by phone, and only by operators", async t => {
  const f = await fixture(t);
  assert.equal((await f.call(`${f.base}/phone`, f.input(start(tomorrow, "13:00")))).status, 409);
  assert.equal((await f.call(`${f.base}/phone`, f.input(start(today, "09:00")))).status, 409, "a past time");
  assert.equal((await f.call(`${f.base}/phone`, f.input(start(today, "13:00")), "alice")).status, 403);
  assert.equal((await f.call(`${f.base}/phone-slots?menu=${f.menu.id}`, undefined, "alice")).status, 403);
  for (const phone of ["call me", "", "123"]) assert.equal((await f.call(`${f.base}/phone`, { ...f.input(start(today, "13:00")), phone })).status, 400);
  const { phone: _phone, ...withoutPhone } = f.input(start(today, "13:00"));
  assert.equal((await f.call(`${f.base}/phone`, withoutPhone)).status, 400, "a phone booking requires a number");
  assert.equal((await f.call(`${f.base}/phone`, { ...f.input(start(today, "13:00")), expectedPrice: 1 })).status, 409);
  assert.deepEqual(await f.store.bookings(f.shop.id), []);
});

test("phone and online bookings share inventory: an active booking blocks the slot and retries do not double-book", async t => {
  const f = await fixture(t), at = start(today, "14:00");
  await f.store.saveBooking({ id: "online", shopId: f.shop.id, customer: "alice@example.com", name: "Alice", message: "", menuId: f.menu.id, price: f.menu.price, staffId: "owner", start: at, end: new Date(Date.parse(at) + f.menu.duration * 60000).toISOString(), status: "active", createdAt: new Date(now).toISOString() });
  assert.equal((await f.call(`${f.base}/phone`, f.input(at))).status, 409);
  const request = f.input(start(today, "16:00"));
  const results = await Promise.all([f.call(`${f.base}/phone`, request), f.call(`${f.base}/phone`, request), f.call(`${f.base}/phone`, { ...request, requestId: randomUUID() })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 409], "a retry is idempotent; another caller cannot double-book");
  assert.equal((await f.store.bookings(f.shop.id)).length, 2);
});

test("phone customers accumulate visits under one number, receive no mail and can be cancelled", async t => {
  const f = await fixture(t);
  const booking: Booking = (await f.call(`${f.base}/phone`, f.input(start(today, "13:00")))).body.booking;
  const customers = ((await f.call(`/api/shops/${f.shop.id}/customers`)).body as CustomerSummary[]).filter(customer => customer.phone);
  assert.deepEqual(customers.map(customer => [customer.email, customer.name, customer.phone]), [["tel:0312345678", "Hanako", "03-1234-5678"]]);
  assert.equal((await f.call(`/api/shops/${f.shop.id}/customers/${encodeURIComponent(customers[0].email)}`)).body.history.length, 1);
  await f.store.put("shop", f.shop.id, { ...(await f.store.shop(f.shop.id))!, google: { folderId: "folder" } });
  const queued: string[] = [];
  await queueBookingReminders(f.store, (await f.store.shop(f.shop.id))!, async (_id, mail) => { queued.push(mail.to); }, now + 3600000);
  assert.deepEqual(queued, []);
  assert.equal((await f.call(`${f.base}/${booking.id}/status`, { status: "cancelled" })).status, 200);
  assert.ok((await f.call(`${f.base}/phone-slots?menu=${f.menu.id}`)).body.slots.some((slot: { start: string }) => slot.start === booking.start), "the slot opens again");
});

test("a customer can be registered by name and phone alone, and later bookings join them", async t => {
  const f = await fixture(t), customers = `/api/shops/${f.shop.id}/customers`;
  const phoneList = async () => ((await f.call(customers)).body as CustomerSummary[]).filter(customer => customer.phone);
  assert.equal((await f.call(`${customers}/phone`, { name: "Taro", phone: "０９０－１２３４－５６７８" })).status, 200);
  assert.equal((await f.call(`${customers}/phone`, { name: "Taro" })).status, 400, "a phone number is required");
  assert.equal((await f.call(`${customers}/phone`, { name: "Taro", phone: "090-1234-5678" }, "alice")).status, 403);
  const listed = await phoneList();
  assert.deepEqual(listed.map(customer => [customer.name, customer.visitCount]), [["Taro", 0]], "listed before any booking");
  assert.equal(phoneKey("090 1234 5678"), "tel:09012345678");
  await f.call(`${f.base}/phone`, { ...f.input(start(today, "13:00")), name: "Taro Y", phone: "090-1234-5678" });
  const [customer, ...others] = await phoneList();
  assert.deepEqual(others, [], "punctuation and width do not split a customer");
  assert.equal(customer.name, "Taro Y");
  const record = await f.store.get<CustomerRecord>("customer", `${f.shop.id}:tel:09012345678`);
  assert.equal(record!.phone, "090-1234-5678");
  t.mock.timers.setTime(now + 2 * 86400000);
  await f.store.put("session", digest("owner"), { user: { email: f.shop.owner, name: "owner", role: "owner", shopId: f.shop.id }, expires: now + 3 * 86400000 });
  assert.equal((await phoneList())[0].visitCount, 1, "an ended phone booking counts as a visit");
});

test("a registered number fills in the name, and an unknown or invalid one does not", async t => {
  const f = await fixture(t), customers = `/api/shops/${f.shop.id}/customers`;
  await f.call(`${customers}/phone`, { name: "Taro", phone: "090-1234-5678" });
  const find = async (number: string, who = "owner") => f.call(`${customers}/phone?number=${encodeURIComponent(number)}`, undefined, who);
  assert.equal((await find("０９０ １２３４ ５６７８")).body.name, "Taro");
  assert.equal((await find("090-9999-0000")).body.name, "");
  assert.equal((await find("x")).body.name, "");
  assert.equal((await find("090-1234-5678", "alice")).status, 403);
});

async function listedSlot(t: TestContext) {
  const f = await fixture(t), config = f.config, tiers = [{ hoursBefore: 0, percent: 0 }];
  const shop = (await f.store.shop(f.shop.id))!;
  shop.published = { ...config, rules: { ...config.rules, sameDay: true, leadMinutes: 0, payment: { enabled: true, refundTiers: tiers } } };
  shop.google = { folderId: "folder" } as typeof shop.google; await f.store.saveShop(shop); // Mail is queued only for a connected shop.
  const at = start(today, "13:00"), refunds: number[] = [];
  f.gateway.refund = async (_capture: string, amount: number, id: string, currency = "JPY") => { refunds.push(amount); return { id, status: "COMPLETED", amount: { currency_code: currency, value: paypalValue(amount, currency) } }; };
  const begun = await f.call(`/api/public/${f.shop.slug}/bookings`, { name: "Alice", menuId: f.menu.id, start: at, requestId: randomUUID(), expectedPrice: f.menu.price, paymentConsent: { amount: f.menu.price, policy: tiers } }, "alice");
  assert.equal(begun.status, 200, JSON.stringify(begun.body));
  const id = begun.body.checkout.id;
  await f.call(`/api/public/${f.shop.slug}/checkouts/${id}/capture`, {}, "alice");
  const quote = (await f.call(`/api/public/${f.shop.slug}/bookings/${id}/cancel-quote`, undefined, "alice")).body;
  assert.equal(quote.amount, 0, "cancelling alone refunds nothing");
  const listed = await f.call(`/api/public/${f.shop.slug}/bookings/${id}/cancel`, { expectedRefund: 0, expectedTransfer: quote.transfer }, "alice");
  assert.equal(listed.body.cancellationPending, true);
  const listing = (await f.call(`/api/shops/${f.shop.id}/operations`)).body.transferListings[0];
  const replace = (input = {}, who = "owner") => f.call(`/api/shops/${f.shop.id}/transfers/${listing.id}/phone`, { requestId: randomUUID(), name: "Hanako", phone: "03-1234-5678", expectedPrice: listing.price, ...input }, who);
  return { ...f, id, at, listing, replace, refunds };
}

test("the shop replaces a listed slot with a cash customer and raises the holder's refund to the promised amount", async t => {
  const f = await listedSlot(t), price = f.listing.price, mail: string[] = [], put = f.store.put.bind(f.store);
  t.mock.method(f.store, "put", async (kind: string, id: string, value: unknown) => { if (kind === "job") mail.push(String((value as { to?: string }).to)); return put(kind, id, value); });
  assert.equal((await f.call(`${f.base}/phone`, f.input(f.at))).status, 409, "the plain phone form cannot take a listed slot");
  assert.equal((await f.replace({}, "alice")).status, 403);
  assert.equal((await f.replace({ expectedPrice: price + 1 })).status, 409);
  assert.equal((await f.replace({ phone: "" })).status, 400, "a replacement requires a phone number");
  const requestId = randomUUID(), done = await f.replace({ requestId });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.booking.price, price); assert.equal(done.body.booking.customer, "tel:0312345678"); assert.equal(done.body.booking.start, f.at);
  assert.equal((await f.replace({ requestId })).body.booking.id, done.body.booking.id, "a retry returns the same booking");
  assert.deepEqual(f.refunds, [price], "refunded once, at the promised amount rather than the 0 for cancelling");
  const bookings = await f.store.bookings(f.shop.id);
  assert.deepEqual(bookings.map(b => [b.customer, b.status]).sort(), [["alice@example.com", "cancelled"], ["tel:0312345678", "active"]]);
  assert.equal(bookings.find(b => b.customer === "alice@example.com")!.payment!.cancellation!.amount, price);
  assert.equal((await f.replace()).status, 409, "the listing is closed");
  const mine = (await f.call(`/api/public/${f.shop.slug}/transfers/mine`, undefined, "alice")).body;
  assert.deepEqual([mine.selling[0].phase, mine.selling[0].refund.amount], ["sold", price]);
  assert.ok(mail.includes("alice@example.com"), "the original customer hears about the raised refund");
  assert.ok(!mail.some(to => to.startsWith("tel:")), "no mail is addressed to a phone customer");
});

test("a replacement is refused after the listing closes and for a later day", async t => {
  const f = await listedSlot(t);
  t.mock.timers.setTime(Date.parse(f.at) - 5 * 60000);
  await f.store.put("session", digest("owner"), { user: { email: f.shop.owner, name: "owner", role: "owner", shopId: f.shop.id }, expires: Date.parse(f.at) + 3600000 });
  assert.equal((await f.replace()).status, 409, "the listing closed ten minutes before the visit");
  const c = (await f.store.get<Checkout>("checkout", f.id))!;
  c.booking.start = start(tomorrow, "13:00"); await f.store.put("checkout", c.id, c);
  t.mock.timers.setTime(now + 3600000);
  await f.store.put("session", digest("owner"), { user: { email: f.shop.owner, name: "owner", role: "owner", shopId: f.shop.id }, expires: now + 7200000 });
  assert.equal((await f.replace()).status, 409);
  assert.deepEqual(f.refunds, []);
});
