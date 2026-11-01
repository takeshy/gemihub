import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/公開・連携",
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
  name: "Google 連携の再送",
  args: { scenario: "sync-error" },
};

export const PublicationError: Story = {
  name: "公開の再試行",
  args: { scenario: "publication-error" },
};
