import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/お店づくり/仮公開・本番公開",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Provisional: Story = {
  name: "仮公開中・本人のみ閲覧・本番公開前の確認へ",
  args: { scenario: "provisional" },
};

export const ProvisionalNeedsSettings: Story = {
  name: "仮公開後は各メニューで設定",
  args: { scenario: "provisional-unconfigured" },
};

export const ProvisionalPage: Story = {
  name: "仮公開ページ・本人のログイン中",
  args: { scenario: "provisional-page" },
};

export const ProductionPreview: Story = {
  name: "本番公開前に各画面を確認",
  args: { scenario: "production-preview" },
};
