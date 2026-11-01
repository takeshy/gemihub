import { tr } from "../shared/i18n.ts";
import { z } from "zod";

export const defaultRefundTiers = [
  { hoursBefore: 72, percent: 100 },
  { hoursBefore: 24, percent: 50 },
  { hoursBefore: 0, percent: 0 },
];
export const refundTiersSchema = z.array(z.object({
  hoursBefore: z.number().int().min(0).max(8760),
  percent: z.number().int().min(0).max(100),
})).min(1).max(10).superRefine((tiers, ctx) => {
  if (tiers.at(-1)?.hoursBefore !== 0 || tiers.some((tier, i) => i > 0 &&
    (tier.hoursBefore >= tiers[i - 1].hoursBefore || tier.percent > tiers[i - 1].percent)))
    ctx.addIssue({ code: "custom", message: tr("返金条件は時間の大きい順、返金率は同じか小さくし、最後を0時間にしてください") });
});
export type RefundTiers = z.infer<typeof refundTiersSchema>;
export const paymentRulesSchema = z.object({ enabled: z.boolean(), refundTiers: refundTiersSchema });
export const bookingPaymentSchema = z.object({
  provider: z.literal("paypal"), environment: z.enum(["sandbox", "live"]),
  orderId: z.string().min(1), captureId: z.string().min(1),
  amount: z.number().int().positive(), currency: z.literal("JPY"),
  policy: refundTiersSchema,
  cancellation: z.object({
    at: z.iso.datetime(), by: z.string(), reason: z.enum(["customer", "shop"]),
    percent: z.number().int().min(0).max(100), amount: z.number().int().min(0),
    status: z.enum(["not_required", "retrying", "pending", "awaiting_funds", "completed", "manual_review"]),
    requestId: z.string().min(1), refundId: z.string().optional(), attemptedAt: z.iso.datetime().optional(),
  }).optional(),
});
export type BookingPayment = z.infer<typeof bookingPaymentSchema>;
export function refundQuote(amount: number, start: string, at: string, policy: RefundTiers, reason: "customer" | "shop") {
  const remaining = Math.max(0, Date.parse(start) - Date.parse(at));
  if (!Number.isFinite(remaining) || !Number.isSafeInteger(amount) || amount < 0) throw new Error(tr("返金計算の値が不正です"));
  const percent = reason === "shop" ? 100 : refundTiersSchema.parse(policy).find(t => remaining >= t.hoursBefore * 3600000)!.percent;
  // JPY has no fractional unit. Round down once, always using the original capture amount.
  return { percent, amount: Math.floor(amount * percent / 100) };
}
export function policyText(tiers: RefundTiers) {
  return tiers.map((tier, i) => {
    const range = tier.hoursBefore > 0
      ? tr("開始まで{0}時間以上{1}", tier.hoursBefore, i > 0 ? tr("{0}時間未満", tiers[i - 1].hoursBefore) : "")
      : i > 0 ? tr("開始まで{0}時間未満（開始後を含む）", tiers[i - 1].hoursBefore) : tr("いつでも");
    return tr("{0}：{1}%返金", range, tier.percent);
  }).join(" ／ ");
}
