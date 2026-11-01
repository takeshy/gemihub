import React from "react";
import { within, userEvent } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "お客様の予約",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Customer: Story = {
  name: "顧客・スタッフ指名の予約",
  args: { scenario: "reservation" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(await canvas.findByRole("combobox", { name: /^スタッフ/ }), "aoi");
  },
};

export const AnyStaff: Story = {
  name: "顧客・指名なしの予約",
  args: { scenario: "any-reservation" },
};

export const CustomerChoice: Story = {
  name: "顧客・指名と指名なしを選択",
  args: { scenario: "customer-choice" },
};


export const Contact: Story = {
  name: "顧客・お問い合わせ",
  args: { scenario: "contact" },
};
