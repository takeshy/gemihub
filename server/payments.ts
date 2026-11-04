import { tr } from "../shared/i18n.ts";
import { randomUUID, createHash } from "node:crypto";
import type { Booking } from "./domain.ts";
import { refundQuote, type RefundTiers } from "./payment-domain.ts";
import { fromMinor, toMinor, type Currency } from "../shared/region.ts";
import { approvalUrl, PayPalError, type PaymentGateway, type PayPalOrder } from "./paypal.ts";
import type { Store } from "./store.ts";

export type Checkout = {
  id: string; shopId: string; customer: string; booking: Booking; policy: RefundTiers;
  environment: PaymentGateway["environment"];
  phase: "creating" | "awaiting_approval" | "capturing" | "captured" | "confirmed" | "expired" | "failed";
  expires: number; createdAt: number; captureAttemptedAt?: number;
  orderId?: string; approvalUrl?: string; review?: boolean;
  returnUrl: string; cancelUrl: string; synced?: string;
  /** The shop's currency when the checkout began; absent on older checkouts, which are yen. */
  currency?: Currency;
  /** Keep checkout branding stable if the shop is renamed while payment is pending. */
  brandName?: string;
};
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
export async function paymentHolds(store: Store, shopId: string, exclude?: string) {
  return (await store.list<Checkout>("checkout")).filter(c => c.shopId === shopId && c.id !== exclude &&
    (["capturing", "captured"].includes(c.phase) || (["creating", "awaiting_approval"].includes(c.phase) && c.expires > Date.now()))).map(c => c.booking);
}
export function checkoutView(c: Checkout) {
  return { id: c.id, phase: c.phase, expires: c.expires, approvalUrl: c.phase === "awaiting_approval" ? c.approvalUrl : undefined, review: !!c.review, start: c.booking.start, amount: c.booking.price, currency: c.currency || "JPY" };
}
// Callers hold the shop's booking/payment lock. Persist the journal BEFORE each PayPal mutation.
export function paymentService(store: Store, gateway: PaymentGateway, onChange: (booking: Booking, event: string) => Promise<void> = async () => {}) {
  const save = (c: Checkout) => store.put("checkout", c.id, c);
  function checkEnvironment(c: Checkout) {
    if (c.environment !== gateway.environment) fail(503, tr("この支払いのPayPal環境とサーバーの設定が一致しません。お店にお問い合わせください。"));
  }
  async function sync(c: Checkout) {
    const snapshot = createHash("sha256").update(JSON.stringify(c.booking)).digest("hex");
    if (c.synced !== snapshot) {
      await store.saveBooking(c.booking);
      c.synced = snapshot;
    }
    if (c.phase === "captured") c.phase = "confirmed";
    await save(c);
    const cancellation = c.booking.payment?.cancellation;
    await onChange(c.booking, cancellation ? `cancel-${cancellation.status}` : c.booking.status === "no_show" ? "no_show" : "paid");
  }
  async function create(c: Checkout) {
    checkEnvironment(c);
    if (["creating", "awaiting_approval"].includes(c.phase) && c.expires <= Date.now()) { c.phase = "expired"; await save(c); return c; }
    if (c.phase !== "creating") return c;
    const currency = c.currency || "JPY";
    const order = await gateway.create(c.id, toMinor(c.booking.price, currency), c.returnUrl, c.cancelUrl, currency, c.brandName);
    c.orderId = order.id;
    c.approvalUrl = approvalUrl(order, c.environment);
    c.phase = "awaiting_approval";
    await save(c);
    return c;
  }
  async function begin(booking: Booking, policy: RefundTiers, returnUrl: string, cancelUrl: string, currency: Currency = "JPY", brandName?: string) {
    await gateway.ready();
    let c = await store.get<Checkout>("checkout", booking.id);
    if (!c) {
      c = { id: booking.id, shopId: booking.shopId, customer: booking.customer, booking: structuredClone(booking), policy: structuredClone(policy), environment: gateway.environment, phase: "creating", createdAt: Date.now(), expires: Date.now() + 10 * 60000, returnUrl, cancelUrl, currency, ...(brandName ? { brandName } : {}) };
      await save(c);
    }
    return create(c);
  }
  function inspect(c: Checkout, order: PayPalOrder) {
    const units = order.purchase_units || [];
    if (order.id !== c.orderId || units?.length !== 1 || units[0].custom_id !== c.id) fail(503, tr("PayPalの注文内容を照合できません。お店にお問い合わせください。"));
    if (units[0].amount && (units[0].amount.currency_code !== (c.currency || "JPY") || Number(units[0].amount.value) !== c.booking.price)) fail(503, tr("PayPalの金額を照合できません。お店にお問い合わせください。"));
    const captures = units[0].payments?.captures || [];
    if (captures.length > 1) fail(503, tr("PayPalの支払い内容を確認してください。"));
    const capture = captures[0];
    if (capture && (capture.amount.currency_code !== (c.currency || "JPY") || Number(capture.amount.value) !== c.booking.price)) fail(503, tr("PayPalの決済金額を照合できません。"));
    return capture;
  }
  async function finish(c: Checkout, order: PayPalOrder) {
    const capture = inspect(c, order);
    if (!capture) return false;
    if (capture.status === "COMPLETED") {
      c.booking.payment = { provider: "paypal", environment: c.environment, orderId: c.orderId!, captureId: capture.id, amount: toMinor(c.booking.price, c.currency || "JPY"), currency: c.currency || "JPY", policy: structuredClone(c.policy) };
      c.phase = "captured";
      await save(c);
      await sync(c);
    } else if (["DECLINED", "DENIED", "FAILED"].includes(capture.status)) {
      c.phase = "failed"; await save(c);
    } // PENDING is not a confirmed reservation; the slot stays held until reconciled.
    return true;
  }
  async function capture(c: Checkout, available: () => Promise<boolean>) {
    checkEnvironment(c);
    if (c.phase === "confirmed" || c.phase === "captured") { await sync(c); return c; }
    if (c.review) { await finish(c, await gateway.order(c.orderId!)); return c; }
    if (!["awaiting_approval", "capturing"].includes(c.phase)) fail(409, tr("このお支払いは終了しています。空き枠から予約をやり直してください。"));
    const order = await gateway.order(c.orderId!);
    if (await finish(c, order)) return c;
    inspect(c, order);
    if (c.phase === "awaiting_approval") {
      if (c.expires <= Date.now() || !await available()) {
        c.phase = "expired"; await save(c);
        fail(409, tr("お支払い前に予約枠の期限または空き状況が変わりました。課金はしていません。空き枠から選び直してください。"));
      }
      if (order.status !== "APPROVED") fail(409, tr("PayPalでお支払いを承認してから予約を確定してください。"));
      c.phase = "capturing";
      c.captureAttemptedAt = Date.now();
      await save(c);
    }
    // Stop ambiguous writes before the Orders API's default 6-hour idempotency window expires.
    if (Date.now() - c.captureAttemptedAt! > 5 * 3600000) { c.review = true; await save(c); return c; }
    try {
      const result = await gateway.capture(c.orderId!, `cap-${c.id.slice(0, 32)}`);
      if (!await finish(c, result)) { c.review = true; await save(c); }
    }
    catch (error) {
      // Capture can have succeeded even if the response was lost. Never release its slot here.
      if (error instanceof PayPalError && error.definitive) {
        const latest = await gateway.order(c.orderId!);
        if (!await finish(c, latest)) { c.review = true; await save(c); }
      } else throw error;
    }
    return c;
  }
  async function refund(c: Checkout) {
    checkEnvironment(c);
    const payment = c.booking.payment!;
    const r = payment.cancellation!;
    if (["not_required", "completed", "manual_review"].includes(r.status)) { await sync(c); return; }
    if (!r.refundId && r.attemptedAt && Date.now() - Date.parse(r.attemptedAt) > 5 * 3600000) {
      r.status = "manual_review"; await save(c); await sync(c); return;
    }
    if (!r.attemptedAt) { r.attemptedAt = new Date().toISOString(); await save(c); }
    try {
      const result = r.refundId ? await gateway.refundStatus(r.refundId) : await gateway.refund(payment.captureId, r.amount, r.requestId, payment.currency);
      r.refundId = result.id;
      r.status = result.status === "COMPLETED" ? "completed" : result.status === "PENDING" ? "pending" : "manual_review";
      if (result.amount && (result.amount.currency_code !== payment.currency || Number(result.amount.value) !== fromMinor(r.amount, payment.currency))) r.status = "manual_review";
    } catch (error) {
      r.status = error instanceof PayPalError && error.issue === "REFUND_FAILED_INSUFFICIENT_FUNDS" ? "awaiting_funds"
        : error instanceof PayPalError && error.definitive ? "manual_review" : r.refundId ? "pending" : "retrying";
    }
    await save(c);
    await sync(c);
  }
  async function cancel(c: Checkout, by: string, reason: "customer" | "shop", at = new Date().toISOString()) {
    if (c.phase !== "confirmed" || !c.booking.payment) fail(409, tr("支払いを確認中です。確定後にキャンセルしてください。"));
    const payment = c.booking.payment!;
    if (!payment.cancellation) {
      if (c.booking.status !== "active") fail(409, tr("この予約は処理済みです"));
      const quote = refundQuote(payment.amount, c.booking.start, at, payment.policy, reason);
      c.booking.status = "cancelled";
      c.booking.updatedBy = by;
      c.booking.updatedAt = at;
      payment.cancellation = { ...quote, at, by, reason, status: quote.amount ? "retrying" : "not_required", requestId: randomUUID() };
      await save(c); // Freeze cancellation time, rate and amount even if Firestore/PayPal is unavailable.
    }
    await refund(c);
    return c.booking;
  }
  async function reconcile(shopId: string) {
    for (const c of (await store.list<Checkout>("checkout")).filter(c => c.shopId === shopId)) {
      try {
        if (c.phase === "capturing") await capture(c, async () => false);
        else if (c.phase === "captured") await sync(c);
        else if (c.phase === "confirmed") {
          if (c.booking.payment?.cancellation) await refund(c);
          else await sync(c);
        }
        else if (["creating", "awaiting_approval"].includes(c.phase) && c.expires <= Date.now()) { c.phase = "expired"; await save(c); }
      } catch { /* Durable intent is retried next minute, without logging payment/provider data. */ }
    }
  }
  return { begin, create, capture, cancel, reconcile, sync };
}
