import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import type { LiveSection } from "../../server/live-settings";

const meta = { title: "運営/AIで設定", component: Screen, parameters: { layout: "fullscreen" }, render: args => <Screen key={args.scenario} {...args} /> } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
const open = (section: LiveSection) => async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const button = canvasElement.querySelector<HTMLButtonElement>(`.live-settings-${section} .section-top button`);
    if (button && !button.disabled) { button.click(); button.scrollIntoView({ block: "center" }); return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("AI settings button did not become available");
};
export const Basic: Story = { name: "メモ・URLからお店の基本情報を設定", args: { scenario: "manage-basic" }, play: open("basic") };
export const Menus: Story = { name: "メモ・URLからメニューを設定", args: { scenario: "manage-menus" }, play: open("menus") };
export const Staff: Story = { name: "メモ・URLからスタッフを設定", args: { scenario: "manage-staff" }, play: open("staff") };
export const Hours: Story = { name: "メモ・URLから営業時間を設定", args: { scenario: "manage-hours" }, play: open("hours") };
export const Rules: Story = { name: "メモ・URLから予約ルールを設定", args: { scenario: "manage-rules" }, play: open("rules") };
