import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { tr } from "../../shared/i18n";

const meta = {
  title: "運営/画面の編集/サンプル予約の支払い・返金",
  component: Screen,
  parameters: { layout: "fullscreen" },
  args: { scenario: "local-editor" },
  render: args => <Screen {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Refunded: Story = {
  play: async ({ canvasElement }) => {
    for (let i = 0; i < 100; i++) {
      const mine = [...canvasElement.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(item => item.textContent === tr("マイページ"));
      if (mine) { mine.click(); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (let i = 0; i < 100; i++) {
      const summary = [...canvasElement.querySelectorAll<HTMLElement>('summary')].find(item => item.textContent === tr("サンプルデータを編集"));
      if (summary) { summary.click(); summary.scrollIntoView({ block: "start" }); return; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Sample payment editor did not load");
  },
};
