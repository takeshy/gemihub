import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaymentDetails } from "../PaymentDetails";
import { ShopRegionContext } from "../money";
import type { Booking } from "../../server/domain";
import { type RefundTiers } from "../../server/payment-domain";
import type { Region } from "../../shared/region";
import { tr } from "../../shared/i18n";

// Historical snapshots keep their original dates and rates after default changes.
const legacyRefundTiers: RefundTiers = [{ hoursBefore: 72, percent: 100 }, { hoursBefore: 24, percent: 50 }, { hoursBefore: 0, percent: 0 }];
function example(start: string, policy: RefundTiers = structuredClone(legacyRefundTiers)): Booking {
  return { id: "refund-date-example", shopId: "example", customer: "guest@example.com", name: "Guest", menuId: "simple", staffId: "aoi", price: 5500, message: "", start, end: new Date(Date.parse(start) + 3600000).toISOString(), status: "active", createdAt: "2026-01-01T00:00:00Z", payment: { provider: "paypal", environment: "live", orderId: "example", captureId: "example", amount: 5500, currency: "JPY", policy } };
}
const jp: Region = { country: "JP", timeZone: "Asia/Tokyo" }, us: Region = { country: "US", timeZone: "America/New_York" };
const meta = { title: "お客様の画面/返金期限", component: PaymentDetails, parameters: { layout: "fullscreen" }, render: (args, context) => <ShopRegionContext.Provider value={context.parameters.region || jp}><main className="public-shop"><h1>{tr("返金期限")}</h1><section className="panel"><PaymentDetails {...args}/></section></main></ShopRegionContext.Provider>, play: async ({ canvasElement }) => { const details = canvasElement.querySelector("details"); if (details) details.open = true; } } satisfies Meta<typeof PaymentDetails>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Japan: Story = { name: "予約日時からの返金期限・年またぎ", args: { booking: example("2027-01-02T01:00:00Z") }, parameters: { region: jp } };
export const Spring: Story = { name: "米国・夏時間開始をまたぐ返金期限", args: { booking: example("2026-03-09T14:00:00Z") }, parameters: { region: us } };
export const Fall: Story = { name: "米国・同じ時刻が繰り返す日の返金期限", args: { booking: example("2026-11-02T06:30:00Z", [{ hoursBefore: 25, percent: 100 }, { hoursBefore: 24, percent: 50 }, { hoursBefore: 0, percent: 0 }]) }, parameters: { region: us } };
export const Always: Story = { name: "期限のない返金条件", args: { booking: example("2027-01-02T01:00:00Z", [{ hoursBefore: 0, percent: 100 }]) }, parameters: { region: jp } };
