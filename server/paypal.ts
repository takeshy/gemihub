import { paypalValue, type Currency } from "../shared/region.ts";
import { tr } from "../shared/i18n.ts";
import { readFile } from "node:fs/promises";
import { z } from "zod";

export type PayPalEnvironment = "sandbox" | "live";
const money = z.object({ currency_code: z.string(), value: z.string() });
const capture = z.object({ id: z.string(), status: z.string(), amount: money });
export const orderSchema = z.object({
  id: z.string(), status: z.string(),
  purchase_units: z.array(z.object({ custom_id: z.string().optional(), amount: money.optional(), payments: z.object({ captures: z.array(capture).optional() }).optional() })).optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});
export type PayPalOrder = z.infer<typeof orderSchema>;
export const refundSchema = z.object({ id: z.string(), status: z.string(), amount: money.optional(), note_to_payer: z.string().optional() });
export type PayPalRefund = z.infer<typeof refundSchema>;
/** A captured payment read back from PayPal; refund totals are optional in older responses. */
export const captureSchema = z.object({
  id: z.string(), status: z.string(), amount: money,
  custom_id: z.string().optional(), invoice_id: z.string().optional(),
  seller_receivable_breakdown: z.object({ total_refunded_amount: money.optional() }).optional(),
  create_time: z.string().optional(), update_time: z.string().optional(),
});
export type PayPalCapture = z.infer<typeof captureSchema>;
const transactionInfoSchema = z.object({
  transaction_id: z.string(),
  transaction_event_code: z.string().optional(),
  transaction_status: z.string().optional(),
  transaction_initiation_date: z.string().optional(),
  transaction_amount: money.optional(),
  paypal_reference_id: z.string().optional(),
  paypal_reference_id_type: z.string().optional(),
  transaction_subject: z.string().optional(),
});
const transactionSearchSchema = z.object({
  transaction_details: z.array(z.object({ transaction_info: transactionInfoSchema })).optional(),
  total_pages: z.number().int().optional(),
});
/** One payment event, reduced to fields that are useful to the shop owner. */
export type PayPalTransaction = z.infer<typeof transactionInfoSchema>;
/** Payment refunds/reversals, excluding fee refunds and bank-transfer reversals.
 * https://developer.paypal.com/reports/reference/t-codes/
 */
export function isRefundTransaction(row: PayPalTransaction) {
  const code = row.transaction_event_code?.toUpperCase();
  return ["T1106", "T1107", "T1115", "T1120"].includes(code || "") ||
    row.paypal_reference_id_type?.toUpperCase() === "REFUND" || /REFUND|REVERSAL/.test(code || "") ||
    (!code && Number(row.transaction_amount?.value) < 0);
}
export interface PayPalTransactionQuery { start: string; end: string; type?: "all" | "payment" | "refund" }
export interface PaymentGateway {
  environment: PayPalEnvironment;
  ready(): Promise<void>;
  /** `amount` is in minor units (yen or cents) of `currency`. */
  create(id: string, amount: number, returnUrl: string, cancelUrl: string, currency?: Currency, brandName?: string): Promise<PayPalOrder>;
  order(id: string): Promise<PayPalOrder>;
  capture(id: string, requestId: string): Promise<PayPalOrder>;
  refund(captureId: string, amount: number, requestId: string, currency?: Currency): Promise<PayPalRefund>;
  refundStatus(id: string): Promise<PayPalRefund>;
  /** Read-only lookup used by the assistant and alert checks. Optional for small test gateways. */
  captureStatus?(id: string): Promise<PayPalCapture>;
  /** Read-only Transaction Search, capped by the caller. Optional for small test gateways. */
  transactions?(query: PayPalTransactionQuery): Promise<PayPalTransaction[]>;
}
export class PayPalError extends Error {
  status = 503;
  constructor(readonly definitive = false, readonly issue?: "REFUND_FAILED_INSUFFICIENT_FUNDS", readonly upstreamStatus?: number) { super(tr("PayPalの処理状況を確認できません。マイページから再確認してください。")); }
}
export function paypalGateway(fetcher: typeof fetch = fetch): PaymentGateway {
  const environment: PayPalEnvironment = process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";
  const base = environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  let cached: { token: string; until: number } | undefined;
  async function credentials() {
    const client = process.env.PAYPAL_CLIENT_ID;
    let secret = process.env.PAYPAL_CLIENT_SECRET;
    try { if (!secret && process.env.PAYPAL_CLIENT_SECRET_FILE) secret = (await readFile(process.env.PAYPAL_CLIENT_SECRET_FILE, "utf8")).trim(); } catch { /* Never include file contents or provider responses in errors. */ }
    if (!client || !secret) throw Object.assign(new Error(tr("予約時のPayPal決済がまだ設定されていません。お店にお問い合わせください。")), { status: 503 });
    return { client, secret };
  }
  async function token() {
    if (cached && cached.until > Date.now()) return cached.token;
    const { client, secret } = await credentials();
    try {
      const res = await fetcher(base + "/v1/oauth2/token", { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
      if (!res.ok) throw new PayPalError(false, undefined, res.status);
      const value = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await res.json());
      cached = { token: value.access_token, until: Date.now() + Math.max(0, value.expires_in - 60) * 1000 };
      return cached.token;
    } catch (error) { throw error instanceof PayPalError ? error : new PayPalError(); }
  }
  async function request(path: string, data?: unknown, requestId?: string) {
    const access = await token();
    try {
      const res = await fetcher(base + path, { method: data === undefined ? "GET" : "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
      if (!res.ok) {
        if (res.status === 401) cached = undefined;
        const error = await res.json().catch(() => ({})) as { details?: { issue?: string }[] };
        const issue = Array.isArray(error.details) && error.details.some(d => d.issue === "REFUND_FAILED_INSUFFICIENT_FUNDS") ? "REFUND_FAILED_INSUFFICIENT_FUNDS" : undefined;
        throw new PayPalError(res.status === 400 || res.status === 422, issue, res.status);
      }
      return await res.json();
    } catch (error) { throw error instanceof PayPalError ? error : new PayPalError(); }
  }
  return {
    environment,
    async ready() { await credentials(); },
    async create(id, amount, returnUrl, cancelUrl, currency = "JPY", brandName) {
      return orderSchema.parse(await request("/v2/checkout/orders", {
        intent: "CAPTURE", purchase_units: [{ custom_id: id, amount: { currency_code: currency, value: paypalValue(amount, currency) } }],
        payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", ...(brandName?.trim() ? { brand_name: [...brandName.trim()].slice(0, 127).join("") } : {}), return_url: returnUrl, cancel_url: cancelUrl } } },
      }, `create-${id}`));
    },
    async order(id) { return orderSchema.parse(await request(`/v2/checkout/orders/${encodeURIComponent(id)}`)); },
    async capture(id, requestId) { return orderSchema.parse(await request(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, requestId)); },
    async refund(id, amount, requestId, currency = "JPY") { return refundSchema.parse(await request(`/v2/payments/captures/${encodeURIComponent(id)}/refund`, { amount: { currency_code: currency, value: paypalValue(amount, currency) } }, requestId)); },
    async refundStatus(id) { return refundSchema.parse(await request(`/v2/payments/refunds/${encodeURIComponent(id)}`)); },
    async captureStatus(id) { return captureSchema.parse(await request(`/v2/payments/captures/${encodeURIComponent(id)}`)); },
    async transactions({ start, end, type = "all" }) {
      const rows: PayPalTransaction[] = [];
      // Transaction Search requires both bounds and returns at most 31 days. The caller clamps them.
      for (let page = 1; page <= 5; page++) {
        const query = new URLSearchParams({ start_date: start, end_date: end, fields: "transaction_info", page_size: "100", page: String(page) });
        const result = transactionSearchSchema.parse(await request(`/v1/reporting/transactions?${query}`));
        rows.push(...(result.transaction_details || []).map(row => row.transaction_info));
        if (!result.total_pages || page >= result.total_pages) break;
      }
      if (type === "all") return rows;
      return rows.filter(row => {
        const refund = isRefundTransaction(row);
        return type === "refund" ? refund : !refund;
      });
    },
  };
}
export function approvalUrl(order: PayPalOrder, environment: PayPalEnvironment) {
  const raw = order.links?.find(link => link.rel === "payer-action" || link.rel === "approve")?.href;
  if (!raw) throw new PayPalError();
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== (environment === "sandbox" ? "www.sandbox.paypal.com" : "www.paypal.com")) throw new PayPalError();
  return url.href;
}
