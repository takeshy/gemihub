import { dateIn, regionOf } from "./region.ts";
import { inquiryStatus } from "../server/inquiries.ts";
import type { Booking, ShopConfig } from "../server/domain.ts";

/** Use the shop's date and the inquiry list's status semantics, including legacy records. */
export function managementSummary<T extends { id: string; status: string; at?: string }>(
  config: ShopConfig, bookings: Booking[], inquiries: T[], now: Date | number = Date.now(),
) {
  const timeZone = regionOf(config).timeZone;
  const today = dateIn(now, timeZone);
  return {
    today,
    bookings: bookings.filter(booking => Number.isFinite(Date.parse(booking.start)) && dateIn(booking.start, timeZone) === today)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)),
    inquiries: inquiries.filter(inquiry => inquiryStatus(inquiry) === "new")
      .sort((a, b) => (Date.parse(a.at || "") || 0) - (Date.parse(b.at || "") || 0) || a.id.localeCompare(b.id)),
  };
}
