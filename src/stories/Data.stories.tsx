import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/設定/データ管理",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Data: Story = {
  name: "データ管理は無効・基本情報を表示",
  args: { scenario: "data" },
};

export const NoExtraData: Story = { name: "追加データなし・基本情報を表示", args: { scenario: "data-empty" } };
