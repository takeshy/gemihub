import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "お客様の会員登録",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Anonymous: Story = {
  name: "顧客・ログイン前はお店の紹介・会員登録とログイン",
  args: { scenario: "anonymous" },
};

export const Registration: Story = {
  name: "顧客・メール確認後の会員情報登録",
  args: { scenario: "registration" },
};
