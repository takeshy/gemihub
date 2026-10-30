import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Reservations: Story = {
  name: "運営・予約管理",
  args: { scenario: "bookings" },
};

export const Inquiries: Story = {
  name: "運営・問い合わせ返信",
  args: { scenario: "inquiries" },
};

export const Team: Story = {
  name: "家族・スタッフの招待",
  args: { scenario: "team" },
};

export const Data: Story = {
  name: "データ・仕様・変更履歴",
  args: { scenario: "data" },
};

export const Settings: Story = {
  name: "独自ドメインの設定",
  args: { scenario: "settings" },
};

export const SyncError: Story = {
  name: "Google 連携の再送",
  args: { scenario: "sync-error" },
};

export const PublicationError: Story = {
  name: "公開の再試行",
  args: { scenario: "publication-error" },
};
