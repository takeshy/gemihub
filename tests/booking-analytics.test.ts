import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { bookingAnalytics } from "../server/booking-analytics.ts";
import { sample, type Booking } from "../server/domain.ts";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { ShopLogs, type ShopLog } from "../server/shop-logs.ts";
import { parse, render } from "pele";
import { xyChart, diagramLabel, diagramPlainText } from "../shared/diagrams.ts";
import { groupCohorts, groupSales, salesTrendSeries, salesComposition } from "../shared/analytics-grouping.ts";
import { dateIn, zonedDate } from "../shared/region.ts";
import { menuRevenueParts } from "../server/menu-sales.ts";

const now = new Date("2026-11-07T03:00:00Z");
function event(at: string, operation: string, fields: Partial<ShopLog> = {}): ShopLog {
  return { id: randomUUID(), shopId: "shop", requestId: "request", at, kind: "page_view", operation, ok: true, ...fields };
}
function booking(fields: Partial<Booking> = {}): Booking {
  return { id: "b1", shopId: "shop", customer: "a@example.com", name: "A", menuId: sample.menus[0].id, price: 100, staffId: sample.staff[0].id, message: "", start: "2026-11-06T02:00:00Z", end: "2026-11-06T03:00:00Z", createdAt: "2026-11-01T02:00:00Z", status: "active", ...fields };
}

test("anonymous entry links to authenticated outcomes once, in entry-date cohorts", () => {
  const logs = [
    event("2026-10-31T23:30:00Z", "reserve", { visitorKey: "browser-a" }),
    event("2026-11-01T01:00:00Z", "reserve", { visitorKey: "browser-a", customerKey: "customer-a" }),
    event("2026-11-01T01:30:00Z", "slot_selected", { kind: "booking_step", visitorKey: "browser-a", customerKey: "customer-a", staffId: sample.staff[0].id }),
    event("2026-11-01T02:00:00Z", "booking_completed", { kind: "activity", customerKey: "customer-a", bookingId: "b1" }),
    event("2026-11-01T02:01:00Z", "booking_completed", { kind: "activity", customerKey: "customer-a", bookingId: "b1" }),
    event("2026-11-02T00:00:00Z", "reserve", { visitorKey: "browser-a", customerKey: "customer-a" }),
    event("2026-11-02T01:00:00Z", "reserve"),
    event("2026-11-08T00:00:00Z", "reserve", { visitorKey: "future" }),
  ];
  const result = bookingAnalytics(sample, [booking()], logs.reverse(), 7, now);
  assert.deepEqual(result.funnel, { entered: 1, menu: 1, slot: 1, completed: 1, within1Day: 1, within7Days: 1 });
  assert.equal(result.cohorts[0].date, "2026-11-01");
  assert.equal(result.cohorts[0].completed, 1);
  assert.equal(result.unidentifiedViews, 1);
  assert.equal(result.staff.find(row => row.id === sample.staff[0].id)?.completed, 1);
  assert.ok(!JSON.stringify(result).includes("customer-a"));
});

test("completion belongs to most recently identified device, never to a prior booking or transfer", () => {
  const logs = [
    event("2026-11-01T00:00:00Z", "reserve", { visitorKey: "a", customerKey: "c" }),
    event("2026-11-02T00:00:00Z", "reserve", { visitorKey: "b", customerKey: "c" }),
    event("2026-11-02T00:01:00Z", "booking_completed", { kind: "activity", customerKey: "c", bookingId: "old" }),
    event("2026-11-02T00:02:00Z", "booking_completed", { kind: "activity", customerKey: "c", bookingId: "transfer" }),
    event("2026-11-03T00:00:00Z", "booking_completed", { kind: "activity", customerKey: "c", bookingId: "new" }),
  ];
  const bookings = [booking({ id: "old" }), booking({ id: "transfer", createdAt: "2026-11-02T00:01:00Z", transfers: [{} as never] }), booking({ id: "new", createdAt: "2026-11-03T00:00:00Z" })];
  const result = bookingAnalytics(sample, bookings, logs, 7, now);
  assert.equal(result.funnel.entered, 2); assert.equal(result.funnel.completed, 1);
  assert.equal(result.cohorts[0].completed, 0); assert.equal(result.cohorts[1].completed, 1);
  assert.equal(result.staff.find(row => row.id === sample.staff[0].id)?.selected, 1, "no-preference completions include assigned staff");
});

test("storage-disabled signed-in users and 1/7-day elapsed windows are counted", () => {
  const logs = [
    event("2026-11-01T00:00:00Z", "reserve", { customerKey: "c" }),
    event("2026-11-02T01:00:00Z", "reserve", { customerKey: "c" }),
    event("2026-11-02T02:00:00Z", "booking_completed", { kind: "activity", customerKey: "c", bookingId: "b1" }),
  ];
  const result = bookingAnalytics(sample, [booking({ createdAt: logs[2].at })], logs, 7, now);
  assert.equal(result.funnel.entered, 1); assert.equal(result.funnel.within1Day, 0); assert.equal(result.funnel.within7Days, 1);
});

test("sales follow shop-local service end date, preserve cents, and exclude invalid visits", () => {
  const config = structuredClone(sample); config.region = { country: "US", timeZone: "America/New_York" };
  const rows = [booking({ price: 0.1, end: "2026-10-31T03:00:00Z" }), // Oct 30 local, excluded.
    booking({ price: 0.1 }), booking({ price: 0.2 }), booking({ status: "cancelled", price: 1000 }),
    booking({ status: "no_show", price: 1000 }), booking({ end: "2026-11-08T00:00:00Z", price: 1000 }),
    booking({ staffId: "deleted-staff", price: 0 }),
  ];
  const result = bookingAnalytics(config, rows, [], 7, now);
  const staff = result.staff.find(row => row.id === sample.staff[0].id)!;
  assert.equal(result.currency, "USD"); assert.equal(staff.visits, 2); assert.equal(staff.revenue, 0.3);
  assert.equal(staff.trend.find(row => row.date === "2026-11-05")?.revenue, 0.3);
  assert.equal(result.staff.find(row => row.id === "deleted-staff")?.visits, 1);
  const truncated = bookingAnalytics(config, rows, [event("2026-11-02T00:00:00Z", "reserve", { visitorKey: "a" })], 7, now, true);
  assert.equal(truncated.logsTruncated, true); assert.equal(truncated.funnel.entered, 0); assert.equal(truncated.staff[0].revenue, 0.3);
});

test("generated charts parse and business labels cannot inject diagram statements", () => {
  const label = 'A"]\nclick evil "https://untrusted.invalid"\n<script>alert(1)</script>';
  for (const source of [xyChart("Revenue", [label, "B"], [[0, 2.5], [1, 3]], "line", "USD", [label, "Browsers"]), `flowchart LR\na[${diagramLabel(label)}] --> b[Done]`]) {
    const result = render(source, { links: false, images: false });
    assert.ok(result.svg.includes("<svg"));
    assert.ok(!/<script|href=|<image|onclick=/i.test(result.svg));
  }
  const chart = render(xyChart("Traffic", ["Today"], [[10], [2]], "line", "Count", ["Visits", "Confirmed"])).svg;
  assert.match(chart, /class="pele-legend"/);
  assert.match(chart, /class="pele-legend-item" data-id="Visits"/);
  assert.match(chart, /class="pele-legend-item" data-id="Confirmed"/);
});

test("menu sales split saved base/add-on prices after discounts and agree with staff sales", () => {
  const item = (menuId: string, price: number) => ({ menuId, name: menuId, price, duration: 30 });
  const record = booking({ price: 6000, optionIds: ["care"], items: [item(sample.menus[0].id, 5500), item("care", 1500)] });
  const config = structuredClone(sample); config.menus[0].price = 999999;
  const result = bookingAnalytics(config, [record, booking({ status: "cancelled", price: 1000 }), booking({ status: "no_show" }), booking({ end: "2026-11-08T00:00:00Z" })], [], 7, now);
  assert.equal(result.menus.find(row => row.id === record.menuId)?.revenue, 4714);
  assert.equal(result.menus.find(row => row.id === "care")?.revenue, 1286);
  assert.equal(result.menus.find(row => row.id === "care")?.kind, "addon");
  assert.equal(result.menus.reduce((sum, row) => sum + row.revenue, 0), result.staff.reduce((sum, row) => sum + row.revenue, 0));
  assert.equal(result.menus.find(row => row.id === "care")?.trend[0].date, "2026-11-06");
  assert.equal(result.menus.find(row => row.id === "care")?.visits, 1);
});

test("staff menu breakdowns include only that staff's ended appointments and reconcile to staff totals", () => {
  const item = (menuId: string, price: number) => ({ menuId, name: menuId, price, duration: 30 });
  const first = booking({ price: 6000, items: [item(sample.menus[0].id, 5500), item("care", 1500)] });
  const second = booking({ id: "b2", staffId: sample.staff[1].id, price: 2000, items: [item(sample.menus[0].id, 1500), item("care", 500)] });
  const cancelled = booking({ staffId: sample.staff[1].id, status: "cancelled", price: 9000 });
  const result = bookingAnalytics(sample, [first, second, cancelled], [], 7, now);
  const a = result.staff.find(row => row.id === first.staffId)!, b = result.staff.find(row => row.id === second.staffId)!;
  assert.equal(a.menus.find(row => row.id === "care")?.revenue, 1286);
  assert.equal(b.menus.find(row => row.id === "care")?.revenue, 500);
  assert.equal(a.menus.reduce((sum, row) => sum + row.revenue, 0), a.revenue);
  assert.equal(b.menus.reduce((sum, row) => sum + row.revenue, 0), b.revenue);
  assert.equal(a.menus.reduce((sum, row) => sum + row.visits, 0), 2);
  assert.equal(result.menus.find(row => row.id === "care")?.revenue, 1786);
  const empty = bookingAnalytics(sample, [], [], 7, now);
  assert.ok(empty.staff.every(row => row.menus.length === 0));
});

test("menu allocation conserves cents including large amounts, free items and rounding ties", () => {
  const items = [sample.menus[0].id, "care"].map(menuId => ({ menuId, name: menuId, price: 1, duration: 30 }));
  const record = booking({ price: .01, items });
  assert.deepEqual(menuRevenueParts(record, sample, "USD").map(row => row.amount), [1, 0]);
  const large = menuRevenueParts(booking({ price: 999999.99, items: items.map((item, index) => ({ ...item, price: index ? 999999.99 : 1000000 })) }), sample, "USD");
  assert.equal(large.reduce((sum, row) => sum + row.amount, 0), 99999999);
  const free = menuRevenueParts(booking({ price: 100, items: [{ ...items[0], price: 100 }, { ...items[1], price: 0 }] }), sample, "JPY");
  assert.deepEqual(free.map(row => row.amount), [100, 0]);
});

test("missing historical add-on prices remain unallocated and retired snapshots retain their names", () => {
  const record = booking({ price: 7000, optionIds: ["care"] });
  const result = bookingAnalytics(sample, [record], [], 7, now);
  assert.equal(result.menus.find(row => row.kind === "unknown")?.revenue, 7000);
  assert.equal(result.menus.find(row => row.id === record.menuId)?.revenue, 0);
  const retired = booking({ menuId: "retired", price: 100, items: [{ menuId: "retired", name: "Historical service", price: 100, duration: 30 }] });
  assert.equal(bookingAnalytics(sample, [retired], [], 7, now).menus.find(row => row.id === "retired")?.name, "Historical service");
});

test("menu counts deduplicate items within a booking and exclude sales outside the local date window", () => {
  const record = booking({ price: 100, items: [{ menuId: "care", name: "Care", price: 50, duration: 15 }, { menuId: "care", name: "Care", price: 50, duration: 15 }] });
  const result = bookingAnalytics(sample, [record, booking({ end: "2026-10-31T10:00:00Z", price: 1000 })], [], 7, now);
  assert.equal(result.menus.find(row => row.id === "care")?.visits, 1);
  assert.equal(result.menus.find(row => row.id === "care")?.revenue, 100);
});

test("staff/menu comparisons retain individual series across month boundaries and filtering", () => {
  const rows = [{ id: "a", name: 'Care & "Color"', trend: [{ date: "2026-10-31", revenue: .1 }, { date: "2026-11-01", revenue: .1 }, { date: "2026-11-02", revenue: .2 }] },
    { id: "b", name: "Design", trend: [{ date: "2026-11-02", revenue: .4 }] }];
  const dates = ["2026-10-31", "2026-11-01", "2026-11-02"];
  const daily = salesTrendSeries(rows, dates, "day", "USD");
  assert.deepEqual(daily.series.map(row => row.values), [[.1, .1, .2], [0, 0, .4]]);
  const monthly = salesTrendSeries(rows, dates, "month", "USD");
  assert.deepEqual(monthly.labels, ["2026-10", "2026-11"]);
  assert.deepEqual(monthly.series.map(row => row.values), [[.1, .3], [0, .4]]);
  assert.deepEqual(salesTrendSeries(rows, dates, "month", "USD", "b").series, [monthly.series[1]], "filtering keeps the original color index");
  assert.equal(salesTrendSeries([{ ...rows[1], colorIndex: 5 }], dates, "month", "USD").series[0].colorIndex, 5);
  const model = parse(xyChart("Sales", monthly.labels, monthly.series.map(row => row.values), "line", "USD", monthly.series.map(row => row.name)));
  assert.equal(model.type, "xychart");
  if (model.type === "xychart") assert.deepEqual(model.plots.map(row => diagramPlainText(row.title)), rows.map(row => row.name));
});

test("menu composition preserves tiny slices, duplicate names, zero totals and the full circle", () => {
  const slices = salesComposition([{ id: "a", name: "Care", revenue: .01 }, { id: "b", name: "Care", revenue: 9.99 }, { id: "c", name: "Free", revenue: 0 }], "USD");
  assert.equal(slices.length, 2);
  assert.equal(slices[0].percent, .1);
  assert.ok(slices[0].end > slices[0].start);
  assert.equal(slices[1].end, Math.PI * 2);
  assert.equal(slices.reduce((sum, row) => sum + row.amount, 0), 1000);
  assert.deepEqual(salesComposition([{ id: "a", name: "Free", revenue: 0 }], "JPY"), []);
  assert.equal(salesComposition([{ id: "a", name: "Only menu", revenue: 1 }], "JPY")[0].percent, 100);
});

test("a 90-day comparison renders every configured menu within the diagram limits", () => {
  const dates = Array.from({ length: 90 }, (_, index) => new Date(Date.parse("2026-08-10T00:00:00Z") + index * 86400000).toISOString().slice(0, 10));
  const menus = Array.from({ length: 50 }, (_, index) => ({ id: `menu-${index}`, name: `Menu ${index}`, trend: dates.map((date, day) => ({ date, revenue: (index + 1) * (day + 1) * 110.25 })) }));
  const comparison = salesTrendSeries(menus, dates, "day", "USD");
  const source = xyChart("All menus", dates, comparison.series.map(row => row.values), "line", "USD", comparison.series.map(row => row.name));
  const result = render(source, { limit: 50000, outputLimit: 1000000 });
  assert.equal((result.svg.match(/class="pele-series pele-line"/g) || []).length, 50);
});

test("daily cohort maturity waits full elapsed windows across daylight saving changes", () => {
  const config = structuredClone(sample); config.region = { country: "US", timeZone: "America/New_York" };
  const result = bookingAnalytics(config, [], [], 7, new Date("2026-03-09T04:30:00Z"));
  assert.equal(result.cohorts.find(row => row.date === "2026-03-07")?.mature1Day, false, "the spring-forward day provides only 23.5 hours after the cohort closes");
  assert.equal(result.cohorts.find(row => row.date === "2026-03-06")?.mature1Day, true);
});

test("monthly grouping weights conversion by entrants, preserves money, and keeps immature months pending", () => {
  const data = bookingAnalytics(sample, [], [], 7, now);
  const rows = data.cohorts.slice(0, 2).map((row, i) => ({ ...row, entered: i ? 10 : 100, completed: i ? 9 : 10, menu: 0, slot: 0, mature7Days: !i }));
  const grouped = groupCohorts(rows, "month");
  assert.equal(grouped.length, 1); assert.equal(grouped[0].entered, 110); assert.equal(grouped[0].completed, 19);
  assert.equal(grouped[0].mature7Days, false);
  assert.equal(groupCohorts(rows, "day"), rows);
  assert.deepEqual(groupSales([{ date: "2026-10-31", revenue: .1 }, { date: "2026-11-01", revenue: .1 }, { date: "2026-11-02", revenue: .2 }], "month", "USD"), [{ date: "2026-10", revenue: .1 }, { date: "2026-11", revenue: .3 }]);
});

test("monthly traffic deduplicates browsers within months, isolates shops and withholds incomplete uniques", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:"), shop = await store.createShop("monthly@example.com");
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  await store.put("session", digest("monthly-owner"), { user: { role: "owner", email: shop.owner, shopId: shop.id }, expires: Date.now() + 600000 });
  const today = dateIn(new Date(), "Asia/Tokyo"), previous = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const month = previous.toISOString().slice(0, 7);
  for (const [day, visitorKey] of [[`${month}-10`, "a"], [`${month}-11`, "a"], [`${month}-11`, "b"], [`${month}-12`, undefined], [today, "a"]] as const) {
    await store.appendShopLog(event(day === today ? new Date(Date.now() - 1).toISOString() : zonedDate(day, "10:00", "Asia/Tokyo").toISOString(), "home", { shopId: shop.id, day, visitorKey }));
  }
  await store.appendShopLog(event(new Date().toISOString(), "home", { shopId: "foreign", day: today, visitorKey: "foreign" }));
  const server = createApp(store); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  const get = () => fetch(`${origin}/api/shops/${shop.id}/access?days=90&unit=month`, { headers: { Cookie: "gemihub_session=monthly-owner" } });
  const response = await get(); assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.totalViews, 5); assert.equal(result.uniqueCountsAvailable, true);
  assert.deepEqual(result.rows.find((row: { date: string }) => row.date === month), { date: month, views: 4, uniqueBrowsers: 2 });
  assert.equal(result.rows.find((row: { date: string }) => row.date === today.slice(0, 7)).uniqueBrowsers, 1);
  const provider = new ShopLogs(store).toolsFor(shop.id, undefined, undefined, undefined, async () => result);
  assert.ok(provider.tools.some(tool => tool.name === "get_monthly_traffic"));
  assert.equal((await provider.invoke("get_monthly_traffic", {})).source?.path, "logs:monthly-traffic");
  await assert.rejects(provider.invoke("get_monthly_traffic", { shopId: "foreign" }));
  t.mock.method(store, "queryShopLogs", async () => Array.from({ length: 20001 }, () => ({} as ShopLog)));
  const limited = await (await get()).json();
  assert.equal(limited.totalViews, 5); assert.equal(limited.uniqueCountsAvailable, false);
  assert.ok(limited.rows.every((row: { uniqueBrowsers: number | null }) => row.uniqueBrowsers === null));
});

test("analytics endpoint and read tool are tenant-scoped; tracking excludes operators and validates staff", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:"), shop = await store.createShop("analytics@example.com"), foreign = await store.createShop("other@example.com");
  for (const row of [shop, foreign]) { row.published = structuredClone(sample); row.publication = "public"; await store.saveShop(row); }
  await store.put("session", digest("analytics-owner"), { user: { role: "owner", email: shop.owner, shopId: shop.id }, expires: Date.now() + 600000 });
  const server = createApp(store); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  const headers = { Cookie: "gemihub_session=analytics-owner" };
  assert.equal((await fetch(`${origin}/api/shops/${shop.id}/booking-analytics`)).status, 403);
  assert.equal((await fetch(`${origin}/api/shops/${foreign.id}/booking-analytics`, { headers })).status, 403);
  assert.equal((await fetch(`${origin}/api/shops/${shop.id}/booking-analytics?days=8`, { headers })).status, 400);
  const visitorId = randomUUID();
  const post = (path: string, data: unknown, owner = false) => fetch(`${origin}/api/public/${shop.slug}/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(owner ? headers : {}) }, body: JSON.stringify(data) });
  assert.equal((await post("page-views", { page: "reserve", visitorId })).status, 200);
  assert.equal((await post("booking-events", { event: "slot_selected", visitorId, staffId: sample.staff[0].id })).status, 200);
  assert.equal((await post("booking-events", { event: "slot_selected", visitorId, staffId: "missing" })).status, 400);
  assert.equal((await post("booking-events", { event: "booking_completed", visitorId })).status, 400);
  assert.equal((await post("booking-events", { event: "menu_selected", visitorId, shopId: foreign.id })).status, 400);
  assert.equal((await post("page-views", { page: "reserve", visitorId: randomUUID() }, true)).status, 200);
  const response = await fetch(`${origin}/api/shops/${shop.id}/booking-analytics?days=7`, { headers });
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.funnel.entered, 1); assert.equal(data.funnel.slot, 1);
  assert.ok(!JSON.stringify(data).includes(visitorId));
  const tools = new ShopLogs(store).toolsFor(shop.id, undefined, undefined, async () => data);
  assert.ok(tools.tools.some(tool => tool.name === "get_booking_analytics"));
  assert.equal((await tools.invoke("get_booking_analytics", { days: 7 })).source?.path, "logs:booking-analytics");
  await assert.rejects(tools.invoke("get_booking_analytics", { days: 7, shopId: foreign.id }));
});
