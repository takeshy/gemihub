import { z } from "zod";
import { refundQuote, refundTiersSchema, type RefundTiers } from "./payment-domain.ts";

/** Fixed discounts, choosing the largest that returns at least 20 percentage points more than cancellation. */
export const transferDiscounts = [50, 30, 10] as const;
export const minimumRecoveryGain = 20;
/** The no-refund listing closes this many minutes before the visit. */
export const finalListingMinutes = 10;

export type TransferTerms = {
  /** Refund rate that applies if the holder cancels instead, at `at`. */
  refundPercent: number;
  discountPercent: number;
  /** Minor units the transferee pays and the holder gets back. Never more than `basis`. */
  price: number;
  basis: number;
  /** Listing end (exclusive): the moment the current refund zone ends. */
  deadline: string;
  /** What an unsold listing settles to: the cancellation at the deadline. */
  unsold: { percent: number; amount: number };
};

/**
 * Deterministic transfer terms for a paid booking, from the policy frozen at booking time.
 * Equal-rate tiers form one zone. Rates above 70% cannot offer a fixed discount
 * while improving recovery by 20 points, so they use normal cancellation.
 */
export function transferTerms(payment: { amount: number; policy: RefundTiers }, start: string, at: string): TransferTerms | undefined {
  const startAt = Date.parse(start), now = Date.parse(at);
  if (!Number.isFinite(startAt) || !Number.isFinite(now) || !Number.isSafeInteger(payment.amount) || payment.amount <= 0) return undefined;
  const tiers = refundTiersSchema.parse(payment.policy);
  const remaining = startAt - now;
  if (remaining <= finalListingMinutes * 60000) return undefined;
  const index = tiers.findIndex(tier => remaining >= tier.hoursBefore * 3600000);
  const refundPercent = tiers[index].percent;
  const discountPercent = transferDiscounts.find(discount => 100 - discount >= refundPercent + minimumRecoveryGain);
  if (discountPercent === undefined) return undefined;
  let last = index;
  while (last + 1 < tiers.length && tiers[last + 1].percent === refundPercent) last++;
  const end = tiers[last].hoursBefore > 0 ? startAt - tiers[last].hoursBefore * 3600000 : startAt - finalListingMinutes * 60000;
  if (end <= now) return undefined;
  const deadline = new Date(end).toISOString();
  const price = Math.floor(payment.amount * (100 - discountPercent) / 100);
  if (price <= 0) return undefined;
  const unsold = refundQuote(payment.amount, start, deadline, tiers, "customer");
  // Invariant: selling never returns less than the cancellation the listing falls back to.
  if (price < unsold.amount) return undefined;
  return { refundPercent, discountPercent, price, basis: payment.amount, deadline, unsold };
}

export const bookingTransferSchema = z.object({
  id: z.string().min(1), at: z.iso.datetime(),
  from: z.object({ customer: z.string(), name: z.string(), message: z.string().optional() }),
  to: z.object({ customer: z.string(), name: z.string() }),
  /** Minor units; the transferee's capture and the same-amount refund to the previous holder. */
  price: z.number().int().positive(), currency: z.enum(["JPY", "USD"]), discountPercent: z.number().int(),
  previous: z.object({ orderId: z.string(), captureId: z.string(), amount: z.number().int().positive() }),
  refund: z.object({
    amount: z.number().int().positive(),
    status: z.enum(["retrying", "pending", "awaiting_funds", "completed", "manual_review"]),
    requestId: z.string().min(1), refundId: z.string().optional(), attemptedAt: z.iso.datetime().optional(),
  }),
});
export type BookingTransfer = z.infer<typeof bookingTransferSchema>;
