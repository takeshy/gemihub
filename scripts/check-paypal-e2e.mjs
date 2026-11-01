// Real Sandbox captures/refunds through the application API. Never runs against Live.
// Uses PayPal's documented static test card for buyer approval, in this test only.
// May attach an official test card to an unfunded Sandbox buyer account.
// The durable journal allows interrupted captures/refunds to be reconciled on rerun.
import assert from "node:assert/strict";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST, slots } from "../server/domain.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import { paypalGateway } from "../server/paypal.ts";
assert.equal(process.env.PAYPAL_ENVIRONMENT, "sandbox", "Sandbox must be explicitly selected");
process.env.DEMO_MODE = "true";
const buyerFile = process.env.PAYPAL_BUYER_FILE || "tmp/paypal.personal.json";
let buyer;
try { buyer = JSON.parse(await readFile(buyerFile, "utf8")); assert.ok(buyer.email && buyer.password); } catch (e) { if (e.code !== "ENOENT" || process.env.PAYPAL_BUYER_FILE) throw new Error("Check the Sandbox buyer credential file; credentials are never printed."); }
let browser;
const journalFile = "tmp/paypal-e2e-journal.json";
await mkdir("tmp", { recursive: true });
let journal;
try { journal = JSON.parse(await readFile(journalFile, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
journal ||= { checkouts: {}, requests: {}, results: {} };
async function persist() { await writeFile(journalFile + ".new", JSON.stringify(journal, null, 2), { mode: 0o600 }); await rename(journalFile + ".new", journalFile); }
class DurableSandboxStore extends Store {
  async put(kind, id, value) {
    await super.put(kind, id, value);
    if (kind === "checkout") { journal.checkouts[id] = structuredClone(value); await persist(); }
  }
}
const store = new DurableSandboxStore(":memory:");
const shop = journal.shop || await store.createShop("owner@example.com");
const config = structuredClone(sample); config.hours.closedWeekdays = [];
config.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
shop.published = config; journal.shop = shop; await store.saveShop(shop); await persist();
for (const [id, c] of Object.entries(journal.checkouts)) { await store.put("checkout", id, c); if (c.phase === "confirmed") await store.saveBooking(c.booking); }
for (const id of ["owner", "alice"]) {
  const user = { email: `${id}@example.com`, name: id, role: id === "owner" ? "owner" : "customer", shopId: shop.id };
  await store.put("session", digest(id), { user, expires: Date.now() + 3600000 });
  if (id === "alice") await store.put("customer", `${shop.id}:${user.email}`, { shopId: shop.id, ...user, birthDate: "1990-01-01", gender: "not_specified" });
}
let sandboxAuthorization;
const gateway = paypalGateway(async (url, init) => {
  assert.ok(String(url).startsWith("https://api-m.sandbox.paypal.com/"));
  if (init?.headers?.Authorization?.startsWith("Bearer ")) sandboxAuthorization = init.headers.Authorization;
  let request = init;
  // Only the approval preparation differs: no payer source so the documented test card can be confirmed.
  if (!buyer && String(url).endsWith("/v2/checkout/orders") && init?.method === "POST") {
    const data = JSON.parse(init.body); delete data.payment_source;
    request = { ...init, body: JSON.stringify(data) };
  }
  const res = await fetch(url, request);
  if (!res.ok) {
    const error = await res.clone().json().catch(() => ({}));
    console.log(JSON.stringify({ paypalHttpStatus: res.status, name: error.name, issues: error.details?.map(d => d.issue) }));
  }
  return res;
});
const server = createApp(store, undefined, undefined, undefined, gateway);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
const base = `/api/public/${shop.slug}`;
async function api(path, body, user = "alice") {
  const res = await fetch(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `omai_session=${user}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await res.json(); assert.equal(res.status, 200, JSON.stringify(result)); return result;
}
async function approve(c) {
  const current = await gateway.order(c.orderId);
  if (["APPROVED", "COMPLETED"].includes(current.status)) return;
  if (buyer) {
    browser ||= await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
    const page = await browser.newPage({ locale: "en-US" });
    page.setDefaultTimeout(20000);
    let stage = "open";
    try {
      await page.goto(c.approvalUrl, { waitUntil: "domcontentloaded" });
      if (await page.locator("#email").isVisible()) {
        stage = "email";
        await page.locator("#email").fill(buyer.email);
        if (await page.locator("#btnNext").isVisible()) { await page.locator("#btnNext").click(); await page.locator("#btnNext").waitFor({ state: "hidden" }); }
        stage = "password";
        await page.locator("#password").fill(buyer.password);
        await page.locator("#btnLogin").click();
      }
      stage = "approval";
      const pay = page.locator("#payment-submit-btn, [data-testid='submit-button-initial'], [data-id='payment-submit-btn']").or(page.getByRole("button", { name: /^(同意して続行|同意して支払う|Agree.*|Pay Now|支払う)$/i })).first();
      try { await pay.click({ timeout: 10000 }); } catch (error) {
        if (["APPROVED", "COMPLETED"].includes((await gateway.order(c.orderId)).status)) return;
        const funding = page.getByRole("link", { name: /クレジットカード・デビットカードを登録|Link a debit or credit card/i }).first();
        if (!await funding.isVisible()) throw error;
        stage = "funding-card";
        await funding.click();
        await page.locator("#cardNumber").fill("4012888888881881");
        await page.locator("#expDate").fill("12/30");
        await page.locator("#verificationCode").fill("123");
        await page.getByRole("button", { name: /^(カードの登録|Link Card)$/i }).click();
        await page.waitForTimeout(3000);
        const done = page.getByRole("button", { name: /^(完了|Done)$/i });
        if (await done.isVisible()) await done.click();
        stage = "approval-after-card";
        await pay.click({ timeout: 30000 });
      }
      stage = "approval-status";
      for (let attempt = 0; attempt < 15; attempt++) {
        if (["APPROVED", "COMPLETED"].includes((await gateway.order(c.orderId)).status)) return;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new Error("Sandbox buyer approval is still pending. Check PayPal, then rerun this journal.");
    } catch (error) {
      const redact = value => String(value).split(buyer.email).join("[buyer]").split(buyer.password).join("[password]");
      const controls = await page.locator("input,button,a").evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().width && n.getBoundingClientRect().height).map(n => ({ tag: n.tagName, id: n.id, type: n.getAttribute("type"), text: (n.innerText || "").slice(0, 100) }))).catch(() => []);
      await writeFile("tmp/paypal-approval-diagnostic.json", redact(JSON.stringify({ stage, error: error.message, controls, pageText: await page.locator("body").innerText().catch(() => ""), messages: await page.locator("[role=alert],.notification-critical,.errorMessage,.error-message").allTextContents().catch(() => []) }, null, 2)), { mode: 0o600 });
      const text = await page.locator("body").innerText().catch(() => "");
      if (text.includes("売り手のアカウント") || /seller.s account/i.test(text)) throw new Error("Use a different Personal Sandbox buyer account; the supplied account is the receiving merchant.");
      throw new Error(`Sandbox buyer approval stopped at ${stage}. Redacted diagnostics saved locally.`);
    }
    finally { await page.close(); }
  }
  const requestId = journal.requests[`approve-${c.id}`] ||= randomUUID(); await persist();
  const res = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${c.orderId}/confirm-payment-source`, { method: "POST", headers: { Authorization: sandboxAuthorization, "Content-Type": "application/json", "PayPal-Request-Id": requestId }, body: JSON.stringify({ payment_source: { card: { number: "4012000077777777", expiry: "2030-12", security_code: "123", name: "Sandbox Test Buyer", billing_address: { address_line_1: "2211 N First Street", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" } } } }) });
  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify({ step: "Sandbox test card approval", status: res.status, name: result.name, issues: result.details?.map(d => d.issue) }));
  assert.ok(["APPROVED", "COMPLETED"].includes(result.status), `Sandbox approval requires payer action: ${result.status}`);
}
try {
  for (const reason of ["customer", "shop"]) {
    if (journal.results[reason]?.refundStatus === "completed") {
      const refund = await gateway.refundStatus(journal.results[reason].refundId);
      assert.equal(refund.status, "COMPLETED");
      assert.equal(refund.amount?.currency_code, "JPY");
      assert.equal(Number(refund.amount?.value), journal.results[reason].refundAmount);
      console.log(`${reason}: previous completed Sandbox refund verified with PayPal.`); continue;
    }
    let c = Object.values(journal.checkouts).findLast(c => c.booking.message === `Sandbox E2E ${reason}` && !["expired", "failed"].includes(c.phase));
    if (c && ["creating", "awaiting_approval"].includes(c.phase) && c.expires <= Date.now()) {
      const order = c.orderId ? await gateway.order(c.orderId) : undefined;
      const captured = order?.purchase_units?.some(unit => unit.payments?.captures?.length);
      if (captured) { c.phase = "capturing"; c.captureAttemptedAt ||= Date.now(); await store.put("checkout", c.id, c); }
      else { await api(`${base}/checkouts/${c.id}/abandon`, {}); c = undefined; delete journal.requests[reason]; await persist(); }
    }
    if (!c) {
      const requestId = journal.requests[reason] ||= randomUUID(); await persist();
      const day = dateJST(new Date(Date.now() + 2 * 86400000));
      const slot = slots(config, await store.bookings(shop.id), day, "simple")[reason === "shop" ? 1 : 0]; assert.ok(slot);
      const start = await api(`${base}/bookings`, { name: "Sandbox Test Buyer", message: `Sandbox E2E ${reason}`, requestId, menuId: "simple", staffId: slot.staffId, start: slot.start, paymentConsent: { amount: 5500, policy: defaultRefundTiers } });
      c = journal.checkouts[start.checkout.id];
    }
    if (c.phase !== "confirmed") {
      await approve(c);
      const result = await api(`${base}/checkouts/${c.id}/capture`, {});
      assert.equal(result.ok, true, "Capture must complete before cancellation");
      assert.equal(result.booking.payment.amount, 5500);
      c = journal.checkouts[c.id];
    }
    if (reason === "customer") {
      const quote = await api(`${base}/bookings/${c.id}/cancel-quote`); assert.equal(quote.amount, 2750);
      await api(`${base}/bookings/${c.id}/cancel`, { expectedRefund: quote.amount });
    } else await api(`/api/shops/${shop.id}/bookings/${c.id}/status`, { status: "cancelled" }, "owner");
    c = journal.checkouts[c.id];
    const r = c.booking.payment.cancellation;
    assert.equal(r.amount, reason === "customer" ? 2750 : 5500);
    if (r.status === "pending") { await api(`/api/shops/${shop.id}/retry`, {}, "owner"); c = journal.checkouts[c.id]; }
    journal.results[reason] = { orderId: c.orderId, captureId: c.booking.payment.captureId, paidAmount: c.booking.payment.amount, refundId: c.booking.payment.cancellation.refundId, refundAmount: c.booking.payment.cancellation.amount, refundStatus: c.booking.payment.cancellation.status };
    await persist();
    assert.equal(journal.results[reason].refundStatus, "completed", "Run again to reconcile pending provider state");
    console.log(JSON.stringify({ reason, ...journal.results[reason] }));
  }
  console.log("Sandbox E2E passed: application capture JPY 5,500, customer refund JPY 2,750, shop refund JPY 5,500.");
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
