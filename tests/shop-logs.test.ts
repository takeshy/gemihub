import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.ts";
import { ShopLogs, customerLogKey, loggedPaymentGateway, logRoute, type ShopLog } from "../server/shop-logs.ts";
import { PayPalError, type PaymentGateway } from "../server/paypal.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";

process.env.DEMO_MODE = "true";

test("concurrent requests retain tenant and request isolation and redact route parameters", async () => {
  const store = new Store(":memory:"), logs = new ShopLogs(store);
  logs.record({ kind: "error", ok: false, operation: "unscoped" });
  await Promise.all(["one", "two"].map(shopId => logs.run(shopId, async () => {
    logs.record({ kind: "access", ok: true, operation: "first" });
    await new Promise(resolve => setImmediate(resolve));
    logs.record({ kind: "error", ok: false, operation: "second" });
  })));
  await logs.drain();
  const end = new Date(Date.now() + 1000).toISOString();
  const one = await store.queryShopLogs("one", new Date(0).toISOString(), end, 100);
  const two = await store.queryShopLogs("two", new Date(0).toISOString(), end, 100);
  assert.equal(one.length, 2); assert.equal(two.length, 2);
  assert.equal(one[0].requestId, one[1].requestId);
  assert.notEqual(one[0].requestId, two[0].requestId);
  assert.equal(logRoute("/api/shops/secret-id/customers/alice%40example.com"), "/api/shops/:id/customers/:id");
  await store.close();
});

test("PayPal diagnostics preserve results and errors without persisting credentials or response bodies", async () => {
  const store = new Store(":memory:"), logs = new ShopLogs(store);
  const error = new PayPalError(false, undefined, 403, "DEBUG123");
  const gateway = loggedPaymentGateway({ environment: "sandbox", async order() { return { id: "ORDER1", status: "COMPLETED", payer: { email_address: "secret@example.com" }, access_token: "secret-token" }; }, async refund() { throw error; } } as unknown as PaymentGateway, logs);
  await logs.run("one", async () => {
    assert.equal((await gateway.order("ORDER1")).status, "COMPLETED");
    await assert.rejects(gateway.refund("CAPTURE1", 100, "secret-request"), value => value === error);
  });
  await logs.drain();
  const rows = await store.queryShopLogs("one", new Date(0).toISOString(), new Date().toISOString(), 100);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => !row.ok)?.debugId, "DEBUG123");
  assert.equal(rows.find(row => !row.ok)?.upstreamStatus, 403);
  assert.equal(rows.find(row => row.ok)?.providerStatus, "COMPLETED");
  assert.ok(!/secret@example|secret-token|secret-request|email_address|payer/.test(JSON.stringify(rows)));
  store.appendShopLog = async () => { throw new Error("storage unavailable"); };
  await logs.run("one", () => gateway.order("ORDER1"));
  await logs.drain(); // Storage failure cannot change the payment result or become an unhandled rejection.
});

test("search and CRM history enforce tenant, customer, time and scan bounds", async () => {
  const store = new Store(":memory:"), logs = new ShopLogs(store);
  logs.activity("one", "alice@example.com", "login");
  logs.activity("one", "bob@example.com", "mypage_view");
  logs.activity("two", "alice@example.com", "reserve_view");
  await logs.drain();
  const own = await logs.customerActivity("one", " ALICE@example.com ");
  assert.deepEqual(own.rows.map(row => row.operation), ["login"]);
  assert.ok(!/alice@|customerKey|shopId/.test(JSON.stringify(own)));
  const tools = logs.toolsFor("one");
  await assert.rejects(tools.invoke("search_shop_logs", { shopId: "two" }));
  await assert.rejects(tools.invoke("search_shop_logs", { from: "2020-01-01T00:00:00Z" }));
  const edge = await tools.invoke("search_shop_logs", { from: new Date(Date.now() - 91 * 86400000).toISOString(), to: new Date(Date.now() - 80 * 86400000).toISOString() });
  assert.ok(Date.parse((edge.result as { from: string }).from) >= Date.now() - 90 * 86400000 - 1000, "a start just past retention is clamped rather than refused");
  await assert.rejects(tools.invoke("delete_shop_logs", {}));
  const found = await tools.invoke("search_shop_logs", { customer: "alice@example.com" });
  assert.equal((found.result as { matched: number }).matched, 1);
  assert.equal(found.source?.path, "logs:shop");
  assert.notEqual(customerLogKey("one", "alice@example.com"), customerLogKey("two", "alice@example.com"));
  const at = new Date(Date.now() - 1000).toISOString();
  await Promise.all(Array.from({ length: 5002 }, (_, i) => store.appendShopLog({ id: String(i), shopId: "busy", requestId: randomUUID(), at, kind: "access", operation: "GET /", ok: true })));
  const result = (await logs.toolsFor("busy").invoke("search_shop_logs", {})).result as { matched: number; scanTruncated: boolean; rowsTruncated: boolean; rows: unknown[]; summary: { count: number }[] };
  assert.equal(result.matched, 5000); assert.equal(result.scanTruncated, true); assert.equal(result.rowsTruncated, true);
  assert.equal(result.rows.length, 100); assert.equal(result.summary[0].count, 5000);
});

test("log search clamps a future end and finds old failures and references beyond 5000 newer successes", async () => {
  const store = new Store(":memory:"), logs = new ShopLogs(store), now = Date.now();
  const base = { shopId: "busy", requestId: "request-old", at: new Date(now - 60000).toISOString(), ok: false };
  await store.appendShopLog({ ...base, id: "old-error", kind: "error", operation: "POST /bookings", status: 500 });
  await store.appendShopLog({ ...base, id: "old-paypal", kind: "paypal", operation: "refund", refundId: "REF-OLD" });
  await Promise.all(Array.from({ length: 5010 }, (_, i) => store.appendShopLog({ ...base, id: `access-${i}`, at: new Date(now - 1000).toISOString(), requestId: `request-${i}`, ok: true, kind: "access", operation: "GET /" })));
  const tools = logs.toolsFor("busy");
  const errors = (await tools.invoke("search_shop_logs", { kind: "error", failuresOnly: true, to: new Date(now + 86400000).toISOString() })).result as { to: string; matched: number; scanTruncated: boolean; rows: ShopLog[] };
  assert.equal(errors.matched, 1); assert.equal(errors.scanTruncated, false); assert.equal(errors.rows[0].id, "old-error");
  assert.ok(Date.parse(errors.to) >= now && Date.parse(errors.to) <= Date.now());
  const paypal = (await tools.invoke("search_shop_logs", { kind: "paypal", failuresOnly: true, reference: "REF-OLD" })).result as { matched: number; rows: ShopLog[] };
  assert.equal(paypal.matched, 1); assert.equal(paypal.rows[0].id, "old-paypal");
});

test("Firestore applies predicates before limit for combined log searches", async () => {
  const store = new Store(":memory:"), predicates: unknown[][] = [];
  const query = { where(...args: unknown[]) { predicates.push(args); return this; }, orderBy() { return this; }, limit(value: number) { assert.equal(value, 100); assert.ok(predicates.some(([key]) => key === "references")); return this; }, async get() { return { docs: [] }; } };
  Object.defineProperty(store, "memory", { value: false });
  Object.assign(store, { firestore: { collection: () => ({ doc: () => ({ collection: () => query }) }) } });
  await store.queryShopLogs("own", new Date(Date.now() - 86400000).toISOString(), new Date().toISOString(), 100, "customer-key", { kind: "paypal", failuresOnly: true, reference: "REF" });
  assert.ok(predicates.some(([field, op, value]) => field === "kind" && op === "==" && value === "paypal"));
  assert.ok(predicates.some(([field, op, value]) => field === "ok" && op === "==" && value === false));
  assert.ok(predicates.some(([field, op, value]) => field === "customerKey" && op === "==" && value === "customer-key"));
  assert.ok(predicates.some(([field, op, value]) => field === "references" && op === "array-contains" && value === "REF"));
});

test("business activity is recorded after commit and has one immutable receipt across retries", async () => {
  const store = new Store(":memory:"), logs = new ShopLogs(store);
  const history = () => logs.customerActivity("own", "guest@example.com");
  await assert.rejects(store.transaction(async () => {
    logs.activity("own", "guest@example.com", "booking_completed", "b1");
    await store.transaction(async () => { logs.activity("own", "guest@example.com", "booking_cancelled", "b1"); });
    throw new Error("receipt write failed");
  }));
  await logs.drain(); assert.equal((await history()).rows.length, 0);
  for (let attempt = 0; attempt < 3; attempt++) await store.transaction(async () => {
    logs.activity("own", "guest@example.com", "booking_completed", "b1");
    logs.activity("own", "guest@example.com", "booking_cancelled", "b1");
    await store.put("receipt", "b1", { ok: true });
  });
  await logs.drain();
  const first = await history(); assert.equal(first.rows.length, 2);
  logs.activity("own", "guest@example.com", "booking_completed", "b1");
  logs.activity("own", "guest@example.com", "booking_cancelled", "b1");
  await logs.drain(); assert.deepEqual((await history()).rows, first.rows, "retry preserves IDs and timestamps");
  logs.activity("own", "guest@example.com", "booking_completed", "b1", "transfer-1");
  logs.activity("own", "guest@example.com", "booking_completed", "b1", "transfer-2");
  await logs.drain(); assert.equal((await history()).rows.length, 4, "separate transfer outcomes are separate events");
});

test("scheduled coupon failures retain tenant and operation, and request errors inherit the current operation", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  const records = store.records.bind(store);
  t.mock.method(store, "records", async (...args: Parameters<typeof store.records>) => {
    if (args[0] === "couponCampaign") throw Object.assign(new Error("coupon read failed"), { code: "UNAVAILABLE" });
    return records(...args);
  });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  t.mock.timers.tick(60000);
  let found = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    found = (await store.queryShopLogs(shop.id, new Date(Date.now() - 60000).toISOString(), new Date().toISOString(), 100)).some(row => row.kind === "error" && row.operation === "issue_coupons" && row.errorCode === "UNAVAILABLE");
    if (found) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(found, "the scheduled error belongs to the coupon job's shop");
  const logs = new ShopLogs(store);
  logs.run(shop.id, () => { logs.setOperation("POST /api/shops/:id/publish"); logs.error(new Error("private request error")); });
  await logs.drain();
  const rows = await store.queryShopLogs(shop.id, new Date(Date.now() - 60000).toISOString(), new Date().toISOString(), 100);
  assert.ok(rows.some(row => row.operation === "POST /api/shops/:id/publish"));
});

test("customer screen events reach CRM, while foreign customers and unauthenticated callers cannot write or read them", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  const other = await store.createShop("other@example.com"); other.published = structuredClone(sample); other.publication = "public"; await store.saveShop(other);
  const server = createApp(store); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  const post = (path: string, data: unknown, cookie = "") => fetch(base + path, { method: "POST", headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const login = async (role: string, email: string, shopId: string) => (await post("/api/demo-login", { role, email, shopId })).headers.get("set-cookie")!.split(";")[0];
  const owner = await login("owner", shop.owner, shop.id), customer = await login("customer", "guest@example.com", shop.id), foreign = await login("customer", "guest@example.com", other.id);
  const eventPath = `/api/public/${shop.slug}/activity`;
  assert.equal((await post(eventPath, { event: "reserve_view" }, customer)).status, 200);
  assert.equal((await post(eventPath, { event: "mypage_view" }, customer)).status, 200);
  assert.equal((await post(eventPath, { event: "login", email: "someone@example.com" }, customer)).status, 400);
  assert.equal((await post(eventPath, { event: "reserve_view" })).status, 403);
  assert.equal((await post(eventPath, { event: "reserve_view" }, foreign)).status, 403);
  const crm = `/api/shops/${shop.id}/customers/guest%40example.com/activity`;
  assert.equal((await fetch(base + crm, { headers: { Cookie: customer } })).status, 403);
  const response = await fetch(base + crm, { headers: { Cookie: owner } }); assert.equal(response.status, 200);
  const history = await response.json() as { rows: { operation: string }[] };
  assert.deepEqual(history.rows.map(row => row.operation).sort(), ["login", "mypage_view", "reserve_view"]);
  const rows: ShopLog[] = await store.queryShopLogs(shop.id, new Date(0).toISOString(), new Date().toISOString(), 100);
  assert.ok(rows.some(row => row.kind === "error" && row.status === 403));
  assert.ok(rows.some(row => row.kind === "access" && row.status === 200));
  assert.ok(!JSON.stringify(rows).includes("guest@example.com"));
});
