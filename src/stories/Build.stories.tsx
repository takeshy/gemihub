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

export const ShopSpecification: Story = { name: "現在の仕様・履歴とAI相談", args: {scenario: "system"} };

export const PenPreview: Story = { name: "プレビューへのペン入力", args: {scenario: "visual-preview"} };

export const PenLive: Story = { name: "公開ページへのペン入力", args: {scenario: "visual-live"} };

export const LocalEditor: Story = {
  name: "画面を試す・ローカル編集と反映",
  args: { scenario: "local-editor" },
};
export const LocalEditorNew: Story = {
  name: "公開前のお店をローカルで試す",
  args: { scenario: "local-editor-new" },
};

export const CustomPagesEditor: Story = {
  name: "追加ページ・画面ツリーと個別反映",
  args: { scenario: "local-editor-pages" },
};

export const UnfetchedPages: Story = {
  name: "初期サイドツリー・開くと自動取得",
  args: { scenario: "editor-unfetched" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("unfetched"); return {}; }],
};
export const RemoteUpdates: Story = {
  name: "リモート更新・変更あり",
  args: { scenario: "editor-remote" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("remote"); return {}; }],
};
export const PageConflict: Story = {
  name: "競合・プレビュー比較とAI結合",
  args: { scenario: "editor-conflict" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("conflict"); return {}; }],
};
export const AIPageBuilder: Story = { name: "別メニューでAIとページをつくる", args: { scenario: "page-builder" } };
