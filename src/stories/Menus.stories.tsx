import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/設定/メニュー・料金",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Menus: Story = { name: "メニュー・料金の保存", args: { scenario: "manage-menus" } };
export const Addons: Story = { name: "単独予約不可の追加メニューを設定", args: { scenario: "manage-addons" } };
export const HiddenMenus: Story = { name: "無効なメニューは初期状態で非表示", args: { scenario: "manage-hidden-menus" } };
export const ShowHiddenMenus: Story = {
  name: "非表示のメニューも表示",
  args: { scenario: "manage-hidden-menus" },
  play: async ({ canvasElement }) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const toggle = canvasElement.querySelector<HTMLInputElement>('.live-settings-menus .editor > .check-field input[type="checkbox"]');
      if (toggle) { if (!toggle.checked) toggle.click(); return; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Menu visibility toggle did not load");
  },
};
