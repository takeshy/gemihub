import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
const meta = { title: "運営/ダッシュボード", component: Screen, parameters: { layout: "fullscreen" }, render: args => <Screen key={args.scenario} {...args} /> } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShopSpecification: Story = { name: "本日の予約・未対応のお問い合わせ・現在のお店の設定", args: { scenario: "system" } };
export const ShopSpecificationPayment: Story = { name: "現在の設定・PayPal決済と返金条件", args: { scenario: "system-payment" } };
export const ShopSpecificationOwnerOnly: Story = { name: "現在の設定・店主のみ・ブログとお知らせなし", args: { scenario: "system-owner-only" } };
export const Empty: Story = { name: "予約も未対応の問い合わせもない", args: { scenario: "management-dashboard-empty" } };
export const Provisional: Story = { name: "仮公開中のダッシュボード", args: { scenario: "management-dashboard-provisional" } };
export const Staff: Story = { name: "スタッフのダッシュボード", args: { scenario: "management-dashboard-staff" } };

export const GoogleIntegration: Story = { name: "Google連携の要対応", args: { scenario: "integration-alerts" } };
