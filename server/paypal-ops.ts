import { tr } from "../shared/i18n.ts";
import { createHash } from "node:crypto";
import { currencyOf, dateIn, formatMinor, fromMinor, regionOf, toMinor, type Currency } from "../shared/region.ts";
import { requestLocale } from "./i18n.ts";
import type { ToolDeclaration } from "./llm.ts";
import type { Source } from "./assistant.ts";
import { isRefundTransaction, type PaymentGateway } from "./paypal.ts";
import { bookingLockKey, type Store, type Shop } from "./store.ts";
import type { Checkout } from "./payments.ts";
import type { Booking } from "./domain.ts";
import { buyerBusy, type Transfer } from "./transfers.ts";
import { z } from "zod";

// PayPal is read through this module only for explanation. Every mutating action stays in the
// existing payment/transfer services, behind an owner approval of a server-built proposal.

export type PayPalSeverity = "high" | "medium" | "low";
export type PayPalAlertKind = "refund_stalled" | "awaiting_funds" | "manual_review" | "capture_stalled" | "state_mismatch" | "unsold_slot";
export type PayPalProposalOperation = "retry_refund" | "resync" | "complete_manual_review" | "close_transfer";
export type PayPalProposal = {
  id: string;
  operation: PayPalProposalOperation;
  alertId: string;
  bookingId?: string;
  targetId?: string;
  targetKind?: "order" | "capture" | "refund" | "transfer";
  target: string;
  amount?: number;
  currency?: Currency;
  expected: string;
  fingerprint: string;
};
export type PayPalAlertItem = {
  id: string;
  kind: PayPalAlertKind;
  severity: PayPalSeverity;
  bookingId?: string;
  bookingLabel?: string;
  target: string;
  amount?: number;
  currency?: Currency;
  paypalId?: string;
  paypalKind?: "order" | "capture" | "refund";
  since?: string;
  elapsedHours?: number;
  fingerprint: string;
  proposal?: PayPalProposal;
};
export type PayPalAlertState = {
  shopId: string;
  checkedAt: string;
  summary: string;
  items: PayPalAlertItem[];
};
export type PayPalToolProvider = {
  tools: ToolDeclaration[];
  invoke: (name: string, args: Record<string, unknown> | undefined) => Promise<{ result: unknown; source?: Source }>;
};

export type PayPalOpsOptions = {
  store: Store;
  gateway: PaymentGateway;
  /** Reconcile this shop's payments and transfers; execute already holds the booking lock. */
  reconcile: (shopId: string) => Promise<void>;
  closeTransfer: (shopId: string, transferId: string) => Promise<void>;
  /** The payment service's own ledger sync (booking save, confirmation, owner/customer notices). */
  sync: (checkout: Checkout) => Promise<void>;
  /** Persist a history intent only; must not acquire the shop lock while execute holds the booking lock. */
  recordHistory: (shopId: string, entry: Shop["history"][number]) => Promise<void>;
  notifyOwner?: (shop: Shop, subject: string, body: string) => Promise<void>;
  summarize?: (items: PayPalAlertItem[], locale: "ja" | "en") => Promise<string | undefined>;
  appOrigin: () => string;
};

type RefKind = "order" | "capture" | "refund";
type LedgerRef = { kind: RefKind; id: string; bookingId: string; transferId?: string };
type LedgerEntry = {
  bookingId: string;
  start: string;
  /** Used only for server-side lookups; never handed to the model. */
  customer: string;
  name: string;
  amount: number;
  currency: Currency;
  environment: string;
  orderId?: string;
  captureId?: string;
  captureStatus?: string;
  refund?: { id?: string; amount: number; status: string; requestId: string };
  transfers: { id: string; at: string; amount: number; currency: Currency; refund: { id?: string; amount: number; status: string; requestId: string } }[];
};
type Ledger = { checkouts: Checkout[]; entries: LedgerEntry[]; refs: Map<string, LedgerRef> };

const isCurrency = (value: string | undefined): value is Currency => value === "JPY" || value === "USD";
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const hours = (from: string | number | undefined, now: number) => {
  const at = typeof from === "number" ? from : Date.parse(from || "");
  return Number.isFinite(at) ? Math.max(0, (now - at) / 3600000) : undefined;
};
const stallHours = () => {
  const value = Number(process.env.PAYPAL_REFUND_STALL_HOURS || 2);
  return Number.isFinite(value) && value >= 0 ? value : 2;
};
const captureStallMinutes = () => {
  const value = Number(process.env.PAYPAL_CAPTURE_STALL_MINUTES || 15);
  return Number.isFinite(value) && value >= 0 ? value : 15;
};
const unsoldWarningMinutes = 120;
const ledgerLimit = 50;
/** Live PayPal verification covers open refunds and payments active in this window, newest first. */
const liveWindowMs = 7 * 86400000;
const liveLimit = 30;
const checkIntervalMs = () => {
  const value = Number(process.env.PAYPAL_ALERT_INTERVAL_MINUTES || 60);
  return (Number.isFinite(value) && value > 0 ? value : 60) * 60000;
};

function addRef(refs: Map<string, LedgerRef>, kind: RefKind, id: string | undefined, bookingId: string, transferId?: string) {
  if (!id) return;
  const key = `${kind}:${id}`;
  if (!refs.has(key)) refs.set(key, { kind, id, bookingId, ...(transferId ? { transferId } : {}) });
}
function owned(refs: Map<string, LedgerRef>, kind: RefKind, id: string) {
  return refs.get(`${kind}:${id}`);
}
async function readLedger(store: Store, shop: Shop): Promise<Ledger> {
  const checkouts = (await store.list<Checkout>("checkout")).filter(c => c.shopId === shop.id);
  const refs = new Map<string, LedgerRef>();
  const entries = new Map<string, LedgerEntry>();
  for (const c of checkouts) {
    if (!c.booking?.id) continue;
    const p = c.booking.payment;
    if (c.orderId) addRef(refs, "order", c.orderId, c.booking.id);
    if (p) {
      addRef(refs, "order", p.orderId, c.booking.id);
      addRef(refs, "capture", p.captureId, c.booking.id);
      if (p.cancellation?.refundId) addRef(refs, "refund", p.cancellation.refundId, c.booking.id);
    }
    for (const entry of c.booking.transfers || []) {
      addRef(refs, "order", entry.previous.orderId, c.booking.id, entry.id);
      addRef(refs, "capture", entry.previous.captureId, c.booking.id, entry.id);
      addRef(refs, "refund", entry.refund.refundId, c.booking.id, entry.id);
    }
    if (!p && !c.orderId) continue;
    entries.set(c.booking.id, {
      bookingId: c.booking.id,
      start: c.booking.start,
      customer: c.customer,
      name: c.booking.name || "",
      amount: p?.amount ?? toMinor(c.booking.price, c.currency ?? currencyOf(regionOf(shop.published))),
      currency: p?.currency ?? c.currency ?? currencyOf(regionOf(shop.published)),
      environment: p?.environment ?? c.environment,
      ...(p ? { orderId: p.orderId, captureId: p.captureId } : c.orderId ? { orderId: c.orderId } : {}),
      ...(p?.cancellation ? { refund: { ...(p.cancellation.refundId ? { id: p.cancellation.refundId } : {}), amount: p.cancellation.amount, status: p.cancellation.status, requestId: p.cancellation.requestId } } : {}),
      transfers: (c.booking.transfers || []).map(entry => ({ id: entry.id, at: entry.at, amount: entry.refund.amount, currency: entry.currency, refund: { ...(entry.refund.refundId ? { id: entry.refund.refundId } : {}), amount: entry.refund.amount, status: entry.refund.status, requestId: entry.refund.requestId } })),
    });
  }
  // A transfer's buyer checkout can exist before the booking has a confirmed payment.
  for (const t of (await store.list<Transfer>("transfer")).filter(t => t.shopId === shop.id)) {
    addRef(refs, "order", t.buyer?.orderId, t.bookingId, t.id);
    addRef(refs, "capture", t.buyer?.captureId, t.bookingId, t.id);
    addRef(refs, "capture", t.sellerCaptureId, t.bookingId, t.id);
  }
  return { checkouts, entries: [...entries.values()], refs };
}

function toolProvider(store: Store, gateway: PaymentGateway, shop: Shop, ledger: Ledger): PayPalToolProvider {
  const sources = new Map<string, Source>();
  const keep = (path: string, title: string) => { const source = { path, title }; sources.set(path, source); return source; };
  const requireRef = (kind: RefKind, id: string) => {
    if (!owned(ledger.refs, kind, id)) throw new Error(tr("この取引はこのお店の記録にありません"));
  };
  const amount = (value: { currency_code: string; value: string } | undefined) => value ? { amount: Number(value.value), currency: value.currency_code } : undefined;
  const period = (from?: string, to?: string) => {
    const now = new Date();
    const end = to ? new Date(to) : now;
    if (!Number.isFinite(end.getTime())) throw new Error(tr("期間の日時を確認してください"));
    const start = from ? new Date(from) : new Date(end.getTime() - 7 * 86400000);
    if (!Number.isFinite(start.getTime()) || start.getTime() > end.getTime()) throw new Error(tr("期間の日時を確認してください"));
    const earliest = end.getTime() - 31 * 86400000;
    return { start: new Date(Math.max(start.getTime(), earliest)).toISOString(), end: end.toISOString() };
  };
  const ownedIds = new Set([...ledger.refs.values()].map(ref => ref.id));
  const lookup = z.object({
    bookingId: z.string().max(200).optional(),
    customer: z.string().max(300).optional(),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
  });
  const tools: ToolDeclaration[] = [
    { name: "paypal_get_order", description: tr("このお店のPayPal注文を読み取る。注文IDは台帳にあるものだけ。"), parametersJsonSchema: { type: "object", properties: { orderId: { type: "string", description: tr("台帳にある注文ID") } }, required: ["orderId"] } },
    { name: "paypal_get_capture", description: tr("このお店のPayPal決済を読み取る。決済IDは台帳にあるものだけ。"), parametersJsonSchema: { type: "object", properties: { captureId: { type: "string", description: tr("台帳にある決済ID") } }, required: ["captureId"] } },
    { name: "paypal_get_refund", description: tr("このお店のPayPal返金を読み取る。返金IDは台帳にあるものだけ。"), parametersJsonSchema: { type: "object", properties: { refundId: { type: "string", description: tr("台帳にある返金ID") } }, required: ["refundId"] } },
    { name: "paypal_list_transactions", description: tr("このお店のPayPal取引を期間で読み取る。期間は最大31日。返すのは台帳にひも付く取引だけ。"), parametersJsonSchema: { type: "object", properties: {
      from: { type: "string", description: tr("開始日時（ISO 8601、省略時は7日前）") },
      to: { type: "string", description: tr("終了日時（ISO 8601、省略時は現在）") },
      type: { type: "string", enum: ["all", "payment", "refund"], description: tr("取引の種別") },
    } } },
    { name: "ledger_find_booking_payments", description: tr("このお店の台帳から予約とPayPalの注文・決済・返金の対応を探す。予約ID・顧客・期間のいずれかを指定する。"), parametersJsonSchema: { type: "object", properties: {
      bookingId: { type: "string", description: tr("予約ID") },
      customer: { type: "string", description: tr("顧客のメールアドレスまたは名前") },
      from: { type: "string", description: tr("開始日時（ISO 8601）") },
      to: { type: "string", description: tr("終了日時（ISO 8601）") },
    } } },
  ];
  async function invoke(name: string, args: Record<string, unknown> | undefined) {
    if (name === "paypal_get_order") {
      const id = z.object({ orderId: z.string().min(1).max(200) }).parse(args).orderId;
      requireRef("order", id);
      const order = await gateway.order(id);
      const units = order.purchase_units || [];
      const capture = units[0]?.payments?.captures?.[0];
      const source = keep(`paypal:order:${id}`, tr("PayPal注文 {0}（{1}）", id, order.status));
      return { result: { id: order.id, status: order.status, amount: amount(units[0]?.amount), ...(capture ? { captureId: capture.id, captureStatus: capture.status } : {}) }, source };
    }
    if (name === "paypal_get_capture") {
      const id = z.object({ captureId: z.string().min(1).max(200) }).parse(args).captureId;
      requireRef("capture", id);
      if (!gateway.captureStatus) throw new Error(tr("PayPalの決済照会を利用できません"));
      const capture = await gateway.captureStatus(id);
      const source = keep(`paypal:capture:${id}`, tr("PayPal決済 {0}（{1}）", id, capture.status));
      return { result: { id: capture.id, status: capture.status, amount: amount(capture.amount), refundedAmount: amount(capture.seller_receivable_breakdown?.total_refunded_amount), createdAt: capture.create_time, updatedAt: capture.update_time }, source };
    }
    if (name === "paypal_get_refund") {
      const id = z.object({ refundId: z.string().min(1).max(200) }).parse(args).refundId;
      requireRef("refund", id);
      const refund = await gateway.refundStatus(id);
      const source = keep(`paypal:refund:${id}`, tr("PayPal返金 {0}（{1}）", id, refund.status));
      return { result: { id: refund.id, status: refund.status, amount: amount(refund.amount), reason: refund.note_to_payer }, source };
    }
    if (name === "paypal_list_transactions") {
      const input = z.object({ from: z.string().optional(), to: z.string().optional(), type: z.enum(["all", "payment", "refund"]).default("all") }).parse(args || {});
      if (!gateway.transactions) throw new Error(tr("PayPalの取引検索を利用できません"));
      const range = period(input.from, input.to);
      const rows = await gateway.transactions({ ...range, type: input.type });
      const mine = rows.filter(row => [row.transaction_id, row.paypal_reference_id].some(id => !!id && ownedIds.has(id)));
      // Sum in minor units to avoid float drift; PayPal reports refunds as negative amounts.
      const totals = new Map<Currency, { payment: number; refund: number }>();
      for (const row of mine) {
        const currency = row.transaction_amount?.currency_code;
        const value = Number(row.transaction_amount?.value || 0);
        if (!isCurrency(currency) || !Number.isFinite(value)) continue;
        const entry = totals.get(currency) || { payment: 0, refund: 0 };
        const refund = isRefundTransaction(row);
        if (refund) entry.refund += toMinor(Math.abs(value), currency); else entry.payment += toMinor(value, currency);
        totals.set(currency, entry);
      }
      const source = keep(`paypal:transactions:${range.start.slice(0, 10)}:${range.end.slice(0, 10)}`, tr("PayPal取引（{0}〜{1}）", range.start.slice(0, 10), range.end.slice(0, 10)));
      const transactions = mine.slice(0, 100).map(row => ({
        id: row.transaction_id,
        at: row.transaction_initiation_date,
        amount: amount(row.transaction_amount),
        type: row.paypal_reference_id_type || row.transaction_event_code,
        status: row.transaction_status,
        ...(row.paypal_reference_id ? { referenceId: row.paypal_reference_id } : {}),
      }));
      return { result: { from: range.start, to: range.end, total: mine.length, totals: [...totals].map(([currency, value]) => ({ currency, payment: fromMinor(value.payment, currency), refund: fromMinor(value.refund, currency) })), transactions }, source };
    }
    if (name === "ledger_find_booking_payments") {
      const input = lookup.parse(args || {});
      if (!input.bookingId && !input.customer && !input.from && !input.to) throw new Error(tr("予約ID・顧客・期間のいずれかを指定してください"));
      const from = input.from ? Date.parse(input.from) : undefined;
      const to = input.to ? Date.parse(input.to) : undefined;
      const rows = ledger.entries.filter(entry => {
        if (input.bookingId && entry.bookingId !== input.bookingId) return false;
        if (input.customer) {
          const needle = input.customer.toLowerCase();
          if (![entry.customer, entry.name, entry.bookingId].some(value => value.toLowerCase().includes(needle))) return false;
        }
        const at = Date.parse(entry.start);
        if (from !== undefined && Number.isFinite(from) && at < from) return false;
        if (to !== undefined && Number.isFinite(to) && at > to) return false;
        return true;
      });
      const totals = new Map<Currency, { payment: number; refund: number }>();
      for (const entry of rows) {
        const value = totals.get(entry.currency) || { payment: 0, refund: 0 };
        value.payment += entry.amount;
        if (entry.refund) value.refund += entry.refund.amount;
        for (const transfer of entry.transfers) value.refund += transfer.amount;
        totals.set(entry.currency, value);
      }
      const source = keep("sheet:paypal", tr("PayPalの台帳"));
      // Ledger amounts are minor units; hand the model the same major-unit values the PayPal tools return.
      const major = (value: number, currency: Currency) => fromMinor(value, currency);
      const refundView = (refund: NonNullable<LedgerEntry["refund"]>, currency: Currency) => ({ ...(refund.id ? { id: refund.id } : {}), amount: major(refund.amount, currency), status: refund.status });
      return { result: { total: rows.length, totals: [...totals].map(([currency, value]) => ({ currency, payment: major(value.payment, currency), refund: major(value.refund, currency) })), rows: rows.slice(0, ledgerLimit).map(entry => ({
        bookingId: entry.bookingId, start: entry.start, name: entry.name, amount: major(entry.amount, entry.currency), currency: entry.currency,
        environment: entry.environment, orderId: entry.orderId, captureId: entry.captureId,
        ...(entry.refund ? { refund: refundView(entry.refund, entry.currency) } : {}),
        transfers: entry.transfers.map(transfer => ({ id: transfer.id, at: transfer.at, currency: transfer.currency, refund: refundView(transfer.refund, transfer.currency) })),
      })), truncated: rows.length > ledgerLimit }, source };
    }
    throw new Error(tr("このPayPalツールは読み取り専用です"));
  }
  return { tools, invoke };
}

const kindLabel = (kind: PayPalAlertKind) => ({
  refund_stalled: tr("返金の停滞"),
  awaiting_funds: tr("返金用残高の不足"),
  manual_review: tr("手動確認が必要"),
  capture_stalled: tr("決済が未確定"),
  state_mismatch: tr("台帳とPayPalの状態不一致"),
  unsold_slot: tr("割引枠の売れ残り"),
} satisfies Record<PayPalAlertKind, string>)[kind];
const severityLabel = (severity: PayPalSeverity) => ({ high: tr("緊急"), medium: tr("注意"), low: tr("確認") } satisfies Record<PayPalSeverity, string>)[severity];
const operationLabel = (operation: PayPalProposalOperation) => ({
  retry_refund: tr("返金の再試行"),
  resync: tr("状態の再同期"),
  complete_manual_review: tr("手動確認を完了にする"),
  close_transfer: tr("割引枠の再販を終了"),
} satisfies Record<PayPalProposalOperation, string>)[operation];

function makeItem(input: {
  kind: PayPalAlertKind; severity: PayPalSeverity; bookingId?: string; bookingLabel?: string;
  amount?: number; currency?: Currency; paypalId?: string; paypalKind?: "order" | "capture" | "refund";
  since?: string; elapsedHours?: number; status?: string;
  operation?: PayPalProposalOperation; targetKind?: PayPalProposal["targetKind"]; targetId?: string; target: string; expected?: string;
}): PayPalAlertItem {
  const id = digest(`${input.kind}:${input.bookingId || ""}:${input.paypalId || ""}:${input.targetId || ""}`);
  const fingerprint = digest(JSON.stringify({
    kind: input.kind, severity: input.severity, bookingId: input.bookingId, paypalId: input.paypalId,
    amount: input.amount, currency: input.currency, targetId: input.targetId, status: input.status,
  }));
  const item: PayPalAlertItem = {
    id, kind: input.kind, severity: input.severity, target: input.target,
    ...(input.bookingId ? { bookingId: input.bookingId } : {}),
    ...(input.bookingLabel ? { bookingLabel: input.bookingLabel } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.paypalId ? { paypalId: input.paypalId } : {}),
    ...(input.paypalKind ? { paypalKind: input.paypalKind } : {}),
    ...(input.since ? { since: input.since } : {}),
    ...(input.elapsedHours !== undefined ? { elapsedHours: input.elapsedHours } : {}),
    fingerprint,
  };
  if (input.operation) item.proposal = {
    id: digest(`${input.operation}:${id}`),
    operation: input.operation,
    alertId: id,
    ...(input.bookingId ? { bookingId: input.bookingId } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.targetKind ? { targetKind: input.targetKind } : {}),
    target: input.target,
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    expected: input.expected || operationLabel(input.operation),
    fingerprint,
  };
  return item;
}

/**
 * Which bookings get live PayPal reads: "recent" (open refunds and payments active in the last 7 days,
 * capped), "none" (ledger rules only), or one booking ID (proposal verification).
 */
export type LiveScope = "recent" | "none" | { bookingId: string };

async function detect(store: Store, gateway: PaymentGateway, shop: Shop, now = new Date(), live: LiveScope = "recent"): Promise<PayPalAlertItem[]> {
  const config = shop.published;
  if (!config) return [];
  const currency = currencyOf(regionOf(config));
  const ledger = await readLedger(store, shop);
  const items = new Map<string, PayPalAlertItem>();
  const add = (item: PayPalAlertItem) => { if (!items.has(item.id)) items.set(item.id, item); };
  const current = now.getTime();
  const label = (booking: Booking) => tr("予約 {0}", booking.id.slice(0, 8));
  const refundAlert = (input: {
    booking: Booking; refund: { refundId?: string; amount: number; status: string; requestId: string };
    currency: Currency; since?: string; paypalKind: "refund" | "capture"; target: string; targetId?: string;
  }) => {
    const elapsed = hours(input.since, current);
    const amount = input.refund.amount;
    const paypalId = input.refund.refundId || undefined;
    if (input.refund.status === "manual_review") add(makeItem({
      kind: "manual_review", severity: "high", bookingId: input.booking.id, bookingLabel: label(input.booking),
      amount, currency: input.currency, ...(paypalId ? { paypalId, paypalKind: "refund" } : {}), since: input.since, ...(elapsed !== undefined ? { elapsedHours: elapsed } : {}),
      status: input.refund.status,
      // Without a refund ID there is nothing to read back from PayPal; the owner checks the PayPal dashboard.
      ...(paypalId ? { operation: "complete_manual_review" as const, targetKind: "refund" as const, targetId: paypalId } : {}),
      target: input.target, expected: paypalId ? tr("PayPalで返金が完了していることを確認し、台帳を完了にします。") : tr("PayPalの管理画面で返金の有無を確認してください。"),
    }));
    else if (input.refund.status === "awaiting_funds") add(makeItem({
      kind: "awaiting_funds", severity: "medium", bookingId: input.booking.id, bookingLabel: label(input.booking),
      amount, currency: input.currency, ...(paypalId ? { paypalId, paypalKind: "refund" } : {}), since: input.since, ...(elapsed !== undefined ? { elapsedHours: elapsed } : {}),
      status: input.refund.status, operation: "retry_refund", targetKind: "refund", targetId: input.targetId || paypalId,
      target: input.target, expected: tr("残高を確認してから、同じ返金処理IDで再試行します。"),
    }));
    else if (["retrying", "pending"].includes(input.refund.status) && elapsed !== undefined && elapsed >= stallHours()) add(makeItem({
      kind: "refund_stalled", severity: "medium", bookingId: input.booking.id, bookingLabel: label(input.booking),
      amount, currency: input.currency, ...(paypalId ? { paypalId, paypalKind: "refund" } : {}), since: input.since, elapsedHours: elapsed,
      status: input.refund.status, operation: "retry_refund", targetKind: "refund", targetId: input.targetId || paypalId,
      target: input.target, expected: tr("同じ返金処理IDで状態を再確認します。二重返金は作りません。"),
    }));
  };

  for (const c of ledger.checkouts) {
    if (!c.booking?.id) continue;
    const booking = c.booking;
    const p = booking.payment;
    if (p?.cancellation) {
      const target = tr("返金 {0}（予約 {1}）", p.cancellation.refundId || p.cancellation.requestId.slice(0, 8), booking.id.slice(0, 8));
      refundAlert({ booking, refund: p.cancellation, currency: p.currency, since: p.cancellation.attemptedAt || p.cancellation.at, paypalKind: "refund", target, targetId: p.cancellation.refundId });
    }
    for (const entry of booking.transfers || []) {
      const target = tr("キャンセル枠の返金（予約 {0}）", booking.id.slice(0, 8));
      refundAlert({ booking, refund: { ...entry.refund }, currency: entry.currency, since: entry.refund.attemptedAt || entry.at, paypalKind: "refund", target, targetId: entry.refund.refundId || entry.id });
    }
    if (["capturing", "captured"].includes(c.phase) || c.review) {
      const since = c.captureAttemptedAt || c.createdAt;
      const elapsed = hours(since, current);
      const stalled = !!c.review || elapsed !== undefined && elapsed * 60 >= captureStallMinutes();
      if (stalled) add(makeItem({
        kind: "capture_stalled", severity: "high", bookingId: booking.id, bookingLabel: label(booking),
        ...(p ? { amount: p.amount, currency: p.currency } : { amount: toMinor(booking.price, c.currency || currency), currency: c.currency || currency }),
        ...(c.orderId ? { paypalId: c.orderId, paypalKind: "order" } : {}), since: new Date(since).toISOString(), ...(elapsed !== undefined ? { elapsedHours: elapsed } : {}),
        status: c.review ? "REVIEW" : c.phase, operation: "resync", targetKind: "order", targetId: c.orderId,
        target: tr("決済（予約 {0}）", booking.id.slice(0, 8)), expected: tr("PayPalから決済状態を取り直して台帳を更新します。"),
      }));
    }
  }

  for (const t of (await store.list<Transfer>("transfer")).filter(t => t.shopId === shop.id && t.phase === "listed")) {
    const buyer = t.buyer;
    if (buyer && (["capturing", "captured"].includes(buyer.phase) || buyer.review)) {
      const since = buyer.captureAttemptedAt || buyer.createdAt;
      const elapsed = hours(since, current);
      if (buyer.review || elapsed !== undefined && elapsed * 60 >= captureStallMinutes()) add(makeItem({
        kind: "capture_stalled", severity: "high", bookingId: t.bookingId,
        amount: t.price, currency: t.currency,
        ...(buyer.orderId ? { paypalId: buyer.orderId, paypalKind: "order" } : {}),
        since: new Date(since).toISOString(), ...(elapsed !== undefined ? { elapsedHours: elapsed } : {}),
        status: buyer.review ? "REVIEW" : buyer.phase, operation: "resync", targetKind: "transfer", targetId: t.id,
        target: tr("決済（予約 {0}）", t.bookingId.slice(0, 8)), expected: tr("PayPalから決済状態を取り直して台帳を更新します。"),
      }));
    }
    const remaining = Date.parse(t.deadline) - current;
    if (remaining > 0 && remaining <= unsoldWarningMinutes * 60000 && !buyerBusy(t, current)) add(makeItem({
      kind: "unsold_slot", severity: "low", bookingId: t.bookingId,
      amount: t.unsold.amount, currency: t.currency, since: t.deadline, status: t.phase,
      operation: "close_transfer", targetKind: "transfer", targetId: t.id,
      target: tr("割引枠（予約 {0}）", t.bookingId.slice(0, 8)), expected: tr("受付を今終了し、キャンセル受付時の返金額で確定します。"),
    }));
  }

  // Live PayPal reads are advisory: a failed lookup is never treated as a mismatch. They are bounded so
  // a shop with a long payment history does not turn every check into hundreds of PayPal calls.
  const settled = ["completed", "not_required"];
  const lastActivity = (c: Checkout) => Math.max(c.createdAt || 0, ...[c.booking.payment?.cancellation?.attemptedAt, c.booking.payment?.cancellation?.at,
    ...(c.booking.transfers || []).flatMap(entry => [entry.at, entry.refund.attemptedAt])].map(value => Date.parse(value || "")).filter(Number.isFinite));
  const open = (c: Checkout) => {
    const p = c.booking.payment;
    return !!p?.cancellation && !settled.includes(p.cancellation.status) || (c.booking.transfers || []).some(entry => !settled.includes(entry.refund.status));
  };
  const liveTargets = live === "none" ? [] : ledger.checkouts
    .filter(c => c.booking?.id && c.booking.payment && (typeof live === "object" ? c.booking.id === live.bookingId : open(c) || lastActivity(c) >= current - liveWindowMs))
    .sort((a, b) => Number(open(b)) - Number(open(a)) || lastActivity(b) - lastActivity(a))
    .slice(0, liveLimit);
  for (const c of liveTargets) {
    const p = c.booking.payment!;
    try {
      if (p.cancellation?.refundId) {
        const remote = await gateway.refundStatus(p.cancellation.refundId);
        if (!refundMatches(p.cancellation.status, remote.status)) add(makeItem({
          kind: "state_mismatch", severity: "high", bookingId: c.booking.id, bookingLabel: label(c.booking),
          amount: p.cancellation.amount, currency: p.currency, paypalId: p.cancellation.refundId, paypalKind: "refund",
          status: `${p.cancellation.status}:${remote.status}`, operation: "resync", targetKind: "refund", targetId: p.cancellation.refundId,
          target: tr("返金 {0}", p.cancellation.refundId), expected: tr("PayPalの返金状態を台帳に反映します。"),
        }));
      }
      if (p.captureId && gateway.captureStatus) {
        const remote = await gateway.captureStatus(p.captureId);
        const sameAmount = remote.amount.currency_code === p.currency && Number(remote.amount.value) === fromMinor(p.amount, p.currency);
        // A capture we refunded reads back as REFUNDED / PARTIALLY_REFUNDED; that is the expected state.
        const refunded = !!p.cancellation?.refundId || (c.booking.transfers || []).some(entry => !!entry.refund.refundId);
        const expected = remote.status === "COMPLETED" || refunded && ["REFUNDED", "PARTIALLY_REFUNDED"].includes(remote.status);
        if (!expected || !sameAmount) add(makeItem({
          kind: "state_mismatch", severity: "high", bookingId: c.booking.id, bookingLabel: label(c.booking),
          amount: p.amount, currency: p.currency, paypalId: p.captureId, paypalKind: "capture",
          status: `${c.phase}:${remote.status}`, operation: "resync", targetKind: "capture", targetId: p.captureId,
          target: tr("決済 {0}", p.captureId), expected: tr("PayPalの決済状態を台帳に反映します。"),
        }));
      }
    } catch { /* The deterministic ledger rules above still stand. */ }
    for (const entry of c.booking.transfers || []) {
      if (!entry.refund.refundId) continue;
      try {
        const remote = await gateway.refundStatus(entry.refund.refundId);
        if (!refundMatches(entry.refund.status, remote.status)) add(makeItem({
          kind: "state_mismatch", severity: "high", bookingId: c.booking.id, bookingLabel: label(c.booking),
          amount: entry.refund.amount, currency: entry.currency, paypalId: entry.refund.refundId, paypalKind: "refund",
          status: `${entry.refund.status}:${remote.status}`, operation: "resync", targetKind: "refund", targetId: entry.refund.refundId,
          target: tr("キャンセル枠の返金 {0}", entry.refund.refundId), expected: tr("PayPalの返金状態を台帳に反映します。"),
        }));
      } catch { /* Ignore an unavailable verification call. */ }
    }
  }

  return [...items.values()].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.kind.localeCompare(b.kind) || (a.bookingId || "").localeCompare(b.bookingId || ""));
}

const severityOrder = { high: 0, medium: 1, low: 2 } satisfies Record<PayPalSeverity, number>;

function refundMatches(ledger: string, live: string) {
  if (live === "COMPLETED") return ledger === "completed";
  if (live === "PENDING") return ["pending", "retrying"].includes(ledger);
  return ["manual_review", "awaiting_funds", "retrying"].includes(ledger);
}

function amountText(item: PayPalAlertItem) {
  return item.amount !== undefined && item.currency ? formatMinor(item.amount, item.currency) : "";
}
function alertLine(item: PayPalAlertItem) {
  return [
    tr("[{0}]", severityLabel(item.severity)),
    kindLabel(item.kind),
    item.target,
    amountText(item),
    item.paypalId ? tr("PayPal ID: {0}", item.paypalId) : "",
    item.elapsedHours !== undefined ? tr("{0}時間経過", Math.round(item.elapsedHours * 10) / 10) : "",
  ].filter(Boolean).join(" ");
}
function fallbackSummary(items: PayPalAlertItem[]) {
  if (!items.length) return tr("対応が必要な項目はありません。");
  const count = (severity: PayPalSeverity) => items.filter(item => item.severity === severity).length;
  return tr("対応が必要な項目が{0}件あります。緊急{1}件、注意{2}件、確認{3}件です。", items.length, count("high"), count("medium"), count("low"));
}
function localHour(now: Date, timeZone: string) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function settingsOf(shop: Shop) {
  return { enabled: shop.paypalOps?.notify !== false, digestHour: Math.min(23, Math.max(0, shop.paypalOps?.digestHour ?? 9)) };
}

/** Reads one booking's refunds back from PayPal, then saves through the payment service's own sync. */
async function resyncLedger(store: Store, gateway: PaymentGateway, sync: (c: Checkout) => Promise<void>, shopId: string, bookingId: string | undefined) {
  if (!bookingId) return;
  const c = await store.get<Checkout>("checkout", bookingId);
  if (!c || c.shopId !== shopId) return;
  const p = c.booking.payment;
  const mapped = (remote: { status: string; amount?: { currency_code: string; value: string } }, amount: number, currency: Currency) => {
    const status = remote.status === "COMPLETED" ? "completed" as const : remote.status === "PENDING" ? "pending" as const : "manual_review" as const;
    return remote.amount && (remote.amount.currency_code !== currency || Number(remote.amount.value) !== fromMinor(amount, currency)) ? "manual_review" as const : status;
  };
  if (p?.cancellation?.refundId) p.cancellation.status = mapped(await gateway.refundStatus(p.cancellation.refundId), p.cancellation.amount, p.currency);
  for (const entry of c.booking.transfers || []) {
    if (entry.refund.refundId) entry.refund.status = mapped(await gateway.refundStatus(entry.refund.refundId), entry.refund.amount, entry.currency);
  }
  // Only a not-yet-confirmed capture is re-judged here; a confirmed booking keeps its capture and a
  // remaining mismatch stays visible for the owner instead of being flagged for review.
  if (c.phase === "captured" && p?.captureId && gateway.captureStatus && (await gateway.captureStatus(p.captureId)).status !== "COMPLETED") {
    c.review = true;
    await store.put("checkout", c.id, c);
    return;
  }
  if (c.phase === "captured" || c.phase === "confirmed") await sync(c);
  else await store.put("checkout", c.id, c);
}

/**
 * Proposals to show under a consult answer. When the question, answer or sources name a booking or
 * PayPal ID, only proposals for those; otherwise (e.g. "anything stuck?") the most urgent few.
 */
export function relevantProposals(items: PayPalAlertItem[], texts: string[], limit = 5) {
  const text = texts.join("\n");
  const named = (value: string | undefined, min = 8) => !!value && value.length >= min && text.includes(value);
  const mentioned = items.filter(item => named(item.paypalId) || named(item.proposal?.targetId) || named(item.bookingId?.slice(0, 8)));
  const unique = new Map((mentioned.length ? mentioned : items).flatMap(item => item.proposal ? [[item.proposal.id, item.proposal] as const] : []));
  return [...unique.values()].slice(0, limit);
}

export function paypalOps(options: PayPalOpsOptions) {
  const { store, gateway } = options;
  const state = (shopId: string) => store.get<PayPalAlertState>("paypalAlertState", shopId);
  async function saveState(shop: Shop, items: PayPalAlertItem[], summary?: string) {
    const value: PayPalAlertState = { shopId: shop.id, checkedAt: new Date().toISOString(), summary: summary || fallbackSummary(items), items };
    await store.put("paypalAlertState", shop.id, value);
    return value;
  }
  async function toolsFor(shop: Shop): Promise<PayPalToolProvider | undefined> {
    const ledger = await readLedger(store, shop);
    return ledger.refs.size ? toolProvider(store, gateway, shop, ledger) : undefined;
  }
  /**
   * Runs the rules and keeps state mismatches from the previous check for bookings this run did not
   * read live, so a narrow check (one booking, or ledger-only) never drops the others.
   */
  async function detectMerged(shop: Shop, live: LiveScope) {
    const items = await detect(store, gateway, shop, new Date(), live);
    if (live === "recent") return items;
    const ids = new Set(items.map(item => item.id));
    const kept = ((await state(shop.id))?.items || []).filter(item => item.kind === "state_mismatch" && !ids.has(item.id) &&
      (live === "none" || item.bookingId !== live.bookingId));
    return [...items, ...kept].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.kind.localeCompare(b.kind) || (a.bookingId || "").localeCompare(b.bookingId || ""));
  }
  async function check(shop: Shop, opts: { notify?: boolean; forceDigest?: boolean; force?: boolean; live?: LiveScope } = {}) {
    const locale = shop.locale || (await store.get<{ locale: "ja" | "en" }>("shopLocale", shop.id))?.locale || "ja";
    return requestLocale.run(locale, async () => {
      const scheduled = (opts.live || "recent") === "recent" && !!opts.notify;
      if (!opts.force && scheduled) {
        const last = await store.get<{ checkedAt: string }>("paypalAlertRun", shop.id);
        if (last && Date.now() - Date.parse(last.checkedAt) < checkIntervalMs()) {
          const cached = await state(shop.id);
          if (cached) return cached;
        }
      }
      const items = await detectMerged(shop, opts.live || "recent");
      const send = opts.notify ? await dueNotifications(shop, items, !!opts.forceDigest) : undefined;
      // The AI summary costs a model call: write one only when mail goes out or the owner pressed "check now".
      let summary: string | undefined;
      if (items.length && options.summarize && (send?.items.length || opts.force && opts.notify)) {
        try { summary = (await options.summarize(items, locale))?.trim().slice(0, 1200); } catch { /* fall back to the deterministic summary */ }
      }
      const value = await saveState(shop, items, summary);
      const markChecked = async () => {
        if (scheduled) await store.put("paypalAlertRun", shop.id, { shopId: shop.id, checkedAt: new Date().toISOString() });
      };
      if (!send?.items.length || !options.notifyOwner) { await markChecked(); return value; }
      const subject = tr("gemihub: 対応が必要なものが{0}件あります", send.items.length);
      const link = `${options.appOrigin()}/?tab=assistant&shop=${shop.id}`;
      const body = [value.summary, "", ...send.items.map(item => `- ${alertLine(item)}`), "", tr("管理画面: {0}", link)].join("\n");
      try {
        await options.notifyOwner(shop, subject, body);
      } catch {
        // A failed send (e.g. the owner's Google needs reconnecting) still counts as this hour's run;
        // otherwise every minute would repeat the PayPal reads and the AI summary. Notices are not
        // recorded, so the same items are mailed on the next scheduled run.
        await markChecked();
        return value;
      }
      for (const item of send.items) await store.put("paypalAlertNotice", `${shop.id}:${item.id}`, { shopId: shop.id, fingerprint: item.fingerprint, notifiedAt: new Date().toISOString() });
      if (send.digest) await store.put("paypalDigest", shop.id, { shopId: shop.id, date: send.today, at: new Date().toISOString() });
      await markChecked();
      return value;
    });
  }
  /** Items to mail now: changed high-severity items at once, the rest in the daily digest. */
  async function dueNotifications(shop: Shop, items: PayPalAlertItem[], forceDigest: boolean) {
    if (shop.judge || !options.notifyOwner || !settingsOf(shop).enabled || !shop.published) return undefined;
    const changed: PayPalAlertItem[] = [];
    for (const item of items) {
      const noticed = await store.get<{ fingerprint: string }>("paypalAlertNotice", `${shop.id}:${item.id}`);
      if (noticed?.fingerprint !== item.fingerprint) changed.push(item);
    }
    const immediate = changed.filter(item => item.severity === "high");
    const digestItems = changed.filter(item => item.severity !== "high");
    const timeZone = regionOf(shop.published).timeZone;
    const now = new Date();
    const today = dateIn(now, timeZone);
    const lastDigest = await store.get<{ date: string }>("paypalDigest", shop.id);
    const digestDue = forceDigest || (localHour(now, timeZone) >= settingsOf(shop).digestHour && lastDigest?.date !== today);
    return { items: [...immediate, ...(digestDue ? digestItems : [])], digest: digestDue && digestItems.length > 0, today };
  }
  async function execute(shop: Shop, input: { proposalId: string; alertId: string; fingerprint: string }, actor: string) {
    return store.locked(bookingLockKey(shop.id), async () => {
      const fresh = await store.shop(shop.id);
      if (!fresh) return { ok: false as const, error: tr("お店がありません") };
      // Verify against live PayPal for the proposal's booking only; other bookings keep their last check.
      const shown = (await state(fresh.id))?.items.find(value => value.id === input.alertId);
      const live: LiveScope = shown?.bookingId ? { bookingId: shown.bookingId } : "none";
      const before = await detectMerged(fresh, live);
      const item = before.find(value => value.id === input.alertId && value.proposal?.id === input.proposalId);
      if (!item || item.fingerprint !== input.fingerprint || !item.proposal)
        return { ok: false as const, error: tr("状態が変わっています。最新の状態を確認してください。"), state: await saveState(fresh, before) };
      const proposal = item.proposal;
      if (proposal.operation === "close_transfer") {
        if (!proposal.targetId) return { ok: false as const, error: tr("対象の割引枠が見つかりません"), state: await saveState(fresh, before) };
        await options.closeTransfer(fresh.id, proposal.targetId);
      } else {
        await options.reconcile(fresh.id);
        if (["resync", "complete_manual_review"].includes(proposal.operation)) await resyncLedger(store, gateway, options.sync, fresh.id, proposal.bookingId);
      }
      const after = await detectMerged(fresh, live);
      const remaining = after.find(value => value.id === item.id);
      const value = await saveState(fresh, after);
      if (["complete_manual_review", "close_transfer"].includes(proposal.operation) && remaining)
        return { ok: false as const, error: tr("まだ完了を確認できません。最新の状態を表示しました。"), state: value };
      const at = new Date().toISOString();
      try {
        await options.recordHistory(fresh.id, { at, summary: tr("PayPal対応を実行：{0}", operationLabel(proposal.operation)), ...(actor ? { request: tr("実行者: {0}", actor) } : {}) });
        await store.put("paypalOperation", digest(`${fresh.id}:${item.id}:${at}`), {
          shopId: fresh.id, at, actor, operation: proposal.operation, alertId: item.id, proposalId: proposal.id,
          target: proposal.target, ...(proposal.amount !== undefined ? { amount: proposal.amount } : {}), ...(proposal.currency ? { currency: proposal.currency } : {}),
        });
      } catch { /* The PayPal write already succeeded; the next alert check reports the current state. */ }
      return { ok: true as const, state: value, summary: value.summary };
    });
  }
  async function updateSettings(shop: Shop, input: unknown) {
    const parsed = z.object({ notify: z.boolean(), digestHour: z.number().int().min(0).max(23) }).parse(input);
    return store.locked(shop.id, async () => {
      const fresh = await store.shop(shop.id);
      if (!fresh) throw Object.assign(new Error(tr("お店がありません")), { status: 404 });
      fresh.paypalOps = { notify: parsed.notify, digestHour: parsed.digestHour };
      await store.saveShop(fresh);
      return fresh.paypalOps;
    });
  }
  return { toolsFor, detect: (shop: Shop, now?: Date, live?: LiveScope) => detect(store, gateway, shop, now, live), check, state, execute, settings: settingsOf, updateSettings };
}
