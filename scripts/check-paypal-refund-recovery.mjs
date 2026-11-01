// Sandbox-only replay of a lost response for an ALREADY COMPLETED full refund.
// The same request ID/amount must return the same refund ID. No new capture is made.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { paypalGateway } from "../server/paypal.ts";
assert.equal(process.env.PAYPAL_ENVIRONMENT, "sandbox");
const journal = JSON.parse(await readFile("tmp/paypal-e2e-journal.json", "utf8"));
const expected = journal.results.shop;
assert.equal(expected.refundStatus, "completed");
const checkout = structuredClone(Object.values(journal.checkouts).find(c => c.booking.payment?.captureId === expected.captureId));
const refund = checkout.booking.payment.cancellation;
assert.equal(refund.reason, "shop");
assert.equal(refund.amount, checkout.booking.payment.amount);
assert.ok(Date.now() - Date.parse(refund.attemptedAt) < 5 * 3600000, "Replay is limited to the safe idempotency window");
refund.status = "awaiting_funds";
delete refund.refundId;
await writeFile("tmp/paypal-refund-replay-intent.json", JSON.stringify({ checkoutId: checkout.id, captureId: expected.captureId, requestId: refund.requestId, amount: refund.amount, expectedRefundId: expected.refundId }, null, 2), { mode: 0o600 });
const store = new Store(":memory:");
await store.saveShop(journal.shop);
await store.put("checkout", checkout.id, checkout);
await store.saveBooking(checkout.booking);
await store.put("session", digest("recovery-owner"), { user: { email: journal.shop.owner, name: "Sandbox owner", role: "owner", shopId: journal.shop.id }, expires: Date.now() + 600000 });
let refundPosts = 0;
const gateway = paypalGateway(async (url, init) => {
  const path = new URL(url).pathname;
  assert.ok(String(url).startsWith("https://api-m.sandbox.paypal.com/"));
  assert.ok(path === "/v1/oauth2/token" || path === `/v2/payments/captures/${expected.captureId}/refund`, "Recovery must not create another order or capture");
  if (path.endsWith("/refund")) {
    refundPosts++;
    assert.equal(init.headers["PayPal-Request-Id"], refund.requestId);
    assert.equal(JSON.parse(init.body).amount.value, String(expected.refundAmount));
  }
  return fetch(url, init);
});
const server = createApp(store, undefined, undefined, undefined, gateway);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
try {
  const res = await fetch(`${origin}/api/shops/${journal.shop.id}/retry`, { method: "POST", headers: { Origin: origin, Cookie: "omai_session=recovery-owner", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 200);
  const recovered = (await store.get("checkout", checkout.id)).booking.payment.cancellation;
  assert.equal(refundPosts, 1);
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.refundId, expected.refundId);
  assert.equal(recovered.amount, expected.refundAmount);
  await writeFile("tmp/paypal-refund-replay-results.json", JSON.stringify({ environment: "sandbox", applicationRetryAPI: true, refundId: recovered.refundId, refundAmount: recovered.amount, status: recovered.status, sameRefundId: true, newCaptures: 0 }, null, 2), { mode: 0o600 });
  console.log("Sandbox application recovery passed: the original request ID returned the same completed JPY 5,500 refund. No additional capture or refund was created.");
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
