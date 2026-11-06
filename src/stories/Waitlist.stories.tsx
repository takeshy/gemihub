import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent } from "storybook/test";
import { tr } from "../../shared/i18n";
import { Screen } from "./Screen";

const meta = {
  title: "お客様の画面/空き通知",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Registration: Story = {
  name: "空き通知を登録（キャンセル待ち）",
  args: { scenario: "waitlist-reservation" },
  play: async ({ canvasElement, args }) => {
    if (args.autoplay === false) return;
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText(tr("希望の時間が空いたら知らせる"), { selector: "summary" }));
    await canvas.findByRole("button", { name: tr("空き通知を登録") });
    canvasElement.querySelector(".waitlist-request")!.scrollIntoView({ block: "start" });
  },
};

export const Registered: Story = {
  name: "空き通知を確認・停止",
  args: { scenario: "waitlist-mypage" },
};
