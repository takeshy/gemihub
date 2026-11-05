import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { sample, type Booking } from "../server/domain.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import type { Checkout } from "../server/payments.ts";
import type { PaymentGateway, PayPalOrder, PayPalRefund, PayPalTransaction } from "../server/paypal.ts";
import { paypalOps, relevantProposals } from "../server/paypal-ops.ts";

process.env.DEMO_MODE = "true";

const money = (value: number) => ({ currency_code: "JPY", value: String(value) });

function fakeGateway(refundStatusValue: "PENDING" | "COMPLETED" = "PENDING", captureStatusValue = "COMPLETED"): PaymentGateway & { reads: string[] } {
  const reads: string[] = [];
  const order: PayPalOrder = {
    id: "ORDER1", status: "COMPLETED",
    purchase_units: [{ custom_id: "b1", amount: money(4950), payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: money(4950) }] } }],
  };
  const transaction = (id: string, reference: string, type: string): PayPalTransaction => ({
    transaction_id: id, paypal_reference_id: reference, paypal_reference_id_type: type,
    transaction_initiation_date: "2026-11-04T10:00:00Z", transaction_amount: money(4950),
    transaction_status: "S", transaction_event_code: "T0006",
  });
  return {
    environment: "sandbox", reads,
    async ready() {},
    async create() { throw new Error("write is not available"); },
    async order(id) { reads.push(`order:${id}`); if (id !== "ORDER1") throw new Error("missing"); return structuredClone(order); },
    async capture() { throw new Error("write is not available"); },
    async refund() { throw new Error("write is not available"); },
    async refundStatus(id) { reads.push(`refund:${id}`); return { id, status: refundStatusValue, amount: money(4950) } satisfies PayPalRefund; },
    async captureStatus(id) { reads.push(`capture:${id}`); return { id, status: captureStatusValue, amount: money(4950) }; },
    async transactions() { reads.push("transactions"); return [transaction("TX1", "ORDER1", "ORDER"), transaction("TX2", "CAP1", "CAPTURE"), transaction("TX3", "REF1", "REFUND"), transaction("TX4", "OTHER", "ORDER")]; },
  };
}

async function setup() {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  const config = structuredClone(sample);
  config.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
  shop.published = config;
  await store.saveShop(shop);
  const attemptedAt = new Date(Date.now() - 3 * 3600000).toISOString();
  const booking: Booking = {
    id: "b1", shopId: shop.id, customer: "alice@example.com", name: "Alice", menuId: "simple", price: 4950,
    message: "", staffId: "aoi", start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 90000000).toISOString(),
    status: "active", createdAt: new Date().toISOString(),
    payment: {
      provider: "paypal", environment: "sandbox", orderId: "ORDER1", captureId: "CAP1", amount: 4950, currency: "JPY",
      policy: structuredClone(defaultRefundTiers),
      cancellation: { at: attemptedAt, by: "alice@example.com", reason: "customer", percent: 100, amount: 4950, status: "retrying", requestId: "REQ1", refundId: "REF1", attemptedAt },
    },
  };
  const checkout: Checkout = {
    id: booking.id, shopId: shop.id, customer: booking.customer, booking, policy: structuredClone(defaultRefundTiers),
    environment: "sandbox", phase: "confirmed", expires: Date.now() + 600000, createdAt: Date.now(), returnUrl: "", cancelUrl: "", orderId: "ORDER1",
  };
  await store.put("checkout", checkout.id, checkout);
  await store.saveBooking(booking);
  return { store, shop, booking, checkout };
}

test("PayPal tools are read-only and only accept IDs in the shop's own ledger", async () => {
  const { store, shop } = await setup();
  const gateway = fakeGateway();
  const ops = paypalOps({ store, gateway, reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
  const tools = await ops.toolsFor(shop);
  assert.ok(tools);
  assert.deepEqual(tools!.tools.map(tool => tool.name).sort(), ["ledger_find_booking_payments", "paypal_get_capture", "paypal_get_order", "paypal_get_refund", "paypal_list_transactions"]);
  const order = await tools!.invoke("paypal_get_order", { orderId: "ORDER1" });
  assert.equal((order.result as { status: string }).status, "COMPLETED");
  assert.equal(order.source?.path, "paypal:order:ORDER1");
  await assert.rejects(tools!.invoke("paypal_get_order", { orderId: "OTHER-ORDER" }), /このお店の記録にありません/);
  await assert.rejects(tools!.invoke("paypal_get_capture", { captureId: "OTHER-CAPTURE" }), /このお店の記録にありません/);
  await assert.rejects(tools!.invoke("paypal_get_refund", { refundId: "OTHER-REFUND" }), /このお店の記録にありません/);
  const ledger = await tools!.invoke("ledger_find_booking_payments", { bookingId: "b1" });
  assert.equal((ledger.result as { total: number }).total, 1);
  await assert.rejects(tools!.invoke("ledger_find_booking_payments", {}), /いずれかを指定/);
  const transactions = await tools!.invoke("paypal_list_transactions", { from: "2026-11-01T00:00:00Z", to: "2026-11-05T00:00:00Z" });
  const result = transactions.result as { total: number; transactions: { id: string }[] };
  assert.equal(result.total, 3, "transactions not tied to the ledger are removed");
  assert.ok(!JSON.stringify(result).includes("payer"), "payer details are never handed to the model");
});

test("alerts are detected from the ledger and the same unchanged item is not notified twice", async () => {
  const { store, shop, checkout } = await setup();
  let notices = 0;
  const payloads: string[] = [];
  const ops = paypalOps({
    store, gateway: fakeGateway("COMPLETED"), reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {},
    notifyOwner: async (_shop, subject, body) => { notices++; payloads.push(`${subject}\n${body}`); },
    appOrigin: () => "https://shop.invalid",
  });
  const first = await ops.check(shop, { notify: true, force: true, forceDigest: true });
  assert.equal(first.items.filter(item => item.kind === "refund_stalled").length, 1);
  assert.ok(first.items.some(item => item.kind === "state_mismatch"), "ledger retrying vs PayPal PENDING is a real mismatch");
  assert.equal(notices, 1);
  assert.match(payloads[0], /refund|返金/i);
  await ops.check(shop, { notify: true, force: true, forceDigest: true });
  assert.equal(notices, 1, "the same fingerprint is suppressed");
  checkout.booking.payment!.cancellation!.status = "pending";
  await store.put("checkout", checkout.id, checkout);
  await ops.check(shop, { notify: true, force: true, forceDigest: true });
  assert.equal(notices, 2, "a state change re-notifies");
});

test("a proposal executes through the existing reconcile path and expires when the ledger changes", async () => {
  const { store, shop, checkout } = await setup();
  let reconciled = 0, histories = 0;
  const ops = paypalOps({
    store, gateway: fakeGateway(),
    reconcile: async () => { reconciled++; },
    closeTransfer: async () => {},
    sync: async () => {},
    recordHistory: async () => { histories++; },
    appOrigin: () => "https://shop.invalid",
  });
  const state = await ops.check(shop, { notify: false, force: true });
  const item = state.items.find(value => value.kind === "refund_stalled");
  assert.ok(item?.proposal);
  const ok = await ops.execute(shop, { proposalId: item!.proposal!.id, alertId: item!.id, fingerprint: item!.fingerprint }, "owner@example.com");
  assert.equal(ok.ok, true);
  assert.equal(reconciled, 1);
  assert.equal(histories, 1);
  checkout.booking.payment!.cancellation!.status = "completed";
  checkout.booking.payment!.cancellation!.refundId = undefined;
  await store.put("checkout", checkout.id, checkout);
  const stale = await ops.execute(shop, { proposalId: item!.proposal!.id, alertId: item!.id, fingerprint: item!.fingerprint }, "owner@example.com");
  assert.equal(stale.ok, false);
  assert.match(stale.error, /状態が変わっています/);
});

test("ledger amounts reach the model in the same major units as PayPal, without customer email", async () => {
  const { store, shop, booking, checkout } = await setup();
  booking.payment!.currency = "USD";
  booking.payment!.amount = 4950;
  booking.payment!.cancellation!.amount = 4950;
  checkout.booking = booking;
  await store.put("checkout", checkout.id, checkout);
  const ops = paypalOps({ store, gateway: fakeGateway(), reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
  const tools = await ops.toolsFor(shop);
  const ledger = (await tools!.invoke("ledger_find_booking_payments", { customer: "alice@example.com" })).result as {
    totals: { currency: string; payment: number; refund: number }[]; rows: { amount: number; name: string; refund: { amount: number } }[];
  };
  assert.equal(ledger.rows[0].amount, 49.5, "$49.50 is 49.5, not 4950 cents");
  assert.equal(ledger.rows[0].refund.amount, 49.5);
  assert.deepEqual(ledger.totals, [{ currency: "USD", payment: 49.5, refund: 49.5 }]);
  assert.equal(ledger.rows[0].name, "Alice");
  assert.ok(!JSON.stringify(ledger).includes("alice@example.com"), "customer email is matched on the server but never returned");
  const transactions = (await tools!.invoke("paypal_list_transactions", { from: "2026-11-01T00:00:00Z", to: "2026-11-05T00:00:00Z", type: "all" })).result as { totals: { currency: string; refund: number }[] };
  assert.ok(transactions.totals.every(total => total.refund >= 0), "refund totals are positive");
});

test("a refunded capture is the expected PayPal state, not a mismatch", async () => {
  const { store, shop, checkout } = await setup();
  checkout.booking.payment!.cancellation!.status = "completed";
  await store.put("checkout", checkout.id, checkout);
  for (const status of ["REFUNDED", "PARTIALLY_REFUNDED"]) {
    const ops = paypalOps({ store, gateway: fakeGateway("COMPLETED", status), reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
    assert.deepEqual((await ops.check(shop, { force: true })).items, [], status);
  }
  const ops = paypalOps({ store, gateway: fakeGateway("COMPLETED", "REVERSED"), reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
  assert.ok((await ops.check(shop, { force: true })).items.some(item => item.kind === "state_mismatch" && item.paypalKind === "capture"));
});

test("live PayPal reads skip settled old payments and a ledger-only check keeps earlier mismatches", async () => {
  const { store, shop, checkout } = await setup();
  const gateway = fakeGateway("COMPLETED", "REVERSED");
  const ops = paypalOps({ store, gateway, reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
  const first = await ops.check(shop, { force: true });
  assert.ok(first.items.some(item => item.kind === "state_mismatch"));
  gateway.reads.length = 0;
  const ledgerOnly = await ops.check(shop, { force: true, live: "none" });
  assert.deepEqual(gateway.reads, [], "a consult question does not read PayPal for every booking");
  assert.ok(ledgerOnly.items.some(item => item.kind === "state_mismatch"), "earlier live findings are kept");
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  checkout.createdAt = Date.now() - 30 * 86400000;
  Object.assign(checkout.booking.payment!.cancellation!, { status: "completed", at: old, attemptedAt: old });
  await store.put("checkout", checkout.id, checkout);
  gateway.reads.length = 0;
  await ops.check(shop, { force: true });
  assert.deepEqual(gateway.reads, [], "settled payments older than the window are not re-read");
});

test("manual review without a refund ID has no proposal, and consult proposals follow the named booking", async () => {
  const { store, shop, checkout } = await setup();
  Object.assign(checkout.booking.payment!.cancellation!, { status: "manual_review", refundId: undefined });
  await store.put("checkout", checkout.id, checkout);
  const ops = paypalOps({ store, gateway: fakeGateway(), reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
  const state = await ops.check(shop, { force: true });
  const item = state.items.find(value => value.kind === "manual_review");
  assert.ok(item && !item.proposal, "nothing can be read back from PayPal without a refund ID");
  const proposal = (id: string, bookingId: string, paypalId: string) => ({
    id, kind: "refund_stalled" as const, severity: "medium" as const, bookingId, paypalId, target: id, fingerprint: id,
    proposal: { id, operation: "retry_refund" as const, alertId: id, bookingId, target: id, expected: "", fingerprint: id },
  });
  const items = [proposal("p1", "booking-aaaaaaaa", "REFUND-AAAA"), proposal("p2", "booking-bbbbbbbb", "REFUND-BBBB")];
  assert.deepEqual(relevantProposals(items, ["What about REFUND-BBBB?"]).map(value => value.id), ["p2"]);
  assert.deepEqual(relevantProposals(items, ["Anything stuck?"]).map(value => value.id), ["p1", "p2"]);
});
