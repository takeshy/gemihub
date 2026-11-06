import React from "react";
import { within, userEvent } from "storybook/test";
import { tr } from "../../shared/i18n";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/予約・お客様/予約管理",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Reservations: Story = {
  name: "予約管理",
  args: { scenario: "bookings" },
};

export const Pagination: Story = { name: "一覧・複数ページ", args: { scenario: "bookings-long" }, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: tr("絞り込みを解除") }));
} };
