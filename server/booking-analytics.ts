import type { Booking, ShopConfig } from "./domain.ts";
import { bookingStaff } from "./domain.ts";
import type { ShopLog } from "./shop-logs.ts";
import { currencyOf, dateIn, regionOf, toMinor, fromMinor, zonedDate } from "../shared/region.ts";
import type { ArticleAccessDays } from "../shared/article-access.ts";
import type { BookingAnalytics, ConversionCounts, MenuSalesRow } from "../shared/booking-analytics.ts";
import { isVisit } from "./customers.ts";
import { menuSales } from "./menu-sales.ts";

export function analyticsDates(days: number, now: Date, timeZone: string) {
  const today = dateIn(now, timeZone);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(`${today}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - days + i + 1);
    return day.toISOString().slice(0, 10);
  });
}
const empty = (): ConversionCounts => ({ entered: 0, menu: 0, slot: 0, completed: 0, within1Day: 0, within7Days: 0 });

/** One entry per browser in the window; only later, server-confirmed outcomes convert it. */
export function bookingAnalytics(config: ShopConfig, bookings: Booking[], logs: ShopLog[], days: ArticleAccessDays, now = new Date(), logsTruncated = false): BookingAnalytics {
  const region = regionOf(config), currency = currencyOf(region);
  const dates = analyticsDates(days, now, region.timeZone), first = dates[0];
  const cohorts = dates.map(date => {
    const nextDay = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const end = zonedDate(nextDay, "00:00", region.timeZone).getTime();
    return { date, ageDays: Math.floor((Date.parse(dates.at(-1)!) - Date.parse(date)) / 86400000),
      mature1Day: now.getTime() >= end + 86400000, mature7Days: now.getTime() >= end + 7 * 86400000, ...empty() };
  });
  const staff = new Map(bookingStaff(config).map(person => [person.id, { id: person.id, name: person.name, visits: 0, revenue: 0, selected: 0, completed: 0, trend: dates.map(date => ({ date, visits: 0, revenue: 0 })), menus: [] as MenuSalesRow[] }]));
  const staffRow = (id: string) => {
    if (!staff.has(id)) staff.set(id, { id, name: id, visits: 0, revenue: 0, selected: 0, completed: 0, trend: dates.map(date => ({ date, visits: 0, revenue: 0 })), menus: [] });
    return staff.get(id)!;
  };
  const byStaff = new Map<string, Booking[]>();
  for (const booking of bookings) {
    const day = dateIn(new Date(booking.end), region.timeZone);
    if (!isVisit(booking, now) || day < first || day > dates.at(-1)!) continue;
    const row = staffRow(booking.staffId), point = row.trend.find(value => value.date === day)!;
    row.visits++; point.visits++;
    row.revenue = fromMinor(toMinor(row.revenue, currency) + toMinor(booking.price, currency), currency);
    point.revenue = fromMinor(toMinor(point.revenue, currency) + toMinor(booking.price, currency), currency);
    if (!byStaff.has(booking.staffId)) byStaff.set(booking.staffId, []);
    byStaff.get(booking.staffId)!.push(booking);
  }
  for (const row of staff.values()) row.menus = menuSales(config, byStaff.get(row.id) || [], dates, now).filter(menu => menu.visits > 0);
  type Entry = { at: string; date: string; menu: boolean; slot: boolean; completedAt?: string; selectedStaff: Set<string>; completedStaff?: string };
  const entries = new Map<string, Entry>(), customers = new Map<string, Entry>();
  const bookingById = new Map(bookings.map(booking => [booking.id, booking]));
  let unidentifiedViews = 0;
  // Never publish a misleading percentage when the bounded scan cannot cover the window.
  const order = (log: ShopLog) => log.kind === "page_view" ? 0 : log.kind === "booking_step" ? 1 : 2;
  for (const log of (logsTruncated ? [] : [...logs]).sort((a, b) => a.at.localeCompare(b.at) || order(a) - order(b) || a.id.localeCompare(b.id))) {
    if (!log.ok || log.at > now.toISOString()) continue;
    const date = dateIn(new Date(log.at), region.timeZone);
    if (date < first) continue;
    const isEntry = log.kind === "page_view" && log.operation === "reserve";
    const key = log.visitorKey ? `browser:${log.visitorKey}` : log.customerKey ? `customer:${log.customerKey}` : undefined;
    if (isEntry && !key) { unidentifiedViews++; continue; }
    let entry = key ? entries.get(key) : undefined;
    if (isEntry && key && !entry) {
      // A customer without browser storage may later acquire it; preserve their initial cohort.
      entry = log.customerKey ? entries.get(`customer:${log.customerKey}`) : undefined;
      entry ||= { at: log.at, date, menu: false, slot: false, selectedStaff: new Set() };
      entries.set(key, entry);
    }
    if (entry && log.customerKey) customers.set(log.customerKey, entry);
    entry ||= log.customerKey ? customers.get(log.customerKey) : undefined;
    if (!entry || log.at < entry.at) continue;
    if (log.kind === "booking_step") {
      if (log.operation === "menu_selected") entry.menu = true;
      if (log.operation === "slot_selected") { entry.menu = true; entry.slot = true; }
      if (log.staffId) entry.selectedStaff.add(log.staffId);
    }
    if (log.kind === "activity" && log.operation === "booking_completed" && !entry.completedAt) {
      // Transfer purchases have their own path and must not convert the standard booking funnel.
      const booking = log.bookingId ? bookingById.get(log.bookingId) : undefined;
      if (!booking || booking.transfers?.length || Date.parse(booking.createdAt) < Date.parse(entry.at)) continue;
      entry.completedAt = log.at; entry.completedStaff = booking.staffId;
      // Older outcomes don't prove newly instrumented selection steps were observed.
    }
  }
  const funnel = empty();
  for (const entry of new Set(entries.values())) {
    const cohort = cohorts.find(row => row.date === entry.date)!;
    for (const counts of [funnel, cohort]) {
      counts.entered++; if (entry.menu) counts.menu++; if (entry.slot) counts.slot++;
      if (entry.completedAt) {
        counts.completed++;
        const elapsed = Date.parse(entry.completedAt) - Date.parse(entry.at);
        if (elapsed <= 86400000) counts.within1Day++;
        if (elapsed <= 7 * 86400000) counts.within7Days++;
      }
    }
    for (const id of entry.selectedStaff) staffRow(id).selected++;
    if (entry.completedStaff) {
      const row = staffRow(entry.completedStaff); row.completed++;
      // Include no-preference bookings in the assigned staff's denominator.
      if (!entry.selectedStaff.has(entry.completedStaff)) row.selected++;
    }
  }
  return { days, from: first, to: now.toISOString(), timeZone: region.timeZone, currency, logsTruncated, unidentifiedViews, funnel, cohorts, staff: [...staff.values()], menus: menuSales(config, bookings, dates, now) };
}
