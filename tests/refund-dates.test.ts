import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { refundWindows, refundQuote, type RefundTiers } from "../server/payment-domain.ts";
import type { Booking } from "../server/domain.ts";
import { PaymentDetails } from "../src/PaymentDetails.tsx";
import { ShopRegionContext } from "../src/money.ts";
import { requestLocale } from "../server/i18n.ts";
import { localDateTime, type Region } from "../shared/region.ts";

// Date math is checked with a 72-hour first tier (the default before 2026-11-05), independent of the current default.
const defaultRefundTiers: RefundTiers = [{ hoursBefore: 72, percent: 100 }, { hoursBefore: 24, percent: 50 }, { hoursBefore: 0, percent: 0 }];
const jp: Region = { country: "JP", timeZone: "Asia/Tokyo" }, us: Region = { country: "US", timeZone: "America/New_York" };
const booking = (start: string, policy: RefundTiers = structuredClone(defaultRefundTiers)): Booking => ({ id: "dated", shopId: "shop", customer: "guest@example.com", name: "Guest", menuId: "simple", staffId: "aoi", price: 5500, message: "", start, end: new Date(Date.parse(start) + 3600000).toISOString(), status: "active", createdAt: "2026-01-01T00:00:00Z", payment: { provider: "paypal", environment: "live", orderId: "order", captureId: "capture", amount: 5500, currency: "JPY", policy } });
const render = (record: Booking, region: Region, language: "ja" | "en") => requestLocale.run(language, () => renderToStaticMarkup(React.createElement(ShopRegionContext.Provider, { value: region }, React.createElement(PaymentDetails, { booking: record }))));

test("saved refund tiers produce explicit inclusive deadlines across month and year boundaries", () => {
  const start = "2027-01-02T01:00:00.000Z", policy = structuredClone(defaultRefundTiers);
  const windows = refundWindows(start, policy);
  assert.deepEqual(windows, [
    { percent: 100, until: "2026-12-30T01:00:00.000Z" },
    { percent: 50, after: "2026-12-30T01:00:00.000Z", until: "2027-01-01T01:00:00.000Z" },
    { percent: 0, after: "2027-01-01T01:00:00.000Z" },
  ]);
  for (const [index, window] of windows.entries()) {
    if (!window.until) continue;
    assert.equal(refundQuote(10000, start, window.until, policy, "customer").percent, window.percent);
    assert.equal(refundQuote(10000, start, new Date(Date.parse(window.until) + 1).toISOString(), policy, "customer").percent, windows[index + 1].percent);
  }
  assert.equal(refundQuote(10000, start, "2027-01-03T00:00:00Z", policy, "customer").percent, 0);
  assert.deepEqual(policy, defaultRefundTiers, "display does not mutate the saved policy");
});

test("refund deadlines subtract elapsed hours across DST and distinguish repeated local times", () => {
  const spring = refundWindows("2026-03-09T14:00:00Z", defaultRefundTiers);
  assert.equal(spring[0].until, "2026-03-06T14:00:00.000Z"); assert.equal(localDateTime(spring[0].until!, us.timeZone), "2026-03-06T09:00");
  const policy = [{ hoursBefore: 25, percent: 100 }, { hoursBefore: 24, percent: 50 }, { hoursBefore: 0, percent: 0 }];
  const fall = refundWindows("2026-11-02T06:30:00Z", policy);
  assert.equal(fall[0].until, "2026-11-01T05:30:00.000Z"); assert.equal(fall[1].until, "2026-11-01T06:30:00.000Z");
  assert.equal(localDateTime(fall[0].until!, us.timeZone), localDateTime(fall[1].until!, us.timeZone));
  const html = render(booking("2026-11-02T06:30:00Z", policy), us, "en"); assert.match(html, /EDT/); assert.match(html, /EST/);
});

test("My page shows the saved booking policy as localized dated ranges in the shop's time zone", () => {
  const record = booking("2027-01-02T01:00:00Z");
  const ja = render(record, jp, "ja"); assert.match(ja, /2026\/12\/30 10:00/); assert.match(ja, /2027\/1\/1 10:00/); assert.match(ja, /100%返金/); assert.match(ja, /50%返金/); assert.match(ja, /より後/); assert.doesNotMatch(ja, /開始まで72時間/);
  const en = render(record, jp, "en"); assert.match(en, /12\/30\/2026/); assert.match(en, /1\/1\/2027/); assert.match(en, /Through .*100% refund/); assert.match(en, /After .*through .*50% refund/); assert.match(en, /Japan time/);
  const all = render(booking(record.start, [{ hoursBefore: 0, percent: 100 }]), jp, "en"); assert.match(all, /At any time: 100% refund/); assert.equal((all.match(/<li>/g) || []).length, 1);
  assert.throws(() => refundWindows("invalid", defaultRefundTiers));
});
