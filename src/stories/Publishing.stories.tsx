import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/設定/公開の設定",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Settings: Story = {
  name: "独自ドメインの設定",
  args: { scenario: "settings" },
};

export const SyncError: Story = {
  name: "Google 連携の処理待ち・警告なし",
  args: { scenario: "sync-error" },
};

export const PublicationError: Story = {
  name: "公開の再試行",
  args: { scenario: "publication-error" },
};
