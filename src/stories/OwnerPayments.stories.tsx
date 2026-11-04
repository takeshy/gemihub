import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
const meta = {
  title: "運営/予約・お客様/お支払いと返金",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: args => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = { name: "支払済み予約の管理", args: { scenario: "owner-paid" } };
export const Policy: Story = { name: "返金条件の設定", args: { scenario: "manage-payment" } };
export const InsufficientFunds: Story = { name: "残高不足と返金の再確認", args: { scenario: "insufficient-refund" } };
