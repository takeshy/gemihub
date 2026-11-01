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
  name: "データ管理・追加データの編集",
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

export const Menus: Story = { name: "メニュー・料金の保存", args: { scenario: "manage-menus" } };
export const Staff: Story = { name: "スタッフ・勤務の保存", args: { scenario: "manage-staff" } };
export const Hours: Story = { name: "営業時間・休業日の保存", args: { scenario: "manage-hours" } };
export const Rules: Story = { name: "予約ルールの保存", args: { scenario: "manage-rules" } };

export const Basic: Story = { name: "お店の基本情報の保存", args: { scenario: "manage-basic" } };

export const NoExtraData: Story = { name: "データ管理・追加データなし", args: { scenario: "data-empty" } };
