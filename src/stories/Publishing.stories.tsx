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

export const PublishedHistory: Story = { name: "公開後の画面確認・全体の版履歴", args: { scenario: "published-history" } };

export const DomainDNS: Story = { name: "独自ドメイン・DNS待ち", args: { scenario: "domain-dns" } };
export const DomainCertificate: Story = { name: "独自ドメイン・証明書発行中", args: { scenario: "domain-certificate" } };
export const DomainConnected: Story = { name: "独自ドメイン・接続済み", args: { scenario: "domain-connected" } };
export const DomainRetrying: Story = { name: "独自ドメイン・再確認中", args: { scenario: "domain-retrying" } };

export const DomainPreparing: Story = { name: "独自ドメイン・証明書DNS準備中", args: { scenario: "domain-preparing" } };
