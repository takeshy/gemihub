import type { Booking, ShopConfig } from "../server/domain";
import { refundQuote } from "../server/payment-domain";
export function simulatePayment(booking: Booking, config: ShopConfig) {
  if (config.rules.payment?.enabled && booking.price > 0) booking.payment = {
    provider: "paypal", environment: "sandbox", orderId: `sample-order-${booking.id}`, captureId: `sample-capture-${booking.id}`,
    amount: booking.price, currency: "JPY", policy: structuredClone(config.rules.payment.refundTiers),
  };
  return booking;
}
export function simulateCancellation(booking: Booking, reason: "customer" | "shop", status: "completed" | "pending" | "manual_review" = "completed") {
  booking.status = "cancelled";
  const p = booking.payment;
  if (p && !p.cancellation) {
    const at = new Date().toISOString();
    const quote = refundQuote(p.amount, booking.start, at, p.policy, reason);
    p.cancellation = { ...quote, at, by: "sample@example.com", reason, requestId: `sample-refund-${booking.id}`, status: quote.amount ? status : "not_required" };
  }
  return booking;
}
