import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "お店づくり",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Onboarding: Story = {
  name: "お店の情報を入力",
  args: { scenario: "onboarding" },
};

export const PlanReview: Story = {
  name: "プランを確認・承認",
  args: { scenario: "plan" },
};

export const Approved: Story = {
  name: "承認済み・公開前",
  args: { scenario: "approved" },
};

export const Preview: Story = {
  name: "モックプレビュー",
  args: { scenario: "preview" },
};

export const Changes: Story = {
  name: "公開後の変更依頼",
  args: { scenario: "changes" },
};

export const ShopSystem: Story = { name: "お店の仕組み図と質問", args: {scenario: "system"} };

export const PenPreview: Story = { name: "プレビューへのペン入力", args: {scenario: "visual-preview"} };

export const PenLive: Story = { name: "公開ページへのペン入力", args: {scenario: "visual-live"} };
