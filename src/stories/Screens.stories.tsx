import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/設定/お店の基本情報",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = { name: "お店の基本情報の保存", args: { scenario: "manage-basic" } };

export const Hours: Story = { name: "営業時間・休業日の保存", args: { scenario: "manage-hours" } };

export const Rules: Story = { name: "予約ルールの保存", args: { scenario: "manage-rules" } };
