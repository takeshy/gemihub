import type { BookingAnalytics } from "./booking-analytics.ts";
import { fromMinor, toMinor, type Currency } from "./region.ts";

export type AnalyticsUnit = "day" | "month";
export function groupCohorts(rows: BookingAnalytics["cohorts"], unit: AnalyticsUnit): BookingAnalytics["cohorts"] {
  if (unit === "day") return rows;
  const months = new Map<string, BookingAnalytics["cohorts"][number]>();
  for (const row of rows) {
    const date = row.date.slice(0, 7), current = months.get(date);
    if (!current) { months.set(date, { ...row, date }); continue; }
    for (const key of ["entered", "menu", "slot", "completed", "within1Day", "within7Days"] as const) current[key] += row[key];
    current.ageDays = Math.min(current.ageDays, row.ageDays);
    current.mature1Day &&= row.mature1Day; current.mature7Days &&= row.mature7Days;
  }
  return [...months.values()];
}
export function groupSales(rows: { date: string; revenue: number }[], unit: AnalyticsUnit, currency: Currency) {
  if (unit === "day") return rows;
  const months = new Map<string, number>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    months.set(month, (months.get(month) || 0) + toMinor(row.revenue, currency));
  }
  return [...months].map(([date, amount]) => ({ date, revenue: fromMinor(amount, currency) }));
}

/** Preserve every staff/menu series, sharing calendar buckets and filling missing dates with zero. */
export function salesTrendSeries(rows: { id: string; name: string; trend: { date: string; revenue: number }[]; colorIndex?: number }[], dates: string[], unit: AnalyticsUnit, currency: Currency, selectedId = "") {
  const labels = groupSales(dates.map(date => ({ date, revenue: 0 })), unit, currency).map(point => point.date);
  const series = rows.flatMap((row, index) => {
    if (selectedId && row.id !== selectedId) return [];
    const byDate = new Map(row.trend.map(point => [point.date, point.revenue]));
    return [{ id: row.id, name: row.name, colorIndex: row.colorIndex ?? index,
      values: groupSales(dates.map(date => ({ date, revenue: byDate.get(date) || 0 })), unit, currency).map(point => point.revenue),
    }];
  });
  return { labels, series };
}

/** Currency-accurate composition, including slices smaller than one percent. */
export function salesComposition(rows: { id: string; name: string; revenue: number }[], currency: Currency) {
  const positive = rows.map((row, index) => ({ ...row, colorIndex: index, amount: toMinor(row.revenue, currency) })).filter(row => row.amount > 0);
  const total = positive.reduce((sum, row) => sum + row.amount, 0);
  let cumulative = 0;
  return positive.map(row => {
    const start = cumulative / total * Math.PI * 2;
    cumulative += row.amount;
    return { ...row, percent: row.amount / total * 100, start, end: cumulative / total * Math.PI * 2 };
  });
}
