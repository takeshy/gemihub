import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/メニュー・料金",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Menus: Story = { name: "メニュー・料金の保存", args: { scenario: "manage-menus" } };
