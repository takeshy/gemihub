import { tr } from "../shared/i18n.ts";
import { createHash } from "node:crypto";
import { currencyOf, dateIn, formatMinor, fromMinor, regionOf, type Currency } from "../shared/region.ts";
import { requestLocale } from "./i18n.ts";
import type { ToolDeclaration } from "./llm.ts";
import type { Source } from "./assistant.ts";
import type { PaymentGateway } from "./paypal.ts";
import type { Store, Shop } from "./store.ts";
import type { Checkout } from "./payments.ts";
import type { Booking } from "./domain.ts";
import { buyerBusy, type Transfer } from "./transfers.ts";
import { z } from "zod";

// PayPal is read through this module only for explanation. Every mutating action stays in the
// existing payment/transfer services, behind an owner approval of a server-built proposal.

export type PayPalSeverity = "high" | "medium" | "low";
export type PayPalAlertKind = "refund_stalled" | "awaiting_funds" | "manual_review" | "capture_stalled" | "state_mismatch" | "unsold_slot" | "awaiting_approval";
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
  /** Reconcile this shop's payments and transfers. The caller must not already hold the booking lock. */
  reconcile: (shopId: string) => Promise<void>;
  closeTransfer: (shopId: string, transferId: string) => Promise<void>;
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
  customer: string;
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
const waitingApprovalMinutes = () => {
  const value = Number(process.env.PAYPAL_APPROVAL_WAIT_MINUTES || 30);
  return Number.isFinite(value) && value >= 0 ? value : 30;
};
const unsoldWarningMinutes = 120;
const ledgerLimit = 50;
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
      amount: p?.amount ?? c.booking.price,
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
      const totals = new Map<string, { payment: number; refund: number }>();
      for (const row of mine) {
        const currency = row.transaction_amount?.currency_code;
        const value = Number(row.transaction_amount?.value || 0);
        if (!currency || !Number.isFinite(value)) continue;
        const entry = totals.get(currency) || { payment: 0, refund: 0 };
        const refund = row.paypal_reference_id_type?.toUpperCase() === "REFUND" || /REFUND|REVERSAL/.test(row.transaction_event_code || "");
        if (refund) entry.refund += value; else entry.payment += value;
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
      return { result: { from: range.start, to: range.end, total: mine.length, totals: [...totals].map(([currency, value]) => ({ currency, ...value })), transactions }, source };
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
          if (!entry.customer.toLowerCase().includes(needle) && !entry.bookingId.toLowerCase().includes(needle)) return false;
        }
        const at = Date.parse(entry.start);
        if (from !== undefined && Number.isFinite(from) && at < from) return false;
        if (to !== undefined && Number.isFinite(to) && at > to) return false;
        return true;
      });
      const totals = new Map<string, { payment: number; refund: number }>();
      for (const entry of rows) {
        const value = totals.get(entry.currency) || { payment: 0, refund: 0 };
        value.payment += entry.amount;
        if (entry.refund) value.refund += entry.refund.amount;
        for (const transfer of entry.transfers) value.refund += transfer.amount;
        totals.set(entry.currency, value);
      }
      const source = keep("sheet:paypal", tr("PayPalの台帳"));
      return { result: { total: rows.length, totals: [...totals].map(([currency, value]) => ({ currency, ...value })), rows: rows.slice(0, ledgerLimit).map(entry => ({
        bookingId: entry.bookingId, start: entry.start, customer: entry.customer, amount: entry.amount, currency: entry.currency,
        environment: entry.environment, orderId: entry.orderId, captureId: entry.captureId, refund: entry.refund, transfers: entry.transfers,
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
  awaiting_approval: tr("支払い手続きの放置"),
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

async function detect(store: Store, gateway: PaymentGateway, shop: Shop, now = new Date()): Promise<PayPalAlertItem[]> {
  const config = shop.published;
  if (!config) return [];
  const currency = currencyOf(regionOf(config));
  const ledger = await readLedger(store, shop);
  const items = new Map<string, PayPalAlertItem>();
  const add = (item: PayPalAlertItem) => { if (!items.has(item.id)) items.set(item.id, item); };
  const current = now.getTime();
  const label = (booking: Booking) => tr("予約 {0}", booking.id.slice(0, 8));
  const refundAlert = (input: {
    booking: Booking; refund: { id?: string; amount: number; status: string; requestId: string };
    currency: Currency; since?: string; paypalKind: "refund" | "capture"; target: string; targetId?: string;
  }) => {
    const elapsed = hours(input.since, current);
    const amount = input.refund.amount;
    const paypalId = input.refund.id || undefined;
    if (input.refund.status === "manual_review") add(makeItem({
      kind: "manual_review", severity: "high", bookingId: input.booking.id, bookingLabel: label(input.booking),
      amount, currency: input.currency, ...(paypalId ? { paypalId, paypalKind: "refund" } : {}), since: input.since, ...(elapsed !== undefined ? { elapsedHours: elapsed } : {}),
      status: input.refund.status, operation: "complete_manual_review", targetKind: "refund", targetId: input.targetId || paypalId,
      target: input.target, expected: tr("PayPalで返金が完了していることを確認し、台帳を完了にします。"),
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
        ...(p ? { amount: p.amount, currency: p.currency } : { amount: booking.price, currency: c.currency || currency }),
        ...(c.orderId ? { paypalId: c.orderId, paypalKind: "order" } : {}), since: new Date(since).toISOString(), ...(elapsed !== undefined ? { elapsedHours: elapsed } : {}),
        status: c.review ? "REVIEW" : c.phase, operation: "resync", targetKind: "order", targetId: c.orderId,
        target: tr("決済（予約 {0}）", booking.id.slice(0, 8)), expected: tr("PayPalから決済状態を取り直して台帳を更新します。"),
      }));
    }
    if (c.phase === "awaiting_approval" && c.expires > current) {
      const elapsed = hours(c.createdAt, current);
      if (elapsed !== undefined && elapsed * 60 >= waitingApprovalMinutes()) add(makeItem({
        kind: "awaiting_approval", severity: "low", bookingId: booking.id, bookingLabel: label(booking),
        amount: booking.price, currency: c.currency || currency, ...(c.orderId ? { paypalId: c.orderId, paypalKind: "order" } : {}),
        since: new Date(c.createdAt).toISOString(), elapsedHours: elapsed, status: c.phase,
        target: tr("支払い手続き（予約 {0}）", booking.id.slice(0, 8)), expected: tr("お客様のPayPal画面での承認待ちです。"),
      }));
    }
  }

  for (const t of (await store.list<Transfer>("transfer")).filter(t => t.shopId === shop.id && t.phase === "listed")) {
    const remaining = Date.parse(t.deadline) - current;
    if (remaining > 0 && remaining <= unsoldWarningMinutes * 60000 && !buyerBusy(t, current)) add(makeItem({
      kind: "unsold_slot", severity: "low", bookingId: t.bookingId,
      amount: t.price, currency: t.currency, since: t.deadline, status: t.phase,
      operation: "close_transfer", targetKind: "transfer", targetId: t.id,
      target: tr("割引枠（予約 {0}）", t.bookingId.slice(0, 8)), expected: tr("受付を今終了し、キャンセル受付時の返金額で確定します。"),
    }));
  }

  // Live PayPal reads are advisory: a failed lookup is never treated as a mismatch.
  for (const c of ledger.checkouts) {
    if (!c.booking?.id) continue;
    const p = c.booking.payment;
    if (!p) continue;
    try {
      if (p.cancellation?.refundId) {
        const live = await gateway.refundStatus(p.cancellation.refundId);
        if (!refundMatches(p.cancellation.status, live.status)) add(makeItem({
          kind: "state_mismatch", severity: "high", bookingId: c.booking.id, bookingLabel: label(c.booking),
          amount: p.cancellation.amount, currency: p.currency, paypalId: p.cancellation.refundId, paypalKind: "refund",
          status: `${p.cancellation.status}:${live.status}`, operation: "resync", targetKind: "refund", targetId: p.cancellation.refundId,
          target: tr("返金 {0}", p.cancellation.refundId), expected: tr("PayPalの返金状態を台帳に反映します。"),
        }));
      }
      if (p.captureId && gateway.captureStatus) {
        const live = await gateway.captureStatus(p.captureId);
        const sameAmount = live.amount.currency_code === p.currency && Number(live.amount.value) === fromMinor(p.amount, p.currency);
        if (live.status !== "COMPLETED" || !sameAmount) add(makeItem({
          kind: "state_mismatch", severity: "high", bookingId: c.booking.id, bookingLabel: label(c.booking),
          amount: p.amount, currency: p.currency, paypalId: p.captureId, paypalKind: "capture",
          status: `${c.phase}:${live.status}`, operation: "resync", targetKind: "capture", targetId: p.captureId,
          target: tr("決済 {0}", p.captureId), expected: tr("PayPalの決済状態を台帳に反映します。"),
        }));
      }
    } catch { /* The deterministic ledger rules above still stand. */ }
    for (const entry of c.booking.transfers || []) {
      if (!entry.refund.refundId) continue;
      try {
        const live = await gateway.refundStatus(entry.refund.refundId);
        if (!refundMatches(entry.refund.status, live.status)) add(makeItem({
          kind: "state_mismatch", severity: "high", bookingId: c.booking.id, bookingLabel: label(c.booking),
          amount: entry.refund.amount, currency: entry.currency, paypalId: entry.refund.refundId, paypalKind: "refund",
          status: `${entry.refund.status}:${live.status}`, operation: "resync", targetKind: "refund", targetId: entry.refund.refundId,
          target: tr("キャンセル枠の返金 {0}", entry.refund.refundId), expected: tr("PayPalの返金状態を台帳に反映します。"),
        }));
      } catch { /* Ignore an unavailable verification call. */ }
    }
  }

  const order = { high: 0, medium: 1, low: 2 } satisfies Record<PayPalSeverity, number>;
  return [...items.values()].sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind) || (a.bookingId || "").localeCompare(b.bookingId || ""));
}

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

async function resyncLedger(store: Store, gateway: PaymentGateway, shopId: string, bookingId: string | undefined) {
  if (!bookingId) return;
  const c = await store.get<Checkout>("checkout", bookingId);
  if (!c || c.shopId !== shopId) return;
  const p = c.booking.payment;
  if (p?.cancellation?.refundId) {
    const live = await gateway.refundStatus(p.cancellation.refundId);
    const status = live.status === "COMPLETED" ? "completed" : live.status === "PENDING" ? "pending" : "manual_review";
    p.cancellation.status = live.amount && (live.amount.currency_code !== p.currency || Number(live.amount.value) !== fromMinor(p.cancellation.amount, p.currency)) ? "manual_review" : status;
  }
  for (const entry of c.booking.transfers || []) {
    if (!entry.refund.refundId) continue;
    const live = await gateway.refundStatus(entry.refund.refundId);
    const status = live.status === "COMPLETED" ? "completed" : live.status === "PENDING" ? "pending" : "manual_review";
    entry.refund.status = live.amount && (live.amount.currency_code !== entry.currency || Number(live.amount.value) !== fromMinor(entry.refund.amount, entry.currency)) ? "manual_review" : status;
  }
  if (p?.captureId && gateway.captureStatus) {
    const live = await gateway.captureStatus(p.captureId);
    if (live.status === "COMPLETED") {
      if (c.phase === "capturing" || c.phase === "captured") { c.phase = "captured"; c.review = false; }
    } else if (live.status === "PENDING") c.review = true;
    else c.review = true;
  }
  await store.put("checkout", c.id, c);
  if (c.phase === "captured") {
    c.phase = "confirmed";
    await store.put("checkout", c.id, c);
    await store.saveBooking(c.booking);
  } else if (c.phase === "confirmed") await store.saveBooking(c.booking);
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
  async function check(shop: Shop, opts: { notify?: boolean; forceDigest?: boolean; force?: boolean } = {}) {
    const locale = shop.locale || (await store.get<{ locale: "ja" | "en" }>("shopLocale", shop.id))?.locale || "ja";
    return requestLocale.run(locale, async () => {
      if (!opts.force) {
        const last = await state(shop.id);
        if (last && Date.now() - Date.parse(last.checkedAt) < checkIntervalMs()) return last;
      }
      const items = await detect(store, gateway, shop);
      let summary: string | undefined;
      if (items.length && options.summarize && opts.notify !== false) {
        try { summary = (await options.summarize(items, locale))?.trim().slice(0, 1200); } catch { /* fall back to the deterministic summary */ }
      }
      const value = await saveState(shop, items, summary);
      if (!opts.notify || shop.judge || !options.notifyOwner) return value;
      const settings = settingsOf(shop);
      if (!settings.enabled) return value;
      const changed: PayPalAlertItem[] = [];
      for (const item of items) {
        const noticed = await store.get<{ fingerprint: string }>("paypalAlertNotice", `${shop.id}:${item.id}`);
        if (noticed?.fingerprint !== item.fingerprint) changed.push(item);
      }
      const immediate = changed.filter(item => item.severity === "high");
      const digestItems = changed.filter(item => item.severity !== "high");
      const config = shop.published!;
      const timeZone = regionOf(config).timeZone;
      const now = new Date();
      const today = dateIn(now, timeZone);
      const lastDigest = await store.get<{ date: string }>("paypalDigest", shop.id);
      const digestDue = !!opts.forceDigest || (localHour(now, timeZone) >= settings.digestHour && lastDigest?.date !== today);
      const send = [...immediate, ...(digestDue ? digestItems : [])];
      if (!send.length) return value;
      const subject = tr("gemihub: 対応が必要なものが{0}件あります", send.length);
      const link = `${options.appOrigin()}/?tab=assistant&shop=${shop.id}`;
      const body = [value.summary, "", ...send.map(item => `- ${alertLine(item)}`), "", tr("管理画面: {0}", link)].join("\n");
      try {
        await options.notifyOwner(shop, subject, body);
      } catch { return value; }
      for (const item of send) await store.put("paypalAlertNotice", `${shop.id}:${item.id}`, { shopId: shop.id, fingerprint: item.fingerprint, notifiedAt: new Date().toISOString() });
      if (digestDue && digestItems.length) await store.put("paypalDigest", shop.id, { shopId: shop.id, date: today, at: new Date().toISOString() });
      return value;
    });
  }
  async function execute(shop: Shop, input: { proposalId: string; alertId: string; fingerprint: string }, actor: string) {
    return store.locked(`bookings:${shop.id}`, async () => {
      const fresh = await store.shop(shop.id);
      if (!fresh) return { ok: false as const, error: tr("お店がありません") };
      const before = await detect(store, gateway, fresh);
      const item = before.find(value => value.id === input.alertId && value.proposal?.id === input.proposalId);
      if (!item || item.fingerprint !== input.fingerprint || !item.proposal)
        return { ok: false as const, error: tr("状態が変わっています。最新の状態を確認してください。"), state: await saveState(fresh, before) };
      const proposal = item.proposal;
      if (proposal.operation === "close_transfer") {
        if (!proposal.targetId) return { ok: false as const, error: tr("対象の割引枠が見つかりません"), state: await saveState(fresh, before) };
        await options.closeTransfer(fresh.id, proposal.targetId);
      } else {
        await options.reconcile(fresh.id);
        if (["resync", "complete_manual_review"].includes(proposal.operation)) await resyncLedger(store, gateway, fresh.id, proposal.bookingId);
      }
      const after = await detect(store, gateway, fresh);
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
    const fresh = await store.shop(shop.id);
    if (!fresh) throw Object.assign(new Error(tr("お店がありません")), { status: 404 });
    fresh.paypalOps = { notify: parsed.notify, digestHour: parsed.digestHour };
    await store.saveShop(fresh);
    return fresh.paypalOps;
  }
  return { toolsFor, detect: (shop: Shop, now?: Date) => detect(store, gateway, shop, now), check, state, execute, settings: settingsOf, updateSettings };
}
