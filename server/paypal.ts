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
export const refundSchema = z.object({ id: z.string(), status: z.string(), amount: money.optional() });
export type PayPalRefund = z.infer<typeof refundSchema>;
export interface PaymentGateway {
  environment: PayPalEnvironment;
  ready(): Promise<void>;
  create(id: string, amount: number, returnUrl: string, cancelUrl: string): Promise<PayPalOrder>;
  order(id: string): Promise<PayPalOrder>;
  capture(id: string, requestId: string): Promise<PayPalOrder>;
  refund(captureId: string, amount: number, requestId: string): Promise<PayPalRefund>;
  refundStatus(id: string): Promise<PayPalRefund>;
}
export class PayPalError extends Error {
  status = 503;
  constructor(readonly definitive = false, readonly issue?: "REFUND_FAILED_INSUFFICIENT_FUNDS") { super(tr("PayPalの処理状況を確認できません。マイページから再確認してください。")); }
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
      if (!res.ok) throw new PayPalError();
      const value = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await res.json());
      cached = { token: value.access_token, until: Date.now() + Math.max(0, value.expires_in - 60) * 1000 };
      return cached.token;
    } catch { throw new PayPalError(); }
  }
  async function request(path: string, data?: unknown, requestId?: string) {
    const access = await token();
    try {
      const res = await fetcher(base + path, { method: data === undefined ? "GET" : "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
      if (!res.ok) {
        if (res.status === 401) cached = undefined;
        const error = await res.json().catch(() => ({})) as { details?: { issue?: string }[] };
        const issue = Array.isArray(error.details) && error.details.some(d => d.issue === "REFUND_FAILED_INSUFFICIENT_FUNDS") ? "REFUND_FAILED_INSUFFICIENT_FUNDS" : undefined;
        throw new PayPalError(res.status === 400 || res.status === 422, issue);
      }
      return await res.json();
    } catch (error) { throw error instanceof PayPalError ? error : new PayPalError(); }
  }
  return {
    environment,
    async ready() { await credentials(); },
    async create(id, amount, returnUrl, cancelUrl) {
      return orderSchema.parse(await request("/v2/checkout/orders", {
        intent: "CAPTURE", purchase_units: [{ custom_id: id, amount: { currency_code: "JPY", value: String(amount) } }],
        payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: returnUrl, cancel_url: cancelUrl } } },
      }, `create-${id}`));
    },
    async order(id) { return orderSchema.parse(await request(`/v2/checkout/orders/${encodeURIComponent(id)}`)); },
    async capture(id, requestId) { return orderSchema.parse(await request(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, requestId)); },
    async refund(id, amount, requestId) { return refundSchema.parse(await request(`/v2/payments/captures/${encodeURIComponent(id)}/refund`, { amount: { currency_code: "JPY", value: String(amount) } }, requestId)); },
    async refundStatus(id) { return refundSchema.parse(await request(`/v2/payments/refunds/${encodeURIComponent(id)}`)); },
  };
}
export function approvalUrl(order: PayPalOrder, environment: PayPalEnvironment) {
  const raw = order.links?.find(link => link.rel === "payer-action" || link.rel === "approve")?.href;
  if (!raw) throw new PayPalError();
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== (environment === "sandbox" ? "www.sandbox.paypal.com" : "www.paypal.com")) throw new PayPalError();
  return url.href;
}
