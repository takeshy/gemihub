import type { ArticleAccessDays, MonthlyTrafficResult, SiteTrafficResult } from "../../shared/article-access";
import type { BookingAnalytics, ConversionCounts } from "../../shared/booking-analytics";
import { fromMinor, toMinor, type Currency } from "../../shared/region";
import { tr } from "../../shared/i18n";
import { bookingAnalytics } from "../../server/booking-analytics";
import { sample } from "../../server/domain";

export type AnalyticsFixtureState = "ready" | "empty" | "truncated";
export function trafficFixture(days: ArticleAccessDays = 30, state: AnalyticsFixtureState = "ready", currency: Currency = "JPY", unit = "day"): SiteTrafficResult | MonthlyTrafficResult {
  const data = analyticsFixture(days, state, currency);
  const base = { days, timeZone: data.timeZone, totalViews: data.funnel.entered };
  if (unit === "month") {
    const months = new Map<string, number>();
    for (const row of data.cohorts) months.set(row.date.slice(0, 7), (months.get(row.date.slice(0, 7)) || 0) + row.entered);
    return { ...base, unit: "month", from: data.from, to: data.to, uniqueCountsAvailable: true,
      rows: [...months].reverse().map(([date, views]) => ({ date, views, uniqueBrowsers: Math.min(40, views) })),
    };
  }
  return { ...base, rows: [...data.cohorts].reverse().map(row => ({ date: row.date, views: row.entered, uniqueBrowsers: Math.min(40, row.entered) })) };
}
// Fixed observation date keeps screenshots, mature cohorts and pagination reproducible.
export function analyticsFixture(days: ArticleAccessDays = 30, state: AnalyticsFixtureState = "ready", currency: Currency = "JPY"): BookingAnalytics {
  const config = structuredClone(sample);
  config.region = currency === "USD" ? { country: "US", timeZone: "America/New_York" } : { country: "JP", timeZone: "Asia/Tokyo" };
  const data = bookingAnalytics(config, [], [], days, new Date("2026-11-07T12:00:00Z"));
  if (state === "empty") return data;
  data.unidentifiedViews = 12;
  for (const [index, row] of data.cohorts.entries()) {
    row.entered = 45 + index % 7 * 4;
    row.menu = Math.floor(row.entered * .8);
    row.slot = Math.floor(row.entered * .6);
    row.completed = Math.floor(row.entered * (row.ageDays < 2 ? .2 : .4));
    row.within1Day = Math.floor(row.completed * .8);
    row.within7Days = row.completed;
    for (const key of Object.keys(data.funnel) as (keyof ConversionCounts)[]) data.funnel[key] += row[key];
  }
  data.staff = [tr("あおい"), tr("はる")].map((name, index) => {
    const trend = data.cohorts.map(({ date, ageDays }, day) => {
      const visits = ageDays ? 2 + (day + index) % 4 : 0;
      return { date, visits, revenue: visits * (currency === "USD" ? 55.5 + index * 15 : 5500 + index * 1500) };
    });
    const completed = index ? data.funnel.completed - Math.floor(data.funnel.completed * .6) : Math.floor(data.funnel.completed * .6);
    return { id: index ? "haru" : "aoi", name, trend,
      visits: trend.reduce((sum, point) => sum + point.visits, 0), revenue: trend.reduce((sum, point) => sum + point.revenue, 0),
      selected: completed * 2 + 20, completed, menus: [],
    };
  });
  const names = [tr("シンプルネイル"), tr("季節のデザイン"), tr("追加ケア")];
  for (const person of data.staff) person.menus = names.map((name, index) => {
    const trend = person.trend.map(point => {
      const sales = toMinor(point.revenue, currency);
      const amount = index === 0 ? Math.floor(sales * .55) : index === 1 ? Math.floor(sales * .35) : sales - Math.floor(sales * .55) - Math.floor(sales * .35);
      return { date: point.date, visits: index === 2 ? Math.ceil(point.visits * .3) : index === 0 ? Math.ceil(point.visits * .6) : point.visits - Math.ceil(point.visits * .6), revenue: fromMinor(amount, currency) };
    });
    return { id: ["simple", "design", "care"][index], name, kind: index === 2 ? "addon" : "service", trend,
      revenue: fromMinor(trend.reduce((sum, point) => sum + toMinor(point.revenue, currency), 0), currency), visits: trend.reduce((sum, point) => sum + point.visits, 0) };
  });
  data.menus = names.map((name, index) => {
    const trend = data.cohorts.map(({ date }, day) => ({ date,
      visits: data.staff.reduce((sum, person) => sum + person.menus[index].trend[day].visits, 0),
      revenue: fromMinor(data.staff.reduce((sum, person) => sum + toMinor(person.menus[index].trend[day].revenue, currency), 0), currency),
    }));
    return { id: ["simple", "design", "care"][index], name, kind: index === 2 ? "addon" : "service", trend,
      revenue: fromMinor(trend.reduce((sum, point) => sum + toMinor(point.revenue, currency), 0), currency), visits: trend.reduce((sum, point) => sum + point.visits, 0) };
  });
  if (state === "truncated") {
    data.logsTruncated = true;
    for (const key of Object.keys(data.funnel) as (keyof ConversionCounts)[]) data.funnel[key] = 0;
    for (const row of data.cohorts) for (const key of Object.keys(data.funnel) as (keyof ConversionCounts)[]) row[key] = 0;
    for (const staff of data.staff) { staff.selected = 0; staff.completed = 0; }
  }
  return data;
}
