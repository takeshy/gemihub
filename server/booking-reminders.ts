import { createHash } from "node:crypto";
import { origin } from "./auth.ts";
import { bookingHeldSince, bookingMenuName, bookingStaffName, type Booking } from "./domain.ts";
import { requestLocale } from "./i18n.ts";
import { judgeActive } from "./judge.ts";
import { isArchivedShop, type Shop, type Store } from "./store.ts";
import { customerPaneUrl } from "./storefront-build.tsx";
import type { Transfer } from "./transfers.ts";
import { tr, intlLocale } from "../shared/i18n.ts";
import { regionOf } from "../shared/region.ts";
import { bookingReminderDue } from "../shared/booking-reminders.ts";

export type BookingReminder = { bookingId: string; customer: string; start: string };

/** Bookings their holder has given up for a replacement: still active, but the customer should not come. */
export async function listedBookingIds(store: Store, shop: Shop) {
  return new Set((await store.records<Transfer>("transfer", shop)).filter(t => t.phase === "listed").map(t => t.bookingId));
}

export function reminderCurrent(booking: Booking | undefined, reminder: BookingReminder, listed: ReadonlySet<string>, now = Date.now()) {
  return !!booking && booking.status === "active" && booking.customer === reminder.customer &&
    booking.start === reminder.start && Date.parse(booking.start) > now && !listed.has(booking.id);
}

/** Caller holds the shop's mail lock. The notice and outbox entry commit together. */
export async function queueBookingReminders(store: Store, shop: Shop,
  enqueue: (id: string, mail: { to: string; subject: string; body: string; reminder: BookingReminder }) => Promise<void>,
  now = Date.now(),
) {
  if (!shop.published || isArchivedShop(shop) || (!shop.google && !shop.judge) || (shop.judge && !judgeActive())) return;
  const config = shop.published;
  const shopLocale = shop.locale || (await store.get<{ locale: "ja" | "en" }>("shopLocale", shop.id))?.locale || "ja";
  const [bookings, listed] = await Promise.all([store.bookings(shop.id), listedBookingIds(store, shop)]);
  for (const booking of bookings) {
    const due = bookingReminderDue(config, booking);
    // A withdrawn listing leaves no reminder marker, so its holder is reminded on the next check.
    if (booking.status !== "active" || listed.has(booking.id) || !Number.isFinite(due) || due > now || Date.parse(booking.start) <= now ||
      // Short-notice bookings and purchases already receive their confirmation; avoid a second immediate email.
      !(Date.parse(bookingHeldSince(booking)) <= due)) continue;
    const id = `booking-reminder:${createHash("sha256").update(JSON.stringify([shop.id, booking.id, booking.customer, booking.start])).digest("hex")}`;
    if (await store.get("bookingReminder", id)) continue;
    await requestLocale.run(booking.locale || shopLocale, async () => {
      const link = customerPaneUrl(shop, origin(), "mine", booking.locale || shopLocale);
      const when = (date: string) => new Date(date).toLocaleString(intlLocale(), { timeZone: regionOf(config).timeZone, timeZoneName: "short" });
      await store.transaction(async () => {
        await enqueue(id, {
          to: booking.customer,
          subject: tr("{0} ご来店前の予約確認", config.name),
          body: tr("{0} 様\nご予約が近づいています。\n日時: {1} ～ {2}\nメニュー: {3}\n担当者: {4}\nアクセス: {5}\n\n予約の確認・キャンセル: {6}\nご来店が難しい場合は、早めにマイページからキャンセルをお願いします。ログインが必要な場合は、ご予約のメールアドレスでログインしてください。返金条件はマイページで確認できます。", booking.name, when(booking.start), when(booking.end), bookingMenuName(config, booking), bookingStaffName(config, booking.staffId), config.address, link),
          reminder: { bookingId: booking.id, customer: booking.customer, start: booking.start },
        });
        await store.put("bookingReminder", id, { shopId: shop.id, at: new Date(now).toISOString() });
      });
    });
  }
}
