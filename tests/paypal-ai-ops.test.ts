import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Store, bookingLockKey } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import type { AddressInfo } from "node:net";
import { sample, type Booking } from "../server/domain.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import type { Checkout } from "../server/payments.ts";
import type { PaymentGateway, PayPalOrder, PayPalRefund, PayPalTransaction } from "../server/paypal.ts";
import { paypalOps, relevantProposals } from "../server/paypal-ops.ts";
import type { Transfer } from "../server/transfers.ts";

process.env.DEMO_MODE = "true";

const money = (value: number) => ({ currency_code: "JPY", value: String(value) });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

function opsFor(store: Store, gateway = fakeGateway()) {
  return paypalOps({ store, gateway, reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid" });
}
function transferFixture(shopId: string, bookingId: string): Transfer {
  return {
    id: "transfer1", shopId, bookingId, seller: "alice@example.com", sellerName: "Alice", sellerCaptureId: "CAP1",
    environment: "sandbox", currency: "JPY", basis: 4950, price: 2475, discountPercent: 50,
    deadline: new Date(Date.now() + 30 * 60000).toISOString(), unsold: { percent: 0, amount: 0 },
    policy: structuredClone(defaultRefundTiers), phase: "listed", createdAt: new Date().toISOString(), attempts: 0,
  };
}

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

test("cancellation and transfer refunds expose their real IDs and manual-review proposals", async () => {
  const { store, shop, checkout, booking } = await setup();
  const ops = opsFor(store);
  for (const status of ["manual_review", "awaiting_funds", "pending"] as const) {
    checkout.booking.payment!.cancellation!.status = status;
    checkout.booking.transfers = [{
      id: "sold-transfer", at: checkout.booking.payment!.cancellation!.at,
      from: { customer: "previous@example.com", name: "Previous" }, to: { customer: booking.customer, name: booking.name },
      price: 4950, currency: "JPY", discountPercent: 10,
      previous: { orderId: "OLD_ORDER", captureId: "OLD_CAPTURE", amount: 5500 },
      refund: { amount: 4950, status, requestId: "TRANSFER_REQ", refundId: "TRANSFER_REF" },
    }];
    await store.put("checkout", checkout.id, checkout);
    const items = await ops.detect(shop, undefined, "none");
    const refunds = items.filter(item => item.kind === (status === "pending" ? "refund_stalled" : status));
    assert.deepEqual(refunds.map(item => item.paypalId).sort(), ["REF1", "TRANSFER_REF"]);
    for (const item of refunds) {
      assert.equal(item.paypalKind, "refund");
      assert.equal(item.proposal?.operation, status === "manual_review" ? "complete_manual_review" : "retry_refund");
      assert.equal(item.proposal?.targetId, item.paypalId);
    }
  }
  await store.close();
});

test("closing an unsold listing proposes its settlement refund, including zero, and invalidates changed amounts", async () => {
  const { store, shop, booking } = await setup();
  const transfer = transferFixture(shop.id, booking.id);
  await store.put("transfer", transfer.id, transfer);
  const ops = opsFor(store);
  const first = (await ops.detect(shop, undefined, "none")).find(item => item.kind === "unsold_slot")!;
  assert.equal(first.amount, 0);
  assert.equal(first.proposal?.amount, 0, "the resale price 2475 is never offered as a zero-refund settlement");
  transfer.unsold = { percent: 40, amount: 1980 };
  await store.put("transfer", transfer.id, transfer);
  const changed = (await ops.detect(shop, undefined, "none")).find(item => item.kind === "unsold_slot")!;
  assert.equal(changed.proposal?.amount, 1980);
  assert.notEqual(changed.fingerprint, first.fingerprint);
  await store.close();
});

test("pending USD checkout prices are normalized before ledger totals and approval cards", async () => {
  const { store, shop, checkout } = await setup();
  delete checkout.booking.payment;
  checkout.currency = "USD";
  checkout.booking.price = 49.50;
  checkout.phase = "capturing";
  checkout.captureAttemptedAt = Date.now() - 3600000;
  await store.put("checkout", checkout.id, checkout);
  const ops = opsFor(store), tools = (await ops.toolsFor(shop))!;
  const result = (await tools.invoke("ledger_find_booking_payments", { bookingId: checkout.booking.id })).result as { rows: { amount: number }[]; totals: { payment: number }[] };
  assert.equal(result.rows[0].amount, 49.5);
  assert.equal(result.totals[0].payment, 49.5);
  const item = (await ops.detect(shop, undefined, "none")).find(item => item.kind === "capture_stalled")!;
  assert.equal(item.currency, "USD");
  assert.equal(item.proposal?.amount, 4950);
  checkout.currency = "JPY"; checkout.booking.price = 4950;
  await store.put("checkout", checkout.id, checkout);
  assert.equal((await ops.detect(shop, undefined, "none")).find(item => item.kind === "capture_stalled")?.amount, 4950);
  await store.close();
});

test("transfer buyer stalls and review states alert and resync through the transfer reconciler", async () => {
  const { store, shop, booking } = await setup();
  const transfer = transferFixture(shop.id, booking.id), now = Date.now();
  transfer.buyer = { id: "buyer1", customer: "bob@example.com", name: "Bob", requestKey: "buy1", phase: "capturing", createdAt: now - 6 * 3600000, captureAttemptedAt: now - 6 * 3600000, expires: now - 5 * 3600000, orderId: "BUY_ORDER", returnUrl: "", cancelUrl: "", review: true };
  const ops = paypalOps({ store, gateway: fakeGateway(),
    reconcile: async () => { transfer.buyer!.phase = "failed"; transfer.buyer!.review = false; await store.put("transfer", transfer.id, transfer); },
    closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, appOrigin: () => "https://shop.invalid",
  });
  for (const [phase, age, review, expected] of [
    ["capturing", 6 * 3600000, true, true], ["captured", 3600000, false, true],
    ["capturing", 60000, false, false], ["creating", 60000, true, true], ["awaiting_approval", 3600000, false, false],
  ] as const) {
    Object.assign(transfer.buyer, { phase, review, captureAttemptedAt: now - age });
    await store.put("transfer", transfer.id, transfer);
    const item = (await ops.detect(shop, new Date(now), "none")).find(item => item.paypalId === "BUY_ORDER");
    assert.equal(!!item, expected, `${phase}/${age}/${review}`);
    if (item) { assert.equal(item.proposal?.operation, "resync"); assert.equal(item.proposal?.targetId, transfer.id); assert.equal(item.amount, transfer.price); }
  }
  Object.assign(transfer.buyer, { phase: "capturing", review: true });
  await store.put("transfer", transfer.id, transfer);
  const state = await ops.check(shop, { force: true, live: "none" });
  const item = state.items.find(item => item.paypalId === "BUY_ORDER")!;
  const result = await ops.execute(shop, { proposalId: item.proposal!.id, alertId: item.id, fingerprint: item.fingerprint }, shop.owner);
  assert.equal(result.ok, true);
  assert.ok(!result.state!.items.some(item => item.paypalId === "BUY_ORDER"));
  await store.close();
});

test("ledger-only consults never postpone live verification or urgent notification", async () => {
  const { store, shop, checkout } = await setup();
  const gateway = fakeGateway("COMPLETED", "REVERSED"); let notices = 0;
  const ops = paypalOps({ store, gateway, reconcile: async () => {}, closeTransfer: async () => {}, sync: async () => {}, recordHistory: async () => {}, notifyOwner: async () => { notices++; }, appOrigin: () => "https://shop.invalid" });
  await ops.check(shop, { force: true, live: "none", notify: false });
  assert.deepEqual(gateway.reads, []);
  assert.equal(await store.get("paypalAlertRun", shop.id), undefined);
  await ops.check(shop, { notify: true });
  assert.ok(gateway.reads.length > 0); assert.equal(notices, 1);
  const schedule = await store.get("paypalAlertRun", shop.id);
  gateway.reads.length = 0;
  await ops.check(shop, { force: true, live: "none", notify: false });
  assert.deepEqual(await store.get("paypalAlertRun", shop.id), schedule);
  await ops.check(shop, { notify: true });
  assert.deepEqual(gateway.reads, [], "a completed periodic check still throttles the next one");
  await store.put("paypalAlertRun", shop.id, { shopId: shop.id, checkedAt: new Date(Date.now() - 2 * 3600000).toISOString() });
  checkout.booking.payment!.cancellation!.status = "manual_review";
  await store.put("checkout", checkout.id, checkout);
  await ops.check(shop, { force: true, live: "none", notify: false });
  await ops.check(shop, { notify: true });
  assert.ok(gateway.reads.length > 0); assert.equal(notices, 2, "a new urgent finding is notified even immediately after a consult");
  await store.close();
});

test("notification settings wait for shop updates and preserve the latest revision and publication", async () => {
  const { store, shop } = await setup();
  const entered = deferred(), release = deferred();
  const writer = store.locked(shop.id, async () => {
    const latest = (await store.shop(shop.id))!; entered.resolve(); await release.promise;
    latest.revision += 1; latest.published!.name = "New publication";
    await store.saveShop(latest);
  });
  await entered.promise;
  const settings = opsFor(store).updateSettings(shop, { notify: false, digestHour: 17 });
  await new Promise(resolve => setImmediate(resolve)); release.resolve();
  await Promise.all([writer, settings]);
  const latest = (await store.shop(shop.id))!;
  assert.equal(latest.revision, shop.revision + 1);
  assert.equal(latest.published!.name, "New publication");
  assert.deepEqual(latest.paypalOps, { notify: false, digestHour: 17 });
  await store.close();
});

test("real refund event codes contribute to positive refund totals for this shop only", async () => {
  const { store, shop } = await setup();
  const gateway = fakeGateway();
  gateway.transactions = async () => [
    { transaction_id: "CAP1", transaction_event_code: "T0006", transaction_amount: money(4950) },
    { transaction_id: "REF1", paypal_reference_id: "CAP1", paypal_reference_id_type: "TXN", transaction_event_code: "T1107", transaction_amount: money(-2000) },
    { transaction_id: "AUTH_REF", paypal_reference_id: "CAP1", paypal_reference_id_type: "TXN", transaction_event_code: "T1120", transaction_amount: money(500) },
    { transaction_id: "FOREIGN_REF", paypal_reference_id: "FOREIGN_CAP", paypal_reference_id_type: "TXN", transaction_event_code: "T1107", transaction_amount: money(-99999) },
  ];
  const tools = (await opsFor(store, gateway).toolsFor(shop))!;
  const result = (await tools.invoke("paypal_list_transactions", { type: "all" })).result as { total: number; totals: { currency: string; payment: number; refund: number }[] };
  assert.equal(result.total, 3);
  assert.deepEqual(result.totals, [{ currency: "JPY", payment: 4950, refund: 2500 }]);
  await store.close();
});

test("HTTP proposal execution releases its booking lock before applying durable shop history", { timeout: 10000 }, async t => {
  const { store, shop } = await setup();
  const gateway = fakeGateway();
  const alert = (await opsFor(store, gateway).check(shop, { force: true, live: "none" })).items.find(item => item.kind === "refund_stalled")!;
  await store.put("session", digest("ops-owner"), { user: { email: shop.owner, role: "owner", name: "Owner", shopId: shop.id }, expires: Date.now() + 600000 });
  const server = createApp(store, undefined, undefined, undefined, gateway);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  const acquired = deferred(), proceed = deferred(), shopHeld = deferred();
  let executing = true;
  const originalLocked = store.locked.bind(store);
  const locked = mock.method(store, "locked", (id: string, action: () => Promise<unknown>) => originalLocked(id, async () => {
    if (id === bookingLockKey(shop.id) && executing) { executing = false; acquired.resolve(); await proceed.promise; }
    return action();
  }));
  t.after(async () => { proceed.resolve(); locked.mock.restore(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const response = fetch(`${origin}/api/shops/${shop.id}/paypal/proposals/execute`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=ops-owner", "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: alert.proposal!.id, alertId: alert.id, fingerprint: alert.fingerprint }) });
  await acquired.promise;
  const configuration = store.locked(shop.id, async () => {
    shopHeld.resolve();
    await store.locked(bookingLockKey(shop.id), async () => {});
    const latest = (await store.shop(shop.id))!;
    latest.revision++; await store.saveShop(latest);
  });
  await shopHeld.promise; proceed.resolve();
  const result = await response;
  assert.equal(result.status, 200);
  await configuration;
  const history = (await store.shop(shop.id))!.history.filter(entry => entry.summary.startsWith("PayPal"));
  assert.equal(history.length, 1);
  assert.match(history[0].request!, /owner@example.com/);
  const pending = await store.entries<{ applied: boolean }>("paypalHistory", shop);
  assert.equal(pending.length, 1); assert.equal(pending[0].value.applied, true);
  // The normal retry path drains the same intent without appending history again.
  const retry = await fetch(`${origin}/api/shops/${shop.id}/retry`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=ops-owner", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(retry.status, 200);
  assert.equal((await store.shop(shop.id))!.history.filter(entry => entry.summary.startsWith("PayPal")).length, 1);
});
