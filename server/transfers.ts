import { tr } from "../shared/i18n.ts";
import { randomUUID, createHash } from "node:crypto";
import type { Booking } from "./domain.ts";
import type { RefundTiers } from "./payment-domain.ts";
import { transferTerms, type BookingTransfer, type TransferTerms } from "./transfer-domain.ts";
import { fromMinor, type Currency } from "../shared/region.ts";
import { approvalUrl, PayPalError, type PaymentGateway, type PayPalOrder } from "./paypal.ts";
import type { Checkout, paymentService } from "./payments.ts";
import type { Store } from "./store.ts";

export type TransferBuyer = {
  /** PayPal custom_id and idempotency base; one per checkout attempt on the listing. */
  id: string; customer: string; name: string; requestKey: string;
  phase: "creating" | "awaiting_approval" | "capturing" | "captured" | "expired" | "failed";
  expires: number; createdAt: number; captureAttemptedAt?: number;
  orderId?: string; approvalUrl?: string; captureId?: string; review?: boolean;
  returnUrl: string; cancelUrl: string; brandName?: string;
};
export type Transfer = {
  id: string; shopId: string; bookingId: string;
  seller: string; sellerName: string; sellerCaptureId: string;
  environment: PaymentGateway["environment"]; currency: Currency;
  basis: number; discountPercent: number; price: number; deadline: string;
  unsold: TransferTerms["unsold"]; policy: RefundTiers;
  phase: "listed" | "withdrawn" | "sold" | "expired";
  createdAt: string; closedAt?: string;
  attempts: number;
  buyer?: TransferBuyer;
  /** Event side effects commit with these acknowledgements, so a crash can safely retry them. */
  notified?: Partial<Record<TransferEvent, boolean>>;
};
export type TransferEvent = "listed" | "sold" | "expired";
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const holdMinutes = 10;
/** A buyer checkout that blocks withdrawal, settlement and other buyers. */
export const buyerBusy = (t: Transfer, now = Date.now()) => !!t.buyer &&
  (["capturing", "captured"].includes(t.buyer.phase) || (["creating", "awaiting_approval"].includes(t.buyer.phase) && t.buyer.expires > now));
export const pendingTransferRefund = (booking: Booking) => (booking.transfers || []).some(entry => ["retrying", "pending", "awaiting_funds"].includes(entry.refund.status));

// Callers hold the shop's booking/payment lock. Persist the journal BEFORE each PayPal mutation.
export function transferService(store: Store, gateway: PaymentGateway, payments: ReturnType<typeof paymentService>, onEvent: (transfer: Transfer, booking: Booking, event: TransferEvent) => Promise<void> = async () => {}) {
  const save = (t: Transfer) => store.put("transfer", t.id, t);
  const saveCheckout = (c: Checkout) => store.put("checkout", c.id, c);
  const forShop = async (shopId: string) => (await store.list<Transfer>("transfer")).filter(t => t.shopId === shopId);
  async function notifyEvent(t: Transfer, booking: Booking, event: TransferEvent) {
    if (t.notified?.[event]) return;
    const notified = { ...t.notified, [event]: true };
    await store.transaction(async () => {
      await onEvent(t, booking, event);
      await store.put("transfer", t.id, { ...t, notified });
    });
    t.notified = notified;
  }
  async function active(shopId: string, bookingId: string) {
    return (await forShop(shopId)).find(t => t.bookingId === bookingId && t.phase === "listed");
  }
  function checkEnvironment(environment: string) {
    if (environment !== gateway.environment) fail(503, tr("この支払いのPayPal環境とサーバーの設定が一致しません。お店にお問い合わせください。"));
  }
  /** Current terms for the holder, or a reason it cannot be listed. */
  async function quote(c: Checkout, at = new Date().toISOString()): Promise<{ terms?: TransferTerms; reason?: string }> {
    const p = c.booking.payment;
    if (c.phase !== "confirmed" || !p) return { reason: tr("支払いを確認中です。確定後に操作してください。") };
    if (c.booking.status !== "active" || p.cancellation) return { reason: tr("この予約は処理済みです") };
    if (await active(c.shopId, c.booking.id)) return { reason: tr("この予約はすでにキャンセルを受け付けています") };
    if (pendingTransferRefund(c.booking)) return { reason: tr("前の予約者への返金を確認中です。完了後にお試しください。") };
    const terms = transferTerms(p, c.booking.start, at);
    return terms ? { terms } : { reason: tr("通常のキャンセル条件で返金します。") };
  }
  async function list(c: Checkout, seller: string, expected: { price: number; deadline: string }, at = new Date().toISOString()) {
    checkEnvironment(c.environment);
    if (c.customer !== seller) fail(404, tr("予約がありません"));
    const { terms, reason } = await quote(c, at);
    if (!terms) return fail(409, reason!);
    if (expected.price !== terms.price || expected.deadline !== terms.deadline) fail(409, tr("キャンセル条件が変わりました。内容を確認し直してください。"));
    const p = c.booking.payment!;
    const t: Transfer = {
      id: createHash("sha256").update(randomUUID()).digest("hex"), shopId: c.shopId, bookingId: c.booking.id,
      seller, sellerName: c.booking.name, sellerCaptureId: p.captureId, environment: p.environment, currency: p.currency,
      basis: terms.basis, discountPercent: terms.discountPercent, price: terms.price, deadline: terms.deadline, unsold: terms.unsold,
      policy: structuredClone(p.policy), phase: "listed", createdAt: at, attempts: 0,
    };
    await save(t);
    await notifyEvent(t, c.booking, "listed");
    return t;
  }
  async function withdraw(t: Transfer, at = new Date().toISOString()) {
    if (t.phase !== "listed") fail(409, tr("この空き枠の受付は終了しています"));
    if (buyerBusy(t)) fail(409, tr("代わりに利用する方がお支払い手続き中のため、キャンセルは取り消せません。"));
    t.phase = "withdrawn"; t.closedAt = at;
    await save(t);
    return t;
  }
  /** Before any cancellation of the booking: withdraw an idle listing, refuse while a transferee is paying. */
  async function release(shopId: string, bookingId: string) {
    const t = await active(shopId, bookingId);
    if (!t) return;
    if (buyerBusy(t)) fail(409, tr("代わりに利用する方の決済が進行中です。完了または期限切れの後に操作してください。"));
    await withdraw(t);
  }
  async function createOrder(t: Transfer) {
    const b = t.buyer!;
    checkEnvironment(t.environment);
    if (["creating", "awaiting_approval"].includes(b.phase) && b.expires <= Date.now()) { b.phase = "expired"; await save(t); return t; }
    if (b.phase !== "creating") return t;
    const order = await gateway.create(b.id, t.price, b.returnUrl, b.cancelUrl, t.currency, b.brandName);
    b.orderId = order.id;
    b.approvalUrl = approvalUrl(order, t.environment);
    b.phase = "awaiting_approval";
    await save(t);
    return t;
  }
  async function begin(t: Transfer, buyer: { customer: string; name: string; requestKey: string }, returnUrl: string, cancelUrl: string, brandName?: string) {
    await gateway.ready();
    checkEnvironment(t.environment);
    if (t.buyer && t.buyer.requestKey === buyer.requestKey) {
      if (t.buyer.customer !== buyer.customer || t.buyer.name !== buyer.name) fail(409, tr("予約内容が変更されています。空き枠から選び直してください。"));
      return createOrder(t);
    }
    if (t.phase !== "listed" || Date.now() >= Date.parse(t.deadline)) fail(409, tr("この空き枠の受付は終了しています"));
    if (buyer.customer === t.seller) fail(409, tr("ご自身がキャンセルした枠は予約できません。"));
    if (buyerBusy(t)) fail(409, tr("ほかの方がお支払い手続き中です。少し時間をおいてご確認ください。"));
    t.attempts++;
    t.buyer = { id: createHash("sha256").update(`${t.id}:${t.attempts}`).digest("hex"), ...buyer, phase: "creating", createdAt: Date.now(), expires: Date.now() + holdMinutes * 60000, returnUrl, cancelUrl, ...(brandName ? { brandName } : {}) };
    await save(t);
    return createOrder(t);
  }
  function inspect(t: Transfer, order: PayPalOrder) {
    const b = t.buyer!;
    const units = order.purchase_units || [];
    const value = fromMinor(t.price, t.currency);
    if (order.id !== b.orderId || units.length !== 1 || units[0].custom_id !== b.id) fail(503, tr("PayPalの注文内容を照合できません。お店にお問い合わせください。"));
    if (units[0].amount && (units[0].amount.currency_code !== t.currency || Number(units[0].amount.value) !== value)) fail(503, tr("PayPalの金額を照合できません。お店にお問い合わせください。"));
    const captures = units[0].payments?.captures || [];
    if (captures.length > 1) fail(503, tr("PayPalの支払い内容を確認してください。"));
    const capture = captures[0];
    if (capture && (capture.amount.currency_code !== t.currency || Number(capture.amount.value) !== value)) fail(503, tr("PayPalの決済金額を照合できません。"));
    return capture;
  }
  async function finish(t: Transfer, order: PayPalOrder) {
    const capture = inspect(t, order);
    if (!capture) return false;
    if (capture.status === "COMPLETED") {
      t.buyer!.captureId = capture.id;
      t.buyer!.phase = "captured";
      await save(t);
      await applySale(t);
    } else if (["DECLINED", "DENIED", "FAILED"].includes(capture.status)) {
      t.buyer!.phase = "failed"; await save(t);
    } // PENDING keeps the listing reserved for this buyer until reconciled.
    return true;
  }
  async function capture(t: Transfer) {
    const b = t.buyer || fail(404, tr("お支払いの記録がありません"));
    checkEnvironment(t.environment);
    if (b.phase === "captured") { await applySale(t); return t; }
    if (b.review) { await finish(t, await gateway.order(b.orderId!)); return t; }
    if (!["awaiting_approval", "capturing"].includes(b.phase)) fail(409, tr("このお支払いは終了しています。空き枠の一覧から選び直してください。"));
    const order = await gateway.order(b.orderId!);
    if (await finish(t, order)) return t;
    inspect(t, order);
    if (b.phase === "awaiting_approval") {
      // The listing deadline does not cut off a checkout already started; only its own hold does.
      if (b.expires <= Date.now() || t.phase !== "listed") {
        b.phase = "expired"; await save(t);
        fail(409, tr("お支払い前に手続きの期限が過ぎました。課金はしていません。"));
      }
      if (order.status !== "APPROVED") fail(409, tr("PayPalでお支払いを承認してから予約を確定してください。"));
      b.phase = "capturing";
      b.captureAttemptedAt = Date.now();
      await save(t);
    }
    if (Date.now() - b.captureAttemptedAt! > 5 * 3600000) { b.review = true; await save(t); return t; }
    try {
      const result = await gateway.capture(b.orderId!, `tcap-${b.id.slice(0, 32)}`);
      if (!await finish(t, result)) { b.review = true; await save(t); }
    } catch (error) {
      if (error instanceof PayPalError && error.definitive) {
        const latest = await gateway.order(b.orderId!);
        if (!await finish(t, latest)) { b.review = true; await save(t); }
      } else throw error;
    }
    return t;
  }
  /** After the transferee's capture: hand over the booking, then refund the same amount to the previous holder. */
  async function applySale(t: Transfer) {
    const b = t.buyer!;
    const c = await store.get<Checkout>("checkout", t.bookingId);
    let entry = c?.booking.transfers?.find(entry => entry.id === t.id);
    if (!c) return fail(503, tr("PayPalの支払い内容を確認してください。"));
    if (!entry) {
      const p = c.booking.payment;
      // Cancellations are refused while a transferee pays; anything else needs an operator.
      if (c.phase !== "confirmed" || !p || p.cancellation || c.booking.status !== "active" || p.captureId !== t.sellerCaptureId) {
        b.review = true; await save(t); return;
      }
      const at = new Date().toISOString();
      entry = {
        id: t.id, at, from: { customer: t.seller, name: c.booking.name, ...(c.booking.message ? { message: c.booking.message } : {}) }, to: { customer: b.customer, name: b.name },
        price: t.price, currency: t.currency, discountPercent: t.discountPercent,
        previous: { orderId: p.orderId, captureId: p.captureId, amount: p.amount },
        refund: { amount: t.price, status: "retrying", requestId: randomUUID() },
      } satisfies BookingTransfer;
      c.booking.transfers = [...(c.booking.transfers || []), entry];
      c.booking.customer = b.customer;
      c.booking.name = b.name;
      // Keep the previous holder's message only in the operator-visible history.
      c.booking.message = "";
      c.booking.payment = { provider: "paypal", environment: t.environment, orderId: b.orderId!, captureId: b.captureId!, amount: t.price, currency: t.currency, policy: structuredClone(p.policy) };
      c.booking.updatedBy = b.customer; c.booking.updatedAt = at;
      c.customer = b.customer;
      t.phase = "sold"; t.closedAt = at;
      // The holder change and the refund intent are written together, before calling PayPal.
      await store.transaction(async () => { await saveCheckout(c); await save(t); });
    } else if (t.phase !== "sold") { t.phase = "sold"; t.closedAt = entry.at; await save(t); }
    await refundSeller(c, entry);
    await notifyEvent(t, c.booking, "sold");
  }
  async function refundSeller(c: Checkout, entry: BookingTransfer) {
    checkEnvironment(c.environment);
    const r = entry.refund;
    if (["completed", "manual_review"].includes(r.status)) { await payments.sync(c); return; }
    if (!r.refundId && r.attemptedAt && Date.now() - Date.parse(r.attemptedAt) > 5 * 3600000) {
      r.status = "manual_review"; await saveCheckout(c); await payments.sync(c); return;
    }
    if (!r.attemptedAt) { r.attemptedAt = new Date().toISOString(); await saveCheckout(c); }
    try {
      const result = r.refundId ? await gateway.refundStatus(r.refundId) : await gateway.refund(entry.previous.captureId, r.amount, r.requestId, entry.currency);
      r.refundId = result.id;
      r.status = result.status === "COMPLETED" ? "completed" : result.status === "PENDING" ? "pending" : "manual_review";
      if (result.amount && (result.amount.currency_code !== entry.currency || Number(result.amount.value) !== fromMinor(r.amount, entry.currency))) r.status = "manual_review";
    } catch (error) {
      r.status = error instanceof PayPalError && error.issue === "REFUND_FAILED_INSUFFICIENT_FUNDS" ? "awaiting_funds"
        : error instanceof PayPalError && error.definitive ? "manual_review" : r.refundId ? "pending" : "retrying";
    }
    await saveCheckout(c);
    await payments.sync(c);
  }
  /** An unsold listing settles as the cancellation at its deadline: the best terms available then. */
  async function settle(t: Transfer) {
    const c = await store.get<Checkout>("checkout", t.bookingId);
    const p = c?.booking.payment;
    if (c && p && p.captureId === t.sellerCaptureId && (p.cancellation || c.booking.status === "active"))
      await payments.cancel(c, t.seller, "customer", t.deadline);
    t.phase = "expired"; t.closedAt = new Date().toISOString();
    await save(t);
    if (c) await notifyEvent(t, c.booking, "expired");
  }
  async function reconcile(shopId: string) {
    const now = Date.now();
    for (const t of await forShop(shopId)) {
      try {
        const b = t.buyer;
        if (t.phase === "listed" && b?.phase === "captured") await applySale(t);
        else if (t.phase === "listed" && b?.phase === "capturing") await capture(t);
        else if (b && ["creating", "awaiting_approval"].includes(b.phase) && b.expires <= now) { b.phase = "expired"; await save(t); }
        if (t.phase === "listed" && now >= Date.parse(t.deadline) && !buyerBusy(t, now)) await settle(t);
        const event = t.phase;
        if (event !== "withdrawn" && !t.notified?.[event]) {
          const c = await store.get<Checkout>("checkout", t.bookingId);
          if (c) await notifyEvent(t, c.booking, event);
        }
      } catch { /* Durable intent is retried next minute, without logging payment/provider data. */ }
    }
    for (const c of (await store.list<Checkout>("checkout")).filter(c => c.shopId === shopId && c.phase === "confirmed" && pendingTransferRefund(c.booking))) {
      try { for (const entry of c.booking.transfers!) if (["retrying", "pending", "awaiting_funds"].includes(entry.refund.status)) await refundSeller(c, entry); }
      catch { /* Retried next minute. */ }
    }
  }
  return { quote, list, withdraw, release, begin, createOrder, capture, reconcile, active, forShop };
}
