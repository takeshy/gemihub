import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { sample, type Booking } from "../server/domain.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import type { Checkout } from "../server/payments.ts";
import type { PaymentGateway, PayPalOrder, PayPalRefund, PayPalTransaction } from "../server/paypal.ts";
import { paypalOps } from "../server/paypal-ops.ts";

process.env.DEMO_MODE = "true";

const money = (value: number) => ({ currency_code: "JPY", value: String(value) });

function fakeGateway(refundStatusValue: "PENDING" | "COMPLETED" = "PENDING"): PaymentGateway & { reads: string[] } {
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
    async captureStatus(id) { reads.push(`capture:${id}`); return { id, status: "COMPLETED", amount: money(4950) }; },
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
  const ops = paypalOps({ store, gateway, reconcile: async () => {}, closeTransfer: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
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
    store, gateway: fakeGateway("COMPLETED"), reconcile: async () => {}, closeTransfer: async () => {}, recordHistory: async () => {},
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
