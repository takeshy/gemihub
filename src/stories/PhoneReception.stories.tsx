import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = { title: "運営/設定/AI電話受付", component: Screen, parameters: { layout: "fullscreen" }, args: { scenario: "settings" }, render: args => <Screen {...args} /> } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Rules: Story = { name: "電話AIの応対ルール" };
export const ImproveFromCall: Story = {
  name: "通話からルールを改善",
  play: async ({ canvasElement }) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const panel = canvasElement.querySelector(".phone-reception-settings");
      const calls = panel?.querySelector<HTMLDetailsElement>("details:has(.phone-calls)");
      if (calls) {
        calls.open = true;
        const button = calls.querySelector<HTMLButtonElement>("button");
        if (button) { button.click(); panel?.scrollIntoView({ block: "start" }); return; }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Phone call did not load");
  },
};
