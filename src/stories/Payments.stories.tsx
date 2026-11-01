import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
const meta = {
  title: "お客様の予約/お支払い・返金",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: args => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Payment: Story = { name: "支払額・返金条件への同意", args: { scenario: "payment-reservation" } };
export const Paid: Story = { name: "支払済みの予約", args: { scenario: "paid-mypage" } };
export const PartialRefund: Story = { name: "50%返金完了", args: { scenario: "partial-refund" } };
export const ZeroRefund: Story = { name: "返金なし", args: { scenario: "zero-refund" } };
export const FullRefund: Story = { name: "店都合・全額返金", args: { scenario: "full-refund" } };
export const PendingRefund: Story = { name: "返金確認中", args: { scenario: "pending-refund" } };
export const FailedRefund: Story = { name: "返金の確認が必要", args: { scenario: "failed-refund" } };
export const Owner: Story = { name: "運営・支払済み予約の管理", args: { scenario: "owner-paid" } };
export const Policy: Story = { name: "運営・返金条件の設定", args: { scenario: "manage-payment" } };

export const InsufficientFunds: Story = { name: "運営・残高不足と返金の再確認", args: { scenario: "insufficient-refund" } };
