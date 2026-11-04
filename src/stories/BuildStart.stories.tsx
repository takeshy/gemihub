import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { openEditingChat } from "./story-helpers";

const meta = {
  title: "運営/お店づくり/はじめてのお店づくり",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Onboarding: Story = {
  name: "初回ログイン・お店づくりだけを表示",
  args: { scenario: "onboarding" },
};

export const PlanReview: Story = {
  name: "用意するページと機能を確認",
  args: { scenario: "plan" },
};

export const InitialTheme: Story = {
  name: "初回テーマ・赤ペン修正・お知らせと紹介ページ",
  args: { scenario: "initial-theme" },
};

export const InitialThemeChat: Story = {
  name: "初回テーマ・右側の修正チャット",
  args: { scenario: "initial-theme" },
  play: openEditingChat,
};
