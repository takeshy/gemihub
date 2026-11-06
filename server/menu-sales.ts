import type { Booking, ShopConfig } from "./domain.ts";
import { isVisit } from "./customers.ts";
import { currencyOf, dateIn, regionOf, fromMinor, toMinor, type Currency } from "../shared/region.ts";
import type { MenuSalesRow } from "../shared/booking-analytics.ts";
import { tr } from "../shared/i18n.ts";

/** Allocate saved booking totals by saved item prices, conserving every yen/cent after discounts. */
export function menuRevenueParts(booking: Booking, config: ShopConfig, currency: Currency) {
  const total = toMinor(booking.price, currency);
  const unknown = () => [{ id: "unallocated:", name: tr("内訳不明"), kind: "unknown" as const, amount: total }];
  if (!booking.items?.length) {
    if (booking.optionIds?.length) return unknown();
    return [{ id: booking.menuId, name: config.menus.find(menu => menu.id === booking.menuId)?.name || tr("現在の設定にないメニュー"), kind: "service" as const, amount: total }];
  }
  const weights = booking.items.map(item => Math.max(0, toMinor(item.price, currency)));
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  if (!denominator && total) return unknown();
  const parts = booking.items.map((item, index) => {
    const product = BigInt(total) * BigInt(weights[index]), divisor = BigInt(denominator || 1);
    return { id: item.menuId, name: item.name, kind: item.menuId === booking.menuId ? "service" as const : "addon" as const,
      amount: Number(product / divisor), remainder: product % divisor, index };
  });
  const remainder = total - parts.reduce((sum, part) => sum + part.amount, 0);
  const ranked = [...parts].sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.index - b.index);
  for (let i = 0; i < remainder; i++) ranked[i].amount++;
  return parts.map(({ id, name, kind, amount }) => ({ id, name, kind, amount }));
}

export function menuSales(config: ShopConfig, bookings: Booking[], dates: string[], now: Date): MenuSalesRow[] {
  const region = regionOf(config), currency = currencyOf(region);
  const rows = new Map<string, MenuSalesRow>(config.menus.map(menu => [menu.id, { id: menu.id, name: menu.name, kind: menu.optionFor ? "addon" : "service", visits: 0, revenue: 0, trend: [] }]));
  for (const booking of bookings) {
    const date = dateIn(new Date(booking.end), region.timeZone);
    if (!isVisit(booking, now) || date < dates[0] || date > dates.at(-1)!) continue;
    const seen = new Set<string>();
    for (const part of menuRevenueParts(booking, config, currency)) {
      const row = rows.get(part.id) || { id: part.id, name: part.name, kind: part.kind, visits: 0, revenue: 0, trend: [] };
      const point = row.trend.find(value => value.date === date) || { date, visits: 0, revenue: 0 };
      if (!row.trend.includes(point)) row.trend.push(point);
      if (!seen.has(part.id)) { row.visits++; point.visits++; seen.add(part.id); }
      row.revenue = fromMinor(toMinor(row.revenue, currency) + part.amount, currency);
      point.revenue = fromMinor(toMinor(point.revenue, currency) + part.amount, currency);
      rows.set(part.id, row);
    }
  }
  for (const row of rows.values()) row.trend.sort((a, b) => a.date.localeCompare(b.date));
  return [...rows.values()];
}
