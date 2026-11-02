import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  id: "お店づくり",
  title: "運営/お店づくり",
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

export const ProductionPreview: Story = {
  name: "本番公開前に各画面を確認",
  args: { scenario: "production-preview" },
};

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

export const Changes: Story = {
  name: "公開後の変更依頼",
  args: { scenario: "changes" },
};

export const ShopSpecification: Story = { name: "トップの変更履歴・現在のお店の設定とAI相談", args: {scenario: "system"} };

export const LocalEditor: Story = {
  name: "画面を試す・ローカル編集と反映",
  args: { scenario: "local-editor" },
};
export const LocalEditorNew: Story = {
  name: "仮公開したお店をローカルで試す",
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
export const AIPageBuilder: Story = { name: "相談・修正・新ページ作成を選ぶ", args: { scenario: "page-builder" } };
