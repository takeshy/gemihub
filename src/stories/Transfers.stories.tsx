import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "お客様の画面/キャンセルとお得な空き枠",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: args => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Offers: Story = { name: "20%引き・半額の空き枠を予約", args: { scenario: "transfer-offers" } };
export const Eligible: Story = { name: "キャンセルする・元の予約に戻す", args: { scenario: "transfer-eligible" } };
export const Listed: Story = { name: "キャンセル受付済み・取り消し可能", args: { scenario: "transfer-listed" } };
export const SellerBuying: Story = { name: "代わりの方の決済中・取り消し不可", args: { scenario: "transfer-seller-buying" } };
export const BuyerCreating: Story = { name: "空き枠の支払い手続きの再開", args: { scenario: "transfer-buyer-creating" } };
export const BuyerPaying: Story = { name: "空き枠の決済確認中", args: { scenario: "transfer-buyer-paying" } };
export const BuyerReview: Story = { name: "空き枠の決済結果の確認が必要", args: { scenario: "transfer-buyer-review" } };
export const Sold: Story = { name: "代わりの予約が入り返金完了", args: { scenario: "transfer-sold" } };
export const PendingRefund: Story = { name: "代わりの予約が入り返金確認中", args: { scenario: "transfer-refund-pending" } };
export const RefundReview: Story = { name: "代わりの予約が入り返金の確認が必要", args: { scenario: "transfer-refund-review" } };
export const Expired: Story = { name: "受付期限後に返金額が確定", args: { scenario: "transfer-expired" } };
export const Received: Story = { name: "お得な空き枠からの予約", args: { scenario: "transfer-received" } };
