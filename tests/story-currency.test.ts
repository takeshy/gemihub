import assert from "node:assert/strict";
import { test } from "node:test";
import { setLocaleResolver } from "../shared/i18n.ts";
import { currencyOf, regionOf, fromMinor } from "../shared/region.ts";
import { sample } from "../server/domain.ts";
import { sampleConfig, samplePrice } from "../src/stories/sample-data.ts";
import { createMockClient } from "../src/stories/mock.ts";
import { analyticsFixture } from "../src/stories/booking-analytics-fixtures.ts";
import type { Workspace } from "../src/App.tsx";

test("English sample bookings, payments, coupons and analytics agree on dollars while Japanese samples keep yen", async () => {
  try {
    for (const language of ["en", "ja"] as const) {
      setLocaleResolver(() => language);
      const currency = language === "en" ? "USD" : "JPY";
      const config = sampleConfig();
      assert.equal(currencyOf(regionOf(config)), currency);
      assert.equal(config.menus[0].price, language === "en" ? 55 : 5500);
      assert.equal(samplePrice(config, 500), language === "en" ? 5 : 500);
      const client = createMockClient("owner-paid");
      const workspace = await client("/api/workspace") as { shops: Workspace[] };
      const shop = workspace.shops[0];
      const booking = shop.bookings[0];
      assert.equal(booking.price, config.menus[0].price);
      assert.equal(booking.payment!.currency, currency);
      assert.equal(fromMinor(booking.payment!.amount, currency), booking.price);
      const wallet = await createMockClient("coupon-mypage")("/api/public/story-shop/coupons") as { currency: string }[];
      assert.equal(wallet[0].currency, currency);
      assert.equal(analyticsFixture().currency, currency);
    }
    assert.equal(sample.region, undefined);
    assert.equal(sample.menus[0].price, 5500, "real shop defaults are never mutated by examples");
    setLocaleResolver(() => "ja");
    assert.equal(sampleConfig(true).menus[0].price, 55.25, "explicit US examples keep cents regardless of language");
  } finally { setLocaleResolver(() => "ja"); }
});
