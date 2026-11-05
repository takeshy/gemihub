import type { Booking, ShopConfig } from "../server/domain.ts";

/** Leave time to cancel unpaid bookings before the shop's existing cutoff. */
export function bookingReminderHours(config: ShopConfig, booking: Pick<Booking, "payment">) {
  return booking.payment ? 24 : Math.max(24, config.rules.cancelHours + 1);
}

export function bookingReminderDue(config: ShopConfig, booking: Pick<Booking, "start" | "payment">) {
  return Date.parse(booking.start) - bookingReminderHours(config, booking) * 3600000;
}
