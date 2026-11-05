import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { tr } from "../../shared/i18n";

const meta = {
  title: "運営/画面の編集/同期と競合",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const UnfetchedPages: Story = {
  name: "初期サイドツリー・開くと自動取得",
  args: { scenario: "editor-unfetched" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("unfetched"); return {}; }],
};

export const RemoteUpdates: Story = {
  name: "本番の更新あり・画面ツリーに表示",
  args: { scenario: "editor-remote-tree" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("remote"); return {}; }],
  // The badge sits on the FAQ page at the end of the sidebar tree.
  play: async ({ canvasElement }) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const badge = canvasElement.querySelector(".sync-badge.sync-remote");
      if (badge) { badge.scrollIntoView({ block: "center" }); return; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  },
};
export const RemoteAdopted: Story = {
  name: "本番の更新あり・開くと自動で取り込む",
  args: { scenario: "editor-remote" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("remote"); return {}; }],
};
export const PageConflict: Story = {
  name: "競合・プレビュー比較とAI結合",
  args: { scenario: "editor-conflict" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("conflict"); return {}; }],
};
export const LocalChanges: Story = {
  name: "変更あり・本番と比較",
  args: { scenario: "editor-local" },
  loaders: [async () => { const { seedEditor } = await import("./sync-fixtures"); seedEditor("local"); return {}; }],
  play: async ({ canvasElement }) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const button = [...canvasElement.querySelectorAll<HTMLButtonElement>(".editor-toolbar button")].find(item => item.textContent === tr("変更を比較"));
      if (button && !button.disabled) { button.click(); return; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  },
};
