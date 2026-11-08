import { sampleCurrency } from "./sample-data";
import React, { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent } from "storybook/test";
import { tr } from "../../shared/i18n";
import type { Currency } from "../../shared/region";
import type { ArticleAccessDays } from "../../shared/article-access";
import { ApiProvider, type ApiClient } from "../api";
import { ShopRegionContext } from "../money";
import { ShopAnalytics } from "../ShopAnalytics";
import type { AccessView } from "../ShopAccess";
import { analyticsFixture, trafficFixture, type AnalyticsFixtureState } from "./booking-analytics-fixtures";
import type { AnalyticsUnit } from "../../shared/analytics-grouping";
import { Screen } from "./Screen";

type Props = { view: AccessView; state?: AnalyticsFixtureState; currency?: Currency; unit?: AnalyticsUnit };
function AnalyticsPreview({ view, unit = "day", state = "ready", currency = sampleCurrency() }: Props) {
  const api = useMemo(() => (async (path: string) => {
    const url = new URL(path, "https://storybook.invalid");
    const days = Number(url.searchParams.get("days") || 30) as ArticleAccessDays;
    const data = analyticsFixture(days, state, currency);
    if (url.pathname.endsWith("/booking-analytics")) return data;
    if (url.pathname.endsWith("/posts/access")) return { days, from: data.from, to: data.to, total: 128, byCategory: { blogs: 90, announcements: 38 }, rows: [
      { postId: "blog", category: "blogs", title: tr("ブログ"), path: "/blogs/story", views: 90, uniqueBrowsers: 60 },
      { postId: "news", category: "announcements", title: tr("お知らせ"), path: "/announcements/story", views: 38, uniqueBrowsers: 25 },
    ] };
    return trafficFixture(days, state, currency, url.searchParams.get("unit") || "day");
  }) as ApiClient, [state, currency]);
  return <ApiProvider value={api}><ShopRegionContext.Provider value={currency === "USD" ? { country: "US", timeZone: "America/New_York" } : { country: "JP", timeZone: "Asia/Tokyo" }}>
    <main style={{ maxWidth: 1000, margin: "auto", padding: 16, minWidth: 0 }}>
      <ShopAnalytics key={`${view}:${unit}`} shopId="analytics-story" initialView={view} initialUnit={unit} />
    </main>
  </ShopRegionContext.Provider></ApiProvider>;
}
const meta = {
  title: "運営/分析", component: AnalyticsPreview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AnalyticsPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ManagementPage: Story = { name: "独立した分析メニュー", args: { view: "daily" }, render: () => <Screen scenario="analytics" /> };

export const DailyTraffic: Story = { name: "匿名ユーザーを含む日別アクセス数", args: { view: "daily" } };
export const ArticleTraffic: Story = { name: "記事別のPV・ユニークブラウザ数", args: { view: "articles" } };
export const MonthlyTraffic: Story = { name: "月別アクセス・ブラウザの重複を除外", args: { view: "daily", unit: "month" } };
export const MonthlyCohorts: Story = { name: "月別予約コホート", args: { view: "cohorts", unit: "month" } };
export const MonthlySales: Story = { name: "月別スタッフ売上推移", args: { view: "staff", unit: "month" } };
export const MenuSales: Story = { name: "メニュー別売上・追加メニューの内訳", args: { view: "menus" } };
export const MonthlyMenuSales: Story = { name: "月別メニュー売上推移", args: { view: "menus", unit: "month" } };
export const EmptyMenuSales: Story = { name: "メニュー別売上・実績なし", args: { view: "menus", state: "empty" } };
export const AddonSales: Story = {
  name: "メニュー指定・スタッフ別売上推移", args: { view: "menus", unit: "month" },
  play: async ({ canvasElement }) => {
    await userEvent.selectOptions(await within(canvasElement).findByRole("combobox", { name: tr("売上推移のメニュー") }), "care");
  },
};

export const BookingCohorts: Story = { name: "予約コホート・到達数と完了率", args: { view: "cohorts" } };
export const StaffSales: Story = { name: "スタッフ別売上・推移と予約完了率", args: { view: "staff" } };
export const OneStaffTrend: Story = {
  name: "スタッフ指定・メニュー別売上", args: { view: "staff" },
  play: async ({ canvasElement }) => {
    await userEvent.selectOptions(await within(canvasElement).findByRole("combobox", { name: tr("表示するスタッフ") }), "haru");
  },
};
export const OneStaffNoSales: Story = {
  name: "スタッフ指定・売上なし", args: { view: "staff", state: "empty" },
  play: async ({ canvasElement }) => {
    await userEvent.selectOptions(await within(canvasElement).findByRole("combobox", { name: tr("表示するスタッフ") }), "haru");
  },
};
export const DollarSales: Story = { name: "ドル建てのスタッフ売上", args: { view: "staff", currency: "USD" } };
export const EmptyCohorts: Story = { name: "予約コホート・記録なし", args: { view: "cohorts", state: "empty" } };
export const EmptySales: Story = { name: "スタッフ売上・実績なし", args: { view: "staff", state: "empty" } };
export const TruncatedCohorts: Story = { name: "予約コホート・記録上限超過", args: { view: "cohorts", state: "truncated" } };
export const TruncatedStaff: Story = { name: "記録上限超過でも売上を表示", args: { view: "staff", state: "truncated" } };
