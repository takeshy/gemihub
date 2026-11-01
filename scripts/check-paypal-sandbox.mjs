// Creates one unpaid Sandbox order, then reads it. Never captures or refunds money.
// Run: node --env-file-if-exists=.env --import tsx scripts/check-paypal-sandbox.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { paypalGateway, approvalUrl } from "../server/paypal.ts";
const gateway = paypalGateway();
assert.equal(gateway.environment, "sandbox", "This check is Sandbox-only");
const order = await gateway.create(`smoke-${randomUUID()}`, 100, "http://localhost:3000/?paypal=return", "http://localhost:3000/?paypal=cancel");
const saved = await gateway.order(order.id);
assert.equal(saved.id, order.id);
assert.ok(["CREATED", "PAYER_ACTION_REQUIRED"].includes(saved.status));
assert.equal(saved.purchase_units[0].amount.currency_code, "JPY");
assert.equal(saved.purchase_units[0].amount.value, "100");
assert.ok(approvalUrl(order, "sandbox"));
console.log("PayPal Sandbox: OAuth, JPY 100 order creation, approval URL and order lookup passed. No payment captured.");
